/**
 * Dossier patient — page clinicienne (Vague 1).
 *
 * Ce que le soignant cherche entre deux examens : « qui dois-je revoir, et
 * qu'est-ce qui a changé depuis la dernière fois ? ». La page répond à ces deux
 * questions par la liste des dossiers puis, au clic, la chronologie complète
 * avec comparaison du dernier examen au précédent.
 *
 * Rien ici n'est technique : ni destination Edge/Cloud, ni latence, ni
 * identifiant système. Ces informations appartiennent à la page Historique,
 * journal de la plateforme — le dossier de soins et le journal d'exécution sont
 * deux vues différentes du même examen, et les mélanger ferait porter au
 * clinicien une information qu'il n'utilise pas pour soigner.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Search,
  Users,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import {
  EtatIndisponible,
  Panel,
  SectionChargement,
  StatusDot,
  Tag,
} from "@/components/aeris/primitives";
import { useChronologiePatient, useDossiersPatients } from "@/hooks/use-api";
import type { EtatValidation, VerdictClinique } from "@/lib/api";
import { exigerRole } from "@/lib/authentification";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/patients")({
  beforeLoad: () => exigerRole("clinicien"),
  component: PatientsPage,
  head: () => ({
    meta: [
      { title: "Dossiers patients · AERIS" },
      {
        name: "description",
        content:
          "Dossiers patients AERIS : chronologie des examens, comparaison des verdicts et état de validation clinique.",
      },
    ],
  }),
});

/** Libellé et couleur d'un état de validation, selon la charte AERIS. */
const ETAT_VALIDATION: Record<
  EtatValidation["statut"],
  { libelle: string; tone: "ok" | "warn" | "alert" | "neutral" }
> = {
  approuve: { libelle: "Validé", tone: "ok" },
  en_attente: { libelle: "En attente", tone: "warn" },
  desapprouve: { libelle: "Désapprouvé", tone: "alert" },
  sans_decision: { libelle: "Non validé", tone: "neutral" },
  sans_base: { libelle: "Indisponible", tone: "neutral" },
};

function TagValidation({ validation }: { validation: EtatValidation }) {
  const { libelle, tone } = ETAT_VALIDATION[validation.statut] ?? ETAT_VALIDATION.sans_decision;
  return <Tag tone={tone}>{libelle}</Tag>;
}

/** Un verdict, avec sa confiance exprimée en pourcentage lisible. */
function LigneVerdict({ verdict }: { verdict: VerdictClinique }) {
  const positif = verdict.prediction === "positif";
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot tone={positif ? "alert" : "ok"} pulse={false} />
      <span className="capitalize">{verdict.pathologie}</span>
      <span className={cn("font-semibold", positif ? "text-alert" : "text-ok")}>
        {positif ? "positif" : "négatif"}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
        {Math.round(verdict.confiance * 100)} %
      </span>
    </span>
  );
}

function formatDateFr(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("fr-FR");
}

