import { createFileRoute } from "@tanstack/react-router";
import { exigerRole } from "@/lib/authentification";
import { Activity, CheckCircle2, Cloud, Cpu, Gauge, Wifi, XCircle } from "lucide-react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import { DecisionEngine } from "@/components/aeris/DecisionEngine";
import {
  EtatIndisponible,
  Meter,
  Panel,
  SectionChargement,
  Sparkline,
  StatusDot,
  Tag,
} from "@/components/aeris/primitives";
import { useEtatSysteme, useHistoriqueLive } from "@/hooks/use-api";
import { useSeries } from "@/lib/aeris";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => exigerRole("admin"),
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "AERIS · Edge-Cloud AI Control Center" },
      {
        name: "description",
        content:
          "Centre de contrôle AERIS : moteur de décision Edge-Cloud, métriques temps réel et activité d'inférence IA pour le triage radiologique assisté.",
      },
      { property: "og:title", content: "AERIS · Edge-Cloud AI Control Center" },
      {
        property: "og:description",
        content:
          "Supervision temps réel de l'orchestration Edge-Cloud des services d'inférence IA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function OverviewBar({
  items,
}: {
  items: { label: string; value: string; tone?: "ok" | "warn" | "alert" | "edge" | "cloud" }[];
}) {
  return (
    <div className="panel grid grid-cols-2 divide-border sm:grid-cols-3 sm:divide-x xl:grid-cols-6">
      {items.map((i) => (
        <div key={i.label} className="px-4 py-2.5">
          <p className="label-xs">{i.label}</p>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-sm font-semibold">
            {i.tone && <StatusDot tone={i.tone} />}
            {i.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  unit,
  series,
  tone,
  pct,
}: {
  icon: typeof Cpu;
  label: string;
  value: number;
  unit: string;
  series: number[];
  tone: "edge" | "cloud" | "ok" | "alert";
  pct?: number;
}) {
  return (
    <div className="panel p-3.5">
      <div className="flex items-center justify-between">
        <p className="label-xs flex items-center gap-1.5">
          <Icon className="size-3.5" />
          {label}
        </p>
        <span className="font-mono text-lg leading-none font-semibold tabular-nums">
          {value}
          <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">{unit}</span>
        </span>
      </div>
      <Sparkline data={series} tone={tone} className="mt-2" />
      {pct !== undefined && <Meter value={pct} tone={tone} className="mt-1" />}
    </div>
  );
}

function Dashboard() {
  const { telemetry, decision, nbRequetesTotal, etat, refresh } = useEtatSysteme();
  const { records: activity, statistiques, etat: etatHistorique, charger } = useHistoriqueLive();

  const cpu = useSeries(telemetry?.edgeCpu ?? 0);
  const ram = useSeries(telemetry?.edgeRam ?? 0);
  const lat = useSeries(telemetry?.latence_reseau_ms ?? 0);
  const thr = useSeries(telemetry?.throughput ?? 0);

  if (etat === "indisponible") {
    return (
      <AppShell>
        <PageHeader
          title="Mission Control"
          description="Orchestration adaptative Edge-Cloud des services d'inférence IA"
        />
        <main className="p-5">
          <EtatIndisponible
            message="Le moteur de décision est injoignable. Aucune métrique n'est affichée tant qu'il ne répond plus."
            onRetry={refresh}
          />
        </main>
      </AppShell>
    );
  }

  if (etat === "chargement" || !telemetry || !decision) {
    return (
      <AppShell>
        <PageHeader
          title="Mission Control"
          description="Orchestration adaptative Edge-Cloud des services d'inférence IA"
        />
        <main className="space-y-4 p-5">
          <SectionChargement message="Interrogation de l'état du système auprès du moteur…" />
        </main>
      </AppShell>
    );
  }

  const horsLigne = !telemetry.reseau_disponible || telemetry.latence_reseau_ms >= 9000;
  const requetes = decision.requetes;
  const totalRequetes = requetes.edge + requetes.cloud;
  const edgePct = totalRequetes ? Math.round((requetes.edge / totalRequetes) * 100) : 0;
  const cloudPct = totalRequetes ? 100 - edgePct : 0;

  return (
    <AppShell>
      <PageHeader
        title="Mission Control"
        description="Orchestration adaptative Edge-Cloud des services d'inférence IA"
      />

      <main className="space-y-4 p-5">
        <OverviewBar
          items={[
            { label: "Routage actif", value: decision.destination, tone: decision.destination },
            {
              label: "Nœud Edge",
              value: `${telemetry.edgeCpu}% CPU · ${telemetry.edgeRam}% RAM`,
              tone: "edge",
            },
            {
              label: "Région Cloud",
              value: horsLigne ? "hors ligne" : "joignable",
              tone: horsLigne ? "alert" : "cloud",
            },
            {
              label: "Réseau",
              value: horsLigne ? "coupé" : `${Math.round(telemetry.latence_reseau_ms)} ms`,
              tone: horsLigne ? "alert" : "ok",
            },
            { label: "Modèles actifs", value: "TB + PN" },
            { label: "Requêtes", value: String(nbRequetesTotal) },
          ]}
        />

        <DecisionEngine telemetry={telemetry} decision={decision} requestId={nbRequetesTotal} />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            icon={Cpu}
            label="Edge CPU"
            value={telemetry.edgeCpu}
            unit="%"
            series={cpu}
            tone="edge"
            pct={telemetry.edgeCpu}
          />
          <MetricTile
            icon={Gauge}
            label="Edge RAM"
            value={telemetry.edgeRam}
            unit="%"
            series={ram}
            tone="edge"
            pct={telemetry.edgeRam}
          />
          <MetricTile
            icon={Wifi}
            label="Latence réseau"
            value={horsLigne ? 0 : Math.round(telemetry.latence_reseau_ms)}
            unit="ms"
            series={lat}
            tone={horsLigne ? "alert" : "cloud"}
          />
          <MetricTile
            icon={Activity}
            label="Débit"
            value={telemetry.throughput}
            unit="req/min"
            series={thr}
            tone="ok"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Panel
            title="Activité d'inférence"
            subtitle="Dernières requêtes routées par le moteur"
            actions={
              <Tag tone="ok">
                <StatusDot tone="ok" /> streaming
              </Tag>
            }
            bodyClassName="p-0"
          >
            {etatHistorique === "indisponible" ? (
              <div className="p-4">
                <EtatIndisponible
                  message="L'historique est indisponible tant que le moteur ne répond pas."
                  onRetry={() => void charger()}
                />
              </div>
            ) : etatHistorique === "chargement" ? (
              <div className="grid place-items-center p-8">
                <p className="label-xs animate-pulse">Chargement…</p>
              </div>
            ) : activity.length === 0 ? (
              <div className="grid place-items-center p-8 text-center">
                <p className="text-xs text-muted-foreground">
                  Aucune inférence réalisée — lancez un diagnostic.
                </p>
              </div>
            ) : (
              <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto">
                {activity.slice(0, 9).map((r, i) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 px-4 py-2.5 animate-rise hover:bg-muted/50"
                    style={{ animationDelay: `${i * 35}ms` }}
                  >
                    <span className="w-[4.5rem] shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {r.time}
                    </span>
                    <span className="w-14 shrink-0 font-mono text-xs font-semibold">#{r.id}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{r.service}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{r.finding}</p>
                    </div>
                    <span className="hidden w-16 shrink-0 text-right font-mono text-[11px] tabular-nums sm:block">
                      {r.confidence}%
                    </span>
                    <Tag tone={r.target}>{r.target}</Tag>
                    <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums">
                      {r.latencyMs}ms
                    </span>
                    {r.status === "completed" ? (
                      <CheckCircle2 className="size-4 shrink-0 text-ok" />
                    ) : (
                      <XCircle className="size-4 shrink-0 text-alert" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel title="Répartition d'exécution" subtitle="Requêtes réelles routées Edge / Cloud">
              <div className="flex h-3 overflow-hidden rounded-full">
                <div
                  className="bg-edge transition-all duration-700"
                  style={{ width: `${edgePct}%` }}
                />
                <div className="flex-1 bg-cloud/70" />
              </div>
              {totalRequetes === 0 ? (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Aucune requête routée — la répartition s'affichera après les premières inférences.
                </p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["EDGE", edgePct, requetes.edge, statistiques.avgLatencyEdge, "edge", Cpu],
                      [
                        "CLOUD",
                        cloudPct,
                        requetes.cloud,
                        statistiques.avgLatencyCloud,
                        "cloud",
                        Cloud,
                      ],
                    ] as const
                  ).map(([label, pct, count, latency, tone, Icon]) => (
                    <div
                      key={label}
                      className={cn(
                        "rounded-lg border p-3",
                        tone === "edge"
                          ? "border-edge/30 bg-edge-soft"
                          : "border-cloud/30 bg-cloud-soft",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-[0.14em]">
                          <Icon
                            className={cn("size-3.5", tone === "edge" ? "text-edge" : "text-cloud")}
                          />
                          {label}
                        </span>
                        <span className="font-mono text-lg leading-none font-semibold">{pct}%</span>
                      </div>
                      <dl className="mt-2.5 space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Requêtes</dt>
                          <dd className="font-mono font-semibold">{count}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Latence moyenne</dt>
                          <dd className="font-mono font-semibold">
                            {latency ? `${latency} ms` : "—"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Règles de décision" subtitle="Seuils appliqués par le moteur">
              <ul className="space-y-1.5">
                {[
                  ["Réseau indisponible", "→ Edge · mode dégradé"],
                  ["Latence > seuil", "→ Edge · réseau trop lent"],
                  ["CPU ou RAM Edge saturé", "→ Cloud · délestage"],
                  ["Sinon", "→ Edge · proximité des données"],
                ].map(([regle, action]) => (
                  <li
                    key={regle}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[11px]"
                  >
                    <span className="text-muted-foreground">{regle}</span>
                    <span className="font-mono font-semibold">{action}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
