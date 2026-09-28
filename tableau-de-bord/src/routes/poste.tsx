/**
 * Poste de travail — tableau de bord clinicien.
 *
 * Une page, une question : **où en est mon poste ?** Elle rassemble la file de
 * validation, l'activité, les résultats et les contrôles à venir en une seule
 * lecture, pour qu'un clinicien n'ait pas à ouvrir quatre pages avant de
 * savoir s'il peut prendre son service.
 *
 * Le langage visuel est celui du centre de contrôle administrateur
 * (`/dashboard`) : bandeau de synthèse, tuiles à icône, panneaux `Panel`,
 * `Tag` + `StatusDot`, barres de répartition en `rounded-full`, listes
 * `divide-y` en chiffres tabulaires.
 *
 * Deux teintes de marque appartiennent à cette page : le **bleu `#00b4D8`** et
 * le **rouge `#DB4437`**. Ambre et verts restent ceux de l'application.
 *
 * Elles sont injectées en surchargeant `--cloud` et `--alert` sur le seul
 * sous-arbre de la page (`.poste-teinte`, dans `styles.css`) : les utilitaires
 * existants, et les `var(--cloud)` / `var(--alert)` des graphiques, suivent
 * alors sans être dupliqués. `:root` conserve les teintes d'origine — le
 * centre de contrôle et le badge de rôle gardent leurs nuances.
 *
 * Correspondance des tons, sémantique et non décorative :
 *
 * | État clinique        | Ton     | Rappel                              |
 * | -------------------- | ------- | ----------------------------------- |
 * | pathologie détectée  | `alert` | rouge de marque `#DB4437`          |
 * | aucun signal         | `ok`    | vert « sain »                      |
 * | second avis requis   | `warn`  | ambre « attention modérée »        |
 * | file en cours        | `cloud` | bleu de marque `#00b4D8`           |
 *
 * `--edge` n'est jamais employé ici : son orange est indiscernable de l'ambre
 * `--warn`, et deux nuances que le lecteur ne peut pas séparer.
 *
 * ⚠️ Les deux hex n'ont pas la même solidité. Sur le fond clair de la
 * `#00b4d8` plafonne à **2,4:1** — sous le seuil de 3:1 — ce qui convient aux
 * aplats (points, jauges, barres) et aux libellés courts, pas à un paragraphe.
 * Sur ce rouge, « plus clair » ne veut pas dire « plus pâle » : `#DB4437` n'est
 * pas un rouge délavé. Sa teinte est passée de 357° à 5° — plus chaude, plus
 * orangée que le `--alert` d'origine — pour une clarté presque identique (54 %).
 * C'est ce déplacement de teinte qui est demandé, et non un éclaircissement.
 * Un rouge réellement éclairci (`#E2695F`, 63 % de clarté) ne bouge pas la
 * teinte et perd un point de contraste : c'est un rouge plus blanc, ce qui
 * n'est pas le but. Il tient 4,2:1, contre 4,6:1 pour le rouge d'origine.
 *
 * Unités et règles, toutes visibles à l'écran :
 *
 * 1. **L'examen est l'unité.** Les diagnostics sont rejoués à chaque analyse
 *    et par la passe de charge des scénarios (1 010 lignes pour 25 examens) :
 *    les compter comme des actes de soin afficherait un pic de 947 unités qui
 *    n'a jamais eu lieu. Les verdicts retenus sont ceux du *dernier*
 *    diagnostic de chaque examen.
 * 2. **Pas de graphique sous 5 examens.** En dessous, la page affiche la liste
 *    et l'effectif. Une barre unique n'apprend rien et donne un poids visuel
 *    au hasard.
 * 3. **Aucun pourcentage sans dénominateur.** Sans examen validé, la part
 *    affichée est « — », pas « 0 % ».
 * 4. **La base indisponible n'est pas une file vide.** L'écran d'état
 *    remplace tous les chiffres plutôt que d'afficher des zéros.
 * 5. **Aucun champ technique.** Ni destination Edge/Cloud, ni CPU, RAM ou
 *    latence : ces indicateurs restent dans Monitoring, réservé à l'admin.
 *
 * Pas de rafraîchissement automatique, comme Protocole : ces compteurs changent
 * quand un clinicien valide, donc à sa main. Un balayage automatique les
 * ferait clignoter sous les yeux de celui qui les lit.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileWarning,
  Inbox,
  RefreshCw,
  ScanLine,
  Stethoscope,
  Users,
  XCircle,
} from "lucide-react";

import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import {
  GraphiqueActivite,
  GraphiqueAnciennete,
  GraphiqueCharge,
  GraphiqueFile,
  GraphiqueVerdicts,
  LectureCharge,
} from "@/components/aeris/GraphiquesPoste";
import {
  EtatIndisponible,
  Meter,
  Panel,
  SectionChargement,
  StatusDot,
  Tag,
} from "@/components/aeris/primitives";
import { useSynthesePoste } from "@/hooks/use-api";
import { exigerRole } from "@/lib/authentification";
import { formatDateFr } from "@/lib/dernier-resultat";
import {
  axeJournalier,
  graphiquePossible,
  heuresLisible,
  libellePathologie,
  libelleStatutSuivi,
  libelleTranche,
  part,
  tranchesCoherentes,
  type JourSerie,
  type LigneVerdict,
  type SynthesePoste,
  type TonPoste,
} from "@/lib/poste";

export const Route = createFileRoute("/poste")({
  beforeLoad: () => exigerRole("clinicien"),
  component: PostePage,
  head: () => ({
    meta: [
      { title: "Poste de travail · AERIS" },
      {
        name: "description",
        content:
          "Charge du poste clinicien : file de validation, ancienneté, activité quotidienne, résultats par pathologie et contrôles à venir.",
      },
    ],
  }),
});

/* ------------------- Bandeau de synthèse (équivalent de OverviewBar) ------------------- */

