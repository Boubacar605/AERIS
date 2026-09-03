interface PropsCarteStatut {
  nom: string;
  statut: "operationnel" | "hors-ligne" | "erreur";
  mode?: "edge" | "cloud";
}

const STATUTS = {
  operationnel: { label: "Operationnel", classe: "pastille-succes" },
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
    <div className={`panneau border-l-4 ${bordure} p-4 flex items-center justify-between`}>
      <div>
        <p className="font-titre text-sm font-semibold text-aeris-texte">
          {nom}
        </p>
        {mode && (
          <span className={mode === "edge" ? "pastille-edge mt-1" : "pastille-cloud mt-1"}>
            {mode}
          </span>
        )}
      </div>
      <span className={info.classe}>{info.label}</span>
    </div>
  );
}

export default CarteStatutService;
