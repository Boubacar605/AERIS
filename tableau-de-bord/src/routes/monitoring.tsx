import { createFileRoute } from "@tanstack/react-router";
import { exigerRole } from "@/lib/authentification";
import { Activity, Cloud, Cpu, Gauge, Wifi } from "lucide-react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import {
  EtatIndisponible,
  Meter,
  Panel,
  SectionChargement,
  Sparkline,
  StatusDot,
  Tag,
} from "@/components/aeris/primitives";
import { useEtatSysteme, useServiceHealthLive, type ServiceHealth } from "@/hooks/use-api";
import { useSeries } from "@/lib/aeris";
import { formatUptime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/monitoring")({
  beforeLoad: () => exigerRole("admin"),
  component: MonitoringPage,
  head: () => ({
    meta: [
      { title: "Monitoring temps réel · AERIS" },
      {
        name: "description",
        content:
          "Télémétrie temps réel du cluster AERIS : CPU, mémoire, latence réseau, et débit d'inférence sur les nœuds Edge et Cloud.",
      },
      { property: "og:title", content: "Monitoring temps réel · AERIS" },
      {
        property: "og:description",
        content: "Supervision continue des ressources Edge et Cloud en provenance du moteur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

/** Libellés lisibles pour les 4 services IA interrogés. */
const LIBELLES_SERVICES: Record<string, { label: string; tone: "edge" | "cloud" }> = {
  tb_edge: { label: "Classificateur TB · Edge", tone: "edge" },
  tb_cloud: { label: "Classificateur TB · Cloud", tone: "cloud" },
  pn_edge: { label: "Classificateur PN · Edge", tone: "edge" },
  pn_cloud: { label: "Classificateur PN · Cloud", tone: "cloud" },
};

function GaugeTile({
  icon: Icon,
  label,
  value,
  unit,
  tone,
  meter,
}: {
  icon: typeof Cpu;
  label: string;
  value: number;
  unit: string;
  tone: "edge" | "cloud" | "ok" | "warn" | "alert";
  meter?: number;
}) {
  const series = useSeries(value);
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
      <Sparkline data={series} tone={tone === "warn" ? "alert" : tone} className="mt-2" />
      {meter !== undefined && <Meter value={meter} tone={tone} className="mt-1" />}
    </div>
  );
}

function ServiceCard({ nom, sante }: { nom: string; sante: ServiceHealth | undefined }) {
  const libelle = LIBELLES_SERVICES[nom] ?? {
    label: nom,
    tone: ((sante?.mode ?? "edge") === "cloud" ? "cloud" : "edge") as "cloud" | "edge",
  };
  const enLigne = sante?.statut === "ok";
  const statut = sante?.statut ?? "deconnecte";
  return (
    <Panel
      title={libelle.label}
      subtitle={`nœud ${sante?.mode ?? "inconnu"}`}
      actions={
        enLigne ? (
          <Tag tone={libelle.tone}>
            <StatusDot tone={libelle.tone} /> opérationnel
          </Tag>
        ) : (
          <Tag tone="alert">
            <StatusDot tone="alert" /> injoignable
          </Tag>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        <div>
          <dt className="label-xs">Statut</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 font-mono font-semibold capitalize">
            <StatusDot tone={enLigne ? "ok" : "alert"} pulse={false} />
            {statut}
          </dd>
        </div>
        <div>
          <dt className="label-xs">Environnement</dt>
          <dd className="mt-0.5 font-mono font-semibold">{sante?.mode ?? "inconnu"}</dd>
        </div>
        <div>
          <dt className="label-xs">Uptime</dt>
          <dd className="mt-0.5 font-mono font-semibold tabular-nums">
            {formatUptime(sante?.uptime_secondes ?? 0)}
          </dd>
        </div>
        <div>
          <dt className="label-xs">Latence moteur</dt>
          <dd className="mt-0.5 font-mono font-semibold tabular-nums">
            {sante?.latence_ms ? `${sante.latence_ms} ms` : "—"}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function MonitoringPage() {
  const { telemetry, decision, etat, refresh } = useEtatSysteme(1800);
  const { sante, etat: etatSante, refresh: refreshSante } = useServiceHealthLive();

  if (etat === "indisponible") {
    return (
      <AppShell>
        <PageHeader title="Monitoring" description="Télémétrie continue du cluster Edge-Cloud" />
        <main className="p-5">
          <EtatIndisponible
            message="Le moteur est injoignable : aucune télémétrie n'est disponible tant qu'il ne répond pas."
            onRetry={refresh}
          />
        </main>
      </AppShell>
    );
  }

  if (etat === "chargement" || !telemetry || !decision) {
    return (
      <AppShell>
        <PageHeader title="Monitoring" description="Télémétrie continue du cluster Edge-Cloud" />
        <main className="space-y-4 p-5">
          <SectionChargement message="Collecte de la télémétrie auprès du moteur…" />
        </main>
      </AppShell>
    );
  }

  const horsLigne = !telemetry.reseau_disponible || telemetry.latence_reseau_ms >= 9000;
  const latenceAffichee = horsLigne ? 0 : Math.round(telemetry.latence_reseau_ms);
  const verification = decision.metriques;

  const raisons: { label: string; value: string; tone: "ok" | "warn" | "alert" }[] = [
    {
      label: "Latence réseau",
      value: horsLigne ? "injoignable" : `${Math.round(verification.latence_reseau_ms)} ms`,
      tone: horsLigne ? "alert" : verification.latence_reseau_ms < 160 ? "ok" : "warn",
    },
    {
      label: "CPU Edge",
      value: `${Math.round(verification.cpu_pourcentage)}%`,
      tone:
        verification.cpu_pourcentage < 75
          ? "ok"
          : verification.cpu_pourcentage < 90
            ? "warn"
            : "alert",
    },
    {
      label: "RAM Edge",
      value: `${Math.round(verification.ram_pourcentage)}%`,
      tone:
        verification.ram_pourcentage < 75
          ? "ok"
          : verification.ram_pourcentage < 90
            ? "warn"
            : "alert",
    },
    {
      label: "Réseau",
      value: verification.reseau_disponible ? "disponible" : "interrompu",
      tone: verification.reseau_disponible ? "ok" : "alert",
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Monitoring"
        description="Télémétrie continue du cluster Edge-Cloud"
        right={<Tag tone={decision.destination}>{decision.destination} routing</Tag>}
      />

      <main className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <GaugeTile
            icon={Cpu}
            label="Edge CPU"
            value={Math.round(verification.cpu_pourcentage)}
            unit="%"
            tone="edge"
            meter={Math.round(verification.cpu_pourcentage)}
          />
          <GaugeTile
            icon={Gauge}
            label="Edge RAM"
            value={Math.round(verification.ram_pourcentage)}
            unit="%"
            tone="edge"
            meter={Math.round(verification.ram_pourcentage)}
          />
          <GaugeTile
            icon={Wifi}
            label="Latence réseau"
            value={latenceAffichee}
            unit="ms"
            tone={horsLigne ? "alert" : "cloud"}
          />
          <GaugeTile
            icon={Activity}
            label="Débit"
            value={telemetry.throughput}
            unit="req/min"
            tone="ok"
          />
          <GaugeTile
            icon={Cpu}
            label="Inférence Edge"
            value={Math.round(telemetry.edgeInference)}
            unit="ms"
            tone="edge"
          />
          <GaugeTile
            icon={Cloud}
            label="Inférence Cloud"
            value={Math.round(telemetry.cloudInference)}
            unit="ms"
            tone="cloud"
          />
          <div className="panel p-3.5">
            <p className="label-xs flex items-center gap-1.5">
              <Cloud className="size-3.5" />
              Connectivité Cloud
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-lg leading-none font-semibold tabular-nums",
                horsLigne ? "text-alert" : "text-ok",
              )}
            >
              {horsLigne ? "hors ligne" : "en ligne"}
            </p>
          </div>
          <div className="panel p-3.5">
            <p className="label-xs flex items-center gap-1.5">
              <Activity className="size-3.5" />
              Lien réseau
            </p>
            <p className="mt-1 font-mono text-lg leading-none font-semibold tabular-nums">
              {telemetry.latence_reseau_ms >= 9000
                ? "coupé"
                : `${Math.round(telemetry.latence_reseau_ms)} ms`}
            </p>
          </div>
        </div>

        <Panel
          title="Santé des services"
          subtitle="État des services d'inférence TB/PN sur chaque environnement"
        >
          {etatSante === "indisponible" ? (
            <EtatIndisponible
              message="La santé des services ne peut être vérifiée tant que le moteur est injoignable."
              onRetry={refreshSante}
            />
          ) : etatSante === "chargement" && Object.keys(sante).length === 0 ? (
            <SectionChargement message="Sondage des 4 services d'inférence…" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(["tb_edge", "tb_cloud", "pn_edge", "pn_cloud"] as const).map((nom) => (
                <ServiceCard key={nom} nom={nom} sante={sante[nom]} />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Décision de routage"
          subtitle={decision.raison}
          actions={<Tag tone={decision.destination}>{decision.destination}</Tag>}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {raisons.map((r) => (
              <div key={r.label} className="rounded-lg border border-border p-3">
                <p className="label-xs flex items-center gap-1.5">
                  <StatusDot tone={r.tone} pulse={false} />
                  {r.label}
                </p>
                <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{r.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] text-foreground">
            {decision.raison}
          </p>
        </Panel>
      </main>
    </AppShell>
  );
}
