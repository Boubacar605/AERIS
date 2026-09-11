import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Cloud,
  Cpu,
  Info,
  Play,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Stethoscope,
  Upload,
} from "lucide-react";
import { AppShell, PageHeader, useConnexion } from "@/components/aeris/AppShell";
import { Meter, Panel, StatusDot, Tag } from "@/components/aeris/primitives";
import { SyntheseClinique } from "@/components/aeris/SyntheseClinique";
import { useEtatSysteme } from "@/hooks/use-api";
import {
  uploadImage,
  type EvenementEscalade,
  type FiltrageSpecialistes,
  type ReponseRoutage,
  type ResultatDiagnostic,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Pie, PieChart, ResponsiveContainer } from "recharts";

export const Route = createFileRoute("/diagnostic")({
  component: DiagnosticPage,
  head: () => ({
    meta: [
      { title: "Diagnostic assisté · AERIS" },
      {
        name: "description",
        content:
          "Lancez une inférence de triage radiologique et observez en direct le routage Edge ou Cloud choisi par l'orchestrateur AERIS.",
      },
      { property: "og:title", content: "Diagnostic assisté · AERIS" },
      {
        property: "og:description",
        content: "Exécution guidée d'une inférence IA avec routage adaptatif Edge-Cloud.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const STEPS = [
  { key: "ingest", label: "Ingestion", detail: "Réception de la radiographie" },
  { key: "profil", label: "Profilage", detail: "Analyse légère de la radiographie" },
  { key: "probe", label: "Télémétrie", detail: "Sondage des nœuds disponibles" },
  { key: "route", label: "Routage", detail: "Sélection de l'environnement d'exécution" },
  { key: "infer", label: "Inférence", detail: "Passage des modèles du domaine retenu" },
  { key: "report", label: "Rapport", detail: "Restitution des résultats cliniques" },
] as const;

const MODES_ROUTAGE = [
  { key: "auto", label: "Auto", hint: "Décision du moteur" },
  { key: "edge", label: "Forcer Edge", hint: "Traitement local" },
  { key: "cloud", label: "Forcer Cloud", hint: "Traitement distant" },
] as const;

const MODES_CONTEXTE = [
  { key: "auto", label: "Auto (profil)", hint: "Triage par le format de l'image" },
  { key: "tuberculose", label: "Dépistage TB", hint: "Focus modèle tuberculose" },
  { key: "pneumonie", label: "Dépistage PN", hint: "Focus modèle pneumonie" },
  { key: "general", label: "Général", hint: "Bilan des deux pathologies" },
] as const;

type ModeRoutage = (typeof MODES_ROUTAGE)[number]["key"];
type ContexteMode = (typeof MODES_CONTEXTE)[number]["key"];
type Destination = "edge" | "cloud";

type Reason = { label: string; value: string; state: "ok" | "warn" | "alert" };

type ResultatAnalyse = {
  destination: Destination;
  raison: string;
  metriques: {
    cpu_pourcentage: number;
    ram_pourcentage: number;
    latence_reseau_ms: number;
    reseau_disponible: boolean;
  };
  resultats: ResultatDiagnostic[];
  escalades: EvenementEscalade[];
  temps_total_ms: number;
  temps_escalade_ms: number | null;
  /** Profilage de l'image et triage des spécialistes, si fourni par le moteur. */
  filtrage?: FiltrageSpecialistes;
};

/** Libellé affiché pour une pathologie, aligné sur les modèles du backend. */
const LIBELLE_PATHOLOGIE: Record<string, string> = {
  tuberculose: "TB Classifier",
  pneumonie: "Pneumonia Classifier",
};

/** Construit la liste des raisons de routage à partir des métriques. */
function raisonsDepuis(resultat: ResultatAnalyse): Reason[] {
  const m = resultat.metriques;
  const etat = (ok: boolean, warn = false): "ok" | "warn" | "alert" =>
    ok ? "ok" : warn ? "warn" : "alert";
  const injoignable = m.latence_reseau_ms >= 9000;
  return [
    {
      label: "Latence réseau",
      value: injoignable ? "injoignable" : `${Math.round(m.latence_reseau_ms)} ms`,
      state: etat(!injoignable && m.latence_reseau_ms < 100, m.latence_reseau_ms < 160),
    },
    {
      label: "CPU Edge",
      value: `${Math.round(m.cpu_pourcentage)}%`,
      state: etat(m.cpu_pourcentage < 75, m.cpu_pourcentage < 90),
    },
    {
      label: "RAM Edge",
      value: `${Math.round(m.ram_pourcentage)}%`,
      state: etat(m.ram_pourcentage < 75, m.ram_pourcentage < 90),
    },
    {
      label: "Réseau",
      value: m.reseau_disponible ? "disponible" : "interrompu",
      state: etat(m.reseau_disponible),
    },
  ];
}

/** Libellé humain d'une raison de routage. */
function libelleRaisonDestination(destination: Destination): string {
  return destination === "edge"
    ? "Environnement Edge retenu pour l'inférence primaire."
    : "Environnement Cloud retenu pour l'inférence primaire.";
}

/** Badge résumant la règle de triage appliquée par le profilage. */
const LIBELLES_PROFIL: Record<string, { label: string; tone: "ok" | "warn" | "alert" }> = {
  profil_tb: { label: "Profil TB", tone: "ok" },
  profil_pn: { label: "Profil PN", tone: "ok" },
  profil_ambigue: { label: "Ambigu", tone: "warn" },
  profil_indecodable: { label: "Indécodable", tone: "alert" },
  profilage_desactive: { label: "Profilage désactivé", tone: "warn" },
  contexte_tuberculose: { label: "Contexte TB", tone: "ok" },
  contexte_pneumonie: { label: "Contexte PN", tone: "ok" },
  contexte_general: { label: "Contexte général", tone: "warn" },
};

/** Format lisible d'une taille en octets (Ko / Mo). */
function formaterTaille(octets: number): string {
  if (octets >= 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
  if (octets >= 1024) return `${(octets / 1024).toFixed(0)} Ko`;
  return `${octets} o`;
}

/** Résout une variable CSS en sa valeur calculée (oklch, hex, etc.) via le DOM. */
function resoudreVariable(nom: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(nom).trim() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Donut circulaire de répartition des routages Edge vs Cloud.
 * Alimenté en live par GET /etat-systeme (statistiques.repartition) du moteur.
 * Les couleurs sont résolues au montage (getComputedStyle) puis placées DANS
 * les données (entry.fill) : c'est le seul chemin fiable dans Recharts — les
 * <Cell> d'un <Pie> alimenté en data ne sont pas toujours fusionnés.
 */
function DonutRepartition({ requetes }: { requetes: { edge: number; cloud: number } | null }) {
  const edge = requetes?.edge ?? 0;
  const cloud = requetes?.cloud ?? 0;
  const total = edge + cloud;
  const pourcentageEdge = total > 0 ? Math.round((edge / total) * 100) : null;
  const couleurs = {
    edge: resoudreVariable("--edge", "oklch(0.72 0.16 63)"),
    cloud: resoudreVariable("--cloud", "oklch(0.58 0.15 250)"),
  };
  const vide = total === 0;
  const donnees = vide
    ? [{ nom: "Aucun", valeur: 1, fill: "#a3a3a3", fillOpacity: 0.25 }]
    : [
        { nom: "Edge", valeur: edge, fill: couleurs.edge },
        { nom: "Cloud", valeur: cloud, fill: couleurs.cloud },
      ];
  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <p className="flex items-center gap-2 text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        <Activity className="size-3" /> Répartition des routages
      </p>
      <div className="mt-2 flex items-center gap-4">
        <div className="relative shrink-0">
          <ResponsiveContainer width={146} height={146}>
            <PieChart>
              <Pie
                data={donnees}
                dataKey="valeur"
                nameKey="nom"
                innerRadius={50}
                outerRadius={67}
                stroke="none"
                startAngle={90}
                endAngle={-270}
                paddingAngle={total > 0 ? 2 : 0}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="font-mono text-xl leading-none font-bold tabular-nums">
                {pourcentageEdge != null ? `${pourcentageEdge}%` : "—"}
              </p>
              <p className="mt-0.5 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                edge
              </p>
            </div>
          </div>
        </div>
        <dl className="min-w-0 flex-1 space-y-1.5 text-[11px]">
          {[
            { nom: "Edge", valeur: edge, couleur: couleurs.edge },
            { nom: "Cloud", valeur: cloud, couleur: couleurs.cloud },
          ].map((l) => (
            <div
              key={l.nom}
              className="flex items-center justify-between gap-2 rounded border border-border/70 bg-background/60 px-2.5 py-1.5"
            >
              <dt className="flex items-center gap-1.5 font-semibold">
                <span className="size-2 rounded-full" style={{ backgroundColor: l.couleur }} />
                {l.nom}
              </dt>
              <dd className="font-mono tabular-nums">{l.valeur} req</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/**
 * Verdict mono-spécialiste : affiché quand le profilage a écarté l'un des
 * deux modèles. Le croisement clinique de SyntheseClinique exige les deux
 * lectures — il ne doit jamais être rendu avec un seul résultat.
 */
function VerdictUnique({
  resultat,
  resultatUnique,
}: {
  resultat: ResultatAnalyse;
  resultatUnique: ResultatDiagnostic;
}) {
  const t = resultatUnique.indetermine
    ? "alert"
    : resultatUnique.prediction === "positif"
      ? "warn"
      : "ok";
  const ecarte = resultat.filtrage?.specialiste_ecarte;
  const remarque = ecarte
    ? `${LIBELLE_PATHOLOGIE[ecarte] ?? ecarte} non sollicité — ${
        resultat.filtrage?.regle_appliquee ?? "hors domaine"
      }. L'image n'appartient pas à son domaine d'entraînement : absence de verdict, pas de contradiction.`
    : "Un seul spécialiste a été sollicité pour cette analyse.";

  return (
    <div
      className={cn(
        "rounded-xl border p-5 transition-colors",
        t === "ok"
          ? "border-ok/40 bg-ok-soft/30"
          : t === "warn"
            ? "border-warn/40 bg-warn-soft/30"
            : "border-alert/40 bg-alert-soft/30",
      )}
    >
      <p className="label-xs tracking-[0.14em] text-muted-foreground">VERDICT MONO-SPÉCIALISTE</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {resultatUnique.indetermine ? (
          <ShieldAlert className="size-5 text-alert" />
        ) : resultatUnique.prediction === "positif" ? (
          <ScanLine className="size-5 text-warn" />
        ) : (
          <BadgeCheck className="size-5 text-ok" />
        )}
        <h3
          className={cn(
            "text-lg font-bold tracking-tight",
            t === "ok" && "text-ok",
            t === "warn" && "text-warn",
            t === "alert" && "text-alert",
          )}
        >
          {resultatUnique.indetermine
            ? "RELECTURE REQUISE"
            : resultatUnique.prediction === "positif"
              ? "PATHOLOGIE SUSPECTÉE"
              : "EXAMEN NORMAL"}
        </h3>
        <span className="font-mono text-[11px] text-muted-foreground">
          {LIBELLE_PATHOLOGIE[resultatUnique.pathologie] ?? resultatUnique.pathologie}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Confiance retenue</span>
        <span
          className={cn(
            "font-mono text-sm font-bold tabular-nums",
            t === "ok" && "text-ok",
            t === "warn" && "text-warn",
            t === "alert" && "text-alert",
          )}
        >
          {Math.round(resultatUnique.confiance * 100)}%
        </span>
      </div>
      <Meter value={Math.round(resultatUnique.confiance * 100)} tone={t} className="mt-1.5" />

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-background/40 px-4 py-3">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{remarque}</p>
      </div>
    </div>
  );
}

function DiagnosticPage() {
  return (
    <AppShell>
      <DiagnosticContent />
    </AppShell>
  );
}

function DiagnosticContent() {
  const { connecte } = useConnexion();
  const { decision: decisionTempsReel } = useEtatSysteme(5000);
  const [mode, setMode] = useState<ModeRoutage>("auto");
  const [contexte, setContexte] = useState<ContexteMode>("auto");
  const [fichier, setFichier] = useState<File | null>(null);
  const imagePreviewUrl = useMemo(() => (fichier ? URL.createObjectURL(fichier) : null), [fichier]);
  const [resultat, setResultat] = useState<ResultatAnalyse | null>(null);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);
  const [erreurLive, setErreurLive] = useState(false);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

  // Révoquer l'URL objet pour éviter les fuites mémoire.
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const purgeTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const run = async () => {
    if (running) return;
    if (!fichier) {
      setStep(-1);
      return;
    }
    setRunning(true);
    purgeTimers();
    setResultat(null);
    setErreurLive(false);
    setStep(0);

    // Animation visuelle du pipeline pendant l'appel réseau.
    STEPS.forEach((_, i) => {
      timersRef.current.push(setTimeout(() => setStep(i), i * 500));
    });

    try {
      const reponse: ReponseRoutage = await uploadImage(
        "/routage/analyser",
        fichier,
        mode === "auto" ? undefined : mode,
        contexte,
      );
      setResultat({
        destination: reponse.decision.destination,
        raison: reponse.decision.raison,
        metriques: reponse.decision.metriques,
        resultats: reponse.resultats,
        // Le moteur est censé renvoyer ce champ ; un backend partiellement
        // à jour ou en dégradation ne doit jamais faire planter le rendu.
        escalades: reponse.escalades ?? [],
        temps_total_ms: reponse.temps_total_ms,
        temps_escalade_ms: reponse.temps_escalade_ms ?? null,
        // Le champ est omis (exactOptionalPropertyTypes) si le backend ne
        // renvoie pas le profilage (version ancienne).
        ...(reponse.filtrage ? { filtrage: reponse.filtrage } : {}),
      });
      setErreurLive(false);
    } catch {
      // Moteur injoignable : aucun résultat n'est fabriqué.
      setResultat(null);
      setErreurLive(true);
    } finally {
      setRunning(false);
      setStep(STEPS.length);
    }
  };

  const reset = () => {
    purgeTimers();
    setStep(-1);
    setResultat(null);
    setErreurLive(false);
  };

  const moteurIndisponible = !connecte;

  return (
    <>
      <PageHeader
        title="Diagnostic"
        description="Exécution guidée d'une inférence avec routage adaptatif"
        right={
          <>
            {moteurIndisponible && !resultat && (
              <span className="rounded-full border border-alert/40 bg-alert-soft px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-alert uppercase">
                ● Moteur injoignable
              </span>
            )}
            {resultat && <Tag tone={resultat.destination}>{resultat.destination} execution</Tag>}
          </>
        }
      />

      <main className="space-y-4 p-5">
        {/* ------------------- Zone entrée + pipeline ------------------- */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          {/* -------- Colonne gauche : entrée -------- */}
          <div className="space-y-4">
            <Panel title="Study input" subtitle="Radiographie thoracique à analyser">
              <div className="grid-surface relative aspect-4/3 overflow-hidden rounded-lg border border-border bg-muted/40">
                <label
                  htmlFor="radiographie"
                  className="flex h-full w-full cursor-pointer flex-col items-center justify-center p-6 text-center"
                >
                  {imagePreviewUrl ? (
                    <>
                      <img
                        src={imagePreviewUrl}
                        alt="Aperçu de la radiographie"
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                      <span className="absolute bottom-2 left-2 rounded-md bg-background/80 px-2 py-1 font-mono text-[10px] font-semibold backdrop-blur">
                        {fichier!.name} · {(fichier!.size / 1024).toFixed(0)} Ko
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="size-7 text-muted-foreground" />
                      <p className="mt-2 font-mono text-xs font-semibold">
                        Importer une radiographie
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        PNG, JPEG — cliquer pour choisir
                      </p>
                    </>
                  )}
                  <input
                    id="radiographie"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setFichier(f);
                        reset();
                      }
                    }}
                  />
                </label>
              </div>

              <p className="label-xs mt-4">Routing mode</p>
              <div className="mt-2 grid gap-2">
                {MODES_ROUTAGE.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMode(m.key)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border p-3 text-left transition-all",
                      mode === m.key
                        ? "border-primary bg-primary/5 shadow-raise"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <span>
                      <span className="flex items-center gap-2 text-xs font-semibold">
                        <ScanLine className="size-3.5 text-primary" />
                        {m.label}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                        {m.hint}
                      </span>
                    </span>
                    {mode === m.key && <StatusDot tone="ok" pulse={false} />}
                  </button>
                ))}
              </div>

              <p className="label-xs mt-4">Contexte de dépistage</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {MODES_CONTEXTE.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setContexte(c.key)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border p-3 text-left transition-all",
                      contexte === c.key
                        ? "border-primary bg-primary/5 shadow-raise"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <span>
                      <span className="flex items-center gap-2 text-xs font-semibold">
                        <Stethoscope className="size-3.5 text-primary" />
                        {c.label}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                        {c.hint}
                      </span>
                    </span>
                    {contexte === c.key && <StatusDot tone="ok" pulse={false} />}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                Un contexte clinique prime sur le triage automatique par le format.
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={run}
                  disabled={running || !fichier || moteurIndisponible}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-foreground uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Play className="size-3.5" />
                  {running ? "Running…" : "Run inference"}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Réinitialiser"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </div>
              {moteurIndisponible && (
                <p className="mt-2 rounded-md border border-alert/30 bg-alert-soft px-3 py-2 font-mono text-[10px] text-alert">
                  Moteur injoignable — analyse impossible tant que le backend ne répond pas.
                </p>
              )}
            </Panel>
          </div>

          {/* -------- Colonne droite : pipeline -------- */}
          <div className="flex flex-col gap-4">
            <Panel title="Execution pipeline" subtitle="Progression de la requête dans le système">
              <ol className="space-y-1.5">
                {STEPS.map((s, i) => {
                  const state = step > i || resultat ? "done" : step === i ? "active" : "idle";
                  return (
                    <li
                      key={s.key}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all duration-300",
                        state === "active"
                          ? "border-primary/50 bg-primary/5"
                          : state === "done"
                            ? "border-ok/30 bg-ok-soft"
                            : "border-border opacity-60",
                      )}
                    >
                      <StatusDot
                        tone={state === "done" ? "ok" : state === "active" ? "cloud" : "idle"}
                        pulse={state === "active"}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{s.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{s.detail}</p>
                      </div>
                      <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                        {state}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {erreurLive && (
                <p className="mt-3 rounded-md border border-alert/30 bg-alert-soft px-3 py-2 font-mono text-[10px] text-alert">
                  Moteur injoignable — aucun résultat n'a été produit.
                </p>
              )}
            </Panel>

            {/* -------- Carte contexte d'exécution -------- */}
            <Panel
              title="Contexte d'exécution"
              subtitle="Paramètres et état du système avant lancement"
              className="flex-1"
              bodyClassName="flex flex-col"
            >
              <dl className="grid gap-2 sm:grid-cols-2">
                {[
                  {
                    label: "Mode de routage",
                    value: MODES_ROUTAGE.find((m) => m.key === mode)?.label ?? mode,
                    tone: mode === "auto" ? ("ok" as const) : ("cloud" as const),
                  },
                  {
                    label: "Contexte dépistage",
                    value: MODES_CONTEXTE.find((c) => c.key === contexte)?.label ?? contexte,
                    tone: contexte === "auto" ? ("ok" as const) : ("cloud" as const),
                  },
                  {
                    label: "Connectivité moteur",
                    value: connecte ? "connecté" : "injoignable",
                    tone: (connecte ? "ok" : "alert") as "ok" | "alert",
                  },
                  {
                    label: "Profiling",
                    value: "sélectif (1–2 modèles)",
                    tone: "ok" as const,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2"
                  >
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <StatusDot tone={item.tone} pulse={false} />
                      {item.label}
                    </span>
                    <span className="font-mono text-xs font-semibold">{item.value}</span>
                  </div>
                ))}
              </dl>
              <DonutRepartition requetes={decisionTempsReel?.requetes ?? null} />
              <p className="mt-auto flex items-baseline gap-2.5 border-t border-border/60 pt-3">
                {(() => {
                  const totalRequetes =
                    (decisionTempsReel?.requetes?.edge ?? 0) +
                    (decisionTempsReel?.requetes?.cloud ?? 0);
                  if (totalRequetes > 0) {
                    return (
                      <>
                        <span className="font-mono text-2xl leading-none font-bold tabular-nums">
                          {totalRequetes}
                        </span>
                        <span className="text-sm font-medium text-muted-foreground">
                          requêtes routées · mise à jour live
                        </span>
                      </>
                    );
                  }
                  return (
                    <span className="text-[11px] text-muted-foreground">
                      Aucune requête routée pour l'instant
                    </span>
                  );
                })()}
              </p>
              {!connecte && (
                <p className="mt-2 rounded-md border border-alert/30 bg-alert-soft px-3 py-2 font-mono text-[10px] text-alert">
                  Le moteur de décision est injoignable — lancez-le avant de lancer l'inférence.
                </p>
              )}
            </Panel>
          </div>
        </div>

        {/* ------------------- Zone résultats (pleine largeur) ------------------- */}
        {resultat ? (
          <>
            <Panel
              title="Clinical results"
              subtitle={`Analyse réelle — ${resultat.resultats.length} pathologie${resultat.resultats.length > 1 ? "s" : ""}`}
              actions={
                <Tag tone="ok">
                  <StatusDot tone="ok" /> completed
                </Tag>
              }
            >
              <div className="space-y-3">
                {resultat.resultats.map((r) => {
                  const source = r.source ?? resultat.destination;
                  const indeterminate = r.indetermine === true;
                  const escalation = resultat.escalades.find((e) => e.pathologie === r.pathologie);
                  const profilage = resultat.filtrage;
                  const profilBadge = profilage
                    ? (LIBELLES_PROFIL[profilage.cle_regle ?? ""] ?? null)
                    : null;
                  const partTemps =
                    resultat.temps_total_ms > 0
                      ? Math.round((r.temps_inference_ms / resultat.temps_total_ms) * 100)
                      : null;
                  const sourceDestination = source === "edge" ? "EDGE" : "CLOUD";
                  return (
                    <div key={r.pathologie} className="grid gap-3 lg:grid-cols-2">
                      <div
                        className={cn(
                          "rounded-lg border p-4",
                          indeterminate ? "border-alert/40 bg-alert-soft/50" : "border-border",
                        )}
                      >
                        <p className="flex items-center gap-2 label-xs">
                          {LIBELLE_PATHOLOGIE[r.pathologie] ?? r.pathologie}
                          <Tag tone={source} className="py-px text-[9px]">
                            <StatusDot tone={source} pulse={false} /> {source}
                          </Tag>
                          {r.escalade && (
                            <span className="flex items-center gap-0.5 text-[9px] font-bold text-primary uppercase">
                              <ArrowUpRight className="size-2.5" /> contrôle qualité
                            </span>
                          )}
                        </p>
                        {indeterminate ? (
                          <p className="mt-1 flex items-center gap-2 text-base font-semibold text-alert">
                            <ShieldAlert className="size-4" />
                            Résultat indéterminé — relecture requise
                          </p>
                        ) : (
                          <p className="mt-1 flex items-center gap-2 text-base font-semibold">
                            <ScanLine className="size-4 text-primary" />
                            {r.prediction === "positif" ? "Pathologie suspectée" : "Examen normal"}
                          </p>
                        )}
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">Confiance</span>
                            <span
                              className={cn(
                                "font-mono font-semibold tabular-nums",
                                indeterminate && "text-alert",
                              )}
                            >
                              {Math.round(r.confiance * 100)}%
                            </span>
                          </div>
                          <Meter
                            value={Math.round(r.confiance * 100)}
                            tone={
                              r.confiance >= 0.75 ? "ok" : r.confiance >= 0.6 ? "warn" : "alert"
                            }
                            className="mt-1.5"
                          />
                        </div>
                        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                          {r.prediction} · {Math.round(r.temps_inference_ms)} ms
                        </p>
                      </div>

                      {/* Carte complémentaire — contexte de la décision */}
                      <div className="rounded-lg border border-border bg-muted/20 p-4">
                        <p className="flex items-center gap-2 text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                          <Info className="size-3" /> Contexte de la décision
                        </p>
                        <dl className="mt-2 grid grid-cols-2 gap-1.5">
                          {(() => {
                            const lignes: [string, string][] = [
                              ["exécution", sourceDestination],
                              ["inférence", `${Math.round(r.temps_inference_ms)} ms`],
                            ];
                            if (partTemps != null) {
                              lignes.push(["part du total", `${partTemps}%`]);
                            }
                            lignes.push([
                              "réseau",
                              resultat.metriques.latence_reseau_ms >= 9000
                                ? "n/a"
                                : `${Math.round(resultat.metriques.latence_reseau_ms)} ms`,
                            ]);
                            return lignes.map(([k, v]) => (
                              <div
                                key={k}
                                className="rounded border border-border/70 bg-background/60 px-2 py-1.5"
                              >
                                <dt className="text-[8px] tracking-[0.14em] text-muted-foreground uppercase">
                                  {k}
                                </dt>
                                <dd className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums">
                                  {v}
                                </dd>
                              </div>
                            ));
                          })()}
                        </dl>
                        <ul className="mt-2 space-y-1.5 text-[11px]">
                          {escalation && (
                            <li className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-1.5">
                              <span className="flex items-center gap-1 font-semibold">
                                <ArrowUpRight className="size-3 text-primary" /> Contrôle qualité
                              </span>
                              <span className="font-mono text-muted-foreground">
                                {escalation.source_initiale}{" "}
                                {Math.round(escalation.confiance_initiale * 100)}%{" → "}
                                {escalation.source_controle}{" "}
                                {Math.round(escalation.confiance_controle * 100)}%
                              </span>
                            </li>
                          )}
                          {profilage && (
                            <li className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-1.5">
                              <span className="font-semibold">Routage sélectif</span>
                              <span className="font-mono text-muted-foreground">
                                {profilBadge?.label ?? "profil"}
                                {profilage.specialiste_ecarte
                                  ? ` — ${
                                      LIBELLE_PATHOLOGIE[profilage.specialiste_ecarte] ??
                                      profilage.specialiste_ecarte
                                    } écarté`
                                  : ""}
                              </span>
                            </li>
                          )}
                          {r.indetermine && (
                            <li className="flex items-center gap-2 rounded-md bg-background/70 px-2.5 py-1.5 font-semibold text-alert">
                              <ShieldAlert className="size-3" /> Relecture médicale requise
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]">
                {[
                  ["exec", resultat.destination],
                  ["total", `${Math.round(resultat.temps_total_ms)}ms`],
                  ["net", `${Math.round(resultat.metriques.latence_reseau_ms)}ms`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded border border-border/70 bg-muted/40 p-1.5">
                    <dt className="text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                      {k}
                    </dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">
                      {k === "net" && resultat.metriques.latence_reseau_ms >= 9000 ? "n/a" : v}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Panneau trace d'escalade (filet de securite) */}
              {resultat.escalades.length > 0 && (
                <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                  <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-primary uppercase">
                    <ArrowUpRight className="size-3.5" />
                    Contrôle qualité — {resultat.escalades.length} pathologie
                    {resultat.escalades.length > 1 ? "s" : ""}
                    {resultat.temps_escalade_ms != null && (
                      <span className="font-normal normal-case tracking-normal text-muted-foreground">
                        (+{Math.round(resultat.temps_escalade_ms)}ms)
                      </span>
                    )}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {resultat.escalades.map((e) => (
                      <li
                        key={e.pathologie}
                        className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-3 py-1.5 text-[11px]"
                      >
                        <span className="font-semibold">
                          {LIBELLE_PATHOLOGIE[e.pathologie] ?? e.pathologie}
                        </span>
                        <span className="text-muted-foreground">
                          {e.source_initiale}{" "}
                          <span className="font-mono">
                            {Math.round(e.confiance_initiale * 100)}%
                          </span>
                          {" → "}
                          {e.source_controle}{" "}
                          <span className="font-mono">
                            {Math.round(e.confiance_controle * 100)}%
                          </span>
                        </span>
                        <span
                          className={cn(
                            "font-bold",
                            e.decision === "arbitrage_a_prevalu"
                              ? "text-ok"
                              : e.decision === "escalade_impossible"
                                ? "text-alert"
                                : "text-muted-foreground",
                          )}
                        >
                          {e.decision === "arbitrage_a_prevalu"
                            ? "✓ Préservé"
                            : e.decision === "escalade_impossible"
                              ? "✗ Impossible"
                              : "→ Conservation"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] text-muted-foreground italic">
                    {resultat.resultats.some((r) => r.indetermine) &&
                      "⚠ Certains résultats restent indéterminés après contrôle — relecture médicale requise."}
                  </p>
                </div>
              )}
            </Panel>

            {resultat.filtrage &&
              (() => {
                const f = resultat.filtrage;
                const p = f.profil;
                const profilBadge = LIBELLES_PROFIL[f.cle_regle ?? ""] ?? {
                  label: "Profil",
                  tone: "warn" as const,
                };
                const totalDim =
                  p.largeur_px != null && p.hauteur_px != null
                    ? `${p.largeur_px} × ${p.hauteur_px} px`
                    : p.indecodable
                      ? "non lisible"
                      : "—";
                const ratio =
                  p.ratio_largeur_hauteur != null ? p.ratio_largeur_hauteur.toFixed(2) : "—";
                return (
                  <Panel
                    title="Profilage d'image"
                    subtitle="Triage des spécialistes selon les caractéristiques de la radiographie"
                    actions={<Tag tone={profilBadge.tone}>{profilBadge.label}</Tag>}
                  >
                    <div className="grid gap-2 sm:grid-cols-3">
                      {[
                        ["format", p.format ?? "—"],
                        ["dimensions", totalDim],
                        ["ratio L/H", ratio],
                        ["canaux", p.mode_canaux ?? "—"],
                        ["taille", formaterTaille(p.taille_octets ?? 0)],
                        [
                          "spécialiste écarté",
                          f.specialiste_ecarte
                            ? (LIBELLE_PATHOLOGIE[f.specialiste_ecarte] ?? f.specialiste_ecarte)
                            : "aucun",
                        ],
                      ].map(([k, v]) => (
                        <div
                          key={k}
                          className="rounded border border-border/70 bg-muted/30 px-3 py-2"
                        >
                          <dt className="text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                            {k}
                          </dt>
                          <dd className="mt-0.5 font-mono text-xs font-semibold tabular-nums">
                            {v}
                          </dd>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs font-semibold">{f.regle_appliquee}</p>
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Info className="mt-0.5 size-3 shrink-0" />
                      {f.raison}
                    </p>
                  </Panel>
                );
              })()}

            {(() => {
              const tb = resultat.resultats.find((r) => r.pathologie === "tuberculose");
              const pn = resultat.resultats.find((r) => r.pathologie === "pneumonie");
              const unique = resultat.resultats[0];
              return tb && pn ? (
                <SyntheseClinique
                  tb={tb}
                  pn={pn}
                  destination={resultat.destination}
                  escalades={resultat.escalades}
                />
              ) : unique ? (
                <VerdictUnique resultat={resultat} resultatUnique={unique} />
              ) : null;
            })()}

            <Panel
              title="Routing rationale"
              subtitle={libelleRaisonDestination(resultat.destination)}
            >
              <p className="text-[11px] text-muted-foreground">{resultat.raison}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div
                  className={cn(
                    "rounded-lg border p-3",
                    resultat.destination === "edge"
                      ? "border-edge/40 bg-edge-soft"
                      : "border-border",
                  )}
                >
                  <p className="flex items-center justify-between font-mono text-[11px] font-bold tracking-[0.14em]">
                    <span className="flex items-center gap-1.5">
                      <Cpu className="size-3.5 text-edge" /> EDGE
                    </span>
                    {resultat.destination === "edge" && (
                      <Tag tone="ok" className="py-px text-[9px]">
                        <StatusDot tone="ok" pulse={false} /> retenu
                      </Tag>
                    )}
                  </p>
                  <p
                    className={cn(
                      "mt-1 font-mono text-xl font-semibold tabular-nums",
                      resultat.destination !== "edge" && "opacity-40",
                    )}
                  >
                    {Math.round(resultat.metriques.cpu_pourcentage)}% CPU
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
                    <div className="rounded border border-border/70 bg-muted/30 p-1.5">
                      <dt className="text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                        RAM
                      </dt>
                      <dd className="mt-0.5 font-semibold tabular-nums">
                        {Math.round(resultat.metriques.ram_pourcentage)}%
                      </dd>
                    </div>
                    <div className="rounded border border-border/70 bg-muted/30 p-1.5">
                      <dt className="text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                        Latence locale
                      </dt>
                      <dd className="mt-0.5 font-semibold tabular-nums">0 ms</dd>
                    </div>
                  </dl>
                </div>
                <div
                  className={cn(
                    "rounded-lg border p-3",
                    resultat.destination === "cloud"
                      ? "border-cloud/40 bg-cloud-soft"
                      : "border-border",
                  )}
                >
                  <p className="flex items-center justify-between font-mono text-[11px] font-bold tracking-[0.14em]">
                    <span className="flex items-center gap-1.5">
                      <Cloud className="size-3.5 text-cloud" /> CLOUD
                    </span>
                    {resultat.destination === "cloud" && (
                      <Tag tone="ok" className="py-px text-[9px]">
                        <StatusDot tone="ok" pulse={false} /> retenu
                      </Tag>
                    )}
                  </p>
                  <p
                    className={cn(
                      "mt-1 font-mono text-xl font-semibold tabular-nums",
                      resultat.destination !== "cloud" && "opacity-40",
                    )}
                  >
                    {resultat.metriques.latence_reseau_ms >= 9000
                      ? "offline"
                      : `${Math.round(resultat.metriques.latence_reseau_ms)} ms`}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
                    <div className="rounded border border-border/70 bg-muted/30 p-1.5">
                      <dt className="text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                        Réseau
                      </dt>
                      <dd className="mt-0.5 font-semibold tabular-nums">
                        {resultat.metriques.reseau_disponible ? "disponible" : "interrompu"}
                      </dd>
                    </div>
                    <div className="rounded border border-border/70 bg-muted/30 p-1.5">
                      <dt className="text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                        Inférence
                      </dt>
                      <dd className="mt-0.5 font-semibold tabular-nums">
                        {(() => {
                          const ms = Math.round(
                            resultat.resultats.reduce(
                              (acc, r) => acc + (r.temps_inference_ms ?? 0),
                              0,
                            ),
                          );
                          return `${ms} ms`;
                        })()}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                {raisonsDepuis(resultat).map((r) => (
                  <li
                    key={r.label}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
                  >
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <StatusDot tone={r.state} pulse={false} />
                      {r.label}
                    </span>
                    <span className="font-mono font-semibold tabular-nums">{r.value}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        ) : (
          <Panel title="Clinical results" subtitle="En attente d'exécution">
            <div className="grid place-items-center py-10 text-center">
              <ScanLine className="size-8 text-muted-foreground" />
              <p className="mt-2 max-w-sm text-xs text-muted-foreground">
                Importez une radiographie puis lancez l'inférence pour obtenir les résultats
                tuberculose et pneumonie.
              </p>
            </div>
          </Panel>
        )}
      </main>
    </>
  );
}
