/**
 * Vue patient de son résultat — accès par code OTP uniquement.
 *
 * Un OTP = UN compte rendu (celui de la dernière analyse). Le rendu est
 * entièrement patient-friendly : badges de statut lisibles, explications
 * en langage clair, aucune donnée technique interne (confiance ML, edge/cloud).
 */

import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  HelpCircle,
  Info,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReponseAccesResultat } from "@/lib/api";
import {
  afficherNomPatient,
  conclusionPatient,
  dateExamenIso,
  dernierResultat,
  explicationVerdict,
  formatDateFr,
  nomPathologie,
  DISCLAIMER_PATIENT,
} from "@/lib/dernier-resultat";
import { estIOS, genererPdfPatient } from "@/lib/export-pdf";
import { cn } from "@/lib/utils";

/** Badge de statut pour une pathologie — layout uniforme web + PDF. */
function BadgeStatut({ prediction }: { prediction: string }) {
  const estNormal = prediction === "negatif";
  const estPositif = prediction === "positif";

  if (estNormal) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-ok/40 bg-ok-soft/30 px-4 py-3">
        <CheckCircle2 className="size-6 shrink-0 text-ok" />
        <span className="text-lg font-semibold text-ok">Aucune anomalie détectée</span>
      </span>
    );
  }
  if (estPositif) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-warn/40 bg-warn-soft/30 px-4 py-3">
        <AlertTriangle className="size-6 shrink-0 text-warn" />
        <span className="text-lg font-semibold text-warn">
          Anomalie détectée — consultation recommandée
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <HelpCircle className="size-6 shrink-0 text-muted-foreground" />
      <span className="text-lg font-semibold text-muted-foreground">
        Résultat non concluant — relecture recommandée
      </span>
    </span>
  );
}

