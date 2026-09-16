/**
 * Vue patient de son résultat — accès par code OTP uniquement.
 *
 * Aucun accès à la plateforme : aucune image n'est stockée côté serveur, le
 * patient reçoit le compte rendu de sa DERNIÈRE analyse (un OTP = un seul
 * compte rendu, comme un résultat de consultation médicale). Verdicts et
 * confiances sont affichés sans aucune donnée technique de routage, avec une
 * conclusion clinique lisible en bas de carte.
 */

import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  HelpCircle,
  Loader2,
  Lock,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import type { ReponseAccesResultat } from "@/lib/api";
import {
  conclusionPatient,
  dateExamenIso,
  dernierResultat,
  formatDateFr,
  libelleVerdict,
} from "@/lib/dernier-resultat";
import { genererPdfPatient } from "@/lib/export-pdf";
import { cn } from "@/lib/utils";

/** Icône + couleur du verdict d'une pathologie (ok / alerte / non concluant). */
function VerdictPathologie({ pathologie, prediction }: { pathologie: string; prediction: string }) {
  const concluant = prediction === "negatif" || prediction === "positif";
  if (!concluant) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-warn-soft text-warn">
        <HelpCircle className="size-4" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full",
        prediction === "positif" ? "bg-alert-soft text-alert" : "bg-ok-soft text-ok",
      )}
    >
      {prediction === "positif" ? (
        <XCircle className="size-4" />
      ) : (
        <CheckCircle2 className="size-4" />
      )}
    </span>
  );
}

export function PatientResult({ donnees }: { donnees: ReponseAccesResultat }) {
  const { patient, resultats } = donnees;
  const [pdfEnCours, setPdfEnCours] = useState(false);

  // Un seul compte rendu : celui de la dernière analyse du patient.
  const examen = dernierResultat(resultats);
  const dateExamen = examen ? formatDateFr(dateExamenIso(examen)) : null;

  /** Télécharge le résultat au format PDF (marque AERIS) sans quitter la page. */
  const telechargerPdf = async () => {
    setPdfEnCours(true);
    try {
      await genererPdfPatient(donnees);
    } finally {
      setPdfEnCours(false);
    }
  };

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
            {patient.nom_complet
              ? `Bonjour ${patient.nom_complet}, voici le résultat de votre dernier examen`
              : "Accès sécurisé"}
          </p>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              Examen du {dateExamen ?? "…"}
            </span>
            <span className="font-mono">Dossier {patient.code_patient}</span>
            {examen?.code_examen && <span className="font-mono">{examen.code_examen}</span>}
          </p>
        </div>

        <h1 className="mt-7 flex items-center gap-2 text-lg font-semibold text-foreground">
          <FileText className="size-5 text-ok" />
          Compte rendu de votre examen radiologique
        </h1>

        {!examen ? (
          <p className="mt-4 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            Aucun compte rendu disponible pour le moment. Un résultat vous sera communiqué par email
            dès qu'un examen vous concernant aura été analysé.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border bg-muted/40 px-4 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-xs font-semibold text-foreground">
                  {examen.code_examen ?? "Examen radiologique"}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {dateExamen ?? "date inconnue"}
                </p>
              </div>
              {examen.nom_fichier && (
                <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
                  <FileText className="size-3 shrink-0" />
                  <span className="truncate">{examen.nom_fichier}</span>
                </p>
              )}
            </div>

            {examen.resultats.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                Aucune analyse enregistrée pour ce cliché.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {examen.resultats.map((p) => (
                  <li key={p.pathologie} className="flex items-center gap-3 px-4 py-3">
                    <VerdictPathologie pathologie={p.pathologie} prediction={p.prediction} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {p.pathologie === "tuberculose" ? "Tuberculose (TB)" : "Pneumonie (PN)"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Résultat :{" "}
                        <span className="font-medium">{libelleVerdict(p.prediction)}</span> —
                        confiance du modèle : {(p.confiance * 100).toFixed(0)} %
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="flex items-start gap-2 border-t border-border bg-muted/20 px-4 py-3 text-xs leading-relaxed text-foreground">
              <Activity className="mt-0.5 size-3.5 shrink-0 text-ok" />
              <span>
                <span className="font-semibold">Conclusion : </span>
                {conclusionPatient(resultats)}
              </span>
            </p>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void telechargerPdf()}
            disabled={pdfEnCours || !examen}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-foreground uppercase transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pdfEnCours ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {pdfEnCours ? "Génération…" : "Télécharger mon résultat (PDF)"}
          </button>
          <p className="font-mono text-[10px] text-muted-foreground">
            Dossier {patient.code_patient}
          </p>
        </div>

        <p className="mt-6 flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
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
