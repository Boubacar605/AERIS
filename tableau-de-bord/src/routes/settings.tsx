import { createFileRoute } from "@tanstack/react-router";
import { exigerRole } from "@/lib/authentification";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import {
  EtatIndisponible,
  Panel,
  SectionChargement,
  StatusDot,
  Tag,
} from "@/components/aeris/primitives";
import { useSeuilsLive, useServiceHealthLive } from "@/hooks/use-api";
import { formatUptime } from "@/lib/format";

export const Route = createFileRoute("/settings")({
  beforeLoad: () => exigerRole("admin"),
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Paramètres · Plateforme AERIS" },
      {
        name: "description",
        content:
          "Paramètres de la plateforme AERIS : politique de routage Edge-Cloud, seuils de bascule et nœuds enregistrés.",
      },
      { property: "og:title", content: "Paramètres · Plateforme AERIS" },
      {
        property: "og:description",
        content: "Politique de routage, seuils de bascule et nœuds de la plateforme AERIS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const LIBELLES_SERVICES: Record<string, string> = {
  tb_edge: "Classificateur TB · Edge",
  tb_cloud: "Classificateur TB · Cloud",
  pn_edge: "Classificateur PN · Edge",
  pn_cloud: "Classificateur PN · Cloud",
};

function SettingsPage() {
  const { seuils, etat: etatSeuils, refresh } = useSeuilsLive();
  const { sante, etat: etatSante, refresh: refreshSante } = useServiceHealthLive();

  const seuilsAffiches = seuils
    ? [
        { label: "CPU Edge max", value: `${seuils.cpu} %`, hint: "Au-delà, délestage Cloud" },
        { label: "RAM Edge max", value: `${seuils.ram} %`, hint: "Au-delà, délestage Cloud" },
        {
          label: "Latence réseau max",
          value: `${seuils.latence_ms} ms`,
          hint: "Au-delà, exécution locale forcée",
        },
      ]
    : null;

  return (
    <AppShell>
      <PageHeader
        title="Paramètres"
        description="Politique de routage et paramètres de plateforme"
      />
      <main className="grid gap-4 p-5 xl:grid-cols-2">
        <Panel title="Seuils de routage" subtitle="Seuils du moteur de décision (GET /)">
          {etatSeuils === "indisponible" ? (
            <EtatIndisponible
              message="Les seuils ne sont pas disponibles tant que le moteur ne répond pas."
              onRetry={refresh}
            />
          ) : etatSeuils === "chargement" || !seuilsAffiches ? (
            <SectionChargement message="Lecture des seuils du moteur de décision…" />
          ) : (
            <ul className="divide-y divide-border">
              {seuilsAffiches.map((t) => (
                <li key={t.label} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-xs font-medium">{t.label}</p>
                    <p className="text-[11px] text-muted-foreground">{t.hint}</p>
                  </div>
                  <span className="font-mono text-sm font-semibold tabular-nums">{t.value}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Nœuds enregistrés"
          subtitle="État des services d'inférence interrogés en direct"
        >
          {etatSante === "indisponible" ? (
            <EtatIndisponible
              message="Les nœuds enregistrés ne peuvent être sondés tant que le moteur est injoignable."
              onRetry={refreshSante}
            />
          ) : etatSante === "chargement" && Object.keys(sante).length === 0 ? (
            <SectionChargement message="Sondage des 4 services d'inférence…" />
          ) : (
            <ul className="space-y-2">
              {(["tb_edge", "tb_cloud", "pn_edge", "pn_cloud"] as const).map((nom) => {
                const s = sante[nom];
                const enLigne = s?.statut === "ok";
                const tone = nom.endsWith("_cloud") ? ("cloud" as const) : ("edge" as const);
                return (
                  <li
                    key={nom}
                    className="flex items-center justify-between rounded border border-border bg-muted/40 p-2.5"
                  >
                    <div>
                      <p className="font-mono text-xs font-semibold">{nom}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {LIBELLES_SERVICES[nom]} ·{" "}
                        {s?.uptime_secondes ? formatUptime(s.uptime_secondes) : "—"}
                      </p>
                    </div>
                    <Tag tone={enLigne ? tone : "alert"}>
                      <StatusDot tone={enLigne ? tone : "alert"} pulse={false} />
                      {enLigne ? "en ligne" : "injoignable"}
                    </Tag>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </main>
    </AppShell>
  );
}
