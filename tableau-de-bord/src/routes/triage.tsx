/**
 * File de triage — page clinicienne (Vague 2).
 *
 * La première page du matin. Elle répond à une seule question : « qu'est-ce qui
 * attend une décision de ma part ? », et par extension « depuis combien de
 * temps ? ».
 *
 * Deux règles de lecture :
 *
 * 1. **Le plus ancien d'abord.** Un examen de la nuit et un examen bloqué depuis
 *    quinze jours ne se traitent pas de la même façon ; le tri fait ce travail
 *    pour que la page ne soit qu'une liste.
 * 2. **Le délai est une alerte, pas une sanction.** Un délai se dérive du
 *    nombre de jours écoulés, recalculé à chaque lecture. Rien n'est stocké,
 *    rien n'est envoyé : c'est un indicateur de charge du poste, pas un
 *    compteur figé.
 *
 * Le désaccord reste dans la file après décision : l' clinique doit pouvoir le
 * relire avec son motif, pas le perdre en fermant la page.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileWarning,
  Inbox,
  Loader2,
  PhoneOff,
  XCircle,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import {
  EtatIndisponible,
  Panel,
  SectionChargement,
  StatusDot,
  Tag,
} from "@/components/aeris/primitives";
import { useFileTriage } from "@/hooks/use-api";
import { ApiError, approuverExamen, desapprouverExamen, type ExamenTriage } from "@/lib/api";
import { exigerRole } from "@/lib/authentification";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/triage")({
  beforeLoad: () => exigerRole("clinicien"),
  component: TriagePage,
  head: () => ({
    meta: [
      { title: "File de triage · AERIS" },
      {
        name: "description",
        content:
          "Examens en attente de validation clinique, du plus ancien au plus récent, avec alertes de retard.",
      },
    ],
  }),
});

const LIBELLE_STATUT: Record<string, string> = {
  sans_decision: "Jamais validé",
  en_attente: "En attente",
  approuve: "Approuvé",
  desapprouve: "Désapprouvé",
  sans_base: "Base indisponible",
};

function formatDateFr(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Attente lisible : « aujourd'hui », « 3 j », « 15 j ». */
function libelleAttente(jours: number): string {
  if (jours <= 0) return "aujourd'hui";
  return `${jours} j`;
}

