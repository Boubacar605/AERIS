/**
 * Règles d'affichage du tableau de bord du poste.
 *
 * Fonctions pures et sans effet de bord : une erreur de règle ici fausse un
 * chiffre de charge de travail, pas une simple mise en forme. Les garder
 * séparées de la page permet de les faire évoluer et de les tester.
 *
 * Trois garde-fous, tous inspirés de règles déjà appliquées ailleurs :
 *
 * 1. **Aucune division sans dénominateur.** Un pourcentage calculé sur
 *    zéro examen afficherait « 0 % », qui se lit comme un indicateur de
 *    performance alors que c'est l'absence de donnée. On renvoie `null`
 *    et la page affiche « — ».
 * 2. **Aucun graphique sous `SEUIL_EFFECTIF` examens.** Deux examens ne
 *    font pas une tendance : le graphique capte alors le bruit et donne
 *    un poids visuel au hasard.
 * 3. **Aucun jour absent comblé par un zéro.** L'activité renvoie les
 *    journées où un examen a été enregistré ; un jour sans examen est un trou,
 *    pas une valeur nulle.
 */

import type { SynthesePoste } from "@/lib/api";

/** Réexporté : les composants du poste consomment le contrat et ses règles. */
export type { SynthesePoste };

/**
 * Sous cet effectif, un graphique est du bruit.
 *
 * Un seuil bas plutôt que haut : afficher la liste est toujours possible et
 * toujours juste, un graphique d'une seule barre ne l'est pas.
 */
export const SEUIL_EFFECTIF = 5;

/** Une ligne de répartition des verdicts, tous pathologie confondue. */
export type LigneVerdict = SynthesePoste["verdits_par_pathologie"][number];

/**
 * Tons de la palette de l'application employés par le poste.
 *
 * Ambre et verts viennent de la palette de l'application. Le bleu et le rouge,
 * eux, sont **les teintes de marque du poste** : `.poste-teinte` surcharge
 * `--cloud` en `#00b4d8` et `--alert` en `#DB4437` sur la seule page `/poste`.
 * Ces quatre tons portent donc les mêmes noms que dans le reste de
 * l'application, sans être les mêmes teintes. La correspondance est
 * sémantique — voir la table en tête de `routes/poste.tsx`.
 *
 * `edge` en est volontairement absent : son orange (`oklch(0.72 0.16 63)`)
 * est indiscernable de l'ambre `warn` (`oklch(0.72 0.15 70)`), et
 * l'utiliser ferait lire une localisation à la place d'un état clinique.
 */
export type TonPoste = "ok" | "warn" | "alert" | "cloud";

// ── Proportions ──

/**
 * Part d'un effectif, ou `null` si l'effectif de référence est vide.
 *
 * `null` et non `0` : les deux se rendent à l'identique dans un JSON, mais
 * seul le premier permet à la page d'afficher « — » au lieu de « 0 % ».
 */
export function part(nombre: number, total: number): number | null {
  if (total <= 0) return null;
  return (nombre * 100) / total;
}

/** Durée en heures, lisible sans convertir en jours quand c'est court. */
export function heuresLisible(heures: number): string {
  if (!Number.isFinite(heures) || heures <= 0) return "—";
  if (heures < 24) return `${heures.toFixed(1).replace(".", ",")} h`;
  const jours = heures / 24;
  return `${jours.toFixed(1).replace(".", ",")} j`;
}

// ── Effectifs et graphiques ──

/** Le nombre d'examens est-il suffisant pour mériter un graphique ? */
export function graphiquePossible(effectif: number): boolean {
  return effectif >= SEUIL_EFFECTIF;
}

/** Total des verdicts d'une pathologie, toutes catégories confondues. */
export function totalVerdits(ligne: LigneVerdict): number {
  return ligne.negatif + ligne.positif + ligne.indetermine;
}

// ── Libellés ──

/** Libellé humain d'une tranche d'ancienneté, la clé étant technique. */
export function libelleTranche(tranche: string): string {
  switch (tranche) {
    case "aujourd_hui":
      return "Aujourd'hui";
    case "1_jour":
      return "Hier";
    case "2_a_6_jours":
      return "2 à 6 jours";
    case "plus_de_7_jours":
      return "Plus de 7 jours";
    default:
      return tranche;
  }
}

/** Libellé d'un statut de suivi, la valeur venant de la base. */
export function libelleStatutSuivi(statut: string): string {
  switch (statut) {
    case "planifie":
      return "À venir";
    case "realise":
      return "Réalisé";
    case "annule":
      return "Annulé";
    default:
      return statut;
  }
}

