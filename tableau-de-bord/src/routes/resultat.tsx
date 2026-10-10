import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { formatDateFr } from "@/lib/dernier-resultat";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarCheck,
  CalendarPlus,
  Download,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
  ScanLine,
  Share2,
  Stethoscope,
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
  creerSuivi,
  desapprouverExamen,
  lireRecommandations,
  partagerCompteRendu,
  type PartageCompteRendu,
  type RecommandationClinique,
  type ReponseAccesResultat,
  type ReponseApprobation,
  type ReponseDesapprobation,
  type SuiviCree,
} from "@/lib/api";
import { genererCompteRendu, type ToneFiabilite } from "@/lib/compte-rendu";
import { genererPdfClinique } from "@/lib/export-pdf";
import { useResultat } from "@/lib/resultat-store";
import { pageAccueilPourRole } from "@/lib/authentification";
import { sessionHydratee, useSession, type RoleUtilisateur } from "@/lib/authentification-store";
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
  // Le portail patient est public : c'est un code OTP, pas une session, qui
  // identifie le patient. La garde de rôle ne peut donc pas lives dans
  // beforeLoad — elle rejetait vers /login le patient venu par le lien de
  // partage, qui ne contient pas d'OTP. Le choix se fait dans le composant,
  // une fois la session hydratée.
  beforeLoad: () => {},
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

/** Attente neutre, le temps que sessionStorage soit lu. */
function AttenteHydratation() {
  return (
    <div className="grid min-h-screen place-items-center bg-navy">
      <Loader2 className="size-6 animate-spin text-navy-muted" />
    </div>
  );
}

/**
 * Point d'entrée dual :
 * - avec `?otp=` : flux patient, code déjà pré-rempli (lien d'e-mail ou
 *   WhatsApp au moment de l'approbation) ;
 * - sans session : le visiteur est un patient, il saisit son code à la main
 *   (lien de partage, ou lien perdu d'origine) ;
 * - avec une session : compte rendu clinicien.
 */
function ResultatPage() {
  const { otp } = Route.useSearch();
  const session = useSession();

  const vue = choisirVueResultat({
    otp,
    hydrate: sessionHydratee(),
    role: session?.personne.role ?? null,
  });

  if (vue === "attente") return <AttenteHydratation />;
  if (vue === "patient") return <PatientOtpHub />;
  return <ResultatClinique />;
}

/**
 * Décide quelle vue afficher sur `/resultat`. Fonction pure, volontairement
 * séparée du composant : c'est ici que se décide l'entrée du patient, et une
 * erreur ici est invisible (elle ne plante pas, elle renvoie simplement le
 * patient vers une page de connexion sans issue).
 */