function Bandeau({ items }: { items: { label: string; value: string; tone?: TonPoste }[] }) {
  return (
    <div className="panel grid grid-cols-2 divide-border sm:grid-cols-3 sm:divide-x xl:grid-cols-6">
      {items.map((i) => (
        <div key={i.label} className="px-4 py-2.5">
          <p className="label-xs">{i.label}</p>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-sm font-semibold">
            {i.tone && <StatusDot tone={i.tone} />}
            {i.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ------------------- Tuile de mesure (équivalent de MetricTile) ------------------- */

function Tuile({
  icon: Icon,
  label,
  valeur,
  unite,
  ton,
  ratio,
  children,
}: {
  icon: typeof Activity;
  label: string;
  valeur: string | number;
  unite?: string;
  ton?: TonPoste;
  ratio?: number | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="panel p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="label-xs flex items-center gap-1.5">
          <Icon className="size-3.5" />
          {label}
        </p>
        <span className="font-mono text-lg leading-none font-semibold tabular-nums">
          {valeur}
          {unite && (
            <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">{unite}</span>
          )}
        </span>
      </div>
      {ratio !== undefined && ratio !== null && (
        <Meter value={ratio} tone={ton ?? "cloud"} className="mt-2" />
      )}
      {children}
    </div>
  );
}

/**
 * Message affiché quand le graphique serait trompeur.
 *
 * Le libellé est donné au singulier et au pluriel : « 2 verdict disponible »
 * serait le genre de faute qui fait douter du reste de la page.
 */
function SousSeuil({
  effectif,
  singulier,
  pluriel,
}: {
  effectif: number;
  singulier: string;
  pluriel: string;
}) {
  return (
    <div className="grid place-items-center p-6 text-center">
      <p className="font-mono text-2xl leading-none font-semibold tabular-nums">{effectif}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{effectif > 1 ? pluriel : singulier}</p>
      <p className="mt-3 max-w-xs text-[11px] text-muted-foreground">
        Effectif trop faible pour un graphique : les valeurs affichées ci-dessus constituent
        l'information complète.
      </p>
    </div>
  );
}

/* ------------------- Blocs ------------------- */

function BlocFile({ synthese }: { synthese: SynthesePoste }) {
  const { file } = synthese;
  const total = file.total_examens;
  const statuts = [
    { valeur: file.a_valider, libelle: "à valider", ton: "cloud" as const },
    { valeur: file.valides, libelle: "validés", ton: "ok" as const },
    { valeur: file.desapproves, libelle: "désapprouvés", ton: "alert" as const },
    { valeur: file.jamais_analyses, libelle: "jamais analysés", ton: "warn" as const },
  ];

  return (
    <Panel
      title="File de validation"
      subtitle="Unité de compte : l'examen"
      actions={
        file.en_retard > 0 ? (
          <Tag tone="alert">
            <StatusDot tone="alert" /> {file.en_retard} en retard
          </Tag>
        ) : (
          <Tag tone="ok">
            <StatusDot tone="ok" /> file à jour
          </Tag>
        )
      }
      bodyClassName="flex flex-col"
    >
      {graphiquePossible(total) ? (
        <GraphiqueFile statuts={statuts} centre={file.a_valider} libelleCentre="à valider" />
      ) : (
        <SousSeuil effectif={total} singulier="examen enregistré" pluriel="examens enregistrés" />
      )}

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {statuts.map((s) => (
          <div
            key={s.libelle}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[11px]"
          >
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <span className={`size-2 shrink-0 rounded-[2px] bg-${s.ton}`} aria-hidden />
              {s.libelle}
            </dt>
            <dd className="font-mono font-semibold tabular-nums">{s.valeur}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-[11px] text-muted-foreground">
        {file.examens_analyses} examens analysés sur {file.total_examens} enregistrés. Les
        diagnostics sont rejoués à chaque analyse et par la passe de charge des scénarios : 1 010
        lignes pour 25 examens. Les compter comme des actes de soin afficherait un pic de 947 unités
        qui n'a jamais eu lieu.
      </p>
    </Panel>
  );
}

function BlocAnciennete({ synthese }: { synthese: SynthesePoste }) {
  const { file } = synthese;
  const possible = graphiquePossible(file.a_valider);
  return (
    <Panel
      title="Ancienneté de la file"
      subtitle={`${file.a_valider} examen${file.a_valider > 1 ? "s" : ""} sans décision`}
    >
      {possible ? (
        <GraphiqueAnciennete file={file} />
      ) : (
        <SousSeuil
          effectif={file.a_valider}
          singulier="examen à valider"
          pluriel="examens à valider"
        />
      )}

      {possible && (
        <ul className="mt-3 space-y-1.5">
          {file.anciennete.map((t) => (
            <li
              key={t.tranche}
              className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-[11px]"
            >
              <span className="text-muted-foreground">{libelleTranche(t.tranche)}</span>
              <span className="font-mono font-semibold tabular-nums">{t.examens}</span>
            </li>
          ))}
        </ul>
      )}

      {file.en_retard > 0 && (
        <p className="mt-4 flex items-start gap-2 text-[11px] text-alert">
          <Clock className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {file.en_retard} examen{file.en_retard > 1 ? "s" : ""} attend
            {file.en_retard > 1 ? "ent" : ""} depuis plus de {synthese.seuil_alerte_jours} jour
            {synthese.seuil_alerte_jours > 1 ? "s" : ""}. Le plus ancien a {file.age_max_jours} jour
            {file.age_max_jours > 1 ? "s" : ""}.
          </span>
        </p>
      )}

      {!tranchesCoherentes(synthese) && (
        <p className="mt-3 flex items-start gap-2 text-[11px] text-warn">
          <FileWarning className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Les tranches d'ancienneté ne retombent pas sur le total de la file. L'affichage est
            incomplet : signalez-le plutôt que de lire des chiffres incohérents.
          </span>
        </p>
      )}
    </Panel>
  );
}

function BlocActivite({ synthese }: { synthese: SynthesePoste }) {
  const total = synthese.activite.reduce((acc, j) => acc + j.examens, 0);
  const possible = graphiquePossible(total);
  return (
    <Panel
      title="Activité"
      subtitle="Examens enregistrés, par jour d'import"
      actions={
        <Tag tone={possible ? "ok" : "neutral"}>
          <StatusDot tone={possible ? "ok" : "cloud"} pulse={possible} />
          {possible ? `${total} examens` : "insuffisant"}
        </Tag>
      }
    >
      {possible ? (
        <GraphiqueActivite activite={synthese.activite} />
      ) : (
        <SousSeuil effectif={total} singulier="examen enregistré" pluriel="examens enregistrés" />
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Les journées sans examen ne sont pas affichées : un trou dit « rien ce jour-là », une barre
        à zéro inventerait de l'activité.
      </p>
    </Panel>
  );
}

function BlocVerdicts({ lignes }: { lignes: LigneVerdict[] }) {
  const total = lignes.reduce((acc, l) => acc + l.negatif + l.positif + l.indetermine, 0);
  const possible = graphiquePossible(total);
  return (
    <Panel
      title="Résultats par pathologie"
      subtitle="Verdict du dernier diagnostic de chaque examen"
      actions={<Tag tone="ok">{total} verdicts</Tag>}
    >
      {possible ? (
        <GraphiqueVerdicts lignes={lignes} />
      ) : (
        <SousSeuil effectif={total} singulier="verdict disponible" pluriel="verdits disponibles" />
      )}

      <ul className="mt-3 divide-y divide-border">
        {lignes.map((l) => {
          const sousTotal = l.negatif + l.positif + l.indetermine;
          const partIndetermine = part(l.indetermine, sousTotal);
          return (
            <li key={l.pathologie} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{libellePathologie(l.pathologie)}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {l.negatif} négatif · {l.positif} positif
                  {l.indetermine > 0 && ` · ${l.indetermine} indéterminé`}
                </p>
              </span>
              {partIndetermine !== null && partIndetermine > 0 ? (
                <Tag tone="warn">
                  <StatusDot tone="warn" /> second avis
                </Tag>
              ) : (
                <CheckCircle2 className="size-4 shrink-0 text-ok" />
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] text-muted-foreground">
        L'unité est le verdict, pas l'examen : les deux modèles sont interrogés, donc un examen peut
        produire un verdict de tuberculose et un de pneumonie. 13 examens à deux verdicts donnent 26
        verdicts, et c'est le dénominateur honnête.
      </p>
    </Panel>
  );
}

function BlocPatients({ synthese }: { synthese: SynthesePoste }) {
  const { dossiers, joignables } = synthese.patients;
  const ratio = part(joignables, dossiers);
  const orphans = dossiers - joignables;
  return (
    <Panel
      title="Jouabilité des dossiers"
      subtitle="Capacité à recevoir le code d'approbation"
      actions={
        orphans > 0 ? (
          <Tag tone="warn">
            <StatusDot tone="warn" /> {orphans} non joignable{orphans > 1 ? "s" : ""}
          </Tag>
        ) : (
          <Tag tone="ok">
            <StatusDot tone="ok" /> tous joignables
          </Tag>
        )
      }
    >
      <Tuile
        icon={Users}
        label="Dossiers"
        valeur={dossiers}
        ratio={ratio}
        ton="ok"
        unite={`· ${joignables} joignables`}
      />
      <p className="mt-3 text-[11px] text-muted-foreground">
        Un dossier sans téléphone ni e-mail ne peut pas recevoir le code d'approbation. Le compteur
        est là pour le rappeler avant la validation, pas après l'échec d'envoi.
      </p>
    </Panel>
  );
}

function BlocSuivis({ synthese }: { synthese: SynthesePoste }) {
  const { suivis } = synthese;
  return (
    <Panel
      title="Contrôles à venir"
      subtitle={`${suivis.a_venir.length} programmé${suivis.a_venir.length > 1 ? "s" : ""} · ${suivis.realises} réalisé${suivis.realises > 1 ? "s" : ""} sur ${suivis.total}`}
      actions={<Tag tone="cloud">{suivis.total} contrôles</Tag>}
    >
      {suivis.a_venir.length === 0 ? (
        <div className="grid place-items-center p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Aucun contrôle programmé. Un examen différé par un clinicien apparaît ici à la date
            qu'il a fixée.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {suivis.a_venir.map((suivi, index) => (
            <li
              key={`${suivi.code_patient}-${suivi.date_suivi ?? index}`}
              className="flex flex-wrap items-center gap-3 py-2.5"
            >
              <span className="w-32 shrink-0 font-mono text-xs font-semibold">
                {suivi.code_patient}
              </span>
              <span className="min-w-0 flex-1">
                <p className="truncate text-xs">{suivi.motif ?? "Contrôle de suivi"}</p>
              </span>
              <Tag tone="cloud">{libelleStatutSuivi(suivi.statut)}</Tag>
              <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatDateFr(suivi.date_suivi)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Charge du poste face aux décisions prises, en pleine largeur.
 *
 * La seule tuile de la page qui réponde à « le poste tient-il le rythme ? »,
 * et donc la seule dont la réponse change une action : si le bleu domine sur
 * l'ensemble de la période, la file s'allonge et il faut plus de créneaux de
 * validation ; si l'ambre domine, le poste rattrape son retard.
 *
 * Les deux séries sont en bleu de marque et en ambre `warn` — les deux tons
 * déjà porteurs d'un sens sur cette page, aucun hex écrit en dur ici.
 */
function BlocChargeEtDecisions({ serie }: { serie: JourSerie[] }) {
  return (
    <Panel
      title="Charge et décisions"
      subtitle="Ce qui entre dans la file, et ce que le poste en tranche"
    >
      {graphiquePossible(
        serie.reduce((acc, j) => acc + (j.examens ?? 0) + (j.decisions ?? 0), 0),
      ) ? (
        <>
          <GraphiqueCharge serie={serie} />
          <div className="mt-3 border-t border-border pt-3">
            <LectureCharge serie={serie} />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Moins de cinq examens et décisions confondus : une tendance n'aurait aucun sens. Le
          décompte exact reste dans les cartes ci-dessus.
        </p>
      )}
    </Panel>
  );
}

function BlocLecture() {
  const regles: [TonPoste, string, string][] = [
    [
      "cloud",
      "à valider",
      "Examen analysé sans décision tracée. C'est un état de traçabilité, pas une erreur : les examens antérieurs à la mise en place du protocole restent ainsi.",
    ],
    ["ok", "validé", "Le clinicien a arrêté le diagnostic et un code a été émis au patient."],
    [
      "alert",
      "positif",
      "Le modèle a signalé une pathologie. Une confiance élevée n'est pas une probabilité : le compte rendu reste une hypothèse à confirmer.",
    ],
    [
      "warn",
      "indéterminé",
      "Verdict ambigu : le second avis de l'autre couche a été sollicité. Un examen qui reste indéterminé appelle une relecture humaine.",
    ],
  ];
  return (
    <Panel title="Ce que ces chiffres mesurent">
      <ul className="space-y-2">
        {regles.map(([ton, cle, texte]) => (
          <li key={cle} className="flex items-start gap-2">
            <Tag tone={ton}>{cle}</Tag>
            <span className="text-xs text-muted-foreground">{texte}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
        Aucune indication de latence, de CPU ou de destination de calcul : ce tableau de bord décrit
        la charge clinique, la télémétrie reste réservée à l'administrateur.
      </p>
    </Panel>
  );
}

function BlocSuite() {
  const liens = [
    { to: "/triage", icon: ClipboardList, texte: "Traiter la file d'attente" },
    { to: "/suivi", icon: CalendarClock, texte: "Gérer les contrôles" },
    { to: "/patients", icon: Stethoscope, texte: "Ouvrir les dossiers patients" },
  ] as const;
  return (
    <Panel title="Suite" subtitle="Le détail se fait ailleurs">
      <p className="text-xs text-muted-foreground">
        Cette page sert à savoir s'il faut aller travailler, pas à y travailler. La file, les
        dossiers et les échéances ont chacun leur page.
      </p>
      <ul className="mt-4 space-y-1.5">
        {liens.map(({ to, icon: Icon, texte }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[11px] transition-colors hover:border-cloud/40 hover:bg-muted/50"
            >
              <span className="flex items-center gap-1.5">
                <Icon className="size-3.5 text-cloud" />
                {texte}
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------- Page ------------------- */

export default function PostePage() {
  const { synthese, etat, recharger } = useSynthesePoste();

  if (etat === "indisponible") {
    return (
      <AppShell>
        <PageHeader
          title="Poste de travail"
          description="Où en est la file, ce qui a été vu aujourd'hui, et ce qui attend le patient"
        />
        <main className="p-5">
          <EtatIndisponible
            message="La synthèse du poste est indisponible tant que le moteur ne répond pas. Aucun compteur n'est estimé dans ce cas : une file vide serait une conclusion fausse."
            onRetry={() => void recharger()}
          />
        </main>
      </AppShell>
    );
  }

  if (etat === "chargement" || !synthese) {
    return (
      <AppShell>
        <PageHeader
          title="Poste de travail"
          description="Où en est la file, ce qui a été vu aujourd'hui, et ce qui attend le patient"
        />
        <main className="space-y-4 p-5">
          <SectionChargement message="Lecture de la synthèse du poste…" />
        </main>
      </AppShell>
    );
  }

  const { file, validations } = synthese;

  return (
    <AppShell>
      <div className="poste-teinte">
        <PageHeader
          title="Poste de travail"
          description="Où en est la file, ce qui a été vu aujourd'hui, et ce qui attend le patient"
          right={
            <button
              type="button"
              onClick={() => void recharger()}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-foreground uppercase transition-colors hover:text-cloud"
            >
              <RefreshCw className="size-3" />
              Actualiser
            </button>
          }
        />

        <main className="space-y-4 p-5">
          <Bandeau
            items={[
              {
                label: "À valider",
                value: String(file.a_valider),
                tone: file.a_valider > 0 ? "cloud" : "ok",
              },
              {
                label: "Dont en retard",
                value: String(file.en_retard),
                tone: file.en_retard > 0 ? "alert" : "ok",
              },
              { label: "Validés", value: String(file.valides), tone: "ok" },
              {
                label: "Désapprouvés",
                value: String(file.desapproves),
                ...(file.desapproves > 0 ? { tone: "alert" as const } : {}),
              },
              {
                label: "Examens analysés",
                value: `${file.examens_analyses}/${file.total_examens}`,
              },
              { label: "Délai moyen", value: heuresLisible(validations.delai_moyen_heures) },
            ]}
          />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tuile
              icon={Inbox}
              label="À valider"
              valeur={file.a_valider}
              ton="cloud"
              ratio={part(file.a_valider, file.total_examens)}
            />
            <Tuile
              icon={Clock}
              label="Ancienneté max"
              valeur={file.age_max_jours}
              unite="j"
              ton={file.age_max_jours > synthese.seuil_alerte_jours ? "alert" : "ok"}
            />
            <Tuile
              icon={CheckCircle2}
              label="Part validée"
              valeur={
                validations.taux_validation === null
                  ? "—"
                  : `${validations.taux_validation.toFixed(1).replace(/\.0$/, "")}`
              }
              {...(validations.taux_validation === null ? {} : { unite: "%" })}
              ton={validations.taux_validation === null ? "warn" : "ok"}
              ratio={validations.taux_validation}
            />
            <Tuile
              icon={ScanLine}
              label="Jamais analysés"
              valeur={file.jamais_analyses}
              ton={file.jamais_analyses > 0 ? "warn" : "ok"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <BlocFile synthese={synthese} />
            <BlocAnciennete synthese={synthese} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <BlocActivite synthese={synthese} />
            <BlocVerdicts lignes={synthese.verdits_par_pathologie} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tuile
              icon={Users}
              label="Dossiers"
              valeur={synthese.patients.dossiers}
              ratio={part(synthese.patients.joignables, synthese.patients.dossiers)}
              ton="ok"
              unite={`· ${synthese.patients.joignables} joignables`}
            />
            <Tuile
              icon={Activity}
              label="Décisions journalisées"
              valeur={validations.decisions_journalisees}
            />
            <Tuile
              icon={CalendarClock}
              label="Contrôles à venir"
              valeur={synthese.suivis.a_venir.length}
              ton={synthese.suivis.a_venir.length > 0 ? "cloud" : "ok"}
            />
            <Tuile
              icon={Stethoscope}
              label="Verdicts enregistrés"
              valeur={synthese.verdits_par_pathologie.reduce(
                (acc, l) => acc + l.negatif + l.positif + l.indetermine,
                0,
              )}
            />
          </div>

          <BlocSuivis synthese={synthese} />

          <BlocChargeEtDecisions serie={axeJournalier(synthese)} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <BlocLecture />
            <BlocSuite />
          </div>
        </main>
      </div>
    </AppShell>
  );
}