function PatientsPage() {
  const { dossiers, etat, charger } = useDossiersPatients();
  const [recherche, setRecherche] = useState("");
  const [ouvert, setOuvert] = useState<string | null>(null);

  const filtres = dossiers.filter((dossier) =>
    `${dossier.code_patient} ${dossier.nom_complet ?? ""}`
      .toLowerCase()
      .includes(recherche.trim().toLowerCase()),
  );

  // Dossiers à revalider en priorité : un désaccord laissé sans suite est le
  // risque le plus coûteux de la Vague 1 — le patient a reçu un compte rendu
  // qu'un collègue a ensuite refusé.
  const aRelire = dossiers.filter((dossier) => dossier.validation.statut === "desapprouve").length;

  return (
    <AppShell>
      <PageHeader
        title="Dossiers patients"
        description="Chronologie des examens et validation clinique, dossier par dossier"
      />
      <main className="space-y-4 p-5">
        {etat === "indisponible" ? (
          <EtatIndisponible
            message="Les dossiers sont indisponibles tant que le moteur de décision ne répond pas."
            onRetry={() => void charger()}
          />
        ) : etat === "chargement" ? (
          <SectionChargement message="Lecture des dossiers auprès du moteur…" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="panel px-4 py-3">
                <p className="label-xs">Dossiers suivis</p>
                <p className="mt-1 flex items-center gap-2 font-mono text-xl font-semibold tabular-nums">
                  <StatusDot tone="ok" pulse={false} />
                  {dossiers.length}
                </p>
              </div>
              <div className="panel px-4 py-3">
                <p className="label-xs">Examens réalisés</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {dossiers.reduce((total, dossier) => total + dossier.nb_examens, 0)}
                </p>
              </div>
              <div className="panel px-4 py-3">
                <p className="label-xs">À relire</p>
                <p
                  className={cn(
                    "mt-1 flex items-center gap-2 font-mono text-xl font-semibold tabular-nums",
                    aRelire > 0 && "text-alert",
                  )}
                >
                  <StatusDot tone={aRelire > 0 ? "alert" : "ok"} pulse={false} />
                  {aRelire}
                </p>
              </div>
            </div>

            <Panel
              title="Liste des dossiers"
              subtitle={`${filtres.length} dossier${filtres.length > 1 ? "s" : ""}, le plus récemment examiné en premier`}
              bodyClassName="p-0"
              actions={
                <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                  <Search className="size-3.5 text-muted-foreground" />
                  <input
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                    placeholder="Nom ou code…"
                    className="w-32 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                </div>
              }
            >
              {filtres.length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  {dossiers.length === 0
                    ? "Aucun dossier enregistré. Les patients apparaissent ici dès le premier examen."
                    : "Aucun dossier ne correspond à cette recherche."}
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {filtres.map((dossier) => {
                    const estOuvert = ouvert === dossier.code_patient;
                    return (
                      <li key={dossier.id_patient}>
                        <button
                          type="button"
                          onClick={() => setOuvert(estOuvert ? null : dossier.code_patient)}
                          className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                        >
                          {estOuvert ? (
                            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-semibold text-foreground">
                              {dossier.nom_complet ?? "Nom non renseigné"}
                            </span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {dossier.code_patient}
                              {dossier.annee_naissance ? ` · ${dossier.annee_naissance}` : ""}
                              {dossier.sexe ? ` · ${dossier.sexe}` : ""}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-3 text-xs">
                            {dossier.dernier_verdict ? (
                              <LigneVerdict verdict={dossier.dernier_verdict} />
                            ) : (
                              <span className="text-muted-foreground">
                                {dossier.nb_examens === 0 ? "Aucun examen" : "Aucun verdict"}
                              </span>
                            )}
                            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                              {formatDateFr(dossier.dernier_examen_le)}
                            </span>
                            <TagValidation validation={dossier.validation} />
                          </span>
                        </button>
                        {estOuvert && <Chronologie codePatient={dossier.code_patient} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </>
        )}
      </main>
    </AppShell>
  );
}

/**
 * Chronologie d'un dossier, avec comparaison du dernier examen au précédent.
 *
 * La comparaison est calculée ici, et non côté serveur : le moteur renvoie les
 * examens bruts, et c'est l'interface qui décide ce qu'elle oppose. Aucun
 * endpoint dédié n'est nécessaire.
 */
function Chronologie({ codePatient }: { codePatient: string }) {
  const { chronologie, etat, charger } = useChronologiePatient(codePatient);

  if (etat === "indisponible") {
    return (
      <EtatIndisponible
        message="La chronologie de ce dossier est indisponible."
        onRetry={() => void charger()}
      />
    );
  }
  if (etat === "chargement" || !chronologie) {
    return <SectionChargement message="Lecture de la chronologie…" />;
  }

  const [premier, second] = chronologie.examens;
  if (!premier) {
    return (
      <div className="border-t border-border/60 bg-muted/20 px-4 py-4">
        <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <FileText className="size-4" />
          Ce dossier n'a encore aucun examen exploitable.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-border/60 bg-muted/20 px-4 py-4">
      {chronologie.telephone && (
        <p className="font-mono text-[11px] text-muted-foreground">
          Contact connu : {chronologie.telephone}
        </p>
      )}

      <>
        {second && (
          <Panel
            title="Évolution depuis l'examen précédent"
            subtitle="Les deux analyses les plus récentes, pathologie par pathologie"
          >
            <ul className="space-y-2">
              {(["tuberculose", "pneumonia"] as const).map((pathologie) => {
                const avant = second.resultats.find((r) => r.pathologie === pathologie);
                const maintenant = premier.resultats.find((r) => r.pathologie === pathologie);
                if (!avant && !maintenant) return null;
                return (
                  <li key={pathologie} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="min-w-28 font-semibold capitalize">{pathologie}</span>
                    {avant ? (
                      <LigneVerdict verdict={avant} />
                    ) : (
                      <span className="text-muted-foreground">non dépistée</span>
                    )}
                    <ChevronRight className="size-3 text-muted-foreground" />
                    {maintenant ? (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot
                          tone={maintenant.prediction === "positif" ? "alert" : "ok"}
                          pulse={false}
                        />
                        <span
                          className={cn(
                            "font-semibold",
                            maintenant.prediction === "positif" ? "text-alert" : "text-ok",
                          )}
                        >
                          {maintenant.prediction === "positif" ? "positif" : "négatif"}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                          {Math.round(maintenant.confiance * 100)} %
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">non dépistée</span>
                    )}
                    {avant && maintenant && avant.prediction !== maintenant.prediction && (
                      <Tag tone="warn">Changement</Tag>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}

        <Panel title="Historique des examens" subtitle="Du plus récent au plus ancien">
          <ul className="space-y-3">
            {chronologie.examens.map((examen) => (
              <li key={examen.id_examen} className="border-b border-border/50 pb-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatDateFr(examen.horodatage)}
                    {examen.code_examen ? ` · ${examen.code_examen}` : ""}
                  </span>
                  <TagValidation validation={examen.validation} />
                  {examen.nom_fichier && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {examen.nom_fichier}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {examen.resultats.length === 0 ? (
                    <span className="text-muted-foreground">Aucun verdict</span>
                  ) : (
                    examen.resultats.map((verdict) => (
                      <LigneVerdict key={verdict.pathologie} verdict={verdict} />
                    ))
                  )}
                </div>
                {examen.validation.motif_desaccord && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-alert">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span>
                      Désaccord : {examen.validation.motif_desaccord}
                      {examen.validation.par ? ` (${examen.validation.par})` : ""}
                    </span>
                  </p>
                )}
                {examen.validation.note_clinique && (
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" />
                    <span>{examen.validation.note_clinique}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </>
    </div>
  );
}
