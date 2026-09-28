/**
 * Graphiques du tableau de bord du poste.
 *
 * Quatre graphiques, quatre questions cliniques distinctes — et un principe
 * commun : **aucun graphique sous `SEUIL_EFFECTIF` examens**. Un histogramme
 * d'une ou deux barres n'apprend rien au clinicien et transforme du bruit en
 * tendance. En dessous du seuil, l'appelant affiche la liste.
 *
 * Choix de formes, et pourquoi :
 *
 * - **Aires cumulées** pour la charge et les décisions : le creux entre les
 *   deux courbes est la file en attente, lisible en thickness sans calcul.
 * - **Colonnes** pour l'activité quotidienne : une série temporelle se lit de
 *   gauche à droite, et les jours manquants doivent rester des trous. Le
 *   backend ne renvoie que les journées où un examen a été enregistré, donc
 *   on ne comble rien.
 * - **Barres horizontales** pour l'ancienneté de la file : les libellés sont
 *   des phrases (« Plus de 7 jours »), illisibles sous un axe vertical.
 * - **Barres empilées** pour les verdicts : la répartition par pathologie se
 *   compare dans la longueur, pas dans l'angle.
 *
 * Refus explicites : jauge radiale, entonnoir, **aire lissée** (`monotone`).
 * Une aire lissée invente des valeurs entre deux journées réelles ; un entonnoir
 * implique un parcours séquentiel que la file de validation n'est pas.
 *
 * Nuance sur ce dernier refus : `GraphiqueCharge` est bien une aire, mais
 * interpolée en segments droits (`type="linear"`) et percée là où la série
 * manque (`connectNulls={false}`). Un segment droit entre deux points réels ne
 * surestime rien ; ce qu'il refuse, c'est la courbe qui dessine entre eux des
 * valeurs que personne n'a mesurées. La forme « aire » n'est donc pas refusée
 * — l'interpolation lisse, si.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { JourSerie, LigneVerdict, SynthesePoste, TonPoste } from "@/lib/poste";
import {
  axeJournalier,
  dureePeriode,
  fileEnAttente,
  graphiquePossible,
  jourCourt,
  libellePathologie,
  libelleTranche,
  totalVerdits,
} from "@/lib/poste";

/**
 * Teintes des graphiques : les deux teintes de marque du poste pour le rouge
 * et le bleu, la palette de l'application pour l'ambre et les verts.
 *
 * `TEINTE.positif` et `TEINTE.neutre` valent `var(--alert)` et `var(--cloud)`,
 * surchargés à `#DB4437` et `#00b4d8` par `.poste-teinte` : les barres et les
 * cellules suivent la page sans qu'aucune teinte ne soit écrite en dur ici.
 *
 * Correspondance sémantique, et non décorative :
 *
 * | Sens clinique        | Ton       | Pourquoi                                        |
 * | -------------------- | --------- | ----------------------------------------------- |
 * | pathologie détectée  | `alert`   | le rouge de marque `#DB4437` du poste            |
 * | aucun signal         | `ok`      | le vert « sain » du tableau de bord             |
 * | second avis requis   | `warn`    | l'ambre « attention modérée »                   |
 * | file en cours        | `cloud`   | le bleu de marque `#00b4d8` du poste            |
 *
 * `--edge` est volontairement absent : son orange (`oklch(0.72 0.16 63)`) est
 * indiscernable de l'ambre `--warn` (`oklch(0.72 0.15 70)`). L'utiliser pour
 * un sens clinique créerait deux nuances indiscernables, et le lecteur
 * prendrait une localisation pour un état clinique.
 */
const TEINTE = {
  positif: "var(--alert)",
  negatif: "var(--ok)",
  indetermine: "var(--warn)",
  neutre: "var(--cloud)",
} as const;

const CATEGORIES_VERDITS = [
  { cle: "negatif" as const, libelle: "Négatif" },
  { cle: "positif" as const, libelle: "Positif" },
  { cle: "indetermine" as const, libelle: "Indéterminé" },
];

/** Cadre commun : grille discrète, axes sans bordure, texte lisible. */
const AXE = { stroke: "var(--border)", fontSize: 11 } as const;

