import { Cloud, Cpu, GitBranch, Zap } from "lucide-react";
import type { Telemetry } from "@/lib/aeris";
import type { DecisionTempsReel } from "@/hooks/use-api";
import { StatusDot, Tag } from "./primitives";
import { cn } from "@/lib/utils";

function Node({
  active,
  kind,
  requests,
  latencyLabel,
  inference,
}: {
  active: boolean;
  kind: "edge" | "cloud";
  requests: number;
  latencyLabel: string;
  inference: number;
}) {
  const isEdge = kind === "edge";
  const Icon = isEdge ? Cpu : Cloud;
  return (
    <div
      className={cn(
        "relative rounded-lg border p-3.5 transition-all duration-500",
        active
          ? isEdge
            ? "border-edge/50 bg-edge-soft shadow-raise"
            : "border-cloud/50 bg-cloud-soft shadow-raise"
          : "border-border bg-card opacity-60",
      )}
    >
      {active && (
        <span
          className={cn(
            "absolute -top-px left-4 h-px w-16",
            isEdge ? "bg-edge" : "bg-cloud",
            "animate-pulse",
          )}
        />
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("size-4", isEdge ? "text-edge" : "text-cloud")} />
          <p className="font-mono text-xs font-bold tracking-[0.16em]">
            {isEdge ? "EDGE" : "CLOUD"}
          </p>
        </div>
        {active ? (
          <Tag tone={isEdge ? "edge" : "cloud"}>
            <StatusDot tone={isEdge ? "edge" : "cloud"} /> selected
          </Tag>
        ) : (
          <Tag tone="neutral">standby</Tag>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {isEdge ? "Local inference · on-premise node" : "Remote inference · managed region"}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]">
        {[
          ["req", String(requests)],
          ["lat", latencyLabel],
          ["inf", inference ? `${inference}ms` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded border border-border/70 bg-background/60 p-1.5">
            <dt className="text-[9px] tracking-[0.14em] text-muted-foreground uppercase">{k}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function DecisionEngine({
  telemetry,
  decision,
  requestId,
}: {
  telemetry: Telemetry;
  decision: DecisionTempsReel;
  requestId: number;
}) {
  const edge = decision.destination === "edge";
  const latence = decision.metriques.latence_reseau_ms;
  const horsLigne = !decision.metriques.reseau_disponible || latence >= 9000;

  const raisons = [
    {
      label: "Latence reseau",
      value: horsLigne ? "injoignable" : `${Math.round(latence)} ms`,
      tone: horsLigne ? "alert" : latence < 160 ? "ok" : "warn",
    },
    {
      label: "CPU Edge",
      value: `${Math.round(decision.metriques.cpu_pourcentage)}%`,
      tone:
        decision.metriques.cpu_pourcentage < 75
          ? "ok"
          : decision.metriques.cpu_pourcentage < 90
            ? "warn"
            : "alert",
    },
    {
      label: "RAM Edge",
      value: `${Math.round(decision.metriques.ram_pourcentage)}%`,
      tone:
        decision.metriques.ram_pourcentage < 75
          ? "ok"
          : decision.metriques.ram_pourcentage < 90
            ? "warn"
            : "alert",
    },
    {
      label: "Reseau",
      value: decision.metriques.reseau_disponible ? "disponible" : "interrompu",
      tone: decision.metriques.reseau_disponible ? "ok" : "alert",
    },
  ] as const;

  return (
    <section className="panel grid-surface overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 text-primary" />
          <h2 className="font-mono text-xs font-bold tracking-[0.18em] uppercase">
            Edge-Cloud Decision Engine
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Tag tone="neutral">
            <StatusDot tone={edge ? "edge" : "cloud"} /> temps reel
          </Tag>
          <Tag tone={edge ? "edge" : "cloud"}>{edge ? "edge selected" : "cloud selected"}</Tag>
        </div>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* pipeline */}
        <div>
          <div className="rounded-lg border border-border bg-card/85 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Zap className="size-3.5 text-primary" />
                <p className="font-mono text-xs font-semibold">
                  REQUEST #{requestId}
                  <span className="ml-2 font-sans font-normal text-muted-foreground">
                    Radiographie thoracique · TB + PN
                  </span>
                </p>
              </div>
              <Tag tone="ok">ping → routage</Tag>
            </div>
          </div>

          <div className="relative mt-3">
            <svg viewBox="0 0 400 78" className="h-[78px] w-full" aria-hidden>
              <line
                x1="200"
                y1="0"
                x2="200"
                y2="26"
                stroke="var(--color-grid)"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="animate-flow"
              />
              <path
                d="M200 26 V44 H96 V78"
                fill="none"
                stroke={edge ? "var(--edge)" : "var(--color-grid)"}
                strokeWidth={edge ? 2.2 : 1.4}
                strokeDasharray="6 6"
                className={edge ? "animate-flow" : ""}
                opacity={edge ? 1 : 0.5}
              />
              <path
                d="M200 26 V44 H304 V78"
                fill="none"
                stroke={!edge ? "var(--cloud)" : "var(--color-grid)"}
                strokeWidth={!edge ? 2.2 : 1.4}
                strokeDasharray="6 6"
                className={!edge ? "animate-flow" : ""}
                opacity={!edge ? 1 : 0.5}
              />
              <circle cx="200" cy="26" r="4" fill="var(--primary)" />
            </svg>
            <div className="pointer-events-none absolute inset-x-0 top-[14px] flex justify-center">
              <span className="rounded border border-border bg-card px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase shadow-panel">
                decision engine
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Node
              active={edge}
              kind="edge"
              requests={decision.requetes.edge}
              latencyLabel="local"
              inference={telemetry.edgeInference}
            />
            <Node
              active={!edge}
              kind="cloud"
              requests={decision.requetes.cloud}
              latencyLabel={horsLigne ? "injoignable" : `${Math.round(latence)} ms`}
              inference={telemetry.cloudInference}
            />
          </div>
        </div>

        {/* explainability */}
        <aside className="rounded-lg border border-border bg-card p-3.5">
          <p className="label-xs">{edge ? "Why edge?" : "Why cloud?"}</p>
          <ul className="mt-2.5 space-y-2">
            {raisons.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <StatusDot tone={r.tone} pulse={false} />
                  {r.label}
                </span>
                <span className="font-mono font-semibold tabular-nums">{r.value}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 rounded border border-border bg-muted/60 p-2.5 text-[11px] leading-relaxed">
            <span className="label-xs block">Decision</span>
            <span className="mt-1 block">{decision.raison}</span>
          </p>
        </aside>
      </div>
    </section>
  );
}
