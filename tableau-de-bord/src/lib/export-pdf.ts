/**
 * Export PDF avec la marque AERIS (logo + bandeau UADB).
 *
 * Deux générateurs, un seul format :
 * - genererPdfClinique : le clinicien télécharge/refuse le compte rendu du
 *   dossier courant (page Résultat) ;
 * - genererPdfPatient   : le patient télécharge son résultat après validation
 *   de l'OTP (page « consultation résultats »), sans navigation AERIS.
 *
 * Le logo est chargé en DataURL depuis l'asset public (même origine, pas de
 * CORS) ; en cas d'échec le PDF demeure valable avec l'en-tête textuel.
 */

import { jsPDF } from "jspdf";
import type { ReponseAccesResultat } from "@/lib/api";
import { genererCompteRendu } from "@/lib/compte-rendu";
import type { DossierResultat } from "@/lib/resultat-store";

const ENTETE = "AERIS — RADIOLOGIE ADAPTATIVE EDGE-CLOUD";
const SOUS_TITRE = "Université Alioune Diop de Bambey (UADB) · Master 2 Systèmes d'Information";

/** jsPDF enrichi d'un curseur vertical (auto-pagination des sections). */
type DocAeris = jsPDF & { lastAutoY?: number };

/** Charge /logo-aeris.png en DataURL ; null si l'asset est indisponible. */
async function logoDataUrl(): Promise<string | null> {
  try {
    const reponse = await fetch("/logo-aeris.png");
    if (!reponse.ok) return null;
    const blob = await reponse.blob();
    return await new Promise<string>((resoudre, rejeter) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resoudre(String(lecteur.result));
      lecteur.onerror = () => rejeter(new Error("lecture du logo impossible"));
      lecteur.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function formaterDate(iso: string | undefined): string {
  if (!iso) return "date inconnue";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** Découpe le texte en lignes adaptées à la largeur utile (A4 - marges). */
function lignes(doc: jsPDF, texte: string): string[] {
  return doc.splitTextToSize(texte, 182) as string[];
}

/** En-tête A4 : logo, bandeau institutionnel et filet horizontal. */
function dessinerEnTete(doc: jsPDF, logo: string | null): void {
  doc.setFillColor(15, 45, 78); // navy AERIS
  doc.rect(14, 14, 182, 3, "F");

  if (logo) {
    doc.addImage(logo, "PNG", 85, 21, 40, 18); // ratio 2:1 du logo
  } else {
    doc.setFontSize(13);
    doc.setTextColor(15, 45, 78);
    doc.text("A E R I S", 105, 30, { align: "center" });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text(ENTETE, 105, 44, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text(SOUS_TITRE, 105, 49, { align: "center" });

  doc.setDrawColor(200, 200, 200);
  doc.line(14, 55, 196, 55);
}

/** Pied de page : bandeau UADB et mention de consultation. */
function dessinerPiedDePage(doc: jsPDF, pageCourante = 1): void {
  const hauteur = doc.internal.pageSize.getHeight();
  doc.setDrawColor(200, 200, 200);
  doc.line(14, hauteur - 20, 196, hauteur - 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text(
    "AERIS — Radiologie Adaptative Edge-Cloud · UADB · Master 2 Systèmes d'Information",
    105,
    hauteur - 14,
    { align: "center" },
  );
  doc.text(
    `Document généré le ${new Date().toLocaleDateString("fr-FR")} · page ${pageCourante}`,
    105,
    hauteur - 9,
    { align: "center" },
  );
}

/** Conclusion du compte rendu encadrée (ton clair distinct de la page). */
function ajouterConclusion(doc: DocAeris, label: string, raison: string): void {
  const hauteur = doc.lastAutoY ?? 160;
  doc.setFillColor(245, 248, 250);
  doc.setDrawColor(15, 45, 78);
  doc.roundedRect(14, hauteur + 8, 182, 30, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 45, 78);
  doc.text("CONCLUSION", 20, hauteur + 17);

  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  const lignesConclusion = lignes(doc, label.toUpperCase());
  doc.text(lignesConclusion, 20, hauteur + 23);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  const raisonlignes = lignes(doc, raison);
  doc.text(raisonlignes, 20, hauteur + 31);
  doc.lastAutoY = hauteur + 8 + 30;
}

/**
 * Point d'entrée partagé : télécharge immédiatement le PDF généré.
 * @param generer  rends le jsPDF rempli (après l'en-tête le cas échéant)
 * @param nomFichier  nom de téléchargement (sans extension)
 */
async function telecharger(
  construire: (doc: DocAeris, logo: string | null) => void,
  nomFichier: string,
): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" }) as DocAeris;
  const logo = await logoDataUrl();
  construire(doc, logo);
  dessinerPiedDePage(doc);
  doc.save(`${nomFichier}.pdf`);
}

/**
 * PDF clinique : compte rendu structuré du dossier courant avec la marque AERIS.
 * Utilisé par le bouton « Télécharger le PDF » de la page Résultat (clinicien).
 */
export async function genererPdfClinique(dossier: DossierResultat): Promise<void> {
  const rapport = genererCompteRendu(dossier);
  const dateExamen = new Date(dossier.horodatage).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  await telecharger((doc, logo) => {
    dessinerEnTete(doc, logo);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text("COMPTE RENDU D'ANALYSE RADIOLOGIQUE", 105, 62, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    doc.text(`Examen du ${dateExamen} · Référence du cliché : ${dossier.fichier.name}`, 105, 68, {
      align: "center",
    });

    let y = 78;
    for (const section of rapport.sections) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(15, 45, 78);
      doc.text(section.titre.toUpperCase(), 14, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(45, 45, 45);
      for (const paragraphe of section.paragraphes) {
        const paragraphelignes = lignes(doc, paragraphe);
        for (const ligne of paragraphelignes) {
          doc.text(ligne, 14, y);
          y += 5;
        }
        y += 2;
      }
      y += 3;
    }

    doc.lastAutoY = y;
    const hApres = doc.lastAutoY + 8 + 30;
    if (hApres > 270) {
      doc.addPage();
      doc.lastAutoY = 30;
    }
    ajouterConclusion(doc, rapport.conclusion, rapport.raisonConclue);
  }, `AERIS-${dossier.patient.code_patient}-compte-rendu`);
}

/**
 * PDF patient : résultats d'examen restitués après saisie de l'OTP, sans
 * aucune donnée technique de routage (document destiné au patient).
 */
export async function genererPdfPatient(donnees: ReponseAccesResultat): Promise<void> {
  const { patient, resultats } = donnees;
  const nom = patient.nom_complet ?? "Patient";

  await telecharger((doc, logo) => {
    dessinerEnTete(doc, logo);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text("RÉSULTATS DE VOS EXAMENS RADIOLOGIQUES", 105, 62, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(60, 60, 60);
    doc.text(`Bonjour ${nom} — dossier ${patient.code_patient}`, 105, 68, { align: "center" });

    let y = 80;

    if (resultats.length === 0) {
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 90);
      doc.text("Aucun compte rendu disponible pour le moment.", 14, y);
      y += 8;
    }

    for (const examen of resultats) {
      doc.setFillColor(240, 244, 248);
      doc.rect(14, y - 5, 182, 7, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(20, 20, 20);
      doc.text(examen.code_examen ?? `Examen — ${formaterDate(examen.execute_le)}`, 18, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(90, 90, 90);
      doc.text(formaterDate(examen.execute_le), 192, y, { align: "right" });
      y += 10;

      for (const r of examen.resultats ?? []) {
        const libelle = r.pathologie === "tuberculose" ? "Tuberculose (TB)" : "Pneumonie (PN)";
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(30, 30, 30);
        doc.text(libelle, 18, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        const verdict =
          r.prediction === "negatif"
            ? "Résultat : NORMAL (aucune pathologie détectée)"
            : r.prediction === "positif"
              ? "Résultat : POSITIF (pathologie suspectée)"
              : "Résultat : non concluant — relecture recommandée";
        doc.text(
          `${verdict} — confiance du modèle : ${Math.round(r.confiance * 100)} %`,
          18,
          y + 5,
        );
        y += 14;
      }
      y += 4;
    }

    doc.setFillColor(245, 248, 250);
    doc.setDrawColor(15, 45, 78);
    if (y + 20 > 270) {
      y = 30;
    }
    doc.roundedRect(14, y + 4, 182, 16, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(70, 70, 70);
    doc.text(
      "Ce compte rendu est généré automatiquement par le prototype AERIS à des fins de recherche. " +
        "En cas de question, contactez votre établissement de santé.",
      20,
      y + 11,
    );
  }, `AERIS-${patient.code_patient}-resultat`);
}
