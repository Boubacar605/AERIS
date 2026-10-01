/**
 * Relais WhatsApp AERIS — v2 (whatsapp-web.js + Puppeteer).
 *
 * Utilise whatsapp-web.js (Puppeteer/Chrome) au lieu de Baileys :
 * - Automatise un vrai navigateur WhatsApp Web → comportement plus humain
 * - Réduit le risque de détection / hold anti-abus
 * - Session persistée dans /app/.wwebjs_auth (volume Docker)
 *
 * Endpoints HTTP :
 *   GET  /sante      -> {"statut","connexion"}  (sonde réelle du navigateur)
 *   GET  /existe?to= -> {"existant","jid"}      (numéro sur WhatsApp ?)
 *   POST /envoyer    {"to","message"} -> {"ok", "id"}
 *   GET  /statut/:id -> {"id","to","statut",...}
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");

const PORT = Number(process.env.PORT || 3500);
const DOSSIER_SESSION = process.env.DOSSIER_SESSION || "/app/.wwebjs_auth";
const SECRET_RELAY = process.env.SECRET_RELAY || "";

const JID_PATTERN = /^\d{8,15}$/;
const MAX_MESSAGE = 1000;
const DELAI_SIENS = Number(process.env.DELAI_ENTRE_MESSAGES_MS || 3000);

// Robustesse : une opération Puppeteer qui ne répond plus (Chrome gelé) ne
// doit jamais bloquer le relais indéfiniment. Toutes les opérations lentes
// passent par avecTimeout() : dépassement -> le client est recréé.
const TIMEOUT_OPERATION_MS = Number(process.env.TIMEOUT_OPERATION_MS || 35000);
const TIMEOUT_SONDE_MS = Number(process.env.TIMEOUT_SONDE_MS || 12000);
const DELAI_LIVRAISON_MS = Number(process.env.DELAI_LIVRAISON_MS || 120000); // 2 min
// Fenêtre d'attente d'un client prêt avant de refuser un envoi. Passé ce
// délai, l'API répond 503 : le moteur remonte un échec explicite plutôt
// qu'une erreur opaque.
const ATTENTE_PRET_MS = Number(process.env.ATTENTE_PRET_MS || 8000);
// Espacement minimal entre deux creations de client (garde-fou anti-boucle).
const DELAI_RECONNEXION_MS = Number(process.env.DELAI_RECONNEXION_MS || 20000);
// Durée de conservation d'un message suivi (bornage mémoire + /statut).
const DUREE_SUIVI_MS = Number(process.env.DUREE_SUIVI_MS || 3600000);

/** Race entre une promesse et un délai : rejette si la promesse traîne. */
function avecTimeout(promise, ms, libelle) {
  return Promise.race([
    promise,
    new Promise((_, rejeter) =>
      setTimeout(() => rejeter(new Error(libelle || "operation trop lente")), ms),
    ),
  ]);
}

/**
 * Résout le JID canonique d'un numéro avant envoi.
 *
 * Depuis la migration WhatsApp vers les identifiants LID (linked id), certains
 * comptes ne répondent PLUS aux envois vers l'ancien format `2217…@c.us` :
 * sendMessage reste bloqué sans jamais livrer le message. La résolution via
 * getNumberId() fournit le JID actuel (`.lid` ou `.c.us`) et fiabilise l'envoi.
 * Repli sur `@c.us` si la résolution échoue ou que le numéro n'est pas connu.
 */
async function resoudreJid(numero) {
  if (!client) return `${numero}@c.us`;
  try {
    const id = await avecTimeout(client.getNumberId(numero), 20000, "getNumberId trop lente");
    if (id && (id._serialized || id.user)) {
      return id._serialized || `${id.user}@${id.server || "s.whatsapp.net"}`;
    }
  } catch (_) {
    /* repli ci-dessous */
  }
  return `${numero}@c.us`;
}

/** Vérifie que le navigateur répond VRAIMENT (pas seulement « session ouverte »).
 *  - "ouvert"    -> Chrome répond, envoi possible ;
 *  - "en_attente"-> session connectée mais état transitoire ;
 *  - "bloque"    -> Chrome ne répond plus (getState en timeout) ;
 *  - "deconnecte"-> pas de client ou session réellement fermée.
 */