export default function TriagePage() {
  const { file, etat, recharger } = useFileTriage();
  const [enCours, setEnCours] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [motifs, setMotifs] = useState<Record<number, string>>({});

  const examiner = async (examen: ExamenTriage, decision: "approuver" | "desapprouver") => {
    const motif = motifs[examen.id_examen]?.trim() ?? "";
    if (decision === "desapprouver" && motif.length === 0) {
      setErreur("Un désaccord exige un motif : c'est lui qui le rendra relisible.");
      return;
    }
    setEnCours(examen.id_examen);
    setErreur(null);
    try {
      if (decision === "approuver") {
        await approuverExamen(examen.id_examen);
      } else {
        await desapprouverExamen(examen.id_examen, motif);
      }
      await recharger();
    } catch (exception) {
      setErreur(
        exception instanceof ApiError
          ? exception.message
          : "La décision n'a pas pu être enregistrée.",
      );
    } finally {
      setEnCours(null);
    }
  };

  const examens = file?.examens ?? [];
  const alertes = file?.alertes ?? [];
  const seuil = file?.seuil_alerte_jours ?? 2;
  const autres = examens.filter((examen) => !examen.alerte);

  return (
    <AppShell>
      <PageHeader
        title="File de triage"
        description="Examens en attente de validation, le plus ancien d'abord"
      />
      <main className="space-y-4 p-5">
        {etat === "indisponible" ? (
          <EtatIndisponible
            message="La file de triage est indisponible tant que le moteur de décision ne répond pas. Aucun délai n'est estimé dans ce cas."
            onRetry={() => void recharger()}
          />
        ) : etat === "chargement" ? (
          <SectionChargement message="Lecture de la file d'attente…" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="panel px-4 py-3">
                <p className="label-xs">En attente de décision</p>
                <p className="mt-1 flex items-center gap-2 font-mono text-xl font-semibold tabular-nums">
                  <StatusDot tone={examens.length > 0 ? "warn" : "ok"} pulse={false} />
                  {examens.length}
                </p>
              </div>
              <div className="panel px-4 py-3">
                <p className="label-xs">Alertes ({seuil} j ou plus)</p>
                <p
                  className={cn(
                    "mt-1 flex items-center gap-2 font-mono text-xl font-semibold tabular-nums",
                    alertes.length > 0 && "text-alert",
                  )}
                >
                  <StatusDot tone={alertes.length > 0 ? "alert" : "ok"} pulse={false} />
                  {alertes.length}
                </p>
              </div>
              <div className="panel px-4 py-3">
                <p className="label-xs">Patients concernés</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {new Set(examens.map((examen) => examen.id_patient)).size}
                </p>
              </div>
            </div>

            {erreur && (
              <p className="rounded-md border border-alert/40 bg-alert-soft/30 p-3 text-xs text-alert">
                {erreur}
              </p>
            )}

            {examens.length === 0 ? (
              <Panel title="File vide" bodyClassName="p-0">
                <p className="p-8 text-center text-xs text-muted-foreground">
                  <Inbox className="mx-auto mb-3 size-6 opacity-50" />
                  Aucun examen n'attend de validation. Les diagnostics déjà approuvés sortent de la
                  file ; ceux qui n'ont jamais été validés y entrent.
                </p>
              </Panel>
            ) : (
              <>
                {alertes.length > 0 && (
                  <Panel
                    title="Alertes de retard"
                    subtitle={`Sans décision depuis ${seuil} jours ou plus`}
                    bodyClassName="p-0"
                  >
                    <ul className="divide-y divide-border/60">
                      {alertes.map((examen) => (
                        <LigneTriage
                          key={`alerte-${examen.id_examen}`}
                          examen={examen}
                          enCours={enCours === examen.id_examen}
                          motif={motifs[examen.id_examen] ?? ""}
                          onMotif={(valeur) =>
                            setMotifs((actuels) => ({ ...actuels, [examen.id_examen]: valeur }))
                          }
                          onDecider={(decision) => void examiner(examen, decision)}
                        />
                      ))}
                    </ul>
                  </Panel>
                )}

                <Panel
                  title="Autres examens en attente"
                  subtitle="Rendus il y a moins de quelques jours"
                  bodyClassName="p-0"
                >
                  {autres.length === 0 ? (
                    <p className="p-6 text-center text-xs text-muted-foreground">
                      Tous les examens en attente sont dans les alertes ci-dessus.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {autres.map((examen) => (
                        <LigneTriage
                          key={`autre-${examen.id_examen}`}
                          examen={examen}
                          enCours={enCours === examen.id_examen}
                          motif={motifs[examen.id_examen] ?? ""}
                          onMotif={(valeur) =>
                            setMotifs((actuels) => ({ ...actuels, [examen.id_examen]: valeur }))
                          }
                          onDecider={(decision) => void examiner(examen, decision)}
                        />
                      ))}
                    </ul>
                  )}
                </Panel>
              </>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}

type LigneTriageProps = {
  examen: ExamenTriage;
  enCours: boolean;
  motif: string;
  onMotif: (valeur: string) => void;
  onDecider: (decision: "approuver" | "desapprouver") => void;
};

function LigneTriage({ examen, enCours, motif, onMotif, onDecider }: LigneTriageProps) {
  const [ouvert, setOuvert] = useState(false);
  const verdict = examen.verdict_principal;
  const desapproouve = examen.validation.statut === "desapprouve";

  return (
    <li className={cn("px-4 py-3", examen.alerte && "border-l-2 border-l-alert")}>
      <div className="flex flex-wrap items-center gap-3">
        {examen.alerte ? (
          <AlertTriangle className="size-4 shrink-0 text-alert" />
        ) : (
          <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
        )}

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {examen.nom_complet ?? examen.code_patient}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {examen.code_patient} · {examen.code_examen ?? "—"} · {formatDateFr(examen.horodatage)}
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-1.5">
          {verdict ? (
            <Tag tone={verdict.prediction === "positif" ? "alert" : "ok"}>
              {verdict.pathologie === "tuberculose" ? "TB" : "PN"}{" "}
              {verdict.prediction === "positif" ? "positif" : "négatif"}
            </Tag>
          ) : (
            <Tag tone="neutral">aucun positif</Tag>
          )}
          {!examen.contact_disponible && (
            <Tag tone="warn">
              <PhoneOff className="size-3" /> sans contact
            </Tag>
          )}
          {desapproouve && (
            <Tag tone="neutral">
              <FileWarning className="size-3" /> désaccord
            </Tag>
          )}
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              examen.alerte ? "font-semibold text-alert" : "text-muted-foreground",
            )}
          >
            {libelleAttente(examen.jours_attente)}
          </span>
        </span>

        <span className="flex gap-1.5">
          <Link
            to="/patients"
            className="rounded-md border border-border bg-card px-2 py-1 font-mono text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            Dossier
          </Link>
          <button
            type="button"
            // Une approbation notifie le patient par OTP : sans téléphone ni
            // e-mail, l'API refuse la décision. Mieux vaut l'expliquer ici que
            // renvoyer une erreur après le clic.
            disabled={enCours || !examen.contact_disponible}
            onClick={() => onDecider("approuver")}
            title={
              examen.contact_disponible
                ? "Approuver et notifier le patient par SMS ou e-mail"
                : "Patient sans téléphone ni e-mail : l'approbation ne peut pas être notifiée. Relevez d'abord un contact au dossier."
            }
            className="flex items-center gap-1.5 rounded-md border border-ok/30 bg-ok-soft/40 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.1em] text-ok uppercase transition-colors hover:bg-ok-soft/70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enCours ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Approuver
          </button>
          <button
            type="button"
            disabled={enCours}
            onClick={() => setOuvert((v) => !v)}
            title="Ouvrir le motif de désaccord"
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-mono text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase transition-colors hover:text-foreground disabled:opacity-50"
          >
            <XCircle className="size-3.5" />
            Désapprouver
          </button>
        </span>
      </div>

      {desapproouve && examen.validation.motif_desaccord && (
        <p className="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground italic">
          Motif du désaccord : {examen.validation.motif_desaccord}
        </p>
      )}

      {ouvert && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
          <label className="label-xs" htmlFor={`motif-${examen.id_examen}`}>
            Motif du désaccord (obligatoire)
          </label>
          <textarea
            id={`motif-${examen.id_examen}`}
            value={motif}
            onChange={(evenement) => onMotif(evenement.target.value)}
            rows={2}
            placeholder="Ex. : image de mauvaise qualité, cliché non contributif…"
            className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:border-ok focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Le désaccord révoque les codes déjà envoyés au patient.
            </p>
            <button
              type="button"
              disabled={enCours}
              onClick={() => onDecider("desapprouver")}
              className="flex items-center gap-1.5 rounded-md border border-alert/40 bg-alert-soft/40 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.1em] text-alert uppercase transition-colors hover:bg-alert-soft/70 disabled:opacity-50"
            >
              {enCours ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <XCircle className="size-3.5" />
              )}
              Confirmer le désaccord
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
