/**
 * Export PDF avec la marque AERIS (logo + bandeau UADB).
 *
 * Deux générateurs :
 * - genererPdfClinique : le clinicien télécharge le compte rendu du dossier
 *   courant (page Résultat) ;
 * - genererPdfPatient   : le patient télécharge son résultat après validation
 *   de l'OTP — format « compte rendu médical » lisible, sans donnée technique.
 *
 * Le logo est chargé en DataURL depuis l'asset public (même origine, pas de
 * CORS) ; en cas d'échec le PDF demeure valable avec l'en-tête textuel.
 */

import { jsPDF } from "jspdf";
import type { ReponseAccesResultat, ResultatOtp } from "@/lib/api";
import { genererCompteRendu } from "@/lib/compte-rendu";
import {
  afficherNomPatient,
  conclusionPatient,
  dateExamenIso,
  dernierResultat,
  estPositif,
  explicationVerdict,
  formatDateFr,
  statutVerdict,
  DISCLAIMER_PATIENT,
} from "@/lib/dernier-resultat";
import type { DossierResultat } from "@/lib/resultat-store";

// ── Palette PDF (RGB, indépendante du thème web) ──
const NAVY = [15, 45, 78] as const;
const TEAL = [0, 128, 128] as const;
const GRIS_FOND = [240, 244, 248] as const;
const GRIS_TEXTE = [60, 60, 60] as const;
const GRIS_MUET = [110, 110, 110] as const;
const GRIS_LEGER = [200, 200, 200] as const;
const NOIR = [20, 20, 20] as const;

const ENTETE = "AERIS — RADIOLOGIE ADAPTATIVE EDGE-CLOUD";
const SOUS_TITRE = "Université Alioune Diop de Bambey (UADB) · Master 2 Systèmes d'Information";
const SOUS_TITRE_PATIENT =
  "Université Alioune Diop de Bambey (UADB) · Master 2 Systèmes d'Information · Prototype de recherche";

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

/** Typographie étendue que les polices standard savent écrire en un octet. */
const TYPOGRAPHIE_WINANSI = "’‘“”–—…•«»°€™®©";

/** Substitutions lisibles pour les symboles absents de la table WinAnsi. */
const EQUIVALENTS_PDF: Record<string, string> = {
  "⚕": "•",
  "→": "->",
  "←": "<-",
  "─": "-",
  "━": "-",
  "✓": "oui",
  "✗": "non",
  "≠": "!=",
  "≥": ">=",
  "≤": "<=",
};

/**
 * Restreint un texte à ce que les polices standard jsPDF savent écrire.
 *
 * Les polices `/F1`… sont déclarées `/WinAnsiEncoding` **mono-octet**. Dès qu'une
 * chaîne contient un caractère absent de la table WinAnsi (⚕ U+2695, → U+2192),
 * jsPDF écrit la ligne entière en UTF-16BE. LibreOffice ignore alors les octets
 * NUL et rend la ligne correctement, mais PDFium (Firefox) applique une police de
 * substitution plus large : le texte, mesuré sur la chaîne d'origine, déborde de
 * sa boîte. On assainit donc **avant** de mesurer.
 */
function assainirPdf(texte: string): string {
  return texte.replace(/[\s\S]/gu, (caractere) => {
    if (/^[\x20-\x7e\xa0-\xff]$/.test(caractere)) return caractere;
    if (TYPOGRAPHIE_WINANSI.includes(caractere)) return caractere;
    return EQUIVALENTS_PDF[caractere] ?? "?";
  });
}

/**
 * Découpe le texte en lignes adaptées à la largeur utile (A4 - marges).
 *
 * Les sauts de ligne sont traités ici : `splitTextToSize` ne les gère pas et
 * convertit chaque `\n` en « ? » littéral (« diagnostic.??RECOMMANDATION : … »).
 * Chaque paragraphe est donc découpé séparément, les lignes vides étant conservées
 * comme interligne. L'assainissement intervient après la découpe, sinon il
 * remplacerait lui-même les `\n` par « ? ».
 */
function lignes(doc: jsPDF, texte: string, largeur = 182): string[] {
  const sortie: string[] = [];
  for (const paragraphe of texte.split(/\r?\n/)) {
    if (paragraphe.trim() === "") {
      sortie.push("");
      continue;
    }
    sortie.push(...(doc.splitTextToSize(assainirPdf(paragraphe), largeur) as string[]));
  }
  return sortie;
}

