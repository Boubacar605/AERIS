interface PropsCarteMetrique {
  label: string;
  valeur: string | number;
  unite: string;
  variante?: "neutre" | "edge" | "cloud" | "succes" | "alerte";
}

const BORDURES: Record<string, string> = {
  neutre: "border-l-aeris-bordure",
  edge: "border-l-aeris-edge",
  cloud: "border-l-aeris-cloud",
  succes: "border-l-aeris-succes",
  alerte: "border-l-aeris-alerte",
};

function CarteMetrique({
  label,
  valeur,
  unite,
  variante = "neutre",
}: PropsCarteMetrique) {
  return (
    <div className={`panneau border-l-4 ${BORDURES[variante]} p-5`}>
      <p className="text-sm text-aeris-texte-secondaire font-corps mb-2">
        {label}
      </p>
      <div className="flex items-baseline">
        <span className="valeur-metrique text-aeris-texte">{valeur}</span>
        <span className="unite-metrique">{unite}</span>
      </div>
    </div>
  );
}

export default CarteMetrique;
