/**
 * SyntheseClinique — Croise les résultats TB et PN pour produire un
 * verdict clinique unifié. Affiche la matrice de décision, la raison
 * du verdict, et met en évidence la cross-réactivité entre modèles.
 *
 * Principe : les modèles TB et PN sont des spécialistes indépendants
 * (binaires normal/pathologie) qui ne connaissent pas le domaine de
 * l'autre. Leur silence n'est jamais contradictoire — en revanche, une
 * lecture TB « normal » hautement confiante s'oppose frontalement à une
 * détection PN. On arbitre alors au modèle le plus confiant, en
 * signalant explicitement le désaccord.
 */

import { ArrowUpRight, BadgeCheck, Cross, Info, ScanLine, ShieldAlert } from "lucide-react";
import { Meter, StatusDot, Tag } from "./primitives";
import { cn } from "@/lib/utils";
import { formatConfiance } from "@/lib/format";
import type { ResultatDiagnostic } from "@/lib/api";

type Verdict = {
  pathologie: string;
  label: string;
  prediction: string;
  confiance: number;
  raison: string;
  /** Vrai si les deux modèles se contredisent sur l'axe normal / pathologie. */
  conflit?: boolean;
  tbContrib: ResultatDiagnostic;
  pnContrib: ResultatDiagnostic;
};

export const SEUIL_INDETERMINE = 0.6;
export const SEUIL_NORMAL_CONFIANT = 0.75;

export function croiserResultats(tb: ResultatDiagnostic, pn: ResultatDiagnostic): Verdict {
  const tbPos = tb.prediction === "positif";
  const pnPos = pn.prediction === "positif";

  // ─── Les deux positifs : le plus confiant l'emporte, l'autre est cross-réactif ───
  if (tbPos && pnPos) {
    const principale = tb.confiance >= pn.confiance ? tb : pn;
    const pathologie = principale === tb ? "tuberculose" : "pneumonie";
    const sigle = pathologie === "tuberculose" ? "TB" : "PN";
    const adversaire = pathologie === "tuberculose" ? "PN" : "TB";
    if (principale.confiance < SEUIL_INDETERMINE) {
      return {
        pathologie: "aucune",
        label: "RELECTURE REQUISE",
        prediction: "indetermine",
        confiance: Math.max(tb.confiance, pn.confiance),
        raison:
          "Les deux modèles sont positifs mais sans confiance suffisante. Verdict indéterminé — relecture médicale requise.",
        tbContrib: tb,
        pnContrib: pn,
      };
    }
    return {
      pathologie,
      label: pathologie === "tuberculose" ? "TUBERCULOSE DÉTECTÉE" : "PNEUMONIE DÉTECTÉE",
      prediction: "positif",
      confiance: principale.confiance,
      raison: `${sigle} positif avec confiance significative (${sigle} > ${adversaire}). ${adversaire} interprété comme cross-réactif.`,
      tbContrib: tb,
      pnContrib: pn,
    };
  }

  // ─── Seul TB positif ───
  if (tbPos && !pnPos) {
    return {
      pathologie: "tuberculose",
      label: "TUBERCULOSE DÉTECTÉE",
      prediction: "positif",
      confiance: tb.confiance,
      raison:
        "TB positif, PN négatif. Résultat cohérent : le modèle PN ne détecte pas les signatures propres à la tuberculose.",
      tbContrib: tb,
      pnContrib: pn,
    };
  }

  // ─── Seul PN positif : arbitrage face à une lecture TB « normal » ───
  if (!tbPos && pnPos) {
    // Un « normal » TB hautement confiant contredit frontalement une détection PN.
    const desaccord = tb.confiance >= SEUIL_NORMAL_CONFIANT;
    if (tb.confiance > pn.confiance) {
      return {
        pathologie: "aucune",
        label: "EXAMEN NORMAL",
        prediction: "negatif",
        confiance: tb.confiance,
        conflit: true,
        raison:
          "TB signale un poumon normal avec une confiance supérieure à la détection PN. " +
          "Signal PN écarté comme moins confiant — relecture conseillée.",
        tbContrib: tb,
        pnContrib: pn,
      };
    }
    if (pn.confiance < SEUIL_INDETERMINE) {
      return {
        pathologie: "pneumonie",
        label: "PNEUMONIE PROBABLE",
        prediction: "positif",
        confiance: pn.confiance,
        conflit: desaccord,
        raison:
          "PN positif mais sous le seuil de confiance d'usage. Verdict prudent — relecture requise.",
        tbContrib: tb,
        pnContrib: pn,
      };
    }
    return {
      pathologie: "pneumonie",
      label: "PNEUMONIE DÉTECTÉE",
      prediction: "positif",
      confiance: pn.confiance,
      conflit: desaccord,
      raison: desaccord
        ? "PN positif avec une confiance supérieure à la lecture TB. Verdict pneumonie retenu malgré le désaccord."
        : "PN positif, TB négatif (le modèle TB ne détecte pas la pneumonie). Résultat cohérent.",
      tbContrib: tb,
      pnContrib: pn,
    };
  }

  // ─── Les deux négatifs ───
  const minConf = Math.min(tb.confiance, pn.confiance);
  if (minConf >= SEUIL_NORMAL_CONFIANT) {
    return {
      pathologie: "aucune",
      label: "EXAMEN NORMAL",
      prediction: "negatif",
      confiance: minConf,
      raison: "TB et PN négatifs avec confiance élevée. Pas de pathologie détectée.",
      tbContrib: tb,
      pnContrib: pn,
    };
  }
  if (minConf >= SEUIL_INDETERMINE) {
    return {
      pathologie: "aucune",
      label: "EXAMEN NORMAL",
      prediction: "negatif",
      confiance: minConf,
      raison: "TB et PN négatifs mais confiance modérée. Résultat plausible — relecture possible.",
      tbContrib: tb,
      pnContrib: pn,
    };
  }
  return {
    pathologie: "aucune",
    label: "RELECTURE REQUISE",
    prediction: "indetermine",
    confiance: minConf,
    raison:
      "Aucun modèle n'atteint le seuil de confiance. Verdict indéterminé — relecture médicale requise.",
    tbContrib: tb,
    pnContrib: pn,
  };
}

