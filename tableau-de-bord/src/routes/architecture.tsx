import { createFileRoute } from "@tanstack/react-router";
import { exigerRole } from "@/lib/authentification";
import {
  ArrowDown,
  Boxes,
  Cloud,
  Cpu,
  Database,
  GitBranch,
  Layers,
  MonitorSmartphone,
  Network,
  ShieldCheck,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import { Panel, StatusDot, Tag } from "@/components/aeris/primitives";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/architecture")({
  beforeLoad: () => exigerRole("admin"),
  component: ArchitecturePage,
  head: () => ({
    meta: [
      { title: "Architecture distribuée · AERIS" },
      {
        name: "description",
        content:
          "Architecture d'AERIS : couche de présentation, orchestrateur de décision Edge-Cloud, nœud d'inférence local et région Cloud managée.",
      },
      { property: "og:title", content: "Architecture distribuée · AERIS" },
      {
        property: "og:description",
        content: "Vue en couches du système d'orchestration adaptative Edge-Cloud AERIS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const LAYERS = [
  {
    icon: MonitorSmartphone,
    name: "Presentation layer",
    tech: "React 19 · TanStack Start · SSR",
    desc: "Console de supervision temps réel, journal d'inférences et injection de scénarios.",
    tone: "neutral" as const,
    items: ["Mission Control", "Diagnostic", "Monitoring", "Historique"],
  },
  {
    icon: GitBranch,
    name: "Orchestration layer",
    tech: "Adaptive decision engine",
    desc: "Score Edge et Cloud à chaque requête à partir de la télémétrie, avec bascule automatique.",
    tone: "ok" as const,
    items: ["Scoring policy", "Health probes", "Failover", "Explainability"],
  },
  {
    icon: Cpu,
    name: "Edge execution layer",
    tech: "edge-node-01 · runtime local",
    desc: "Inférence locale à faible latence, fonctionne même sans lien Cloud.",
    tone: "edge" as const,
    items: ["ONNX runtime", "Local cache", "Offline mode", "183 ms avg"],
  },
  {
    icon: Cloud,
    name: "Cloud execution layer",
    tech: "cloud-eu-w1 · GPU managé",
    desc: "Délestage des charges lourdes et modèles volumineux vers la région managée.",
    tone: "cloud" as const,
    items: ["GPU pool", "Autoscaling", "Batch queue", "241 ms avg"],
  },
];

function ArchitecturePage() {
  return (
    <AppShell>
      <PageHeader
        title="Architecture"
        description="Vue en couches du système distribué AERIS"
        right={
          <Tag tone="neutral">
            <StatusDot tone="ok" /> 4 layers
          </Tag>
        }
      />

      <main className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Nœuds", "2", Network],
            ["Modèles IA", "2", Boxes],
            ["Couches", "4", Layers],
            ["Stores", "3", Database],
          ].map(([label, value, Icon]) => {
            const I = Icon as typeof Cpu;
            return (
              <div key={label as string} className="panel flex items-center gap-3 px-4 py-3">
                <span className="grid size-9 place-items-center rounded-md border border-border bg-muted">
                  <I className="size-4 text-primary" />
                </span>
                <div>
                  <p className="label-xs">{label as string}</p>
                  <p className="font-mono text-lg leading-none font-semibold tabular-nums">
                    {value as string}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <section className="panel grid-surface overflow-hidden">
          <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
            <h2 className="font-mono text-xs font-bold tracking-[0.18em] uppercase">
              System topology
            </h2>
            <Tag tone="neutral">request flow</Tag>
          </header>
          <div className="space-y-2 p-4">
            {LAYERS.map((l, i) => (
              <div key={l.name}>
                <div
                  className={cn(
                    "rounded-lg border p-4 transition-colors",
                    l.tone === "edge"
                      ? "border-edge/40 bg-edge-soft"
                      : l.tone === "cloud"
                        ? "border-cloud/40 bg-cloud-soft"
                        : l.tone === "ok"
                          ? "border-ok/40 bg-ok-soft"
                          : "border-border bg-card",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background/70">
                        <l.icon
                          className={cn(
                            "size-4",
                            l.tone === "edge"
                              ? "text-edge"
                              : l.tone === "cloud"
                                ? "text-cloud"
                                : l.tone === "ok"
                                  ? "text-ok"
                                  : "text-primary",
                          )}
                        />
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{l.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{l.tech}</p>
                        <p className="mt-1 max-w-xl text-xs text-muted-foreground">{l.desc}</p>
                      </div>
                    </div>
                    <Tag tone={l.tone}>layer {i + 1}</Tag>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {l.items.map((it) => (
                      <span
                        key={it}
                        className="rounded border border-border/70 bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {it}
                      </span>
                    ))}
                  </div>
                </div>
                {i < LAYERS.length - 1 && (
                  <div className="flex justify-center py-1">
                    <ArrowDown className="size-3.5 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Modèles déployés" subtitle="CNN pré-entraînés, répliqués Edge + Cloud">
            <ul className="space-y-2">
              {[
                {
                  name: "TB Classifier",
                  detail: "Détection de la tuberculose",
                  tags: ["Edge", "Cloud", "Keras CNN"],
                },
                {
                  name: "Pneumonia Classifier",
                  detail: "Détection de la pneumonie",
                  tags: ["Edge", "Cloud", "Keras CNN"],
                },
              ].map((m) => (
                <li key={m.name} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold">{m.name}</p>
                    <Tag tone="ok">déployé</Tag>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{m.detail}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {m.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Resilience & data" subtitle="Garanties opérationnelles du système">
            <ul className="space-y-2 text-xs">
              {[
                [
                  ShieldCheck,
                  "Failover automatique",
                  "Bascule Edge en moins d'une seconde si le Cloud devient injoignable.",
                ],
                [
                  Database,
                  "Persistance locale",
                  "File d'attente durable sur le nœud Edge, resynchronisée à la reprise.",
                ],
                [
                  Network,
                  "Sondes de santé",
                  "Latence, perte de paquets et bande passante échantillonnées en continu.",
                ],
                [
                  Layers,
                  "Traçabilité",
                  "Chaque décision de routage est journalisée avec ses critères.",
                ],
              ].map(([Icon, title, desc]) => {
                const I = Icon as typeof Cpu;
                return (
                  <li
                    key={title as string}
                    className="flex gap-3 rounded-lg border border-border p-3"
                  >
                    <I className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="font-semibold">{title as string}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{desc as string}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </main>
    </AppShell>
  );
}