async function capaciteReelle() {
  if (!client) return "deconnecte";
  try {
    const etat = await avecTimeout(client.getState(), TIMEOUT_SONDE_MS, "sonde getState trop lente");
    return etat === "CONNECTED" ? "ouvert" : "en_attente";
  } catch (e) {
    if (e instanceof Error && e.message.includes("trop lente")) return "bloque";
    return "deconnecte";
  }
}

/**
 * Supprime les verrous Chromium restés dans le profil de session après un
 * arret du conteneur (« Recreate »/rebuild). Sans ce nettoyage, le Chromium
 * suivant croit que le profil est utilise par un autre processus et refuse
 * de demarrer (erreur Code:21 « profile appears to be in use »).
 */
function deverrouillerProfil() {
  const dossier = path.join(DOSSIER_SESSION, "session");
  for (const nom of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try { fs.rmSync(path.join(dossier, nom), { force: true }); } catch {}
  }
}

/**
 * Tue le Chromium d'un client donné : un `destroy()` qui dépasse le délai laisse
 * un navigateur fantôme qui garde le profil de session verrouillé. Le
 * Chromium suivant démarre alors sans jamais exposer son endpoint WS et
 * `initialize()` échoue définitivement — c'est ce qui rendait le relais
 * muet après un seul incident.
 */
function tuerNavigateur(clientCible) {
  try {
    clientCible?.puppeteer?.browser?.process()?.kill("SIGKILL");
  } catch {}
}

let client = null; // client whatsapp-web.js actif
let etatConnexion = "deconnecte"; // ouvert | en_attente | deconnecte
let pretDepuis = 0; // dernier « ready » observé (0 = client jamais prêt)
let qrEnAttente = false; // un QR est affiché : recréer le client l'annulerait
let dernierRelance = 0; // horodatage de la dernière création de client

// Suivi de chaque message envoyé
const messagesSuivis = new Map();
const MAX_MESSAGES_SUIVIS = 100;

const dernierEnvoiParNumero = new Map();

function log(niveau, ...args) {
  const h = new Date().toISOString();
  console[niveau in console ? niveau : "log"](`[${h}] [relay] ${args.join(" ")}`);
}

/**
 * whatsapp-web.js message_ack codes :
 *   0 = PENDING, 1 = SERVER (envoyé au serveur)
 *   2 = DEVICE (délivré au destinataire), 3 = READ, 4 = PLAYED
 */
