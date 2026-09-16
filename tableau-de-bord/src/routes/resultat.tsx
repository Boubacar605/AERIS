import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  BadgeCheck,
  Download,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
  ScanLine,
  Send,
  ShieldAlert,
  ThumbsDown,
  Timer,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import { ImageViewer } from "@/components/aeris/ImageViewer";
import { PatientResult } from "@/components/aeris/PatientResult";
import { Panel, Tag } from "@/components/aeris/primitives";
import {
  ApiError,
  approuverExamen,
  type ReponseAccesResultat,
  type ReponseApprobation,
} from "@/lib/api";
import { genererCompteRendu, type ToneFiabilite } from "@/lib/compte-rendu";
import { genererPdfClinique } from "@/lib/export-pdf";
import { useResultat } from "@/lib/resultat-store";
import { exigerRole, pageAccueilPourRole } from "@/lib/authentification";
import { sessionHydratee, useSession } from "@/lib/authentification-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/resultat")({
  validateSearch: (search: Record<string, unknown>): { otp?: string } => {
    // TanStack Search peut restituer un paramètre répété sous forme de tableau
    // après hydration SSR ; on normalise TOUJOURS vers une string avant usage.
    const bruto = search["otp"];
    const brut = Array.isArray(bruto) ? bruto[0] : bruto;
    const otp = typeof brut === "string" && brut.length > 0 ? brut : undefined;
    return otp ? { otp } : {};
  },
  // Le mode patient (?otp=…) est public ; la vue clinicien exige ce rôle.
  beforeLoad: ({ search }) => {
    if (!search.otp) exigerClinique();
  },
  component: ResultatPage,
  head: () => ({
    meta: [
      { title: "Résultat · AERIS" },
      {
        name: "description",
        content:
          "Compte rendu radiologique — relecture clinicienne d'un examen ou résultats du patient via code OTP.",
      },
      { property: "og:title", content: "Résultat · AERIS" },
      { property: "og:type", content: "website" },
    ],
  }),
});

/** Garde locale : la vue clinicien de /resultat n'est pas dans la table
 * ROLES_POUR_PREFIXE (le chemin sert aussi le mode patient public). */
function exigerClinique(): void {
  exigerRole("clinicien");
}

/**
 * Point d'entrée dual :
 * - avec ?otp= : flux patient (public, aucun AppShell) ;
 * - sinon : compte rendu clinicien (AppShell, rôle exigé).
 */
function ResultatPage() {
  const { otp } = Route.useSearch();
  if (otp) return <PatientOtpHub />;
  return <ResultatClinique />;
}

/* ------------------------------ Mode patient ------------------------------ */

type ContactOtp = { email?: string; telephone?: string };

/**
 * Construit l'URL de vérification OTP (GET avec paramètres query).
 *
 * Le GET fonctionne de manière plus fiable que le POST sur les navigateurs
 * mobiles à travers le proxy Tailscale Funnel (Safari iOS bloque certains
 * POST sortants). Le code OTP est déjà visible dans l'URL du lien reçu par
 * le patient, donc l'ajout des paramètres query n'affecte pas la sécurité.
 */
function urlVerificationOtp(codeOtp: string, contact: ContactOtp): string {
  const params = new URLSearchParams({ code_otp: codeOtp });
  if (contact.email) params.set("email", contact.email);
  if (contact.telephone) params.set("telephone", contact.telephone);
  return `${window.location.origin}/api/acces-resultat?${params}`;
}

/**
 * Vérification OTP en fetch GET minimal — volontairement SANS le wrapper
 * fetchAPI (pas de Headers, pas d'AbortSignal.timeout) : le flux patient est
 * public (aucun jeton requis) et le GET est le plus compatible avec les
 * navigateurs de téléphone, même WebView.
 */
async function verifierOtpBrut(
  codeOtp: string,
  contact: ContactOtp,
): Promise<ReponseAccesResultat> {
  const url = urlVerificationOtp(codeOtp, contact);
  const res = await fetch(url);
  if (!res.ok) {
    const brut = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(res.status, brut.detail ?? `API ${res.status}`);
  }
  return (await res.json()) as ReponseAccesResultat;
}