/** Pathologie en toutes lettres : la base stocke un identifiant technique. */
export function libellePathologie(pathologie: string): string {
  return pathologie === "tuberculose" ? "Tuberculose" : "Pneumonie";
}

/** Jour d'activité en format court ; la valeur brute si la date est illisible. */
export function jourCourt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

// ── Cohérence de la synthèse ──

// ── Axe journalier commun ──

/** Une journée de l'axe, les deux séries étant cumulées. */
export type JourSerie = {
  jour: string;
  /** Cumul des examens enregistrés jusqu'à ce jour, `null` si aucun point. */
  examens: number | null;
  /** Cumul des décisions de validation jusqu'à ce jour, `null` si aucun point. */
  decisions: number | null;
};

/**
 * Les deux séries journalières, fusionnées sur un axe continu et cumulées.
 *
 * Les séries n'ont pas la même empreinte : un jour peut voir un examen
 * enregistré et aucune décision, et c'est même le cas courant. Aligner les
 * deux sur une grille de jours commune est donc la seule façon de les
 * comparer.
 *
 * **Pourquoi cumuler plutôt que montrer le flux du jour.** En flux brut, les
 * deux séries se déplacent en sens opposé selon la période — les examens
 * d'avant l'installation du protocole, les décisions d'après — et il arrive
 * qu'aucun jour ne porte les deux. L'aire affiche alors deux blocs séparés
 * par une brèche, et l'écart « ce qui arrive moins ce qui est tranché »
 * n'est calculable sur aucun jour : la page répond « — » à sa propre question.
 * Le cumul supprime ce blocage sans rien inventer : chaque point reste la
 * somme de faits réellement enregistrés jusqu'à ce jour.
 *
 * Ce que le cumul rend lisible : la courbe bleue est la file totale qui est
 * entrée, la courbe ambre la part qui en a été tranchée. L'espace entre les
 * deux n'est donc pas une amplitude décorative, c'est **la file encore en
 * attente**, lue directement en thickness. Si les deux courbes montent
 * ensemble, le poste suit ; si la bleue décroche, la file s'épaissit.
 *
 * Un jour sans fait n'est pas une valeur nulle mais une absence : il n'ajoute
 * rien au cumul et n'apparaît pas comme un point. Le `null` qui suit le jour
 * sert à l'infobulle, qui doit distinguer « rien ce jour-là » de « rien de
 * nouveau depuis le début de la période ».
 */
export function axeJournalier(synthese: SynthesePoste): JourSerie[] {
  const jours = new Set<string>();
  for (const l of synthese.activite) jours.add(l.jour);
  for (const l of synthese.decisions_par_jour) jours.add(l.jour);
  if (jours.size === 0) return [];

  const parJourExamens = new Map(synthese.activite.map((l) => [l.jour, l.examens]));
  const parJourDecisions = new Map(synthese.decisions_par_jour.map((l) => [l.jour, l.decisions]));

  let cumulExamens = 0;
  let cumulDecisions = 0;

  return [...jours]
    .sort((a, b) => a.localeCompare(b))
    .map((jour) => {
      const examens = parJourExamens.get(jour) ?? null;
      const decisions = parJourDecisions.get(jour) ?? null;
      cumulExamens += examens ?? 0;
      cumulDecisions += decisions ?? 0;
      return { jour, examens: cumulExamens, decisions: cumulDecisions };
    });
}

/**
 * File en attente au dernier point du cumul.
 *
 * Cumuls étant croissants, l'écart final est la file qui n'a pas encore été
 * tranchée. `null` si une des deux séries n'a jamais eu de point.
 */
export function fileEnAttente(serie: JourSerie[]): number | null {
  const dernier = serie[serie.length - 1];
  if (!dernier) return null;
  if (dernier.examens === null || dernier.decisions === null) return null;
  return dernier.examens - dernier.decisions;
}

/** Nombre de jours de la période couverte, borne haute incluse. */
export function dureePeriode(serie: JourSerie[]): number {
  return serie.length;
}

/**
 * Les parts de la file doivent retomber sur le total des examens.
 *
 * Servi de garde-fou à l'affichage : un écart signifierait que le backend a
 * modifié ses règles sans que le front le suive, et afficher des tranches
 * dont la somme ne correspond pas au total donnerait un doute légitime au
 * clinicien sur la fiabilité du reste de la page.
 */
export function tranchesCoherentes(synthese: SynthesePoste): boolean {
  const somme = synthese.file.anciennete.reduce((acc, t) => acc + t.examens, 0);
  return somme === synthese.file.a_valider;
}