/**
 * Découpe un texte à la taille où il sera réellement dessiné.
 *
 * `splitTextToSize` mesure avec la police **active**. Si l'on découpe avant
 * d'avoir appelé `setFontSize`, on mesure en 9 pt puis on dessine en 11 pt :
 * les lignes débordent alors de la boîte (xMax > 210 mm) et le PDF est
 * tronqué au bord de la page. Cette fonction verrouille la taille de police
 * pour la mesure, et l'appelant réutilise la même constante au rendu.
 */
function decouperCorps(doc: jsPDF, texte: string, largeur: number, taille: number): string[] {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(taille);
  return lignes(doc, texte, largeur);
}

/** Marge basse avant le pied de page : on pagine au-delà. */
const HAUTEUR_MAX = 270;

/**
 * Vérifie qu'un bloc de `besoinHauteur` mm tient sous la hauteur maximale.
 * Si ce n'est pas le cas, ouvre une page neuve et réinitialise `lastAutoY` à 32.
 * Renvoie toujours la position Y de départ pour le bloc (soit la position
 * actuelle, soit celle de la nouvelle page).
 */
function placerOuPaginer(doc: DocAeris, besoinHauteur: number): number {
  const y = doc.lastAutoY ?? 80;
  if (y + besoinHauteur > HAUTEUR_MAX) {
    doc.addPage();
    doc.lastAutoY = 32;
    return 32;
  }
  return y;
}

// ── En-têtes et pieds de page ──

/** En-tête A4 clinique : logo, bandeau institutionnel et filet gris. */
function dessinerEnTete(doc: jsPDF, logo: string | null): void {
  doc.setFillColor(...NAVY);
  doc.rect(14, 14, 182, 3, "F");

  if (logo) {
    doc.addImage(logo, "PNG", 85, 21, 40, 18);
  } else {
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text("A E R I S", 105, 30, { align: "center" });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NOIR);
  doc.text(ENTETE, 105, 44, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS_MUET);
  doc.text(SOUS_TITRE, 105, 49, { align: "center" });

  doc.setDrawColor(...GRIS_LEGER);
  doc.line(14, 55, 196, 55);
}

/** En-tête A4 patient : titre « COMPTE RENDU D'EXAMEN RADIOLOGIQUE », filet teal. */
function dessinerEnTetePatient(doc: jsPDF, logo: string | null): void {
  doc.setFillColor(...NAVY);
  doc.rect(14, 14, 182, 3, "F");

  if (logo) {
    doc.addImage(logo, "PNG", 85, 21, 40, 18);
  } else {
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text("A E R I S", 105, 30, { align: "center" });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...NOIR);
  doc.text("COMPTE RENDU D’EXAMEN RADIOLOGIQUE", 105, 44, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS_MUET);
  doc.text(SOUS_TITRE_PATIENT, 105, 49.5, { align: "center" });

  // Filet teal (pas gris comme la version clinique)
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.4);
  doc.line(14, 55, 196, 55);
  doc.setLineWidth(0.2);
}

/** Pied de page clinique : centré, simple. */
function dessinerPiedDePage(doc: jsPDF, _pageCourante = 1): void {
  const hauteur = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...GRIS_LEGER);
  doc.setLineWidth(0.2);
  doc.line(14, hauteur - 20, 196, hauteur - 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS_MUET);
  doc.text(
    "AERIS — Radiologie Adaptative Edge-Cloud · UADB · Master 2 Systèmes d'Information",
    105,
    hauteur - 14,
    { align: "center" },
  );
  doc.text(
    `Document généré le ${new Date().toLocaleDateString("fr-FR")} · page ${_pageCourante}`,
    105,
    hauteur - 9,
    { align: "center" },
  );
}

/**
 * Pied de page patient : filet teal + 2 lignes.
 *
 * Les trois mentions (brand, confidentialité, date+page) ne tiennent pas sur
 * une seule ligne à 8 pt : le bloc de gauche (66,8 mm depuis x=14) et le bloc
 * centré (64,4 mm centré sur x=105) se chevauchaient de 8 mm. La marque et la
 * date passent donc en ligne 1 (extrémités opposées, aucun recouvrement), la
 * mention de confidentialité en ligne 2 centrée.
 */