export function choisirVueResultat({
  otp,
  hydrate,
  role,
}: {
  otp: string | undefined;
  hydrate: boolean;
  role: RoleUtilisateur | null;
}): "attente" | "patient" | "clinique" {
  // Un lien d'OTP est déjà une autorisation : le code est là, on l'affiche.
  if (otp) return "patient";

  // Avant hydratation, ni compte rendu ni formulaire : afficher le portail à un
  // clinicien en cours d'authentification ferait clignoter la page.
  if (!hydrate) return "attente";

  // Un patient n'a pas de compte, seulement un code. Le renvoyer vers /login
  // le ferait échouer sans issue : c'est un patient, pas un visiteur égaré.
  if (role === null) return "patient";

  // Un admin est connecté mais n'est pas clinicien : ResultatClinique le
  // renverra vers sa page d'accueil. On ne montre surtout pas le formulaire
  // patient à un administrateur, cela lui suggérerait qu'il a un dossier.
  return "clinique";
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
            ? "Code OTP invalide, ou trop de tentatives erronées. Vérifiez le code reçu et le numéro (ou l'email) que vous avez indiqués."
            : `Le serveur a rencontré une erreur (${ex.status}). Réessayez dans un instant.`
          : ex instanceof DOMException && ex.name === "TimeoutError"
            ? "Le serveur met trop de temps à répondre. Réessayez dans un instant."
            : "Impossible d'envoyer la demande. Vérifiez votre connexion Internet puis réessayez.";
      setErreur(detail);
    } finally {
      setEnCours(false);
    }
  }

  if (donnees) return <PatientResult donnees={donnees} otp={otp ?? ""} />;

  return (
    <div className="grid min-h-screen place-items-center bg-navy px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/logo-aeris.png" alt="AERIS" className="mx-auto w-40 object-contain" />
          <p className="mt-3 font-mono text-[11px] tracking-[0.18em] text-navy-muted uppercase">
            Espace patient · accès par code
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
            Code permanent · vos résultats restent accessibles à tout moment
          </p>
        </form>

        <p className="mt-5 text-center text-[11px] text-navy-muted">
          Vous êtes clinicien ?{" "}
          <Link
            to="/login"
            search={{ retro: "/resultat" }}
            className="font-semibold text-cloud underline underline-offset-2"
          >
            Connectez-vous
          </Link>
        </p>
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
  const [desapprobation, setDesapprobation] = useState<ReponseDesapprobation | null>(null);
  const [erreurApprobation, setErreurApprobation] = useState<string | null>(null);
  const [noteClinique, setNoteClinique] = useState("");
  const [motifDesaccord, setMotifDesaccord] = useState("");
  const [motifOuvert, setMotifOuvert] = useState(false);
  const [pdfEnCours, setPdfEnCours] = useState(false);

  // Recommandations et partage WhatsApp (Vague 2). Les recommandations ne sont
  // ni stockees ni inventees : elles viennent du serveur, qui les derive des
  // verdicts et refuse d'en produire pour un examen non approuve.
  const [recommandations, setRecommandations] = useState<RecommandationClinique[] | null>(null);
  const [recommandationsErreur, setRecommandationsErreur] = useState<string | null>(null);
  const [partage, setPartage] = useState<PartageCompteRendu | null>(null);
  const [partageEnCours, setPartageEnCours] = useState(false);
  const [partageErreur, setPartageErreur] = useState<string | null>(null);

  const [dateSuivi, setDateSuivi] = useState("");
  const [motifSuivi, setMotifSuivi] = useState("");
  const [suiviEnCours, setSuiviEnCours] = useState(false);
  const [suiviCree, setSuiviCree] = useState<SuiviCree | null>(null);
  const [erreurSuivi, setErreurSuivi] = useState<string | null>(null);

  const retourAuDiagnostic = () => navigate({ to: "/diagnostic" });

  // Un examen sans identifiant base est antérieur à la Vague 1 : on ne peut pas
  // décider « à sa place » sur le dossier entier, ce qui libérerait aussi les
  // examens que le clinicien n'a pas regardés.
  const idExamen = dossier?.id_examen ?? null;
  const decisionPossible = idExamen !== null;
  // Les recommandations se chargent a l'ouverture, pas seulement apres une
  // approbation : un examen deja valide et relu depuis l'historique doit aussi
  // afficher ses orientations. Le 409 du serveur (aucun verdict) n'est pas une
  // panne, il est laisse muet dans ce cas de figure.
  useEffect(() => {
    if (idExamen === null) return;
    void chargerRecommandations(idExamen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idExamen]);

  /** « Approuver » : journalise la décision, puis envoie le code OTP au patient
   * (email + WhatsApp, ou WhatsApp seul selon ses coordonnées). */
  /** Charge les recommandations serveur pour un examen. */
  const chargerRecommandations = async (examenId: number) => {
    setRecommandationsErreur(null);
    try {
      const reponse = await lireRecommandations(examenId);
      setRecommandations(reponse.recommandations.filter((reco) => reco.cible === "clinicien"));
    } catch (erreur) {
      setRecommandations(null);
      setRecommandationsErreur(
        erreur instanceof ApiError
          ? erreur.message
          : "Les recommandations ne sont pas disponibles pour le moment.",
      );
    }
  };

  /**
   * Partage WhatsApp du compte rendu. Réservé au clinicien : l'API refuse un
   * examen non approuvé, et l'erreur est affichée telle quelle.
   */
  const partager = async () => {
    if (!idExamen) return;
    setPartageEnCours(true);
    setPartageErreur(null);
    try {
      setPartage(await partagerCompteRendu(idExamen));
    } catch (erreur) {
      setPartage(null);
      setPartageErreur(
        erreur instanceof ApiError ? erreur.message : "Le partage WhatsApp n'a pas abouti.",
      );
    } finally {
      setPartageEnCours(false);
    }
  };

  const approuver = async () => {
    if (!dossier || !idExamen) return;
    setDecision("approuve");
    setEnvoiOtp(true);
    setErreurApprobation(null);
    try {
      const reponse = await approuverExamen(idExamen, noteClinique.trim() || undefined);
      setApprobation(reponse);
      // L'approbation vient de débloquer les recommandations patient : on les
      // relit, plutot que d'afficher une liste vide jusqu'au rechargement.
      void chargerRecommandations(idExamen);
    } catch (erreur) {
      setErreurApprobation(
        erreur instanceof ApiError
          ? erreur.message
          : "Échec de l'envoi OTP — le patient n'a pas été notifié. Vérifiez la connectivité du moteur, puis réessayez.",
      );
      setApprobation(null);
    } finally {
      setEnvoiOtp(false);
    }
  };

  /**
   * « Désapprouver » : exige un motif, journalise le désaccord et révoque les
   * codes déjà envoyés au patient. Sans cette révocation, le refus serait
   * cosmétique : le code est permanent, le patient continuerait de lire le
   * compte rendu rejeté.
   */
  const desapprouver = async () => {
    if (!dossier || !idExamen) return;
    const motif = motifDesaccord.trim();
    if (!motif) {
      setErreurApprobation("Un motif est obligatoire : il explique le désaccord à un tiers.");
      return;
    }
    setEnvoiOtp(true);
    setErreurApprobation(null);
    try {
      const reponse = await desapprouverExamen(idExamen, motif);
      setDesapprobation(reponse);
      setDecision("desapprouve");
      setMotifOuvert(false);
    } catch (erreur) {
      setErreurApprobation(
        erreur instanceof ApiError
          ? erreur.message
          : "Le désaccord n'a pas pu être enregistré. Réessayez.",
      );
    } finally {
      setEnvoiOtp(false);
    }
  };

  /** Programme un contrôle à venir depuis le compte rendu. */
  const programmerSuivi = async () => {
    const idPatient = dossier?.patient.id_patient ?? null;
    if (idPatient === null || !dateSuivi) {
      setErreurSuivi("Choisissez une date de contrôle.");
      return;
    }
    setSuiviEnCours(true);
    setErreurSuivi(null);
    try {
      const cree = await creerSuivi({
        id_patient: idPatient,
        date_suivi: dateSuivi,
        motif: motifSuivi.trim() || null,
        id_examen_origine: idExamen,
      });
      setSuiviCree(cree);
      setMotifSuivi("");
    } catch (erreur) {
      setErreurSuivi(
        erreur instanceof ApiError ? erreur.message : "Le contrôle n'a pas pu être programmé.",
      );
    } finally {
      setSuiviEnCours(false);
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
          <Tag tone={dossier.resultat.destination}>{dossier.resultat.destination} · exécution</Tag>
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
                  Conclusion — confiance {rapport.fiabilite.confiance}
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
              {!decisionPossible && (
                <p className="mb-3 flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft/30 p-3 text-xs text-navy/80">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                  <span>
                    Cet examen est antérieur à la traçabilité des décisions : il n'a pas
                    d'identifiant en base, donc aucune validation ni révocation ne peut lui être
                    rattachée. Relancez l'analyse depuis la page Diagnostic pour pouvoir trancher.
                  </span>
                </p>
              )}

              <label className="mb-3 block">
                <span className="mb-1 block font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                  Note clinique (facultative)
                </span>
                <textarea
                  value={noteClinique}
                  onChange={(e) => setNoteClinique(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Conduite à tenir, examens complémentaires à prescrire…"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!decisionPossible || decision !== null || envoiOtp}
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
                  {envoiOtp ? "Traitement…" : "Approuver"}
                </button>
                <button
                  type="button"
                  disabled={!decisionPossible || decision !== null || envoiOtp}
                  onClick={() => {
                    setMotifOuvert(true);
                    setErreurApprobation(null);
                  }}
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

              {motifOuvert && decision === null && (
                <div className="mt-3 rounded-md border border-alert/40 bg-alert-soft/20 p-3">
                  <label className="block">
                    <span className="mb-1 block font-mono text-[10px] font-bold tracking-[0.12em] text-alert uppercase">
                      Motif du désaccord (obligatoire)
                    </span>
                    <textarea
                      value={motifDesaccord}
                      onChange={(e) => setMotifDesaccord(e.target.value)}
                      maxLength={500}
                      rows={2}
                      autoFocus
                      placeholder="Verdict incohérent avec la lecture radiologique, cliché à refaire…"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                    />
                  </label>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Le motif est conservé au journal, même en cas de réapprobation ultérieure. Il
                    explique le refus à un tiers : écrivez-le comme au collègue qui reprendra le
                    dossier.
                  </p>
                  <button
                    type="button"
                    disabled={envoiOtp}
                    onClick={() => void desapprouver()}
                    className="mt-2 flex items-center gap-2 rounded-md bg-alert px-3 py-2 font-mono text-[11px] font-bold tracking-[0.12em] text-alert-foreground uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {envoiOtp ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ThumbsDown className="size-4" />
                    )}
                    Confirmer le désaccord
                  </button>
                </div>
              )}

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

                  {approbation &&
                    (approbation.statut === "otp_envoye" ||
                      approbation.statut === "otp_partiellement_envoye") && (
                      <p
                        className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
                          approbation.statut === "otp_envoye"
                            ? "border-ok/40 bg-ok-soft/40 text-navy/80"
                            : "border-warn/40 bg-warn-soft/40 text-navy/80"
                        }`}
                      >
                        <Send
                          className={`mt-0.5 size-3.5 shrink-0 ${
                            approbation.statut === "otp_envoye" ? "text-ok" : "text-warn"
                          }`}
                        />
                        <span>
                          <span
                            className={`font-semibold ${
                              approbation.statut === "otp_envoye" ? "text-ok" : "text-warn"
                            }`}
                          >
                            {approbation.statut === "otp_envoye"
                              ? "OTP envoyé au patient"
                              : "OTP partiellement envoyé au patient"}
                          </span>{" "}
                          par{" "}
                          {approbation.canal === "email+whatsapp"
                            ? "email et WhatsApp"
                            : approbation.canal === "whatsapp"
                              ? "WhatsApp seul"
                              : approbation.canal === "email"
                                ? "email seul"
                                : "aucun canal"}
                          {approbation.statut === "otp_partiellement_envoye" &&
                            approbation.canaux_oks &&
                            approbation.canaux_oks.length > 0 && (
                              <>
                                {" "}
                                (canaux ayant abouti :{" "}
                                <span className="font-semibold">
                                  {approbation.canaux_oks
                                    .map((c) => (c === "email" ? "email" : "WhatsApp"))
                                    .join(", ")}
                                </span>
                                )
                              </>
                            )}
                          .
                          {approbation.contact && (
                            <>
                              {" "}
                              Contact : <span className="font-mono">{approbation.contact}</span>.
                            </>
                          )}{" "}
                          {approbation.avertissements?.map((avertissement) => (
                            <span key={avertissement} className="block">
                              {avertissement}
                            </span>
                          ))}
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
                <div className="mt-3 space-y-2">
                  <p className="flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/30 p-3 text-xs text-navy/80">
                    <ThumbsDown className="mt-0.5 size-3.5 shrink-0 text-alert" />
                    <span>
                      <span className="font-semibold text-alert">Décision IA désapprouvée.</span>{" "}
                      Une relecture par un radiologue est recommandée avant toute conclusion
                      clinique.
                    </span>
                  </p>
                  {desapprobation && (
                    <p className="flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/20 p-3 text-xs text-navy/80">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
                      <span>
                        <span className="font-semibold text-alert">Désaccord journalisé.</span>{" "}
                        {desapprobation.otp_revoques > 0 ? (
                          <>
                            {desapprobation.otp_revoques} code
                            {desapprobation.otp_revoques > 1 ? "s" : ""} patient
                            {desapprobation.otp_revoques > 1 ? " ont" : " a"} été
                            {desapprobation.otp_revoques > 1 ? " révoqués" : " révoqué"} : le compte
                            rendu n'est plus accessible depuis ce code.
                          </>
                        ) : (
                          <>
                            Aucun code n'avait encore été envoyé pour cet examen : il n'y avait donc
                            rien à révoquer.
                          </>
                        )}
                      </span>
                    </p>
                  )}
                </div>
              )}
              {/* ── Recommandations et partage (Vague 2) ── */}
              {decisionPossible && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="label-xs">Orientations de prise en charge</p>
                    <div className="flex gap-1.5">
                      {decision === "approuve" && (
                        <button
                          type="button"
                          disabled={partageEnCours}
                          onClick={() => void partager()}
                          title="Envoyer le résumé du compte rendu validé par WhatsApp"
                          className="flex items-center gap-1.5 rounded-md border border-ok/30 bg-ok-soft/40 px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.1em] text-ok uppercase transition-colors hover:bg-ok-soft/70 disabled:opacity-50"
                        >
                          {partageEnCours ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Share2 className="size-3.5" />
                          )}
                          Partager par WhatsApp
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void chargerRecommandations(idExamen)}
                        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase transition-colors hover:text-foreground"
                      >
                        <Stethoscope className="size-3.5" />
                        Actualiser
                      </button>
                    </div>
                  </div>

                  {recommandationsErreur && (
                    <p className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft/30 p-3 text-xs text-navy/80">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                      <span>{recommandationsErreur}</span>
                    </p>
                  )}

                  {partageErreur && (
                    <p className="flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/40 p-3 text-xs text-alert">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
                      <span>{partageErreur}</span>
                    </p>
                  )}

                  {partage && (
                    <p className="flex items-start gap-2 rounded-md border border-ok/40 bg-ok-soft/30 p-3 text-xs text-navy/80">
                      <MessageCircle
                        className={`mt-0.5 size-3.5 shrink-0 ${partage.simulation ? "text-warn" : "text-ok"}`}
                      />
                      <span>
                        <span className="font-semibold text-ok">Résumé transmis par WhatsApp.</span>{" "}
                        {partage.nb_recommandations > 0
                          ? `Le message accompagne ${partage.nb_recommandations} orientation${
                              partage.nb_recommandations > 1 ? "s" : ""
                            } à donner.`
                          : "Aucun message d'orientation n'a été joint."}{" "}
                        {partage.simulation && (
                          <>
                            Aucun relais WhatsApp n'est configuré : l'envoi a été journalisé, pas
                            transmis.
                          </>
                        )}{" "}
                        Le compte rendu reste accessible par le portail patient.
                      </span>
                    </p>
                  )}

                  {recommandations && recommandations.length > 0 && (
                    <ul className="space-y-1.5 rounded-md border border-border bg-muted/20 p-3">
                      {recommandations.map((reco, index) => (
                        <li key={`${reco.motif}-${index}`} className="text-xs text-navy/85">
                          <span className="font-semibold text-foreground">
                            {reco.pathologie
                              ? reco.pathologie === "tuberculose"
                                ? "Tuberculose"
                                : "Pneumonie"
                              : "À noter"}
                            :
                          </span>{" "}
                          {reco.texte}
                          {reco.tags.length > 0 && (
                            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                              {reco.tags.join(" · ")}
                            </span>
                          )}
                        </li>
                      ))}
                      <li className="border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground italic">
                        Ces orientations guident la discussion clinique. Elles ne constituent ni un
                        diagnostic ni une prescription, et le modèle n'est pas calibré.
                      </li>
                    </ul>
                  )}
                </div>
              )}

              {erreurApprobation && decision !== "approuve" && (
                <p className="mt-3 flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/40 p-3 text-xs text-alert">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
                  <span>{erreurApprobation}</span>
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
                  Examen du {formatDateFr(dossier.horodatage)}
                </p>
              </div>
            </Panel>

            <Panel
              title="Contrôle à venir"
              subtitle="Programmer un suivi sans quitter le compte rendu"
            >
              {suiviCree ? (
                <p className="flex items-start gap-2 rounded-md border border-ok/40 bg-ok-soft/30 p-3 text-xs text-navy/80">
                  <CalendarCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
                  <span>
                    <span className="font-semibold text-ok">Contrôle programmé</span> le{" "}
                    {formatDateFr(suiviCree.date_suivi)}
                    {suiviCree.motif ? ` — ${suiviCree.motif}` : ""}. Il apparaîtra dans la page
                    Suivi.
                  </span>
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="mb-1 block font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                        Date du contrôle
                      </span>
                      <input
                        type="date"
                        value={dateSuivi}
                        onChange={(e) => setDateSuivi(e.target.value)}
                        className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
                      />
                    </label>
                    <label className="block flex-1">
                      <span className="mb-1 block font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                        Motif (facultatif)
                      </span>
                      <input
                        type="text"
                        value={motifSuivi}
                        onChange={(e) => setMotifSuivi(e.target.value)}
                        maxLength={500}
                        placeholder="Contrôle radiologique à 3 mois"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={suiviEnCours || !dateSuivi}
                      onClick={() => void programmerSuivi()}
                      className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 font-mono text-[11px] font-bold tracking-[0.12em] text-primary uppercase transition-colors hover:bg-primary/10 disabled:opacity-50"
                    >
                      {suiviEnCours ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CalendarPlus className="size-4" />
                      )}
                      Programmer
                    </button>
                  </div>
                  {erreurSuivi && (
                    <p className="mt-2 flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/40 p-3 text-xs text-alert">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
                      <span>{erreurSuivi}</span>
                    </p>
                  )}
                </>
              )}
            </Panel>
          </div>
        </div>
      </main>
    </>
  );
}
