interface PropsJauge {
  label: string;
  valeur: number;
  unite: string;
  seuil: number;
}

function JaugeNoeud({ label, valeur, unite, seuil }: PropsJauge) {
  const ratio = valeur / seuil;
  const critique = valeur > seuil;
  const largeur = Math.min(ratio * 100, 100);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-corps text-xs text-aeris-texte-secondaire">{label}</span>
        <span className={`font-mono text-sm font-medium ${critique ? "text-aeris-alerte" : "text-aeris-texte"}`}>
          {valeur}{unite}
        </span>
      </div>
      <div className="h-2 bg-aeris-bordure rounded-full relative">
        <div
          className={`h-full rounded-full ${critique ? "bg-aeris-alerte" : "bg-aeris-accent/70"}`}
          style={{ width: `${largeur}%` }}
        />
        <div
          className="absolute top-[-2px] w-[2px] h-[12px] bg-aeris-texte-secondaire/50 rounded-full"
          style={{ left: `${Math.min((1 / Math.max(ratio, 1)) * 100, 100)}%` }}
        />
      </div>
      <p className="font-corps text-[10px] text-aeris-texte-secondaire/60 mt-0.5 text-right">
        seuil {seuil}{unite}
      </p>
    </div>
  );
}

interface PropsBlocNoeud {
  type: "edge" | "cloud";
  metriques: PropsJauge[];
  services: { nom: string; statut: "ok" | "erreur" }[];
}

function BlocNoeud({ type, metriques, services }: PropsBlocNoeud) {
  const estEdge = type === "edge";

  return (
    <div
      className={`panneau border-l-[3px] p-5 ${
        estEdge ? "border-l-aeris-edge" : "border-l-aeris-cloud"
      }`}
    >
      <div className="flex items-center gap-2 mb-4">
        <span className={estEdge ? "pastille-edge" : "pastille-cloud"}>{type}</span>
        <p className="font-titre text-sm font-semibold text-aeris-texte">
          {estEdge ? "Noeud Edge" : "Noeud Cloud"}
        </p>
      </div>

      <div className="space-y-3">
        {metriques.map((m) => (
          <JaugeNoeud key={m.label} {...m} />
        ))}
      </div>

      <div className="flex gap-2 mt-4 pt-3 border-t border-aeris-bordure">
        {services.map((s) => (
          <span
            key={s.nom}
            className={`pastille text-[10px] ${
              s.statut === "ok"
                ? "bg-emerald-50 text-aeris-succes"
                : "bg-red-50 text-aeris-alerte"
            }`}
          >
            {s.nom} {s.statut === "ok" ? "ok" : "err"}
          </span>
        ))}
      </div>
    </div>
  );
}

export { JaugeNoeud };
export default BlocNoeud;