function dessinerPiedDePagePatient(doc: jsPDF, _pageCourante = 1): void {
  const hauteur = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.3);
  doc.line(14, hauteur - 22, 196, hauteur - 22);
  doc.setLineWidth(0.2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS_MUET);

  // Ligne 1 : brand à gauche, date + page à droite.
  doc.text(assainirPdf("AERIS · Prototype de recherche · UADB · Master 2 SI"), 14, hauteur - 15.5);
  doc.text(
    assainirPdf(`Généré le ${new Date().toLocaleDateString("fr-FR")} · Page ${_pageCourante}`),
    196,
    hauteur - 15.5,
    { align: "right" },
  );
  // Ligne 2 : confidentialité, centrée.
  doc.text(assainirPdf("Document confidentiel — usage patient uniquement"), 105, hauteur - 9, {
    align: "center",
  });
}

// ── Boîtes / sections ──

/** Conclusion clinique encadrée (ton clair distinct de la page). — version clinique. */
function ajouterConclusion(doc: DocAeris, label: string, raison: string): void {
  const largeurCorps = 170;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const lignesLabel = lignes(doc, label.toUpperCase(), largeurCorps);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const lignesRaison = lignes(doc, raison, largeurCorps);

  // La boîte s'agrandit si la raison tient sur plusieurs lignes.
  const hauteurBoite = Math.max(30, 26 + (lignesRaison.length - 1) * 4);
  const haut = placerOuPaginer(doc, hauteurBoite + 8) + 8;

  doc.setFillColor(...GRIS_FOND);
  doc.setDrawColor(...NAVY);
  doc.roundedRect(14, haut, 182, hauteurBoite, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text("CONCLUSION", 20, haut + 9);

  doc.setFontSize(12);
  doc.setTextColor(...NOIR);
  doc.text(lignesLabel, 20, haut + 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  doc.text(lignesRaison, 20, haut + 23);
  doc.lastAutoY = haut + hauteurBoite + 4;
}

/**
 * Boîte conclusion patient — fond très léger, sans bande latérale.
 * Hauteur adaptative selon le contenu.
 */
function boiteConclusionPatient(doc: DocAeris, titre: string, corps: string): void {
  const largeurCorps = 170; // largeur utile dans la boîte
  const tailleCorps = 10;
  const lignesCorps = decouperCorps(doc, corps, largeurCorps, tailleCorps);
  const hauteurTexte = lignesCorps.length * 4.2;
  const hauteurBoite = Math.max(22, 10 + hauteurTexte + 6);

  placerOuPaginer(doc, hauteurBoite + 4);
  const y = (doc.lastAutoY ?? 80) + 4;

  doc.setFillColor(235, 248, 248);
  doc.rect(14, y, 182, hauteurBoite, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TEAL);
  doc.text(titre, 20, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(tailleCorps);
  doc.setTextColor(...GRIS_TEXTE);
  for (let i = 0; i < lignesCorps.length; i++) {
    doc.text(lignesCorps[i] ?? "", 20, y + 14 + i * 4.2);
  }

  doc.lastAutoY = y + hauteurBoite + 4;
}

/**
 * Boîte recommandation (uniquement si résultat positif) — fond ambre très léger,
 * sans bande latérale.
 */
function boiteRecommandation(doc: DocAeris, corps: string): void {
  const largeurCorps = 170;
  const tailleCorps = 10;
  const lignesCorps = decouperCorps(doc, corps, largeurCorps, tailleCorps);
  const hauteurTexte = lignesCorps.length * 4.2;
  const hauteurBoite = Math.max(18, 10 + hauteurTexte + 6);

  placerOuPaginer(doc, hauteurBoite + 4);
  const y = (doc.lastAutoY ?? 80) + 4;

  doc.setFillColor(255, 248, 235);
  doc.rect(14, y, 182, hauteurBoite, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(160, 100, 0);
  doc.text("Recommandation", 20, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(tailleCorps);
  doc.setTextColor(...GRIS_TEXTE);
  for (let i = 0; i < lignesCorps.length; i++) {
    doc.text(lignesCorps[i] ?? "", 20, y + 14 + i * 4.2);
  }

  doc.lastAutoY = y + hauteurBoite + 4;
}

/**
 * Boîte disclaimer / avertissement — fond gris, texte petite taille.
 * Utilisée par la version clinique (ancienne) et la version patient.
 */
function dessinerAvertissement(doc: DocAeris, texte: string, estPatient: boolean = false): void {
  const largeurCorps = 170;
  let tailleCorps = 8.5;
  let interligne = 3.4;
  let lignesCorps = decouperCorps(doc, texte, largeurCorps, tailleCorps);
  let hauteurBoite = 9 + lignesCorps.length * interligne + 5;

  let y: number;
  if (estPatient) {
    // Calée en bas de page tant que le contenu la laisse disponible.
    y = Math.max(255 - hauteurBoite, (doc.lastAutoY ?? 80) + 4);
    // Le compte rendu patient doit tenir sur une page : si la hauteur naturelle
    // ne rentre pas, le texte est légèrement réduit plutôt que renvoyé à la page 2.
    if (y + hauteurBoite > 275 && tailleCorps > 7) {
      tailleCorps = 7.5;
      interligne = 3;
      lignesCorps = decouperCorps(doc, texte, largeurCorps, tailleCorps);
      hauteurBoite = 8 + lignesCorps.length * interligne + 4;
    }
    if (y + hauteurBoite > 275) {
      placerOuPaginer(doc, hauteurBoite + 4);
      y = (doc.lastAutoY ?? 80) + 4;
    }
  } else {
    placerOuPaginer(doc, hauteurBoite + 4);
    y = (doc.lastAutoY ?? 200) + 4;
  }

  doc.setFillColor(...GRIS_FOND);
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.2);
  doc.rect(14, y, 182, hauteurBoite, "FD");

  doc.setDrawColor(...GRIS_LEGER);
  doc.setLineWidth(0.2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(tailleCorps);
  doc.setTextColor(71, 85, 105); // #475569
  for (let i = 0; i < lignesCorps.length; i++) {
    doc.text(lignesCorps[i] ?? "", 20, y + 7 + i * interligne);
  }

  doc.lastAutoY = y + hauteurBoite + 4;
}

// ── Téléchargement ──

/**
 * Point d'entrée partagé : télécharge immédiatement le PDF généré.
 * @param construire  rends le jsPDF rempli (après l'en-tête le cas échéant)
 * @param nomFichier  nom de téléchargement (sans extension)
 */
/**
 * iOS et iPadOS ignorent silencieusement `doc.save()` : le clic sur l'ancre de
 * téléchargement n'aboutit à aucun fichier. Seul l'ouverture du PDF dans un
 * onglet fonctionne — le patient y enregistre ou partage ensuite le document.
 * iPadOS 13+ se présente comme un Mac tactile, d'où la seconde condition.
 */
export function estIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

/**
 * Ouvre le PDF généré.
 *
 * Sur iOS, l'onglet est ouvert **avant** tout `await` : c'est le seul moment
 * où le navigateur accepte d'ouvrir un onglet pour l'action de l'utilisateur.
 * Une attente au préalable (chargement du logo) ferait perdre ce contexte et le
 * téléchargement échouerait à nouveau.
 *
 * Sur les autres plateformes, téléchargement direct via une ancre insérée au
 * DOM puis retirée : les navigateurs mobiles exigeant l'ancre dans l'arbre,
 * `doc.save()` n'est pas fiable partout non plus.
 */
async function telecharger(
  construire: (doc: DocAeris, logo: string | null) => void,
  nomFichier: string,
): Promise<void> {
  const fenetreIOS = estIOS() ? window.open("", "_blank") : null;

  try {
    const doc = new jsPDF({ unit: "mm", format: "a4" }) as DocAeris;
    const logo = await logoDataUrl();
    construire(doc, logo);

    // jsPDF déclare `output("bloburl")` comme renvoyant une `URL`, mais
    // l'implémentation retourne `URL.createObjectURL(...)`, c'est-à-dire une
    // chaîne. Lire `.href` dessus donnait `undefined` et l'ancre pointait alors
    // sur `/undefined` : le clic sur « Télécharger » renvoyait un 404.
    const sortie = doc.output("bloburl") as string | URL;
    const lienPdf = typeof sortie === "string" ? sortie : sortie?.href;
    if (!lienPdf) {
      throw new Error("enregistrement du PDF impossible sur ce navigateur");
    }

    if (fenetreIOS) {
      fenetreIOS.location.replace(lienPdf);
      return;
    }

    const ancre = document.createElement("a");
    ancre.download = `${nomFichier}.pdf`;
    ancre.href = lienPdf;
    ancre.style.display = "none";
    document.body.appendChild(ancre);
    ancre.click();
    document.body.removeChild(ancre);
    // Libération différée : une révocation immédiate annule le téléchargement
    // dans plusieurs navigateurs.
    window.setTimeout(() => URL.revokeObjectURL(lienPdf), 30_000);
  } catch (erreur) {
    fenetreIOS?.close();
    throw erreur;
  }
}

// ── Générateurs ──

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
    doc.setTextColor(...NOIR);
    doc.text("COMPTE RENDU D'ANALYSE RADIOLOGIQUE", 105, 62, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...GRIS_TEXTE);
    doc.text(decouperCorps(doc, `Examen du ${dateExamen}`, 182, 10), 105, 68, { align: "center" });

    // Le nom du fichier peut être long : on le découpe au lieu de le centrer
    // sur une seule ligne, ce qui le ferait déborder des deux côtés de la page.
    const lignesReference = decouperCorps(
      doc,
      `Référence du cliché : ${dossier.fichier.name}`,
      182,
      10,
    );
    let y = 68;
    for (const ligne of lignesReference) {
      y += 4.5;
      doc.text(ligne, 105, y, { align: "center" });
    }
    y += 6;
    /** Synchronise le curseur puis place le bloc suivant, en paginant si besoin. */
    const placer = (besoinHauteur: number): number => {
      doc.lastAutoY = y;
      y = placerOuPaginer(doc, besoinHauteur);
      return y;
    };

    for (const section of rapport.sections) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...NAVY);
      doc.text(assainirPdf(section.titre.toUpperCase()), 14, placer(12));

      // `placer` se contente de renvoyer l'ordonnée courante (ou de paginer) :
      // sans cette avance, la première ligne de corps était écrite sur la
      // même ligne de base que le titre, et les deux se superposaient.
      y += 6;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(45, 45, 45);
      for (const paragraphe of section.paragraphes) {
        const paragraphelignes = decouperCorps(doc, paragraphe, 182, 9.5);
        placer(paragraphelignes.length * 5 + 2);
        for (const ligne of paragraphelignes) {
          doc.text(ligne, 14, y);
          y += 5;
        }
        y += 2;
      }
      y += 3;
    }

    doc.lastAutoY = y;
    ajouterConclusion(doc, rapport.conclusion, rapport.raisonConclue);

    const nbPages = doc.getNumberOfPages();
    for (let i = 1; i <= nbPages; i++) {
      doc.setPage(i);
      dessinerPiedDePage(doc, i);
    }
  }, `AERIS-${dossier.patient.code_patient}-compte-rendu`);
}

