/**
 * Dernier résultat patient (OTP = un seul compte rendu).
 *
 * Le principe du flux est : un code OTP donne accès à UN unique compte rendu —
 * celui de la DERNIÈRE analyse du patient, comme un établissement de santé
 * délivre le résultat d'une seule consultation. Le backend borne déjà sa
 * réponse à ce diagnostic (LIMIT 1) ; ce module garantit la même chose côté
 * affichage : si l'API renvoyait malgré tout plusieurs diagnostics, seul le
 * plus récent est conservé, pour la page web comme pour le PDF.
 */

import type { ResultatOtp } from "@/lib/api";

/** Date ISO d'un diagnostic : le backend renvoie `horodatage`, pas `execute_le`. */
export function dateExamenIso(examen: ResultatOtp): string | null {
  return examen.horodatage ?? examen.execute_le ?? null;
}

/** Date courte française ; repli texte brut si la date est illisible. */
export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return "date inconnue";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** Libellé français d'un verdict, identique sur la page web et le PDF. */
export function libelleVerdict(prediction: string): string {
  if (prediction === "positif") return "POSITIF (pathologie suspectée)";
  if (prediction === "negatif") return "NORMAL (aucune pathologie détectée)";
  return "non concluant — relecture recommandée";
}

/**
 * La « dernière analyse » d'un patient : le diagnostic le plus récent, ou null
 * si aucun résultat n'est disponible. Les diagnostics sans date comptent comme
 * les plus anciens (le tri les relègue en fin de liste).
 */
export function dernierResultat(resultats: ResultatOtp[]): ResultatOtp | null {
  if (resultats.length === 0) return null;
  return [...resultats].sort((a, b) => {
    const ta = new Date(dateExamenIso(a) ?? 0).getTime();
    const tb = new Date(dateExamenIso(b) ?? 0).getTime();
    return tb - ta; // plus récent d'abord
  })[0]!;
}

/**
 * Conclusion clinique du dernier résultat, affichée comme sur un compte rendu
 * d'établissement : un état général (normal / pathologie suspectée / relecture).
 */
export function conclusionPatient(resultats: ResultatOtp[]): string {
  const dernier = dernierResultat(resultats);
  const verdicts = dernier?.resultats ?? [];
  if (verdicts.length === 0) {
    return "Aucune analyse exploitée pour ce cliché.";
  }
  const positifs = verdicts.filter((r) => r.prediction === "positif").length;
  const nonConcluants = verdicts.filter(
    (r) => r.prediction !== "positif" && r.prediction !== "negatif",
  ).length;
  if (positifs > 0) {
    return "Des éléments évocateurs de pathologie ont été détectés — une confirmation médicale est recommandée.";
  }
  if (nonConcluants > 0) {
    return "Le verdict comporte un volet non concluant — une relecture par un spécialiste est recommandée.";
  }
  return "Aucun signe de pathologie détecté sur ce cliché.";
}
