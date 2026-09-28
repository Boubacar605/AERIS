/**
 * Dernier résultat patient — helpers partagés (page web + PDF).
 *
 * Un code OTP donne accès à UN unique compte rendu : celui de la DERNIÈRE
 * analyse du patient, comme un établissement de santé délivre le résultat
 * d'une seule consultation. Le backend borne déjà sa réponse à ce diagnostic
 * (LIMIT 1). Ce module fournit les libellés, textes et formatage utilisés
 * aussi bien sur la page web que dans le PDF téléchargé.
 *
 * Le code est permanent et réutilisable : aucun compteur d'expiration n'est
 * affiché au patient, qui peut revoir ses résultats autant de fois qu'il le
 * souhaite.
 */

import type { ResultatOtp } from "@/lib/api";

/** Mention d'usage unique du lien, rappelée au patient (le code, lui, est permanent). */
export const OTP_PERMANENT = true;

// ── Dates ──

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

// ── Noms ──

/**
 * Formate le nom pour un affichage patient — supprime les étiquettes internes
 * entre parenthèses (ex. « (Test canal complet) ») et reformate en « Prénom I. »
 * (initiale du nom de famille).
 *
 * « Niang B. (Test canal complet) » → « Boubacar N. »
 */
export function afficherNomPatient(nom: string | null | undefined): string {
  if (!nom) return "Patient";
  // Supprimer tout contenu entre parenthèses (y compris les espaces avant)
  const sansLabels = nom.replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (!sansLabels) return "Patient";
  // Séparer prénom et nom : on prend le dernier espace comme séparateur
  const parties = sansLabels.split(/\s+/);
  if (parties.length < 2) return parties[0]!;
  const prenom = parties[0]!;
  const nomFamille = parties[parties.length - 1]!;
  return `${prenom} ${nomFamille.charAt(0).toUpperCase()}.`;
}

// ── Pathologies & verdicts ──

/** Disclaimer patient-friendly pour la page web et le PDF. */
export const DISCLAIMER_PATIENT =
  "⚕ AVERTISSEMENT : Ce document est généré automatiquement par le prototype AERIS (Master 2 SI / UADB 2025-2026). Ce prototype est un outil d'aide à la décision à des fins de recherche académique ; il ne constitue pas un acte médical, ni un diagnostic définitif. L'analyse assistée par IA peut produire des résultats erronés. Seul un médecin habilité peut interpréter un bilan radiologique. En cas de symptômes, consultez sans délai un professionnel de santé ou rendez-vous dans votre établissement de santé habituel.";

/** Nom complet d'une pathologie pour un patient. */
export function nomPathologie(pathologie: string): string {
  if (pathologie === "tuberculose") return "tuberculose pulmonaire";
  if (pathologie === "pneumonie") return "pneumonie";
  return pathologie;
}

/** Libellé de statut en français pour un verdict (page web et PDF). */
export function statutVerdict(prediction: string): string {
  if (prediction === "negatif") return "Aucune anomalie détectée";
  if (prediction === "positif") return "Anomalie détectée — consultation recommandée";
  return "Résultat non concluant — relecture recommandée";
}

/** Texte d'explication patient-friendly pour un verdict donné. */
export function explicationVerdict(prediction: string, pathologie: string): string {
  const nom = nomPathologie(pathologie);
  if (prediction === "negatif") {
    return `Aucun signe évocateur de ${nom} n'a été relevé sur ce cliché.`;
  }
  if (prediction === "positif") {
    return `L'analyse assistée a relevé des éléments radiologiques évocateurs de ${nom}. Ce résultat doit être interprété par un médecin qualifié. Veuillez consulter votre établissement de santé dans les meilleurs délais.`;
  }
  return "Le verdict n'est pas concluant. Une relecture par un médecin qualifié est nécessaire pour établir un diagnostic.";
}

// ── Dernier résultat & synthèse ──

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

/** Vrai si le dernier résultat contient au moins un verdict positif. */
export function estPositif(resultats: ResultatOtp[]): boolean {
  const dernier = dernierResultat(resultats);
  return (dernier?.resultats ?? []).some((r) => r.prediction === "positif");
}

/**
 * Conclusion clinique du dernier résultat — texte patient-friendly, identique
 * sur la page web et le PDF.
 *
 * - NORMAL : rassurant, mention des symptômes à surveiller
 * - POSITIF : oriente vers une consultation médicale
 * - NON CONCLUANT : recommande une relecture spécialiste
 */
export function conclusionPatient(resultats: ResultatOtp[]): string {
  const dernier = dernierResultat(resultats);
  const verdicts = dernier?.resultats ?? [];
  if (verdicts.length === 0) {
    return "Aucune analyse exploitable pour ce cliché.";
  }
  const positifs = verdicts.filter((r) => r.prediction === "positif").length;
  const nonConcluants = verdicts.filter(
    (r) => r.prediction !== "positif" && r.prediction !== "negatif",
  ).length;
  if (positifs > 0) {
    return "L'analyse assistée a relevé des éléments radiologiques évocateurs de pathologie sur ce cliché. Ce résultat nécessite une évaluation par un médecin qualifié avant toute conclusion diagnostique.\n\nRECOMMANDATION : Présentez ce document à votre médecin ou rendez-vous dans votre établissement de santé dans les meilleurs délais. N'attendez pas l'apparition ou l'aggravation de symptômes.";
  }
  if (nonConcluants > 0) {
    return "Le verdict comporte un élément non concluant. Une relecture par un spécialiste est recommandée pour confirmer le résultat.";
  }
  return "L'analyse assistée n'a pas relevé d'éléments radiologiques évocateurs de tuberculose pulmonaire ni de pneumonie sur ce cliché.\n\nCe résultat est rassurant. Si vous présentez des symptômes persistants (toux, fièvre, essoufflement), consultez votre médecin indépendamment de ce résultat.";
}
