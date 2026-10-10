import { createFileRoute } from "@tanstack/react-router";
import { exigerRole } from "@/lib/authentification";
import { useMemo, useState } from "react";
import { CheckCircle2, Search, XCircle } from "lucide-react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import {
  EtatIndisponible,
  Panel,
  SectionChargement,
  StatusDot,
  Tag,
} from "@/components/aeris/primitives";
import { useHistoriqueLive } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { formatConfiance } from "@/lib/format";

export const Route = createFileRoute("/historique")({
  beforeLoad: () => exigerRole("admin", "clinicien"),
  component: HistoryPage,
  head: () => ({
    meta: [
      { title: "Historique des inférences · AERIS" },
      {
        name: "description",
        content:
          "Journal complet des inférences AERIS : service IA, confiance, environnement d'exécution Edge ou Cloud, latence et statut.",
      },
      { property: "og:title", content: "Historique des inférences · AERIS" },
      {
        property: "og:description",
        content: "Journal traçable des inférences routées entre Edge et Cloud.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function HistoryPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "edge" | "cloud">("all");
  // La page est une consultation d'archive, pas une vue temps réel : on
  // interroge le journal durable (200 diagnostics) à un rythme calme pour
  // remonter au-delà de la fenêtre mémoire de 100 entrées du moteur, sans
  // multiplier le trafic sur une connexion faible.
  const { records, statistiques, etat, charger } = useHistoriqueLive(10000, 200);

  const rows = useMemo(
    () =>
      records
        .filter((r) => (filter === "all" ? true : r.target === filter))
        .filter((r) =>
          `${r.id} ${r.service} ${r.finding}`.toLowerCase().includes(query.toLowerCase()),
        ),
    [records, query, filter],
  );

  return (
    <AppShell>
      <PageHeader title="Historique" description="Journal traçable des inférences exécutées" />
      <main className="space-y-4 p-5">
        {etat === "indisponible" ? (
          <EtatIndisponible
            message="L'historique est indisponible tant que le moteur de décision ne répond pas."
            onRetry={() => void charger()}
          />
        ) : etat === "chargement" ? (
          <SectionChargement message="Lecture du journal des inférences auprès du moteur…" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Inférences totales", String(statistiques.total), "neutral"],
                [
                  "Latence moyenne Edge",
                  statistiques.avgLatencyEdge ? `${statistiques.avgLatencyEdge} ms` : "— ms",
                  "edge",
                ],
                [
                  "Latence moyenne Cloud",
                  statistiques.avgLatencyCloud ? `${statistiques.avgLatencyCloud} ms` : "— ms",
                  "cloud",
                ],
                ["Taux de réussite", `${Math.round(statistiques.tauxReussite * 100)}%`, "ok"],
              ].map(([label, value, tone]) => (
                <div key={label} className="panel px-4 py-3">
                  <p className="label-xs">{label}</p>
                  <p className="mt-1 flex items-center gap-2 font-mono text-xl font-semibold tabular-nums">
                    {tone !== "neutral" && <StatusDot tone={tone as "edge"} pulse={false} />}
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <Panel
              title="Journal d'inférences"
              subtitle={`${rows.length} enregistrement${rows.length > 1 ? "s" : ""}`}
              bodyClassName="p-0"
              actions={
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                    <Search className="size-3.5 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Rechercher…"
                      className="w-32 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  {(["all", "edge", "cloud"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors",
                        filter === f
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f === "all" ? "tous" : f}
                    </button>
                  ))}
                </div>
              }
            >
              {records.length === 0 ? (
                <div className="grid place-items-center p-10 text-center">
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Aucune inférence réalisée — lancez un diagnostic pour alimenter le journal.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        {[
                          "Heure",
                          "ID",
                          "Service",
                          "Résultat",
                          "Confiance",
                          "Exéc.",
                          "Latence",
                          "Statut",
                        ].map((h) => (
                          <th
                            key={h}
                            className="label-xs px-4 py-2 font-semibold whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => (
                        <tr key={`${r.id}-${r.service}`} className="hover:bg-muted/40">
                          <td className="px-4 py-2 font-mono text-muted-foreground tabular-nums">
                            {r.time}
                          </td>
                          <td className="px-4 py-2 font-mono font-semibold">#{r.id}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{r.service}</td>
                          <td className="px-4 py-2 text-muted-foreground">{r.finding}</td>
                          <td className="px-4 py-2 font-mono tabular-nums">
                            {formatConfiance(r.confidence)}
                          </td>
                          <td className="px-4 py-2">
                            <Tag tone={r.target}>{r.target}</Tag>
                          </td>
                          <td className="px-4 py-2 font-mono tabular-nums">{r.latencyMs} ms</td>
                          <td className="px-4 py-2">
                            {r.status === "completed" ? (
                              <span className="flex items-center gap-1.5 text-ok">
                                <CheckCircle2 className="size-3.5" /> Terminé
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 text-alert">
                                <XCircle className="size-3.5" /> Échec
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </main>
    </AppShell>
  );
}
