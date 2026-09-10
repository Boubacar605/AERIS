import { CloudOff, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function StatusDot({
  tone = "ok",
  pulse = true,
  className,
}: {
  tone?: "ok" | "warn" | "alert" | "edge" | "cloud" | "idle";
  pulse?: boolean;
  className?: string;
}) {
  const color = {
    ok: "bg-ok",
    warn: "bg-warn",
    alert: "bg-alert",
    edge: "bg-edge",
    cloud: "bg-cloud",
    idle: "bg-muted-foreground",
  }[tone];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {pulse && (
        <span className={cn("absolute inset-0 rounded-full animate-breathe opacity-60", color)} />
      )}
      <span className={cn("relative size-2 rounded-full", color)} />
    </span>
  );
}

export function Tag({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "edge" | "cloud" | "ok" | "warn" | "alert" | "neutral";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    edge: "bg-edge-soft text-edge border-edge/30",
    cloud: "bg-cloud-soft text-cloud border-cloud/30",
    ok: "bg-ok-soft text-ok border-ok/30",
    warn: "bg-warn-soft text-warn border-warn/30",
    alert: "bg-alert-soft text-alert border-alert/30",
    neutral: "bg-muted text-muted-foreground border-border",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase",
        tones,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel flex flex-col overflow-hidden", className)}>
      {title && (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
          <div>
            <h2 className="label-xs">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn("flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Sparkline({
  data,
  tone = "cloud",
  height = 34,
  className,
}: {
  data: number[];
  tone?: "edge" | "cloud" | "ok" | "alert";
  height?: number;
  className?: string;
}) {
  const stroke = {
    edge: "var(--edge)",
    cloud: "var(--cloud)",
    ok: "var(--ok)",
    alert: "var(--alert)",
  }[tone];
  const w = 100;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - 3 - ((v - min) / span) * (height - 8);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const id = `spark-${tone}-${height}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts.join(" ")} ${w},${height}`} fill={`url(#${id})`} />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Meter({
  value,
  tone = "cloud",
  className,
}: {
  value: number;
  tone?: "edge" | "cloud" | "ok" | "warn" | "alert";
  className?: string;
}) {
  const bar = {
    edge: "bg-edge",
    cloud: "bg-cloud",
    ok: "bg-ok",
    warn: "bg-warn",
    alert: "bg-alert",
  }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-700 ease-out", bar)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function SectionChargement({ message }: { message: string }) {
  return (
    <div className="panel grid min-h-40 place-items-center gap-2 p-6 text-center">
      <p className="label-xs animate-pulse">Chargement…</p>
      <p className="max-w-sm text-[11px] text-muted-foreground">{message}</p>
    </div>
  );
}

export function EtatIndisponible({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel grid place-items-center gap-3 border-alert/30 bg-alert-soft/40 p-10 text-center">
      <span className="grid size-12 place-items-center rounded-full border border-alert/30 bg-alert-soft">
        <CloudOff className="size-6 text-alert" />
      </span>
      <div>
        <p className="text-sm font-semibold text-alert">Données en pause</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-foreground uppercase transition-colors hover:text-primary"
        >
          <RotateCcw className="size-3.5" />
          Réessayer
        </button>
      )}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone,
  children,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "edge" | "cloud" | "ok" | "alert";
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="label-xs">{label}</p>
      <p className="mt-1 font-mono text-2xl leading-none font-semibold tabular-nums">
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span>}
      </p>
      {children ?? (tone ? <div className="mt-2" /> : null)}
    </div>
  );
}
