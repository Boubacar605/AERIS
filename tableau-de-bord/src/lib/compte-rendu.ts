/**
 * Compte rendu radiologique clinique — transforme le résultat technique d'une
 * analyse AERIS en phrases médicales naturelles, dans le format d'un rapport
 * d'hôpital. Aucune métrique de routage (latence, Edge/Cloud, CPU) n'est
 * exposée : le document est destiné à la lecture et au premier jugement du
 * clinicien, pas à la démonstration système.
 */

import {
  croiserResultats,
  SEUIL_INDETERMINE,
  SEUIL_NORMAL_CONFIANT,
} from "@/components/aeris/SyntheseClinique";
import type { ResultatAnalyse, ResultatDiagnostic } from "@/lib/api";
import type { DossierResultat } from "@/lib/resultat-store";

export type ToneFiabilite = "ok" | "warn" | "alert";

export type SectionCompteRendu = {
  titre: string;
  paragraphes: string[];
};

export type CompteRendu = {
  /** Titre institutionnel affiché en tête du rapport. */
  entete: string;
  sections: SectionCompteRendu[];
  /** Libellé de la conclusion (aligné sur le verdict de la page diagnostic). */
  conclusion: string;
  /** Phrase clinique qui accompagne la conclusion. */
  raisonConclue: string;
  fiabilite: { confiance: number; tone: ToneFiabilite };
};

/** Libellé clinique d'une pathologie tel que utilisé dans le compte rendu. */
const LIBELLE_EXAMEN: Record<string, string> = {
  tuberculose: "tuberculose pulmonaire",
  pneumonie: "pneumonie",
};

/** Libellé du modèle tel qu'affiché dans le rapport. */
const LIBELLE_MODELE: Record<string, string> = {
  tuberculose: "TB Classifier",
  pneumonie: "Pneumonia Classifier",
};

function pourcentage(confiance: number): number {
  return Math.round(Math.max(0, Math.min(1, confiance)) * 100);
}

function formaterDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${date} à ${heure}`;
}

/** Paragraphe de description clinique pour un modèle qui a été exécuté. */
function decrireAxe(r: ResultatDiagnostic): string | null {
  const pathologie = LIBELLE_EXAMEN[r.pathologie];
  if (!pathologie) return null;
  const pct = pourcentage(r.confiance);

  if (r.prediction === "erreur") {
    return `L'axe ${pathologie} n'a pas pu être interprété (échec technique du modèle de lecture). Ce versant n'est pas renseigné.`;
  }

  if (r.prediction === "positif") {
    const phrase =
      r.confiance >= SEUIL_INDETERMINE
        ? "La sémiologie identifiée est cohérente avec ce diagnostic."
        : "La confiance demeure toutefois modérée, ce qui invite à la prudence.";
    return `Des arguments évocateurs de ${pathologie} sont identifiés sur le cliché, avec une probabilité estimée de ${pct} %. ${phrase}`;
  }

  return `Aucun argument radiologique en faveur de ${pathologie} n'est mis en évidence ; le parenchyme apparaît normal (probabilité de normalité estimée à ${pct} %).`;
}

/** Phrase traçant un contrôle qualité, si le verdict a été relu par le modèle de contrôle. */
function tracerControle(r: ResultatDiagnostic): string | null {
  if (!r.escalade) return null;
  return "Le verdict a fait l'objet d'une relecture par le modèle de contrôle avant restitution.";
}

/** Résume comment les spécialistes ont été triés (profilage), en langage clinique. */
function decrireTriage(resultat: ResultatAnalyse): string {
  if (!resultat.filtrage?.specialiste_ecarte) {
    return "Les modèles de lecture correspondant au domaine de l'image ont été sollicités.";
  }
  const ecarte = resultat.filtrage.specialiste_ecarte;
  const libelleEcarte = LIBELLE_MODELE[ecarte] ?? ecarte;
  const retenus = resultat.filtrage.specialistes_admissibles
    .map((p) => LIBELLE_MODELE[p] ?? p)
    .join(" et ");
  return (
    `L'analyse a été confiée à ${retenus}. ` +
    `${libelleEcarte} n'a pas été sollicité pour ce cliché : le profil de l'image relève d'un ` +
    `autre axe, et les lésions décrites s'y rattachent.`
  );
}

type VerdictConclu = {
  label: string;
  prediction: string;
  confiance: number;
  raison: string;
};

