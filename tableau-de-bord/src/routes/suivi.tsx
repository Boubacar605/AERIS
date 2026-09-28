/**
 * Suivi clinique — page clinicienne (Vague 1).
 *
 * La liste des contrôles à venir, et rien d'autre. C'est la page qui répond à
 * la seule question qui compte en fin de vacation : « qui ai-je promis de
 * revoir, et pour quand ? ».
 *
 * Les échéances sont ordonnées par date, les contrôles honnis ou annulés
 * passant en fin de liste plutôt que disparaître : rien n'est effacé, pour que
 * la promesse faite au patient reste lisible et traçable.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import {
  EtatIndisponible,
  Panel,
  SectionChargement,
  StatusDot,
  Tag,
} from "@/components/aeris/primitives";
import { useSuivisCliniques } from "@/hooks/use-api";
import { ApiError, changerStatutSuivi, creerSuivi } from "@/lib/api";
import { exigerRole } from "@/lib/authentification";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/suivi")({
  beforeLoad: () => exigerRole("clinicien"),
  component: SuiviPage,
  head: () => ({
    meta: [
      { title: "Suivi clinique · AERIS" },
      {
        name: "description",
        content:
          "Contrôles à venir par patient : échéances programmées, motifs et clôture des suivis.",
      },
    ],
  }),
});

type TonaliteSuivi = { libelle: string; tone: "ok" | "warn" | "neutral" };

const TONALITE_SUIVI: Record<string, TonaliteSuivi> = {
  planifie: { libelle: "Planifié", tone: "warn" },
  realise: { libelle: "Réalisé", tone: "ok" },
  annule: { libelle: "Annulé", tone: "neutral" },
};

/** Tonalité d'un statut, avec repli sur « Planifié » pour un statut inconnu. */
function tonaliteSuivi(statut: string): TonaliteSuivi {
  return TONALITE_SUIVI[statut] ?? { libelle: statut, tone: "neutral" };
}

function formatDateFr(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

/** Nombre de jours avant l'échéance ; négatif une fois dépassée. */
function joursAvant(iso?: string | null): number | null {
  if (!iso) return null;
  const cible = new Date(iso);
  if (Number.isNaN(cible.getTime())) return null;
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  cible.setHours(0, 0, 0, 0);
  return Math.round((cible.getTime() - aujourdhui.getTime()) / 86_400_000);
}

function SuiviPage() {
  const { suivis, etat, charger } = useSuivisCliniques();
  const [enCours, setEnCours] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  /** « Réalisé » ou « Annulé » : la promesse est close, la trace conservée. */
  const clore = async (idSuivi: number, statut: "realise" | "annule") => {
    setEnCours(idSuivi);
    setErreur(null);
    try {
      await changerStatutSuivi(idSuivi, statut);
      await charger();
    } catch (exception) {
      setErreur(
        exception instanceof ApiError ? exception.message : "Le suivi n'a pas pu être mis à jour.",
      );
    } finally {
      setEnCours(null);
    }
  };

  const planifies = suivis.filter((suivi) => suivi.statut === "planifie");
  const clos = suivis.filter((suivi) => suivi.statut !== "planifie");
  const enRetard = planifies.filter((suivi) => {
    const jours = joursAvant(suivi.date_suivi);
    return jours !== null && jours < 0;
  }).length;

  return (
    <AppShell>
      <PageHeader
        title="Suivi clinique"
        description="Contrôles à venir, par échéance et par patient"
      />
      <main className="space-y-4 p-5">
        {etat === "indisponible" ? (
          <EtatIndisponible
            message="Les suivis sont indisponibles tant que le moteur de décision ne répond pas."
            onRetry={() => void charger()}
          />
        ) : etat === "chargement" ? (
          <SectionChargement message="Lecture des contrôles programmés…" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="panel px-4 py-3">
                <p className="label-xs">Contrôles à venir</p>
                <p className="mt-1 flex items-center gap-2 font-mono text-xl font-semibold tabular-nums">
                  <StatusDot tone="ok" pulse={false} />
                  {planifies.length}
                </p>
              </div>
              <div className="panel px-4 py-3">
                <p className="label-xs">Échéance dépassée</p>
                <p
                  className={cn(
                    "mt-1 flex items-center gap-2 font-mono text-xl font-semibold tabular-nums",
                    enRetard > 0 && "text-alert",
                  )}
                >
                  <StatusDot tone={enRetard > 0 ? "alert" : "ok"} pulse={false} />
                  {enRetard}
                </p>
              </div>
              <div className="panel px-4 py-3">
                <p className="label-xs">Déjà honnis ou annulés</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{clos.length}</p>
              </div>
            </div>

            {erreur && (
              <p className="rounded-md border border-alert/40 bg-alert-soft/30 p-3 text-xs text-alert">
                {erreur}
              </p>
            )}

            <Panel
              title="Contrôles planifiés"
              subtitle="L'échéance la plus proche d'abord"
              bodyClassName="p-0"
            >
              {planifies.length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  Aucun contrôle à venir. Les suivis se programment depuis le compte rendu d'un
                  examen (bouton « Programmer »).
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {planifies.map((suivi) => {
                    const jours = joursAvant(suivi.date_suivi);
                    const retard = jours !== null && jours < 0;
                    return (
                      <li
                        key={suivi.id_suivi}
                        className="flex flex-wrap items-center gap-3 px-4 py-3"
                      >
                        <CalendarClock
                          className={cn(
                            "size-4 shrink-0",
                            retard ? "text-alert" : "text-muted-foreground",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-foreground">
                            {suivi.nom_complet ?? suivi.code_patient}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {suivi.code_patient}
                            {suivi.motif ? ` · ${suivi.motif}` : ""}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block font-mono text-xs text-foreground tabular-nums">
                            {formatDateFr(suivi.date_suivi)}
                          </span>
                          {retard ? (
                            <Tag tone="alert">En retard de {-jours} j</Tag>
                          ) : (
                            <Tag tone="warn">Dans {jours} j</Tag>
                          )}
                        </span>
                        <span className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={enCours === suivi.id_suivi}
                            onClick={() => void clore(suivi.id_suivi, "realise")}
                            title="Marquer comme réalisé"
                            className="flex items-center gap-1.5 rounded-md border border-ok/30 bg-ok-soft/40 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.1em] text-ok uppercase transition-colors hover:bg-ok-soft/70 disabled:opacity-50"
                          >
                            {enCours === suivi.id_suivi ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="size-3.5" />
                            )}
                            Réalisé
                          </button>
                          <button
                            type="button"
                            disabled={enCours === suivi.id_suivi}
                            onClick={() => void clore(suivi.id_suivi, "annule")}
                            title="Annuler ce contrôle"
                            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-mono text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase transition-colors hover:text-foreground disabled:opacity-50"
                          >
                            <XCircle className="size-3.5" />
                            Annuler
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            {clos.length > 0 && (
              <Panel
                title="Suivis clos"
                subtitle="Conservés pour tracer les promesses faites au patient"
                bodyClassName="p-0"
              >
                <ul className="divide-y divide-border/60">
                  {clos.map((suivi) => {
                    const tonalite = tonaliteSuivi(suivi.statut);
                    return (
                      <li
                        key={suivi.id_suivi}
                        className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                      >
                        <span className="min-w-0 flex-1 text-sm text-foreground">
                          {suivi.nom_complet ?? suivi.code_patient}
                          <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                            {suivi.code_patient}
                          </span>
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                          {formatDateFr(suivi.date_suivi)}
                        </span>
                        <Tag tone={tonalite.tone}>{tonalite.libelle}</Tag>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}