/** Repli XMLHttpRequest GET : certains navigateurs WebKit bloquent fetch. */
function verifierOtpViaXhr(codeOtp: string, contact: ContactOtp): Promise<ReponseAccesResultat> {
  const url = urlVerificationOtp(codeOtp, contact);
  return new Promise((resoudre, rejeter) => {
    const xhr = new XMLHttpRequest();
    try {
      xhr.open("GET", url);
    } catch (ex) {
      rejeter(ex instanceof Error ? ex : new TypeError("open invalide"));
      return;
    }
    xhr.timeout = 35_000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resoudre(JSON.parse(xhr.responseText) as ReponseAccesResultat);
        } catch {
          rejeter(new ApiError(0, "Réponse illisible"));
        }
        return;
      }
      let detail: string | null = null;
      try {
        detail = (JSON.parse(xhr.responseText) as { detail?: string }).detail ?? null;
      } catch {
        /* réponse non JSON */
      }
      rejeter(new ApiError(xhr.status, detail ?? `API ${xhr.status}`));
    };
    xhr.onerror = () => {
      rejeter(new TypeError("echec reseau XHR"));
    };
    xhr.ontimeout = () => {
      rejeter(new DOMException("timeout", "TimeoutError"));
    };
    xhr.send();
  });
}

function PatientOtpHub() {
  const { otp } = Route.useSearch();
  const [canal, setCanal] = useState<"email" | "whatsapp">("email");
  const [contact, setContact] = useState("");
  // String() en dernier rempart : garde-fou contre une valeur non-string
  // (tableau d'un élément) après hydration SSR de TanStack Start.
  const [code, setCode] = useState(typeof otp === "string" ? otp : String(otp ?? ""));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [donnees, setDonnees] = useState<ReponseAccesResultat | null>(null);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur(null);

    // ── Sonde de connectivité GET ──
    const urlSante = `${window.location.origin}/api/sante`;
    try {
      await fetch(urlSante, { method: "GET" });
    } catch {
      setErreur("Impossible de joindre AERIS. Vérifiez votre connexion Internet puis réessayez.");
      setEnCours(false);
      return;
    }

    const contactPayload: { email?: string; telephone?: string } = {};
    if (canal === "email") {
      contactPayload.email = contact.trim().toLowerCase();
    } else {
      contactPayload.telephone = contact.trim();
    }

    try {
      let resultat: ReponseAccesResultat;
      // String() : TanStack Search peut retourner un tableau/string braqué
      // côté SSR, provoquant « a.trim is not a function » chez certains
      // navigateurs. Forcer un string avant chaque utilisation.
      const codeTexte = String(code ?? "").trim();
      try {
        // fetch GET minimal (pas de wrapper, pas d'AbortSignal) — le GET est
        // plus fiable que le POST sur Safari iOS à travers le funnel Tailscale.
        resultat = await verifierOtpBrut(codeTexte, contactPayload);
      } catch (ex) {
        if (!(ex instanceof TypeError)) throw ex;
        // Repli XMLHttpRequest GET : certains WebKit bloquent fetch.
        resultat = await verifierOtpViaXhr(codeTexte, contactPayload);
      }
      setDonnees(resultat);
    } catch (ex) {
      const detail =
        ex instanceof ApiError
          ? ex.status === 401
            ? "Code OTP invalide, expiré ou déjà utilisé. Vérifiez le code reçu et le numéro (ou l'email) que vous avez indiqués."
            : `Le serveur a rencontré une erreur (${ex.status}). Réessayez dans un instant.`
          : ex instanceof DOMException && ex.name === "TimeoutError"
            ? "Le serveur met trop de temps à répondre. Réessayez dans un instant."
            : "Impossible d'envoyer la demande. Vérifiez votre connexion Internet puis réessayez.";
      setErreur(detail);
    } finally {
      setEnCours(false);
    }
  }

  if (donnees) return <PatientResult donnees={donnees} />;

  return (
    <div className="grid min-h-screen place-items-center bg-navy px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/logo-aeris.png" alt="AERIS" className="mx-auto w-40 object-contain" />
          <p className="mt-3 font-mono text-[11px] tracking-[0.18em] text-navy-muted uppercase">
            Espace patient · accès sécurisé
          </p>
        </div>

        <form
          onSubmit={(e) => void soumettre(e)}
          className="rounded-lg border border-navy-line bg-card p-6 shadow-raise"
        >
          <h1 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <KeyRound className="size-4 text-ok" />
            Consulter mes résultats
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Le code à 6 chiffres vous a été envoyé par email ou WhatsApp après l'analyse de votre
            dossier.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCanal("email")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 font-mono text-[11px] font-bold tracking-widest uppercase transition-colors",
                canal === "email"
                  ? "border-ok/50 bg-ok-soft text-ok"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Mail className="size-3.5" />
              Email
            </button>
            <button
              type="button"
              onClick={() => setCanal("whatsapp")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 font-mono text-[11px] font-bold tracking-widest uppercase transition-colors",
                canal === "whatsapp"
                  ? "border-ok/50 bg-ok-soft text-ok"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <MessageCircle className="size-3.5" />
              WhatsApp
            </button>
          </div>

          <label className="mt-4 block">
            <span className="label-xs">
              {canal === "email" ? "Adresse email" : "Numéro WhatsApp"}
            </span>
            <div className="relative mt-1.5">
              {canal === "email" ? (
                <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              ) : (
                <MessageCircle className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              )}
              <input
                type={canal === "email" ? "email" : "tel"}
                required
                autoComplete={canal === "email" ? "email" : "tel"}
                placeholder={canal === "email" ? "vous@exemple.sn" : "77 123 45 67"}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                className="w-full rounded-md border border-border bg-background py-2 pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ok/60"
              />
            </div>
          </label>

          <label className="mt-4 block">
            <span className="label-xs">Code OTP</span>
            <input
              inputMode="numeric"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-lg tracking-[0.35em] outline-none placeholder:text-muted-foreground/30 focus:border-ok/60"
            />
          </label>

          {erreur && (
            <p className="mt-4 flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/40 p-3 text-xs leading-relaxed text-alert">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              {erreur}
            </p>
          )}

          <button
            type="submit"
            disabled={enCours}
            className={cn(
              "mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-ok px-4 py-2.5 text-sm font-semibold text-navy transition-opacity",
              enCours ? "cursor-wait opacity-70" : "hover:opacity-90",
            )}
          >
            {enCours && <Loader2 className="size-4 animate-spin" />}
            Afficher mes résultats
          </button>

          <p className="mt-4 text-center font-mono text-[10px] text-muted-foreground">
            Code à usage unique · expire 15 minutes après envoi
          </p>
        </form>
      </div>
    </div>
  );
}