function toneVerdict(v: Verdict): "ok" | "warn" | "alert" {
  if (v.prediction === "indetermine") return "alert";
  if (v.prediction === "negatif") return "ok";
  if (v.confiance >= SEUIL_NORMAL_CONFIANT) return "warn";
  return "alert";
}

/** Rôle d'un modèle dans la synthèse (déterminé à partir du verdict). */
function roleModel(
  verdict: Verdict,
  contrib: ResultatDiagnostic,
  pathologie: string,
): { role: string; tone: "ok" | "warn" | "neutral" } {
  if (verdict.pathologie === pathologie && contrib.prediction === "positif") {
    return { role: "Verdict principal", tone: "ok" };
  }
  if (contrib.prediction === "positif" && verdict.prediction === "positif") {
    return { role: "Cross-réactif", tone: "warn" };
  }
  if (verdict.conflit && contrib.prediction === "positif") {
    return { role: "Signal écarté (désaccord)", tone: "warn" };
  }
  if (contrib.prediction === "positif") {
    return { role: "Concordant", tone: "warn" };
  }
  return { role: "Négatif", tone: "neutral" };
}

/* ─── Composant ─── */

type Props = {
  tb: ResultatDiagnostic;
  pn: ResultatDiagnostic;
  destination: "edge" | "cloud";
  escalades?: { pathologie: string }[];
};