/** Détermine la conclusion à partir du verdict croisé ou, à défaut, du verdict unique. */
function determinerConclusion(resultat: ResultatAnalyse): VerdictConclu {
  const tb = resultat.resultats.find((r) => r.pathologie === "tuberculose");
  const pn = resultat.resultats.find((r) => r.pathologie === "pneumonie");

  if (tb && pn) {
    const v = croiserResultats(tb, pn);
    return {
      label: v.label,
      prediction: v.prediction,
      confiance: v.confiance,
      raison: v.raison,
    };
  }

  const unique = resultat.resultats[0];
  if (!unique) {
    return {
      label: "RELECTURE REQUISE",
      prediction: "indetermine",
      confiance: 0,
      raison: "Aucun verdict n'a pu être établi lors de l'analyse.",
    };
  }

  const labelMaladie =
    unique.pathologie === "tuberculose" ? "TUBERCULOSE DÉTECTÉE" : "PNEUMONIE DÉTECTÉE";

  if (unique.prediction === "positif") {
    const determinable = unique.confiance >= SEUIL_INDETERMINE;
    return {
      label: determinable ? labelMaladie : "RELECTURE REQUISE",
      prediction: determinable ? "positif" : "indetermine",
      confiance: unique.confiance,
      raison: determinable
        ? `Le modèle spécialiste confirme ${LIBELLE_EXAMEN[unique.pathologie]} (confiance ${pourcentage(unique.confiance)} %).`
        : "Le modèle est positif mais sous le seuil de confiance d'usage. Verdict prudent — relecture requise.",
    };
  }

  if (unique.prediction === "negatif") {
    return {
      label: "EXAMEN NORMAL",
      prediction: "negatif",
      confiance: unique.confiance,
      raison: `Aucune pathologie détectée (confiance de normalité ${pourcentage(unique.confiance)} %).`,
    };
  }

  return {
    label: "RELECTURE REQUISE",
    prediction: "indetermine",
    confiance: 0,
    raison: "Le modèle de lecture n'a pas produit de verdict utilisable.",
  };
}

function tonePourConclusion(v: VerdictConclu): ToneFiabilite {
  if (v.prediction === "indetermine") return "alert";
  if (v.prediction === "negatif") return "ok";
  return v.confiance >= SEUIL_NORMAL_CONFIANT ? "warn" : "alert";
}

export function genererCompteRendu(dossier: DossierResultat): CompteRendu {
  const { fichier, resultat, horodatage } = dossier;

  const modelesExecutes = resultat.resultats.map(
    (r) => LIBELLE_MODELE[r.pathologie] ?? r.pathologie,
  );
  const descriptions = resultat.resultats.map(decrireAxe).filter((s): s is string => s !== null);
  const controles = resultat.resultats.map(tracerControle).filter((s): s is string => s !== null);

  const sections: SectionCompteRendu[] = [
    {
      titre: "Renseignements — Demande",
      paragraphes: [
        "Radiographie du thorax (incidence de face), transmise pour évaluation assistée par le système AERIS.",
        `Référence du cliché : ${fichier.name} — examen enregistré le ${formaterDate(horodatage)}.`,
      ],
    },
    {
      titre: "Technique",
      paragraphes: [
        `Analyse assistée par ${modelesExecutes.join(" et ")} sur l'image source, sans recoupe ni reformatage. ${decrireTriage(resultat)}`,
        ...(controles.length
          ? ["Chaque verdict confidentiel est soumis à un contrôle de référence avant restitution."]
          : []),
      ],
    },
    {
      titre: "Description",
      paragraphes: descriptions,
    },
  ];

  // Le raisonnement du verdict n'est ajouté que si les deux modèles se contredisent.
  const tb = resultat.resultats.find((r) => r.pathologie === "tuberculose");
  const pn = resultat.resultats.find((r) => r.pathologie === "pneumonie");
  if (tb && pn && croiserResultats(tb, pn).conflit) {
    sections.push({
      titre: "Raisonnement",
      paragraphes: [
        "Les deux lectures se contredisent (normal vs pathologie). Le signal le moins confiant est écarté ; une relecture clinique est recommandée pour trancher.",
      ],
    });
  }

  const verdict = determinerConclusion(resultat);

  return {
    entete: "AERIS — RADILOGIE ADAPTATIVE EDGE-CLOUD",
    sections,
    conclusion: verdict.label,
    raisonConclue: verdict.raison,
    fiabilite: { confiance: pourcentage(verdict.confiance), tone: tonePourConclusion(verdict) },
  };
}