export function PatientResult({ donnees, otp }: { donnees: ReponseAccesResultat; otp: string }) {
  const { patient, resultats } = donnees;
  const [pdfEnCours, setPdfEnCours] = useState(false);
  // Détecté après hydratation : `navigator` n'existe pas au rendu SSR, l'y
  // interroger directement provoquerait un écart d'hydratation.
  const [surIOS, setSurIOS] = useState(false);

  useEffect(() => setSurIOS(estIOS()), []);

  // String() : TanStack Search peut restituer un tableau/string « braqué »
  // côté SSR (rappel de la même protection dans PatientOtpHub) — forcer une
  // string avant usage, sans quoi otp?.trim() lève en production.
  const code = String(otp ?? "").trim();
  const lienResultat = `${window.location.origin}/resultat?otp=${encodeURIComponent(code)}`;
  const prenom = afficherNomPatient(patient.nom_complet);

  // Un seul compte rendu : celui de la dernière analyse du patient.
  const examen = dernierResultat(resultats);
  const dateExamen = examen ? formatDateFr(dateExamenIso(examen)) : null;
  // Décision du clinicien sur cet examen (Vague 1). L'accès reste ouvert : un
  // bandeau explique l'attente, là où un 401 laisserait le patient croire à
  // une panne — ou worse, à un oubli du soignant.
  const validation = examen?.validation;

  /** Télécharge le résultat au format PDF (marque AERIS) sans quitter la page. */
  const telechargerPdf = async () => {
    setPdfEnCours(true);
    try {
      await genererPdfPatient(donnees, { otp: code, lien: lienResultat });
    } finally {
      setPdfEnCours(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── En-tête ── */}
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
        {/* ── Bandeau de validation clinique ── */}
        {/* L'API ne renvoie que le dernier examen APPROUVE (Vague 2) : ce
            bandeau ne s'affiche donc pas en fonctionnement normal. Il reste
            là pour la seule incohérence possible — une décision prise entre la
            sélection du diagnostic et la lecture de son état, soit une fraction
            de seconde. Préférer l'afficher dans ce cas rare plutôt que montrer
            un résultat qu'un clinicien vient de refuser. */}
        {validation && validation.statut !== "approuve" && (
          <div
            className={`mb-4 rounded-lg border p-4 ${
              validation.statut === "desapprouve"
                ? "border-warn/40 bg-warn-soft/20"
                : "border-accent/40 bg-accent/10"
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Clock
                className={`size-4 ${validation.statut === "desapprouve" ? "text-warn" : "text-accent"}`}
              />
              {validation.statut === "desapprouve"
                ? "Ce résultat n'a pas été retenu par le clinicien"
                : "Résultat en cours de validation clinique"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {validation.statut === "desapprouve" ? (
                <>
                  L'équipe soignante a proposé un nouvel examen. Ce compte rendu est affiché à titre
                  informatif et ne doit pas être interprété comme un résultat définitif. Personne ne
                  vous a oublié : l'examen sera refait.
                </>
              ) : (
                <>
                  Un professionnel de santé relit ce résultat avant de le confirmer. Vous pouvez le
                  consulter dès maintenant, mais il ne fait pas encore foi. Vous n'avez rien à faire
                  en attendant.
                </>
              )}
            </p>
            {validation.motif_desaccord && (
              <p className="mt-2 text-xs text-muted-foreground">
                Motif indiqué par le clinicien :{" "}
                <span className="text-foreground">{validation.motif_desaccord}</span>
              </p>
            )}
          </div>
        )}

        {/* ── Bandeau salutation ── */}
        <div className="rounded-lg border border-ok/30 bg-ok-soft/20 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="size-4 text-ok" />
            {prenom !== "Patient"
              ? `Bonjour ${prenom}, voici le résultat de votre examen radiologique${dateExamen ? ` du ${dateExamen}` : ""}.`
              : "Accès sécurisé"}
          </p>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              {dateExamen ?? "…"}
            </span>
            <span className="font-mono">Dossier {patient.code_patient}</span>
            {examen?.code_examen && <span className="font-mono">{examen.code_examen}</span>}
          </p>
        </div>

        {/* ── Titre ── */}
        <h1 className="mt-7 flex items-center gap-2 text-lg font-semibold text-foreground">
          <FileText className="size-5 text-ok" />
          Compte rendu de votre examen radiologique
        </h1>

        {!examen ? (
          /* Liste vide = aucun examen approuvé, pas « pas d'analyse » : depuis
             la Vague 2, l'API filtre sur la validation. Le distinction compte,
             le patient ne doit pas croire que son examen n'a pas été fait. */
          <div className="mt-4 rounded-md border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Clock className="size-4 text-warn" />
              Aucun résultat validé pour le moment
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Votre examen a bien été analysé, mais aucun compte rendu n'a encore été validé par un
              professionnel de santé. Rien ne vous est demandé : le résultat vous sera communiqué
              dès qu'il sera validé. Si l'analyse a été faite il y a plusieurs jours, vous pouvez
              rappeler le service pour connaître l'avancement.
            </p>
          </div>
        ) : (
          <>
            {/* ── Carte de résultats ── */}
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
              {/* Bandeau examen */}
              <div className="border-b border-border bg-muted/40 px-4 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs font-semibold text-foreground">
                    {examen.code_examen ?? "Examen radiologique"}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {dateExamen ?? "date inconnue"}
                  </p>
                </div>
              </div>

              {/* Résultats par pathologie */}
              {examen.resultats.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  Aucune analyse enregistrée pour ce cliché.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {examen.resultats.map((p) => (
                    <li key={p.pathologie} className="flex flex-col gap-3 px-4 py-4">
                      <BadgeStatut prediction={p.prediction} />
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {nomPathologie(p.pathologie) === p.pathologie
                            ? p.pathologie
                            : `${nomPathologie(p.pathologie).charAt(0).toUpperCase()}${nomPathologie(p.pathologie).slice(1)}`}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {explicationVerdict(p.prediction, p.pathologie)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── Ce que cela signifie pour vous ── */}
            <div className="mt-6 rounded-lg border border-border bg-card px-5 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Activity className="size-4 text-ok" />
                Ce que cela signifie pour vous
              </p>
              {conclusionPatient(resultats)
                .split("\n\n")
                .map((paragraphe, index) => (
                  <p
                    key={paragraphe.slice(0, 24)}
                    className={cn(
                      "text-sm leading-relaxed text-muted-foreground",
                      index > 0 && "mt-3",
                    )}
                  >
                    {paragraphe}
                  </p>
                ))}
            </div>

            {/* ── Informations de référence ── */}
            <p className="mt-4 text-center font-mono text-[10px] text-muted-foreground">
              Dossier {patient.code_patient}
              {examen.code_examen && <> · Référence {examen.code_examen}</>}
              {dateExamen && <> · Consulté le {dateExamen}</>}
            </p>
          </>
        )}

        {/* ── Bouton téléchargement ── */}
        <div className="mt-7 flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => void telechargerPdf()}
            disabled={pdfEnCours || !examen}
            className="flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-foreground uppercase transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pdfEnCours ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {pdfEnCours ? "Génération…" : "Télécharger mon résultat (PDF)"}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            Le document PDF contient votre compte rendu complet · À conserver
            {surIOS && " · sur téléphone, le PDF s'ouvre dans un nouvel onglet"}
          </p>
        </div>

        {/* ── Informations OTP ── */}
        {code && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Ce code n’expire pas : vous pouvez revoir vos résultats autant de fois que vous le
            souhaitez
            {lienResultat && (
              <>
                {" · "}
                <a href={lienResultat} className="underline hover:text-foreground">
                  Lien direct
                </a>
              </>
            )}
          </p>
        )}

        {/* ── Disclaimer ── */}
        <div className="mt-6 flex items-start gap-3 rounded-r-lg border-l-4 border-ok bg-ok-soft/10 p-4">
          <Info className="mt-0.5 size-5 shrink-0 text-ok" />
          <p className="text-sm leading-relaxed text-muted-foreground">{DISCLAIMER_PATIENT}</p>
        </div>
      </main>

      {/* ── Pied de page ── */}
      <footer className="border-t border-border">
        <p className="mx-auto flex max-w-2xl items-center gap-1.5 px-5 py-3 font-mono text-[10px] text-muted-foreground">
          <Lock className="size-3" />
          AERIS · accès patient à usage unique · Master 2 SI · UADB · 2025-2026
        </p>
      </footer>
    </div>
  );
}