export function SyntheseClinique({ tb, pn, destination, escalades = [] }: Props) {
  const verdict = croiserResultats(tb, pn);
  const t = toneVerdict(verdict);
  const estAmbigue =
    verdict.prediction === "indetermine" ||
    (verdict.prediction === "positif" &&
      tb.prediction === "positif" &&
      pn.prediction === "positif");
  const estCrossReactif =
    verdict.prediction === "positif" && tb.prediction === "positif" && pn.prediction === "positif";

  return (
    <div
      className={cn(
        "rounded-xl border p-5 transition-colors",
        t === "ok"
          ? "border-ok/40 bg-ok-soft/30"
          : t === "warn"
            ? "border-warn/40 bg-warn-soft/30"
            : "border-alert/40 bg-alert-soft/30",
      )}
    >
      {/* En-tête verdict */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label-xs tracking-[0.14em] text-muted-foreground">VERDICT SYNTHÉTISÉ</p>
          <div className="mt-1 flex items-center gap-2">
            {verdict.prediction === "indetermine" ? (
              <ShieldAlert className="size-5 text-alert" />
            ) : verdict.prediction === "positif" ? (
              <ScanLine className="size-5 text-warn" />
            ) : (
              <BadgeCheck className="size-5 text-ok" />
            )}
            <h3
              className={cn(
                "text-lg font-bold tracking-tight",
                t === "ok" && "text-ok",
                t === "warn" && "text-warn",
                t === "alert" && "text-alert",
              )}
            >
              {verdict.label}
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Tag tone={destination} className="py-1 text-[10px]">
            <StatusDot tone={destination} pulse={false} /> {destination}
          </Tag>
          {verdict.conflit && (
            <Tag tone="warn" className="py-1 text-[10px]">
              <StatusDot tone="warn" pulse={false} /> désaccord TB/PN
            </Tag>
          )}
          {estAmbigue && (
            <Tag tone="alert" className="py-1 text-[10px]">
              <StatusDot tone="alert" pulse={false} /> ambigu
            </Tag>
          )}
          {escalades.length > 0 && (
            <Tag tone="warn" className="py-1 text-[10px]">
              <ArrowUpRight className="size-2.5" /> contrôle qualité
            </Tag>
          )}
        </div>
      </div>

      {/* Score */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Confiance retenue</span>
          <span
            className={cn(
              "font-mono text-sm font-bold tabular-nums",
              t === "ok" && "text-ok",
              t === "warn" && "text-warn",
              t === "alert" && "text-alert",
            )}
          >
            {formatConfiance(verdict.confiance)}
          </span>
        </div>
        <Meter value={Math.round(verdict.confiance * 100)} tone={t} className="mt-1.5" />
      </div>

      {/* Matrice de croisement */}
      <div className="mt-4 rounded-lg border border-border bg-background/60">
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 gap-y-0 border-b border-border px-4 py-2 text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          <span>Modèle</span>
          <span>Verdict</span>
          <span>Confiance</span>
          <span>Contribution</span>
        </div>
        {[
          {
            patho: "TB Classifier",
            contrib: verdict.tbContrib,
            ...roleModel(verdict, verdict.tbContrib, "tuberculose"),
          },
          {
            patho: "PN Classifier",
            contrib: verdict.pnContrib,
            ...roleModel(verdict, verdict.pnContrib, "pneumonie"),
          },
        ].map((row) => (
          <div
            key={row.patho}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 border-b border-border/50 px-4 py-2.5 last:border-b-0"
          >
            <span className="font-mono text-xs font-semibold">{row.patho}</span>
            <span
              className={cn(
                "text-xs font-semibold",
                row.contrib.prediction === "positif"
                  ? "text-warn"
                  : row.contrib.prediction === "negatif"
                    ? "text-ok"
                    : "text-muted-foreground",
              )}
            >
              {row.contrib.prediction === "positif"
                ? "Pathologie suspectée"
                : row.contrib.prediction === "negatif"
                  ? "Examen normal"
                  : "Indéterminé"}
            </span>
            <span
              className={cn(
                "font-mono text-xs font-bold tabular-nums",
                row.contrib.confiance >= SEUIL_NORMAL_CONFIANT
                  ? "text-ok"
                  : row.contrib.confiance >= SEUIL_INDETERMINE
                    ? "text-warn"
                    : "text-alert",
              )}
            >
              {formatConfiance(row.contrib.confiance)}
            </span>
            <Tag tone={row.tone} className="py-px text-[9px]">
              {row.role}
            </Tag>
          </div>
        ))}
      </div>

      {/* Raison du verdict */}
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-background/40 px-4 py-3">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Analyse</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{verdict.raison}</p>
          {estCrossReactif && (
            <p className="mt-1.5 text-[11px] text-warn">
              <Cross className="mr-1 inline size-2.5" />
              Les deux modèles sont positifs — le verdict est déterminé par la confiance relative.
              Le modèle dont le domaine correspond à la pathologie détectée est prioritaire.
            </p>
          )}
          {verdict.conflit && (
            <p className="mt-1.5 text-[11px] text-warn">
              <Cross className="mr-1 inline size-2.5" />
              Désaccord entre les modèles : la détection la moins confiante est écartée.
              Recommandation de relecture clinique.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
