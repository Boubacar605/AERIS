import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Cloud, Cpu, Play, RotateCcw, ScanLine, Upload } from "lucide-react";
import { AppShell, PageHeader, useConnexion } from "@/components/aeris/AppShell";
import { Meter, Panel, StatusDot, Tag } from "@/components/aeris/primitives";
import { uploadImage, type ReponseRoutage, type ResultatDiagnostic } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  { key: "probe", label: "Télémétrie", detail: "Sondage des nœuds disponibles" },
  { key: "route", label: "Routage", detail: "Sélection de l'environnement d'exécution" },
  { key: "infer", label: "Inférence", detail: "Passage des modèles TB + PN sur l'image" },
  { key: "report", label: "Rapport", detail: "Restitution des résultats cliniques" },
] as const;

const MODES_ROUTAGE = [
  { key: "auto", label: "Auto", hint: "Décision du moteur" },
  { key: "edge", label: "Forcer Edge", hint: "Traitement local" },
  { key: "cloud", label: "Forcer Cloud", hint: "Traitement distant" },
] as const;

type ModeRoutage = (typeof MODES_ROUTAGE)[number]["key"];
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
  temps_total_ms: number;
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

function DiagnosticPage() {
  return (
    <AppShell>
      <DiagnosticContent />
    </AppShell>
  );
}

function DiagnosticContent() {
  const { connecte } = useConnexion();
  const [mode, setMode] = useState<ModeRoutage>("auto");
  const [fichier, setFichier] = useState<File | null>(null);
  const [resultat, setResultat] = useState<ResultatAnalyse | null>(null);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);
  const [erreurLive, setErreurLive] = useState(false);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

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
      );
      setResultat({
        destination: reponse.decision.destination,
        raison: reponse.decision.raison,
        metriques: reponse.decision.metriques,
        resultats: reponse.resultats,
        temps_total_ms: reponse.temps_total_ms,
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

      <main className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {/* ------------------- Colonne gauche : entrée ------------------- */}
        <div className="space-y-4">
          <Panel title="Study input" subtitle="Radiographie thoracique à analyser">
            <div className="grid-surface flex aspect-4/3 items-center justify-center rounded-lg border border-border bg-muted/40">
              <label
                htmlFor="radiographie"
                className="flex h-full w-full cursor-pointer flex-col items-center justify-center p-6 text-center"
              >
                <Upload className="size-7 text-muted-foreground" />
                <p className="mt-2 font-mono text-xs font-semibold">
                  {fichier ? fichier.name : "Importer une radiographie"}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {fichier
                    ? `${(fichier.size / 1024).toFixed(0)} Ko`
                    : "PNG, JPEG — cliquer pour choisir"}
                </p>
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

        {/* ------------------- Colonne droite : exécution ------------------- */}
        <div className="space-y-4">
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

          {resultat ? (
            <>
              <Panel
                title="Clinical results"
                subtitle={`Analyse réelle — ${resultat.resultats.length} pathologies`}
                actions={
                  <Tag tone="ok">
                    <StatusDot tone="ok" /> completed
                  </Tag>
                }
              >
                <div className="grid gap-3 md:grid-cols-2">
                  {resultat.resultats.map((r) => (
                    <div key={r.pathologie} className="rounded-lg border border-border p-4">
                      <p className="label-xs">{LIBELLE_PATHOLOGIE[r.pathologie] ?? r.pathologie}</p>
                      <p className="mt-1 flex items-center gap-2 text-base font-semibold">
                        <ScanLine className="size-4 text-primary" />
                        {r.prediction === "positif" ? "Pathologie suspectée" : "Examen normal"}
                      </p>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Confiance</span>
                          <span className="font-mono font-semibold tabular-nums">
                            {Math.round(r.confiance * 100)}%
                          </span>
                        </div>
                        <Meter
                          value={Math.round(r.confiance * 100)}
                          tone={r.confiance > 0.85 ? "ok" : r.confiance > 0.7 ? "warn" : "alert"}
                          className="mt-1.5"
                        />
                      </div>
                      <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                        {r.prediction} · {Math.round(r.temps_inference_ms)} ms
                      </p>
                    </div>
                  ))}
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
              </Panel>

              <Panel title="Routing rationale" subtitle={resultat.raison}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div
                    className={cn(
                      "rounded-lg border p-3",
                      resultat.destination === "edge"
                        ? "border-edge/40 bg-edge-soft"
                        : "border-border",
                    )}
                  >
                    <p className="flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-[0.14em]">
                      <Cpu className="size-3.5 text-edge" /> EDGE
                    </p>
                    <p
                      className={cn(
                        "mt-1 font-mono text-xl font-semibold tabular-nums",
                        resultat.destination !== "edge" && "opacity-40",
                      )}
                    >
                      {Math.round(resultat.metriques.cpu_pourcentage)}% CPU
                    </p>
                  </div>
                  <div
                    className={cn(
                      "rounded-lg border p-3",
                      resultat.destination === "cloud"
                        ? "border-cloud/40 bg-cloud-soft"
                        : "border-border",
                    )}
                  >
                    <p className="flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-[0.14em]">
                      <Cloud className="size-3.5 text-cloud" /> CLOUD
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
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
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
        </div>
      </main>
    </>
  );
}
