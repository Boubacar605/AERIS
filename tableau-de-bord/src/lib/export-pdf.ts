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
import {
  conclusionPatient,
  dateExamenIso,
  dernierResultat,
  formatDateFr,
  libelleVerdict,
} from "@/lib/dernier-resultat";
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

/** Découpe le texte en lignes adaptées à la largeur utile (A4 - marges). */
function lignes(doc: jsPDF, texte: string): string[] {
  return doc.splitTextToSize(texte, 182) as string[];
}

/** Marge basse avant le pied de page : on pagine au-delà. */
const HAUTEUR_MAX = 270;

/** Avance sans chevauchement : crée une vraie page si lastAutoY ne suffit pas. */
function placerOuPaginer(doc: DocAeris, besoinHauteur: number): void {
  if ((doc.lastAutoY ?? 80) + besoinHauteur > HAUTEUR_MAX) {
    doc.addPage();
    doc.lastAutoY = 32;
  }
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
 * PDF patient : compte rendu de la DERNIÈRE analyse, restitué après saisie de
 * l'OTP (document destiné au patient). Un code OTP = un seul résultat, comme
 * un établissement de santé délivre le résultat d'une consultation : un
 * examen, ses verdicts par pathologie et une conclusion clinique — aucune
 * donnée technique de routage. La pagination passe par placerOuPaginer
 * (lastAutoY + addPage) pour qu'aucun bloc ne se chevauche.
 */
export async function genererPdfPatient(donnees: ReponseAccesResultat): Promise<void> {
  const { patient, resultats } = donnees;
  const nom = patient.nom_complet ?? "Patient";
  const dernier = dernierResultat(resultats);

  await telecharger((doc, logo) => {
    dessinerEnTete(doc, logo);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text("COMPTE RENDU RADIOLOGIQUE — DERNIER RÉSULTAT", 105, 62, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(60, 60, 60);
    doc.text(`Bonjour ${nom} — dossier ${patient.code_patient}`, 105, 68, { align: "center" });

    let y = 80;
    doc.lastAutoY = y;

    doc.setFontSize(8.5);
    doc.setTextColor(110, 110, 110);
    doc.text(`Consulté le ${new Date().toLocaleDateString("fr-FR")}`, 105, y, {
      align: "center",
    });
    y += 8;
    doc.lastAutoY = y;

    if (!dernier) {
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 90);
      doc.text("Aucun compte rendu disponible pour le moment.", 14, y);
      doc.lastAutoY = y + 8;
      dessinerAvertissement(doc);
      return;
    }

    // Bandeau de l'examen analysé.
    const dateExamen = formatDateFr(dateExamenIso(dernier));
    placerOuPaginer(doc, 12);
    y = doc.lastAutoY ?? y;
    doc.setFillColor(240, 244, 248);
    doc.rect(14, y - 5, 182, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(dernier.code_examen ?? "Examen radiologique", 18, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(90, 90, 90);
    doc.text(`Examen du ${dateExamen}`, 192, y, { align: "right" });
    y += 6;
    doc.lastAutoY = y;

    if (dernier.nom_fichier) {
      doc.setFontSize(7.5);
      doc.setTextColor(120, 120, 120);
      doc.text(`Référence du cliché : ${dernier.nom_fichier}`, 18, y);
      y += 5;
      doc.lastAutoY = y;
    }

    // Verdicts par pathologie (une ligne de libellé + une ligne de résultat).
    for (const r of dernier.resultats) {
      placerOuPaginer(doc, 14);
      y = doc.lastAutoY ?? y;
      const libelle = r.pathologie === "tuberculose" ? "Tuberculose (TB)" : "Pneumonie (PN)";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(30, 30, 30);
      doc.text(libelle, 18, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(60, 60, 60);
      doc.text(
        `${libelleVerdict(r.prediction)} — confiance du modèle : ${Math.round(r.confiance * 100)} %`,
        18,
        y + 5,
      );
      y += 12;
      doc.lastAutoY = y;
    }

    // Conclusion clinique encadrée (même ton que la carte web).
    placerOuPaginer(doc, 24);
    y = doc.lastAutoY ?? y;
    doc.setFillColor(245, 248, 250);
    doc.setDrawColor(15, 45, 78);
    doc.roundedRect(14, y + 4, 182, 22, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 45, 78);
    doc.text("CONCLUSION — votre dernier résultat", 20, y + 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(45, 45, 45);
    doc.text(lignes(doc, conclusionPatient(resultats)), 20, y + 17);
    doc.lastAutoY = y + 30;

    dessinerAvertissement(doc);
  }, `AERIS-${patient.code_patient}-resultat`);
}

/** Mention légale du compte rendu patient (texte enroulé, sans débord à droite). */
function dessinerAvertissement(doc: DocAeris): void {
  placerOuPaginer(doc, 24);
  const y = doc.lastAutoY ?? 200;
  doc.setFillColor(245, 248, 250);
  doc.setDrawColor(15, 45, 78);
  doc.roundedRect(14, y + 4, 182, 22, 2, 2, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);
  doc.text(
    lignes(
      doc,
      "Ce compte rendu est généré automatiquement par le prototype AERIS à des fins de recherche. " +
        "En cas de question, contactez votre établissement de santé.",
    ),
    20,
    y + 11,
  );
  doc.lastAutoY = y + 30;
}