/* ------------------------- Mode clinicien (compte rendu) ------------------- */

function ResultatClinique() {
  const session = useSession();
  const navigate = useNavigate();

  // Après hydratation : un utilisateur sans compte, ou non-clinicien, est
  // redirigé (couvre le chargement direct de l'URL sans passer par la nav).
  useEffect(() => {
    if (!sessionHydratee()) return;
    if (!session) {
      void navigate({ to: "/login", search: { retro: window.location.pathname } });
      return;
    }
    if (session.personne.role !== "clinicien") {
      void navigate({ to: pageAccueilPourRole(session.personne.role) });
    }
  }, [session, navigate]);

  return (
    <AppShell>
      <ResultatContent />
    </AppShell>
  );
}

const TONALITE_CONCLUSION: Record<ToneFiabilite, string> = {
  ok: "border-ok/50 bg-ok-soft/40",
  warn: "border-warn/50 bg-warn-soft/40",
  alert: "border-alert/50 bg-alert-soft/40",
};

const TONALITE_TITRE_CONCLUSION: Record<ToneFiabilite, string> = {
  ok: "text-ok",
  warn: "text-warn",
  alert: "text-alert",
};

function ResultatContent() {
  const dossier = useResultat();
  const navigate = useNavigate();
  const [decision, setDecision] = useState<"approuve" | "desapprouve" | null>(null);
  const [envoiOtp, setEnvoiOtp] = useState(false);
  const [approbation, setApprobation] = useState<ReponseApprobation | null>(null);
  const [erreurApprobation, setErreurApprobation] = useState<string | null>(null);
  const [pdfEnCours, setPdfEnCours] = useState(false);

  const retourAuDiagnostic = () => navigate({ to: "/diagnostic" });

  /** « Approuver » : envoie le code OTP au patient (email + WhatsApp, ou WhatsApp
   * seul selon ses coordonnées) avec le lien de consultation, puis verrouille
   * la décision. */
  const approuver = async () => {
    if (!dossier) return;
    setDecision("approuve");
    setEnvoiOtp(true);
    setErreurApprobation(null);
    try {
      const reponse = await approuverExamen(dossier.patient.code_patient);
      setApprobation(reponse);
    } catch {
      setErreurApprobation(
        "Échec de l'envoi OTP — le patient n'a pas été notifié. Vérifiez la connectivité du moteur, puis réessayez.",
      );
      setApprobation(null);
    } finally {
      setEnvoiOtp(false);
    }
  };

  /** « Télécharger le PDF » : compte rendu clinique avec la marque AERIS. */
  const telechargerPdf = async () => {
    if (!dossier) return;
    setPdfEnCours(true);
    try {
      await genererPdfClinique(dossier);
    } finally {
      setPdfEnCours(false);
    }
  };

  // Aucun dossier (arrivée directe ou page rechargée) : on guide vers le diagnostic.
  if (!dossier) {
    return (
      <>
        <PageHeader title="Résultat" description="Compte rendu et relecture d'un examen" />
        <main className="p-5">
          <Panel title="Aucun résultat à afficher">
            <div className="grid place-items-center gap-3 py-10 text-center">
              <FileText className="size-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">Aucun examen transmis</p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Cette page affiche le compte rendu du dernier examen. Lancez d'abord une inférence
                  depuis la page Diagnostic pour produire un résultat.
                </p>
              </div>
              <button
                type="button"
                onClick={retourAuDiagnostic}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-foreground uppercase transition-opacity hover:opacity-90"
              >
                <ArrowLeft className="size-3.5" />
                Retour au diagnostic
              </button>
            </div>
          </Panel>
        </main>
      </>
    );
  }

  const rapport = genererCompteRendu(dossier);

  return (
    <>
      <PageHeader
        title="Résultat"
        description="Compte rendu clinique et relecture — validation du clinicien"
        right={
          <Tag tone={dossier.resultat.destination}>{dossier.resultat.destination} execution</Tag>
        }
      />

      <main className="space-y-4 p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* -------- Carte compte rendu clinique -------- */}
          <Panel title="Compte rendu d'examen" subtitle="Document de lecture du clinicien">
            <div className="p-6">
              {/* En-tête institutionnelle du rapport */}
              <div className="border-b border-border pb-4 text-center">
                <p className="font-mono text-sm font-bold tracking-[0.14em]">{rapport.entete}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Compte rendu d'analyse radiologique assistée par intelligence artificielle
                </p>
              </div>

              {/* Sections du rapport */}
              <div className="mt-5 space-y-5">
                {rapport.sections.map((section) => (
                  <section key={section.titre}>
                    <h3 className="label-xs">{section.titre}</h3>
                    {section.paragraphes.map((paragraphe) => (
                      <p
                        key={paragraphe}
                        className="mt-1.5 text-justify text-[13px] leading-relaxed text-navy/90"
                      >
                        {paragraphe}
                      </p>
                    ))}
                  </section>
                ))}
              </div>

              {/* Conclusion encadrée */}
              <div
                className={cn(
                  "mt-6 rounded-lg border p-4",
                  TONALITE_CONCLUSION[rapport.fiabilite.tone],
                )}
              >
                <p className={cn("label-xs", TONALITE_TITRE_CONCLUSION[rapport.fiabilite.tone])}>
                  Conclusion — confiance {rapport.fiabilite.confiance} %
                </p>
                <p
                  className={cn(
                    "mt-1 text-base font-bold tracking-tight",
                    TONALITE_TITRE_CONCLUSION[rapport.fiabilite.tone],
                  )}
                >
                  {rapport.conclusion}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-navy/80">
                  {rapport.raisonConclue}
                </p>
              </div>
            </div>
          </Panel>

          {/* -------- Carte relecture d'image -------- */}
          <div className="flex min-w-0 flex-col gap-4">
            <Panel
              title="Relecture de l'image"
              subtitle="Zoom molette + glisser pour un avis clinique indépendant"
            >
              <ImageViewer fichier={dossier.fichier} />
            </Panel>

            {/* Premier jugement du clinicien */}
            <Panel
              title="Validité de la décision IA"
              subtitle="Le clinicien garde la main sur le verdict final"
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={decision !== null || envoiOtp}
                  onClick={() => void approuver()}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 font-mono text-[11px] font-bold tracking-[0.12em] uppercase transition-colors",
                    decision === "approuve"
                      ? "border-ok/50 bg-ok-soft text-ok"
                      : "border-ok/30 bg-card text-ok hover:bg-ok-soft/40 disabled:opacity-50",
                  )}
                >
                  {envoiOtp ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <BadgeCheck className="size-4" />
                  )}
                  {envoiOtp ? "Envoi OTP…" : "Approuver"}
                </button>
                <button
                  type="button"
                  disabled={decision !== null}
                  onClick={() => setDecision("desapprouve")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 font-mono text-[11px] font-bold tracking-[0.12em] uppercase transition-colors",
                    decision === "desapprouve"
                      ? "border-alert/50 bg-alert-soft text-alert"
                      : "border-alert/30 bg-card text-alert hover:bg-alert-soft/40 disabled:opacity-50",
                  )}
                >
                  <ThumbsDown className="size-4" />
                  Désapprouver
                </button>
              </div>

              {decision === "approuve" && (
                <div className="mt-3 space-y-2">
                  <p className="flex items-start gap-2 rounded-md border border-ok/40 bg-ok-soft/30 p-3 text-xs text-navy/80">
                    <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
                    <span>
                      <span className="font-semibold text-ok">Décision IA approuvée.</span> Le
                      verdict est validé par le clinicien et peut servir de référence pour le suivi
                      du patient en zone à faible connectivité.
                    </span>
                  </p>

                  {approbation && approbation.statut === "otp_envoye" && (
                    <p className="flex items-start gap-2 rounded-md border border-ok/40 bg-ok-soft/40 p-3 text-xs text-navy/80">
                      <Send className="mt-0.5 size-3.5 shrink-0 text-ok" />
                      <span>
                        <span className="font-semibold text-ok">OTP envoyé au patient</span> par{" "}
                        {approbation.canal === "email+whatsapp"
                          ? "email et WhatsApp"
                          : approbation.canal === "whatsapp"
                            ? "WhatsApp seul"
                            : approbation.canal === "email"
                              ? "email seul"
                              : "aucun canal"}
                        .
                        {approbation.contact && (
                          <>
                            {" "}
                            Contact : <span className="font-mono">{approbation.contact}</span>.
                          </>
                        )}{" "}
                        Le patient peut consulter ses résultats via l'OTP.
                      </span>
                    </p>
                  )}
                  {approbation && approbation.statut === "echec_envoi" && (
                    <p className="flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/40 p-3 text-xs text-alert">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
                      <span>
                        <span className="font-semibold text-alert">Échec de l'envoi OTP</span> — le
                        patient n'a pas pu être joint (canal :{" "}
                        {approbation.canal === "email+whatsapp"
                          ? "email et WhatsApp"
                          : approbation.canal === "whatsapp"
                            ? "WhatsApp"
                            : approbation.canal === "email"
                              ? "email"
                              : "aucun"}
                        ). Vérifiez la connectivité du relais WhatsApp et du serveur SMTP, puis
                        réessayez.
                      </span>
                    </p>
                  )}
                  {erreurApprobation && (
                    <p className="flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/40 p-3 text-xs text-alert">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
                      <span>{erreurApprobation}</span>
                    </p>
                  )}
                </div>
              )}
              {decision === "desapprouve" && (
                <p className="mt-3 flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/30 p-3 text-xs text-navy/80">
                  <ThumbsDown className="mt-0.5 size-3.5 shrink-0 text-alert" />
                  <span>
                    <span className="font-semibold text-alert">Décision IA désapprouvée.</span> Une
                    relecture par un radiologue est recommandée avant toute conclusion clinique.
                  </span>
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                <button
                  type="button"
                  onClick={retourAuDiagnostic}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase transition-colors hover:text-foreground"
                >
                  <ScanLine className="size-3.5" />
                  Renvoi — nouveau test
                </button>
                <button
                  type="button"
                  onClick={() => void telechargerPdf()}
                  disabled={pdfEnCours}
                  className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-primary uppercase transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  {pdfEnCours ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  {pdfEnCours ? "Génération…" : "Imprimer / PDF"}
                </button>
                <p className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                  <Timer className="size-3" />
                  Examen du {new Date(dossier.horodatage).toLocaleDateString("fr-FR")}
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </main>
    </>
  );
}