/**
 * PDF patient : compte rendu de la DERNIÈRE analyse, format « document médical »
 * lisible par un patient sans formation technique. Un code OTP = un seul résultat.
 *
 * Structure :
 *   en-tête AERIS → infos patient (2 colonnes) → OTP + lien →
 *   résultats par pathologie → conclusion → recommandation (si positif) →
 *   disclaimer → pied de page professionnel.
 */
export async function genererPdfPatient(
  donnees: ReponseAccesResultat,
  opts?: { otp?: string; lien?: string },
): Promise<void> {
  const { patient, resultats } = donnees;
  const dernier = dernierResultat(resultats);
  const prenom = afficherNomPatient(patient.nom_complet);
  const dateConsultation = formatDateFr(new Date().toISOString());
  const positif = estPositif(resultats);

  await telecharger((doc, logo) => {
    // ── En-tête ──
    dessinerEnTetePatient(doc, logo);

    // ── Bloc informations patient (fond gris, 2 colonnes) ──
    let y = 60;
    doc.setFillColor(...GRIS_FOND);
    doc.roundedRect(14, y, 182, 27, 2, 2, "F");

    const colGauche = 20;
    const colDroite = 115;
    const ly = y + 9;

    // Colonne gauche
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...NAVY);
    doc.text("Nom du patient :", colGauche, ly);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...NOIR);
    // Le nom reste dans sa colonne (63 mm) : au-delà il chevauchait la
    // colonne de droite.
    const lignesPrenom = decouperCorps(doc, prenom, 63, 9);
    for (let i = 0; i < lignesPrenom.length; i++) {
      doc.text(lignesPrenom[i] ?? "", colGauche + 32, ly + i * 4.5);
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("Dossier :", colGauche, ly + 6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...NOIR);
    doc.text(assainirPdf(patient.code_patient), colGauche + 22, ly + 6);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("Date de consultation :", colGauche, ly + 12);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...NOIR);
    doc.text(assainirPdf(dateConsultation), colGauche + 40, ly + 12);

    // Colonne droite
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("Référence examen :", colDroite, ly);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...NOIR);
    doc.text(assainirPdf(dernier?.code_examen ?? "—"), colDroite + 35, ly);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("Date de génération :", colDroite, ly + 6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...NOIR);
    doc.text(assainirPdf(new Date().toLocaleDateString("fr-FR")), colDroite + 36, ly + 6);

    doc.lastAutoY = y + 31 + (lignesPrenom.length > 1 ? 4.5 : 0);

    // ── Informations OTP + lien direct ──
    if (opts?.otp || opts?.lien) {
      placerOuPaginer(doc, 10);
      y = (doc.lastAutoY ?? 70) + 2;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...GRIS_MUET);
      const partsOtp: string[] = [];
      if (opts.otp)
        partsOtp.push(`Code de consultation : ${opts.otp} · valable sans limite de temps`);
      if (opts.lien) partsOtp.push(`Lien direct : ${opts.lien}`);
      doc.text(assainirPdf(partsOtp.join("  ·  ")), 105, y, { align: "center" });
      doc.lastAutoY = y + 4;
    }

    // ── Section « Résultats de l'analyse radiologique » ──
    placerOuPaginer(doc, 20);
    y = (doc.lastAutoY ?? 80) + 4;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text("Résultats de l'analyse radiologique", 14, y);
    y += 3;

    // Séparateur teal
    doc.setDrawColor(...TEAL);
    doc.setLineWidth(0.4);
    doc.line(14, y, 196, y);
    doc.setLineWidth(0.2);
    y += 7;
    doc.lastAutoY = y;

    if (!dernier || dernier.resultats.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(...GRIS_MUET);
      doc.text("Aucun résultat d'analyse disponible pour ce cliché.", 14, y);
      doc.lastAutoY = y + 8;
    } else {
      // Tableau des résultats
      for (const r of dernier.resultats) {
        const nom = r.pathologie === "tuberculose" ? "Tuberculose pulmonaire" : "Pneumonie";
        const statut = statutVerdict(r.prediction);
        const interpretation = explicationVerdict(r.prediction, r.pathologie);
        const interpLignes = decouperCorps(doc, interpretation, 172, 8.5);

        // Hauteur totale du bloc (fond + titre + statut + interprétation)
        const hauteurBloc = 15 + interpLignes.length * 3.6 + 4;

        // On obtient la position Y valide pour ce bloc
        const y = placerOuPaginer(doc, hauteurBloc);

        // Ligne résultat avec fond
        doc.setFillColor(248, 250, 252);
        doc.rect(14, y, 182, 15 + interpLignes.length * 3.6, "F");

        // Dessin du contenu
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...NOIR);
        doc.text(nom, 18, y + 6);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        if (r.prediction === "negatif") {
          doc.setTextColor(...TEAL);
        } else if (r.prediction === "positif") {
          doc.setTextColor(180, 120, 0);
        } else {
          doc.setTextColor(...GRIS_MUET);
        }
        doc.text(statut, 80, y + 6);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...GRIS_TEXTE);
        for (let j = 0; j < interpLignes.length; j++) {
          doc.text(interpLignes[j] ?? "", 18, y + 11 + j * 3.6);
        }

        // Mise à jour du curseur pour le prochain bloc
        doc.lastAutoY = y + 15 + interpLignes.length * 3.6 + 2;
      }
    }

    // ── Conclusion ──
    doc.lastAutoY = (doc.lastAutoY ?? y) + 4;
    boiteConclusionPatient(doc, "Conclusion", conclusionPatient(resultats));

    // ── Recommandation (uniquement si positif) ──
    if (positif) {
      boiteRecommandation(
        doc,
        "Ce résultat doit être présenté à un médecin qualifié. Rendez-vous dans votre centre de santé avec ce document.",
      );
    }

    // ── Disclaimer recherche ──
    dessinerAvertissement(
      doc,
      DISCLAIMER_PATIENT,
      true, // estPatient
    );

    // ── Pied de page patient ──
    const nbPages = doc.getNumberOfPages();
    for (let i = 1; i <= nbPages; i++) {
      doc.setPage(i);
      dessinerPiedDePagePatient(doc, i);
    }
  }, `AERIS-${patient.code_patient}-resultat`);
}