function Cadre({ hauteur = 200, children }: { hauteur?: number; children: React.ReactElement }) {
  return (
    <div style={{ width: "100%", height: hauteur }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function Infobulle({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {label !== undefined && <p className="mb-1 font-medium text-foreground">{label}</p>}
      {payload.map((entree) => (
        <p key={entree.name} className="flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: entree.color }}
          />
          <span>
            {entree.name} :{" "}
            <span className="font-mono tabular-nums text-foreground">{entree.value}</span>
          </span>
        </p>
      ))}
    </div>
  );
}

/* ------------------- Charge et décisions ------------------- */

/**
 * La file qui s'accumule, et la part déjà tranchée.
 *
 * Deux aires cumulées sur un même axe de jours : les examens enregistrés en
 * bleu, les décisions de validation en ambre. **L'espace entre les deux
 * courbes est la file encore en attente** — il se lit en thickness, sans
 * calcul. Les deux courbes qui montent ensemble disent que le poste suit sa
 * charge ; la bleue qui s'écarte dit que la file s'épaissit.
 *
 * C'est la seule lecture du graphique qui ait une conséquence d'action, et
 * elle n'apparaît dans aucune autre tuile de la page.
 *
 * Choix de forme, et le compromis assumé :
 *
 * - **Aire, non colonnes** : ici on ne compare pas deux ou trois journées, on
 *   suit une tendance. L'aire donne le volume d'un coup à l'œil, là où la
 *   colonne d'origine demande de lire chaque barre.
 * - **Interpolation linéaire, jamais `monotone`.** Le refus d'aire lissée
 *   documenté plus bas reste entier : une courbe lissée invente des valeurs
 *   entre deux journées réelles, et c'est précisément ce qu'il ne faut pas
 *   relier. Le segment droit ne surestime ni ne minore rien.
 * - **`connectNulls={false}`** : un jour sans fait ouvre une brèche plutôt que
 *   de tirer un segment à travers. C'est ce que permet le `null` de
 *   `axeJournalier`, et la raison pour laquelle on ne comble pas la série.
 *
 * Le seuil porte sur la **somme** des deux séries : en dessous de cinq
 * examens au total, la tendance affiche du bruit.
 */
export function GraphiqueCharge({ serie }: { serie: JourSerie[] }) {
  const donnees = serie.map((jour) => ({
    ...jour,
    jour: jourCourt(jour.jour),
  }));
  const volume = donnees.reduce((acc, j) => acc + (j.examens ?? 0) + (j.decisions ?? 0), 0);
  if (!graphiquePossible(volume)) return null;

  return (
    <Cadre hauteur={240}>
      <AreaChart data={donnees} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="jour"
          tick={AXE}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis tick={AXE} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip
          content={<Infobulle />}
          cursor={{ stroke: "var(--border)" }}
          labelFormatter={(_, payload) => String(payload?.[0]?.payload?.jour ?? "")}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={22}
          iconType="plainline"
          wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
        />
        <Area
          type="linear"
          dataKey="examens"
          name="Examens enregistrés (cumul)"
          stroke={TEINTE.neutre}
          strokeWidth={2}
          fill={TEINTE.neutre}
          fillOpacity={0.18}
          connectNulls={false}
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Area
          type="linear"
          dataKey="decisions"
          name="Décisions prises (cumul)"
          stroke={TEINTE.indetermine}
          strokeWidth={2}
          fill={TEINTE.indetermine}
          fillOpacity={0.14}
          connectNulls={false}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </AreaChart>
    </Cadre>
  );
}

/**
/**
 * Les trois chiffres que le graphique ne dit pas à voix haute.
 *
 * Le cumul a fait disparaître le « pire jour » : il n'a plus de sens sur une
 * série qui ne redescend jamais. Restent donc ce qui compte en fin de période,
 * et la longueur de la période elle-même — sans elle, une file de 20 en attente
 * se lit pareil sur six jours que sur six semaines.
 */
export function LectureCharge({ serie }: { serie: JourSerie[] }) {
  const attente = fileEnAttente(serie);
  const jours = dureePeriode(serie);

  return (
    <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
      <div className="flex items-baseline gap-1.5">
        <dt className="text-muted-foreground">Encore en attente</dt>
        <dd
          className={
            attente === null
              ? "font-mono tabular-nums text-foreground"
              : `font-mono tabular-nums ${attente > 0 ? "text-warn" : "text-ok"}`
          }
        >
          {attente === null ? "—" : attente}
        </dd>
      </div>
      <div className="flex items-baseline gap-1.5">
        <dt className="text-muted-foreground">Sur la période</dt>
        <dd className="font-mono tabular-nums text-foreground">
          {jours === 0 ? "—" : `${jours} jour${jours > 1 ? "s" : ""}`}
        </dd>
      </div>
      <p className="text-xs text-muted-foreground">
        Le creux entre les deux aires est la file non tranchée à ce jour.
      </p>
    </dl>
  );
}

/* ------------------- Activité quotidienne ------------------- */

/**
 * Examens enregistrés par jour.
 *
 * Les jours sans examen restent absents de la série : un trou dit « rien ce
 * jour-là », un comblé à zéro afficherait des jours d'activité que le clinicien
 * n'a jamais vus.
 */
export function GraphiqueActivite({ activite }: { activite: SynthesePoste["activite"] }) {
  const donnees = activite.map((jour) => ({ ...jour, jour: jourCourt(jour.jour) }));
  const total = donnees.reduce((acc, j) => acc + j.examens, 0);
  if (!graphiquePossible(total)) return null;

  return (
    <Cadre>
      <BarChart data={donnees} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="jour"
          tick={AXE}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis tick={AXE} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip content={<Infobulle />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        <Bar
          dataKey="examens"
          name="Examens"
          fill={TEINTE.neutre}
          radius={[3, 3, 0, 0]}
          maxBarSize={38}
        />
      </BarChart>
    </Cadre>
  );
}

/* ------------------- Ancienneté de la file ------------------- */

/** Couleurs d'un état de la file, résolues par la surcharge de la page. */
const TEINTE_ETAT: Record<TonPoste, string> = {
  cloud: "var(--cloud)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  alert: "var(--alert)",
};

/**
 * Répartition de la file par état, en anneau.
 *
 * L'anneau occupe toute la hauteur disponible et le centre porte la file à
 * valider : le chiffre qui presse. Remplace la barre segmentée, dont la
 * largeur d'un état se lisait mal quand un autre état dominait tout l'échantillon.
 *
 * Les couleurs viennent de `TEINTE_ETAT` → les variables de `.poste-teinte` :
 * aucune teinte ne vit en dur ici. Les parts nulles sont filtrées — un anneau
 * sans segment n'a pas de valeur à porter.
 */
export function GraphiqueFile({
  statuts,
  centre,
  libelleCentre,
}: {
  statuts: { libelle: string; valeur: number; ton: TonPoste }[];
  centre: number;
  libelleCentre: string;
}) {
  const total = statuts.reduce((acc, s) => acc + s.valeur, 0);
  if (total <= 0) return null;

  const donnees = statuts
    .filter((s) => s.valeur > 0)
    .map((s) => ({ ...s, fill: TEINTE_ETAT[s.ton] }));

  return (
    <div className="relative min-h-0 flex-1">
      <ResponsiveContainer width="100%" height="100%" minHeight={190}>
        <PieChart>
          <Pie
            data={donnees}
            dataKey="valeur"
            nameKey="libelle"
            innerRadius="60%"
            outerRadius="82%"
            stroke="none"
            paddingAngle={2}
            startAngle={90}
            endAngle={-270}
          >
            {donnees.map((d) => (
              <Cell key={d.libelle} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip content={<Infobulle />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="font-mono text-2xl leading-none font-bold tabular-nums">{centre}</p>
          <p className="mt-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            {libelleCentre}
          </p>
        </div>
      </div>
    </div>
  );
}

/** File de validation répartie par ancienneté, du plus récent au plus ancien. */
export function GraphiqueAnciennete({ file }: { file: SynthesePoste["file"] }) {
  const donnees = file.anciennete.map((t) => ({ ...t, libelle: libelleTranche(t.tranche) }));
  if (!graphiquePossible(file.a_valider)) return null;

  return (
    <Cadre hauteur={Math.max(120, donnees.length * 44)}>
      <BarChart data={donnees} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--grid)" />
        <XAxis type="number" tick={AXE} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="libelle"
          tick={AXE}
          tickLine={false}
          axisLine={false}
          width={104}
        />
        <Tooltip content={<Infobulle />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        <Bar dataKey="examens" name="Examens" radius={[0, 3, 3, 0]} maxBarSize={26}>
          {donnees.map((d) => (
            <Cell
              key={d.tranche}
              fill={d.tranche === "plus_de_7_jours" ? TEINTE.positif : TEINTE.neutre}
            />
          ))}
        </Bar>
      </BarChart>
    </Cadre>
  );
}

/* ------------------- Verdicts par pathologie ------------------- */

/**
 * Répartition des verdicts portés par le dernier diagnostic de chaque examen.
 *
 * L'unité du graphique est le **verdict**, pas l'examen : un même examen peut
 * produire un verdict de tuberculose et un de pneumonie, puisque les deux
 * modèles sont interrogés. 13 examens à deux verdicts donnent donc 26 barres,
 * et c'est le dénominateur honnête. Les examens jamais analysés n'y sont pas,
 * sinon la barre représenterait un dénominateur qui n'a jamais existé.
 */
export function GraphiqueVerdicts({ lignes }: { lignes: LigneVerdict[] }) {
  const donnees = lignes.map((l) => ({ ...l, libelle: libellePathologie(l.pathologie) }));
  const total = donnees.reduce((acc, l) => acc + totalVerdits(l), 0);
  if (!graphiquePossible(total)) return null;

  return (
    <Cadre hauteur={Math.max(120, donnees.length * 56)}>
      <BarChart data={donnees} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--grid)" />
        <XAxis type="number" tick={AXE} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="libelle"
          tick={AXE}
          tickLine={false}
          axisLine={false}
          width={92}
        />
        <Tooltip content={<Infobulle />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        {CATEGORIES_VERDITS.map((categorie) => (
          <Bar
            key={categorie.cle}
            dataKey={categorie.cle}
            name={categorie.libelle}
            stackId="verdicts"
            fill={TEINTE[categorie.cle]}
            maxBarSize={26}
          />
        ))}
      </BarChart>
    </Cadre>
  );
}
