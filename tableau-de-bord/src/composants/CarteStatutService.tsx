interface PropsCarteStatut {
  nom: string;
  statut: "operationnel" | "hors-ligne" | "erreur";
  mode?: "edge" | "cloud";
}

const STATUTS = {
  operationnel: { label: "OK", classe: "pastille-succes" },
  "hors-ligne": { label: "Hors ligne", classe: "pastille text-slate-500 bg-slate-100" },
  erreur: { label: "Erreur", classe: "pastille-alerte" },
};

function CarteStatutService({ nom, statut, mode }: PropsCarteStatut) {
  const info = STATUTS[statut];
  const bordure = mode === "edge"
    ? "border-l-aeris-edge"
    : mode === "cloud"
      ? "border-l-aeris-cloud"
      : "border-l-aeris-bordure";

  return (
    <div
      className={`bg-aeris-fond/60 border border-aeris-bordure border-l-[3px] ${bordure} rounded-md px-3 py-2.5 flex items-center justify-between`}
    >
      <div className="flex items-center gap-2">
        {mode && (
          <span
            className={
              mode === "edge" ? "pastille-edge text-[10px]" : "pastille-cloud text-[10px]"
            }
          >
            {mode}
          </span>
        )}
        <p className="font-corps text-sm text-aeris-texte">{nom}</p>
      </div>
      <span className={`${info.classe} text-[10px]`}>{info.label}</span>
    </div>
  );
}

export default CarteStatutService;