function mapperStatut(ack) {
  return { 0: "en_attente", 1: "envoye_serveur", 2: "delivre", 3: "lu", 4: "joue" }[ack]
    ?? `inconnu(${ack})`;
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

function creerClient() {
  const c = new Client({
    authStrategy: new LocalAuth({ dataPath: DOSSIER_SESSION }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    },
  });

  c.on("qr", (qr) => {
    etatConnexion = "en_attente";
    qrEnAttente = true;
    log("info", "========== SCANNEZ CE CODE QR DANS WHATSAPP ==========");
    qrcodeTerminal.generate(qr, { small: true });
    log("info", "WhatsApp > Appareils connectes > Connecter un appareil");
    log("info", "======================================================");
  });

  c.on("ready", () => {
    etatConnexion = "ouvert";
    qrEnAttente = false;
    pretDepuis = Date.now();
    log("info", "Client whatsapp-web.js pret (session chargee).");
  });

  c.on("authenticated", () => {
    log("info", "Authentification reussie.");
  });

  c.on("auth_failure", (msg) => {
    etatConnexion = "deconnecte";
    qrEnAttente = false;
    log("error", `Echec d'authentification : ${msg}`);
  });

  c.on("disconnected", (raison) => {
    etatConnexion = "deconnecte";
    log("warn", `Deconnecte : ${raison}. Reconnexion...`);
    setTimeout(() => relancerClient(), 5000);
  });

  // Accusés de réception pour nos messages envoyés
  c.on("message_ack", (msg, ack) => {
    // L'id peut arriver sous trois formes : la partie unique (base64), le
    // _serialized (id@serveur) ou une string brute ; quelle que soit la forme,
    // on extrait d'abord la partie unique, celle qui sert de cle de stockage.
    const idBrut =
      (typeof msg === "string" ? msg : msg?.id?.id || msg?.id?._serialized) ?? "";
    if (!idBrut) return;
    const idUnique = idBrut.split("@")[0] || idBrut;
    let id = null;
    if (messagesSuivis.has(idUnique)) {
      id = idUnique;
    } else {
      // Envoi vers soi-même : l'id stocké peut être le _serialized complet ;
      // on retombe alors sur la partie unique de chaque entrée.
      for (const cle of messagesSuivis.keys()) {
        const partieUnique = cle.split("@")[0] || cle;
        if (partieUnique === idUnique) {
          id = cle;
          break;
        }
      }
    }
    if (!id) return;

    const suivi = messagesSuivis.get(id);
    const statut = mapperStatut(ack);
    suivi.statut = statut;
    suivi.horodatage_statut = new Date().toISOString();
    log("info", `Statut ${suivi.to} id=${id} ack=${ack} -> ${statut}`);
  });

  return c;
}

async function demarrer() {
  const ancien = client;
  client = null;
  if (ancien) {
    // Un client gelé (OOM Chrome) peut refuser de se détruire : on borne...
    try {
      await avecTimeout(ancien.destroy(), 6000, "destruction trop lente");
    } catch (e) {
      log("warn", "Ancien client non detruit proprement :", e?.message);
      // ...puis on tue son Chromium. Sans cela, le navigateur fantôme verrouille
      // le profil de session et le nouveau client ne démarre jamais.
      tuerNavigateur(ancien);
    }
  }
  etatConnexion = "en_attente";
  pretDepuis = 0;
  qrEnAttente = false;
  deverrouillerProfil();
  client = creerClient();
  try {
    // initialize() peut attendre sans fin sur un navigateur gelé : on borne
    // aussi cette étape. Les événements (ready/qr) reprendront la main.
    await avecTimeout(client.initialize(), 60000, "initialisation trop lente");
  } catch (e) {
    log("error", "Initialisation du client echouee :", e?.message);
    tuerNavigateur(client);
  }
}

// Garde-fou anti-récursion : une seule relance de client à la fois (le watchdog,
// la supervision et l'échec d'un envoi peuvent la vouloir presque simultanément).
let relanceEnCours = null;
function relancerClient(raison, immediat = false) {
  if (relanceEnCours) return relanceEnCours;
  if (!immediat && Date.now() - dernierRelance < DELAI_RECONNEXION_MS) return null;
  dernierRelance = Date.now();
  log("warn", `Relance du client WhatsApp : ${raison}`);
  relanceEnCours = demarrer()
    .catch((e) => log("error", "Echec reinitialisation :", e?.message ?? e))
    .finally(() => {
      relanceEnCours = null;
    });
  return relanceEnCours;
}

/**
 * Attend que le client soit prêt, borné par ATTENTE_PRET_MS.
 * Évite de perdre un OTP parce que le relais était en cours de reconnexion.
 */
async function attendrePret() {
  if (client && etatConnexion === "ouvert") return;
  const fin = Date.now() + ATTENTE_PRET_MS;
  while (Date.now() < fin) {
    if (client && etatConnexion === "ouvert") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("relais non connecte (session WhatsApp indisponible)");
}

// ---------------------------------------------------------------------------
// Envoi de messages
// ---------------------------------------------------------------------------

async function respecterDelaiVers(numero) {
  const precedent = dernierEnvoiParNumero.get(numero) ?? 0;
  const ecart = Date.now() - precedent;
  if (ecart < DELAI_SIENS) {
    await new Promise((r) => setTimeout(r, DELAI_SIENS - ecart));
  }
  dernierEnvoiParNumero.set(numero, Date.now());
}

/** Un envoi, avec une seule réessai après reconnexion du client. */
async function envoyerUneFois(jid, message) {
  try {
    return await avecTimeout(
      client.sendMessage(jid, message),
      TIMEOUT_OPERATION_MS,
      "sendMessage bloquee (navigateur gelee ?)",
    );
  } catch (e) {
    // Un Chromium figé survit au premier échec : on recrée le client et on
    // retente une fois. Sans ce réessai, l'OTP du patient est définitivement
    // perdu alors que la session WhatsApp, elle, est par ailleurs valide.
    log("warn", `Envoi interrompu (${e?.message}) : reconnexion puis nouvelle tentative`);
    await relancerClient("envoi interrompu", true);
    await attendrePret();
    return avecTimeout(
      client.sendMessage(jid, message),
      TIMEOUT_OPERATION_MS,
      "sendMessage bloquee (2e tentative)",
    );
  }
}

async function envoyerMessage(numero, message) {
  await attendrePret();
  await respecterDelaiVers(numero);

  // Résolution LID : envoie vers le JID canonique (`.lid` ou `.c.us`) plutôt
  // que l'ancien format figé `@c.us` qui reste bloqué pour les comptes LID.
  const jid = await resoudreJid(numero);
  const msg = await envoyerUneFois(jid, message);

  // L'id de whatsapp-web.js est composé : msg.id.id (partie unique base64)
  // et msg.id._serialized (id@server). Le handler message_ack reçoit msg.id.id ;
  // on garde donc la partie unique pour le matching, avec le _serialized en
  // repli. NB : envoyer à son propre numéro renvoie parfois msg.id incomplet.
  if (process.env.DEBUG_RAWS) {
    log("info", `RAW sendMessage retour = ${JSON.stringify(msg?.id ?? null)}`);
  }
  const id = msg?.id?.id || msg?.id?._serialized || `${Date.now()}-${numero}`;

  if (messagesSuivis.size >= MAX_MESSAGES_SUIVIS) {
    const plusAncien = messagesSuivis.keys().next().value;
    messagesSuivis.delete(plusAncien);
  }
  messagesSuivis.set(id, {
    id,
    to: numero,
    message,
    statut: "envoye",
    horodatage_statut: null,
    avertie: false,
    horodatage_envoi: Date.now(),
  });

  return { id };
}

// ---------------------------------------------------------------------------
// Surveillance des envois bloqués
// ---------------------------------------------------------------------------

const DELAI_ATTENTE_MS = Number(process.env.DELAI_ATTENTE_MS || 25000);

function lancerSurveillance() {
  // Accusés de réception en retard ; simple journalisation (la remise dépend
  // de la connexion du téléphone destinataire, pas du relais). Un avertissement
  // par message seulement : la boucle répétait le même avertissement toutes
  // les 15 s et noyait les logs (plus de 15 000 lignes en 22 h).
  setInterval(() => {
    const maintenant = Date.now();
    const seuil = maintenant - DELAI_ATTENTE_MS;
    for (const [id, suivi] of messagesSuivis) {
      if (maintenant - (suivi.horodatage_envoi ?? maintenant) > DUREE_SUIVI_MS) {
        messagesSuivis.delete(id);
        continue;
      }
      const sansAccuse =
        (suivi.statut === "envoye" || suivi.statut === "en_attente") && !suivi.avertie;
      if (!sansAccuse || (suivi.horodatage_envoi ?? 0) >= seuil) continue;
      suivi.avertie = true;
      log("warn", `Aucun accuse apres ${DELAI_ATTENTE_MS}ms pour ${suivi.to} id=${suivi.id}`);
    }
  }, 15000).unref();

  // Auto-réparation : si le navigateur ne répond plus (Chrome gelé type
  // "Runtime.callFunctionOn timed out"), on recrée le client sans intervention.
  // La session est persistée dans le volume Docker : pas de QR à rescanner.
  setInterval(async () => {
    if (!client) return;
    const cap = await capaciteReelle();
    if (cap === "bloque") {
      log("warn", "Relais bloque (navigateur gelee) : reinitialisation du client…");
      await relancerClient("navigateur gele", true);
    }
  }, DELAI_LIVRAISON_MS).unref();

  // Filet de sécurité : un client qui n'a JAMAIS atteint l'état « prêt »
  // (initialize() échoué, session invalide) n'est plus récupéré par le
  // watchdog ci-dessus, qui suppose un client déjà fonctionnel. Sans cette
  // boucle, le relais restait muet indéfiniment après un échec de démarrage.
  // On sonde toujours avant de recréer : un client qui charge sa session peut
  // être sain alors que son événement « ready » n'est pas encore arrivé.
  setInterval(async () => {
    if (relanceEnCours) return;
    if (pretDepuis) return; // le client a déjà fonctionné : watchdog gelé
    if (!client) {
      relancerClient("client absent");
      return;
    }
    if (qrEnAttente) return; // QR affiché : le recréer l'annulerait
    const cap = await capaciteReelle();
    if (cap === "ouvert") {
      pretDepuis = Date.now(); // session chargée, « ready » pas encore émis
      return;
    }
    relancerClient("session jamais etablie");
  }, DELAI_RECONNEXION_MS).unref();
}

// ---------------------------------------------------------------------------
// Serveur HTTP
// ---------------------------------------------------------------------------

const corps = (res, statut, donnees) => {
  res.writeHead(statut, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(donnees));
};

const lireCorps = (requete) =>
  new Promise((resoudre, rejeter) => {
    let donnees = "";
    requete.on("data", (m) => {
      donnees += m;
      if (donnees.length > 64 * 1024) { rejeter(new Error("corps trop volumineux")); requete.destroy(); }
    });
    requete.on("end", () => resoudre(donnees));
    requete.on("error", rejeter);
  });

const serveur = http.createServer(async (requete, reponse) => {
  const url = new URL(requete.url, `http://${requete.headers.host || "localhost"}`);

  // Protection par secret partagé
  if (SECRET_RELAY && requete.headers["x-relay-secret"] !== SECRET_RELAY) {
    if (url.pathname !== "/sante") {
      corps(reponse, 403, { erreur: "Secret invalide" });
      return;
    }
  }

  if (requete.method === "GET" && url.pathname === "/sante") {
    // Sonde réelle : « session chargée » ne suffit plus — on vérifie que le
    // navigateur répond avant de déclarer le relais opérationnel.
    const connexion = await capaciteReelle();
    corps(reponse, 200, {
      statut: connexion === "ouvert" ? "ok" : "ko",
      connexion,
      moteur: "whatsapp-web.js",
    });
    return;
  }

  // Vérifie si un numéro est bien un compte WhatsApp (getNumberId renvoie le
  // JID du compte, ou null si ce numéro n'est pas enregistré sur WhatsApp).
  // Utilisé pour expliquer une absence de livraison : un OTP envoyé à un
  // numéro non-WhatsApp ne peut jamais être remis.
  if (requete.method === "GET" && url.pathname === "/existe") {
    const to = String(url.searchParams.get("to") ?? "").replace(/\D/g, "");
    if (!JID_PATTERN.test(to)) {
      corps(reponse, 422, { existant: false, erreur: "to invalide : chiffres uniquement (8-15)" });
      return;
    }
    try {
      const jid = await avecTimeout(client.getNumberId(to), 20000, "getNumberId trop lente");
      corps(reponse, 200, { existant: Boolean(jid), jid: jid ?? null });
    } catch (e) {
      const erreur = e instanceof Error ? e.message : String(e);
      log("warn", `Verification existence ${to} impossible : ${erreur}`);
      corps(reponse, 200, { existant: null, erreur: "verification indisponible (relais non pret)" });
    }
    return;
  }

  if (requete.method === "GET" && url.pathname.startsWith("/statut/")) {
    const id = decodeURIComponent(url.pathname.slice("/statut/".length));
    const suivi = messagesSuivis.get(id) ?? null;
    corps(reponse, 200, { id, present: Boolean(suivi), ...(suivi ?? {}) });
    return;
  }

  if (requete.method === "POST" && url.pathname === "/envoyer") {
    try {
      const brut = await lireCorps(requete);
      const donnees = JSON.parse(brut || "{}");
      const to = String(donnees.to ?? "").replace(/\D/g, "");
      const message = String(donnees.message ?? "").trim();

      if (!JID_PATTERN.test(to)) {
        corps(reponse, 422, { ok: false, erreur: "to invalide : chiffres uniquement (8-15)" });
        return;
      }
      if (!message || message.length > MAX_MESSAGE) {
        corps(reponse, 422, { ok: false, erreur: `message vide ou > ${MAX_MESSAGE} caracteres` });
        return;
      }

      const { id } = await envoyerMessage(to, message);
      log("info", `Message envoye a ${to} (${message.length} car.) id=${id}`);
      corps(reponse, 200, { ok: true, id });
    } catch (exc) {
      const erreur = exc instanceof Error ? exc.message : String(exc);
      // Session WhatsApp absente : 503 explicite, le moteur saura que le
      // canal est momentanément hors service plutôt que l'envoi cassé.
      const indisponible = erreur.includes("non connecte");
      log(indisponible ? "warn" : "error", `Envoi echoue : ${erreur}`);
      corps(reponse, indisponible ? 503 : 500, {
        ok: false,
        erreur,
        connexion: etatConnexion,
      });
    }
    return;
  }

  corps(reponse, 404, { erreur: "inconnu" });
});

serveur.listen(PORT, () => {
  log("info", `Relais WhatsApp AERIS v2 (whatsapp-web.js) sur :${PORT}`);
  lancerSurveillance();
  demarrer().catch((e) => log("error", `Echec demarrage : ${e?.message ?? e}`));
});

process.on("unhandledRejection", (e) => {
  log("error", `Promesse non geree : ${e}`);
});
