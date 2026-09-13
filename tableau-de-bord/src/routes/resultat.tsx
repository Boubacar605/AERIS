import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BadgeCheck, FileText, ScanLine, ThumbsDown, Timer } from "lucide-react";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import { ImageViewer } from "@/components/aeris/ImageViewer";
import { Panel, Tag } from "@/components/aeris/primitives";
import { genererCompteRendu, type ToneFiabilite } from "@/lib/compte-rendu";
import { useResultat } from "@/lib/resultat-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/resultat")({
  component: ResultatPage,
  head: () => ({
    meta: [
      { title: "Résultat · AERIS" },
      {
        name: "description",
        content:
          "Compte rendu radiologique et relecture d'image de l'examen — approuvez ou contestez la décision IA.",
      },
      { property: "og:title", content: "Résultat · AERIS" },
      { property: "og:type", content: "website" },
    ],
  }),
});

function ResultatPage() {
  return (
    <AppShell>
      <ResultatContent />
    </AppShell>
  );
}

const TONALITE_CONCLUSION: Record<ToneFiabilite, string> = {
  ok: "border-ok/50 bg-ok-soft/40",
  warn: "border-warn/50 bg-warn-soft/40",
  alert: "border-alert/50 bg-alert-soft/40",
};

const TONALITE_TITRE_CONCLUSION: Record<ToneFiabilite, string> = {
  ok: "text-ok",
  warn: "text-warn",
  alert: "text-alert",
};

function ResultatContent() {
  const dossier = useResultat();
  const navigate = useNavigate();
  const [decision, setDecision] = useState<"approuve" | "desapprouve" | null>(null);

  const retourAuDiagnostic = () => navigate({ to: "/diagnostic" });

  // Aucun dossier (arrivée directe ou page rechargée) : on guide vers le diagnostic.
  if (!dossier) {
    return (
      <>
        <PageHeader title="Résultat" description="Compte rendu et relecture d'un examen" />
        <main className="p-5">
          <Panel title="Aucun résultat à afficher">
            <div className="grid place-items-center gap-3 py-10 text-center">
              <FileText className="size-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">Aucun examen transmis</p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Cette page affiche le compte rendu du dernier examen. Lancez d'abord une inférence
                  depuis la page Diagnostic pour produire un résultat.
                </p>
              </div>
              <button
                type="button"
                onClick={retourAuDiagnostic}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-foreground uppercase transition-opacity hover:opacity-90"
              >
                <ArrowLeft className="size-3.5" />
                Retour au diagnostic
              </button>
            </div>
          </Panel>
        </main>
      </>
    );
  }

  const rapport = genererCompteRendu(dossier);

  return (
    <>
      <PageHeader
        title="Résultat"
        description="Compte rendu clinique et relecture — validation du clinicien"
        right={
          <Tag tone={dossier.resultat.destination}>{dossier.resultat.destination} execution</Tag>
        }
      />

      <main className="space-y-4 p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* -------- Carte compte rendu clinique -------- */}
          <Panel title="Compte rendu d'examen" subtitle="Document de lecture du clinicien">
            <div className="p-6">
              {/* En-tête institutionnelle du rapport */}
              <div className="border-b border-border pb-4 text-center">
                <p className="font-mono text-sm font-bold tracking-[0.14em]">{rapport.entete}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Compte rendu d'analyse radiologique assistée par intelligence artificielle
                </p>
              </div>

              {/* Sections du rapport */}
              <div className="mt-5 space-y-5">
                {rapport.sections.map((section) => (
                  <section key={section.titre}>
                    <h3 className="label-xs">{section.titre}</h3>
                    {section.paragraphes.map((paragraphe) => (
                      <p
                        key={paragraphe}
                        className="mt-1.5 text-justify text-[13px] leading-relaxed text-navy/90"
                      >
                        {paragraphe}
                      </p>
                    ))}
                  </section>
                ))}
              </div>

              {/* Conclusion encadrée */}
              <div
                className={cn(
                  "mt-6 rounded-lg border p-4",
                  TONALITE_CONCLUSION[rapport.fiabilite.tone],
                )}
              >
                <p className={cn("label-xs", TONALITE_TITRE_CONCLUSION[rapport.fiabilite.tone])}>
                  Conclusion — confiance {rapport.fiabilite.confiance} %
                </p>
                <p
                  className={cn(
                    "mt-1 text-base font-bold tracking-tight",
                    TONALITE_TITRE_CONCLUSION[rapport.fiabilite.tone],
                  )}
                >
                  {rapport.conclusion}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-navy/80">
                  {rapport.raisonConclue}
                </p>
              </div>
            </div>
          </Panel>

          {/* -------- Carte relecture d'image -------- */}
          <div className="flex min-w-0 flex-col gap-4">
            <Panel
              title="Relecture de l'image"
              subtitle="Zoom molette + glisser pour un avis clinique indépendant"
            >
              <ImageViewer fichier={dossier.fichier} />
            </Panel>

            {/* Premier jugement du clinicien */}
            <Panel
              title="Validité de la décision IA"
              subtitle="Le clinicien garde la main sur le verdict final"
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={decision !== null}
                  onClick={() => setDecision("approuve")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 font-mono text-[11px] font-bold tracking-[0.12em] uppercase transition-colors",
                    decision === "approuve"
                      ? "border-ok/50 bg-ok-soft text-ok"
                      : "border-ok/30 bg-card text-ok hover:bg-ok-soft/40 disabled:opacity-50",
                  )}
                >
                  <BadgeCheck className="size-4" />
                  Approuver
                </button>
                <button
                  type="button"
                  disabled={decision !== null}
                  onClick={() => setDecision("desapprouve")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 font-mono text-[11px] font-bold tracking-[0.12em] uppercase transition-colors",
                    decision === "desapprouve"
                      ? "border-alert/50 bg-alert-soft text-alert"
                      : "border-alert/30 bg-card text-alert hover:bg-alert-soft/40 disabled:opacity-50",
                  )}
                >
                  <ThumbsDown className="size-4" />
                  Désapprouver
                </button>
              </div>

              {decision === "approuve" && (
                <p className="mt-3 flex items-start gap-2 rounded-md border border-ok/40 bg-ok-soft/30 p-3 text-xs text-navy/80">
                  <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
                  <span>
                    <span className="font-semibold text-ok">Décision IA approuvée.</span> Le verdict
                    est validé par le clinicien et peut servir de référence pour le suivi du patient
                    en zone à faible connectivité.
                  </span>
                </p>
              )}
              {decision === "desapprouve" && (
                <p className="mt-3 flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/30 p-3 text-xs text-navy/80">
                  <ThumbsDown className="mt-0.5 size-3.5 shrink-0 text-alert" />
                  <span>
                    <span className="font-semibold text-alert">Décision IA désapprouvée.</span> Une
                    relecture par un radiologue est recommandée avant toute conclusion clinique.
                  </span>
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                <button
                  type="button"
                  onClick={retourAuDiagnostic}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase transition-colors hover:text-foreground"
                >
                  <ScanLine className="size-3.5" />
                  Renvoi — nouveau test
                </button>
                <p className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                  <Timer className="size-3" />
                  Examen du {new Date(dossier.horodatage).toLocaleDateString("fr-FR")}
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </main>
    </>
  );
}
