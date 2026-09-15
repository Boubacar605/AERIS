/**
 * Relais WhatsApp AERIS.
 *
 * Se connecte sur le protocole WhatsApp Web (multi-device) via la
 * bibliothèque Baileys : le premier démarrage affiche un QR code scanné une
 * seule fois avec le WhatsApp du numéro émetteur. Les creds sont persistés
 * dans /app/auth_info (volume Docker) pour ne pas ressaisir le QR après un
 * redémarrage.
 *
 * Expose deux endpoints HTTP :
 *   GET  /sante    -> {"statut","connexion"}  (ouvert | en_attente | deconnecte)
 *   POST /envoyer  {"to","message"} -> {"ok"} ou {"ok":false,"erreur"}
 *
 * La connexion WhatsApp est sortante : aucun port entrant requis, fonctionne
 * derrière le tunnel Tailscale sans configuration.
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");

const qrcodeTerminal = require("qrcode-terminal");
const Baileys = require("@whiskeysockets/baileys");
const makeWASocket = Baileys.default || Baileys.makeWASocket;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = Baileys;

const PORT = Number(process.env.PORT || 3500);
const DOSSIER_SESSION = process.env.DOSSIER_SESSION || "/app/auth_info";

const JID_PATTERN = /^\d{8,15}$/;
const MAX_MESSAGE = 1000;

let socket = null; // socket Baileys actif (ou null si déconnecté)
let etatConnexion = "deconnecte"; // open | en_attente | deconnecte

function log(niveau, ...args) {
  const horodatage = new Date().toISOString();
  console[`${niveau}` in console ? niveau : "log"](
    `[${horodatage}] [relay] ${args.join(" ")}`
  );
}

/**
 * Crée (ou recrée) le socket Baileys et le branche sur les événements.
 * À chaque connexion : QR si nécessaire, sinon connexion directe (creds OK).
 */
async function connecter() {
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1018299667] }));

  const { state, saveCreds } = await useMultiFileAuthState(DOSSIER_SESSION);

  socket = makeWASocket({
    version,
    auth: state,
    markOnlineOnConnect: false, // ne pas afficher « en ligne » sur les chats du numéro hôte
    logger: createLoggerSilencieux(),
  });

  socket.ev.on("creds.update", () => {
    saveCreds();
  });

  socket.ev.on("connection.update", (miseAJour) => {
    const { connection, lastDisconnect, qr } = miseAJour;

    if (qr) {
      etatConnexion = "en_attente";
      // Le rendu QR est à la charge de l'application (option printQRInTerminal
      // dépréciée dans Baileys 6.7). Le code s'affiche dans les logs Docker.
      log("info", "========== SCANNEZ CE CODE QR DANS WHATSAPP ==========");
      qrcodeTerminal.generate(qr, { small: true });
      log("info", "WhatsApp > Appareils connectes > Connecter un appareil");
      log("info", "======================================================");
    }

    if (connection === "open") {
      etatConnexion = "ouvert";
      log("info", "Connexion WhatsApp ouverte (multi-device).");
    }

    if (connection === "close") {
      const raison = lastDisconnect?.error?.output?.statusCode;
      const deconnecte = raison === DisconnectReason.loggedOut;

      if (deconnecte) {
        etatConnexion = "deconnecte";
        log(
          "warn",
          "Session WhatsApp deconnectee par l'application : suppression des creds, nouveau QR requis."
        );
        purgerSession();
        void reconnecter(); // affichera un nouveau QR
        return;
      }

      log("info", `Connexion fermee (raison ${raison ?? "inconnue"}), reconnexion…`);
      void reconnecter();
    }
  });
}

/** Supprime les creds persistés (permet de re-scanner un QR proprement). */
function purgerSession() {
  try {
    fs.rmSync(DOSSIER_SESSION, { recursive: true, force: true });
    fs.mkdirSync(DOSSIER_SESSION, { recursive: true });
  } catch (exc) {
    log("warn", `Purge de session impossible : ${exc}`);
  }
}

let enReconnexion = false;
async function reconnecter() {
  if (enReconnexion) return;
  enReconnexion = true;
  try {
    etatConnexion = "en_attente";
    await connecter();
  } finally {
    setTimeout(() => (enReconnexion = false), 3000); // backoff simple
  }
}

/** Logger épuré : seuls warnings/erreurs passent (le QR reste sur stdout). */
function createLoggerSilencieux() {
  const pino = require("pino");
  return pino({ level: "warn", base: undefined, timestamp: false });
}

/** Envoie un message texte à un numéro (format E.164 sans « + »). */
async function envoyerMessage(numero, message) {
  if (!socket || etatConnexion !== "ouvert") {
    throw new Error("relais non connecte (QR a scanner ?)");
  }
  const jid = `${numero}@s.whatsapp.net`;
  await socket.sendMessage(jid, { text: message });
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
    requete.on("data", (morceau) => {
      donnees += morceau;
      if (donnees.length > 64 * 1024) {
        rejeter(new Error("corps trop volumineux"));
        requete.destroy();
      }
    });
    requete.on("end", () => resoudre(donnees));
    requete.on("error", rejeter);
  });

const serveur = http.createServer(async (requete, reponse) => {
  const url = new URL(requete.url, `http://${requete.headers.host || "localhost"}`);

  if (requete.method === "GET" && url.pathname === "/sante") {
    corps(reponse, 200, { statut: "ok", connexion: etatConnexion });
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
        corps(reponse, 422, {
          ok: false,
          erreur: `message vide ou > ${MAX_MESSAGE} caracteres`,
        });
        return;
      }

      await envoyerMessage(to, message);
      log("info", `Message envoye a ${to} (${message.length} caracteres).`);
      corps(reponse, 200, { ok: true });
    } catch (exc) {
      const erreur = exc instanceof Error ? exc.message : String(exc);
      log("error", `Envoi echoue : ${erreur}`);
      corps(reponse, 200, { ok: false, erreur });
    }
    return;
  }

  corps(reponse, 404, { erreur: "inconnu" });
});

// Le serveur HTTP répond dès le démarrage, même si WhatsApp est hors de
// portee (fetchLatestBaileysVersion / handshake prennent du temps en ligne).
serveur.listen(PORT, () => {
  log("info", `Relais WhatsApp AERIS en ecoute sur :${PORT} (session: ${DOSSIER_SESSION}).`);
  void connecter()
    .then(() => {
      if (etatConnexion === "deconnecte") {
        log("info", "Scannez le QR code ci-dessus dans WhatsApp > Appareils connectes.");
      }
    })
    .catch((exc) => {
      log("error", `Connexion WhatsApp echouee : ${exc}`);
    });
});

process.on("unhandledRejection", (exc) => {
  log("error", `Promesse non geree : ${exc}`);
});