/**
 * Vue patient de ses résultats — accès par code OTP uniquement.
 *
 * Aucun accès à la plateforme : aucune image n'est stockée côté serveur, le
 * patient reçoit un récapitulatif textuel de ses examens (verdicts et
 * confiances). L'interface est volontairement simple, sans navigation AERIS.
 */

import { Activity, CheckCircle2, FileText, Lock, ShieldCheck, XCircle } from "lucide-react";
import type { ReponseAccesResultat } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PatientResult({ donnees }: { donnees: ReponseAccesResultat }) {
  const { patient, resultats } = donnees;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-4">
          <img src="/logo-aeris.png" alt="AERIS" className="h-12 w-32 object-contain" />
          <div className="ml-auto text-right">
            <p className="label-xs text-muted-foreground">espace patient</p>
            <p className="font-mono text-[11px] text-foreground">{patient.code_patient}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">
        <div className="rounded-lg border border-ok/30 bg-ok-soft/20 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="size-4 text-ok" />
            {patient.nom_complet ? `Bonjour ${patient.nom_complet}` : "Accès sécurisé"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Vos résultats d'examen sont disponibles ci-dessous. Ce document est délivré à partir
            d'un code à usage unique : il ne peut être consulté qu'une seule fois sur cet appareil.
          </p>
        </div>

        <h1 className="mt-7 flex items-center gap-2 text-lg font-semibold text-foreground">
          <FileText className="size-5 text-ok" />
          Résultats de vos examens radiologiques
        </h1>

        {resultats.length === 0 ? (
          <p className="mt-4 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            Aucun compte rendu disponible pour le moment. Un résultat vous sera communiqué par email
            dès qu'un examen vous concernant aura été analysé.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {resultats.map((examen, i) => (
              <li
                key={examen.id_diagnostic ?? i}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                  <p className="font-mono text-xs font-semibold text-foreground">
                    {examen.code_examen ?? `Examen n°${i + 1}`}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {examen.execute_le
                      ? new Date(examen.execute_le).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                        })
                      : "date inconnue"}
                  </p>
                </div>

                <ul className="divide-y divide-border">
                  {examen.resultats.map((r) => (
                    <li key={r.pathologie} className="flex items-center gap-3 px-4 py-3">
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-full",
                          r.prediction === "positif"
                            ? "bg-alert-soft text-alert"
                            : "bg-ok-soft text-ok",
                        )}
                      >
                        {r.prediction === "positif" ? (
                          <XCircle className="size-4" />
                        ) : (
                          <CheckCircle2 className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">
                          {r.pathologie === "tuberculose" ? "Tuberculose (TB)" : "Pneumonie (PN)"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Résultat : <span className="font-medium">{r.prediction}</span> — confiance
                          du modèle : {(r.confiance * 100).toFixed(0)} %
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-8 flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <Activity className="mt-0.5 size-3.5 shrink-0" />
          Ce compte rendu est généré automatiquement par le prototype AERIS à des fins de recherche.
          En cas de question, contactez votre établissement de santé.
        </p>
      </main>

      <footer className="border-t border-border">
        <p className="mx-auto flex max-w-2xl items-center gap-1.5 px-5 py-3 font-mono text-[10px] text-muted-foreground">
          <Lock className="size-3" />
          AERIS · accès patient à usage unique · Master 2 SI · UADB · 2025-2026
        </p>
      </footer>
    </div>
  );
}
