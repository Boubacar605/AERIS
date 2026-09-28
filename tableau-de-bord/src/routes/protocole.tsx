/**
 * Protocole de validation — page clinicienne (Vague 2).
 *
 * La file de triage dit quoi faire ; cette page dit où l'on en est. Elle ne
 * répète pas Monitoring (latence, CPU, répartition Edge/Cloud, réservé à
 * l'admin) : elle ne parle que de charge de travail et de décisions cliniques.
 *
 * Trois règles de lecture, toutes visibles à l'écran :
 *
 * 1. **Zéro n'est pas toujours une donnée.** `taux_validation` vaut `null`
 *    quand aucun examen n'a été approuvé. La page affiche alors « — » et
 *    « aucun examen validé » : afficher 0 % se lirait comme un indicateur de
 *    performance, alors que c'est l'absence de toute validation.
 * 2. **La base indisponible n'est pas un zéro.** Si PostgreSQL ne répond pas,
 *    la page le dit et ne montre aucun chiffre. Des compteurs vides
 *    suggéreraient « aucune attente », ce qui est faux.
 * 3. **`sans_decision` est un état, pas une erreur.** Les examens analysés
 *    avant la mise en place de la validation n'ont aucune ligne dans le
 *    journal : ils comptent dans « à valider », sans être pour autant fautifs.
 *
 * Aucune action n'est proposée ici : on mesure, on ne décide pas.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ClipboardList, Info } from "lucide-react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import {
  EtatIndisponible,
  Meter,
  Panel,
  SectionChargement,
  Stat,
  Tag,
} from "@/components/aeris/primitives";
import { useProtocoleValidation } from "@/hooks/use-api";
import { exigerRole } from "@/lib/authentification";

export const Route = createFileRoute("/protocole")({
  beforeLoad: () => exigerRole("clinicien"),
  component: ProtocolePage,
  head: () => ({
    meta: [
      { title: "Protocole de validation · AERIS" },
      {
        name: "description",
        content:
          "Volumétrie de la file d'attente, décisions cliniques journalisées, révocations de codes et contrôles à venir.",
      },
    ],
  }),
});

/** Durée moyenne de validation, en jours, à partir des heures. */
function enJours(heures: number): string {
  if (heures <= 0) return "—";
  if (heures < 48) return `${Math.round(heures)} h`;
  return `${(heures / 24).toFixed(1).replace(/\.0$/, "")} j`;
}

export default function ProtocolePage() {
  const { protocole, etat, recharger } = useProtocoleValidation();

  return (
    <AppShell>
      <PageHeader
        title="Protocole de validation"
        description="Où en est la file, et ce que le protocole a déjà tranché"
      />
      <main className="space-y-4 p-5">
        {etat === "indisponible" ? (
          <EtatIndisponible
            message="Les agrégats sont indisponibles tant que la base de données ne répond pas. Aucun compteur n'est estimé dans ce cas."
            onRetry={() => void recharger()}
          />
        ) : etat === "chargement" || !protocole ? (
          <SectionChargement message="Lecture des agrégats de validation…" />
        ) : (
          <>
            <Panel title="File d'attente">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Examens analysés" value={protocole.examens_analyses} />
                <Stat label="Validés" value={protocole.examens_approuves} tone="ok" />
                <Stat
                  label="Désapprouvés"
                  value={protocole.examens_desapprouves}
                  {...(protocole.examens_desapprouves > 0 ? { tone: "alert" as const } : {})}
                />
                <Stat
                  label="À valider"
                  value={protocole.examens_non_approuves}
                  {...(protocole.examens_non_approuves > 0 ? { tone: "alert" as const } : {})}
                />
              </div>

              <div className="mt-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="label-xs">Part des examens validés</p>
                  <p className="font-mono text-sm font-semibold tabular-nums">
                    {protocole.taux_validation === null
                      ? "—"
                      : `${protocole.taux_validation.toFixed(1).replace(/\.0$/, "")} %`}
                  </p>
                </div>
                <Meter
                  className="mt-2"
                  value={protocole.taux_validation ?? 0}
                  tone={protocole.taux_validation === null ? "warn" : "ok"}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {protocole.taux_validation === null
                    ? "Aucun examen validé pour l'instant : ce pourcentage n'a pas de sens, il n'est pas calculé."
                    : "Rapport entre examens approuvés et examens analysés, tous confondus."}
                </p>
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Journal des décisions">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Stat label="Décisions journalisées" value={protocole.decisions_journalisees} />
                  <Stat label="Codes révoqués" value={protocole.otp_revoques} />
                </div>
                <p className="mt-4 flex items-start gap-2 text-[11px] text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Le journal est en ajout : une réapprobation n'efface pas le motif d'un désaccord
                    précédent. « Décisions journalisées » compte donc les décisions, pas les examens
                    — un examen tranché trois fois en compte trois.
                  </span>
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Chaque révocation suit un désaccord : sans elle, le patient continuerait de lire
                  un compte rendu rejeté.
                </p>
              </Panel>

              <Panel title="Suivi et délai">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Stat label="Contrôles à venir" value={protocole.controles_a_venir} />
                  <Stat
                    label="Délai moyen de validation"
                    value={enJours(protocole.delai_moyen_heures)}
                  />
                </div>
                <p className="mt-4 text-[11px] text-muted-foreground">
                  Le délai moyen mesure le temps entre l'analyse d'une radiographie et la décision
                  du clinicien. Il ne parle que des examens effectivement validés : les examens
                  encore en attente ne sont pas comptés, sinon le chiffre continuerait de croître
                  tout seul.
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Contrôles à venir : examens différés par un clinicien, à revoir à la date
                  programmée.
                </p>
              </Panel>
            </div>

            <Panel title="Règles appliquées">
              <ul className="space-y-2 text-xs text-navy/80">
                <li className="flex items-start gap-2">
                  <Tag tone="ok">approuvé</Tag>
                  <span>
                    Un code OTP est émis <em>pour cet examen</em> et le patient peut lire le compte
                    rendu.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Tag tone="alert">désapprouvé</Tag>
                  <span>
                    Le désaccord exige un motif, reste dans la file pour relecture, et révoque les
                    codes déjà envoyés.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Tag tone="warn">jamais validé</Tag>
                  <span>
                    État par défaut, jamais rétro-activé : les examens antérieurs à la mise en place
                    du protocole restent à valider. Aucune traçabilité n'est inventée.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Tag tone="warn">différé</Tag>
                  <span>
                    Un clinicien a explicitement reporté la décision et programmé un contrôle :
                    l'absence de ligne ne vaut pas report.
                  </span>
                </li>
              </ul>
              <p className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Ces états décrivent la <em>traçabilité</em> du dossier, pas la justesse du
                  diagnostic. Le modèle n'est pas calibré : un compte rendu validé reste une
                  hypothèse à confirmer par un clinicien, jamais une conclusion.
                </span>
              </p>
            </Panel>

            <Link
              to="/triage"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-cloud transition-colors hover:text-cloud/80"
            >
              <ClipboardList className="size-3.5" />
              Traiter la file d'attente
              <ArrowRight className="size-3.5" />
            </Link>
          </>
        )}
      </main>
    </AppShell>
  );
}
