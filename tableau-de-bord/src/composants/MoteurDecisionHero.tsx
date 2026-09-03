import { useState, useEffect, useRef } from "react";

interface PropsMoteur {
  requeteId: number;
  horodatage: string;
  destination: "edge" | "cloud";
  raison: string;
  cpu: number;
  ram: number;
  latence: number;
  seuilCpu: number;
  seuilRam: number;
  seuilLatence: number;
  resultatTb: { prediction: string; confiance: number };
  resultatPn: { prediction: string; confiance: number };
  tempsTotal: number;
}

function MoteurDecisionHero({
  requeteId,
  horodatage,
  destination,
  raison,
  cpu,
  ram,
  latence,
  seuilCpu,
  seuilRam,
  seuilLatence,
  resultatTb,
  resultatPn,
  tempsTotal,
}: PropsMoteur) {
  const estEdge = destination === "edge";
  const [animer, setAnimer] = useState(false);
  const dernierIdRef = useRef(requeteId);

  useEffect(() => {
    if (requeteId !== dernierIdRef.current) {
      dernierIdRef.current = requeteId;
      setAnimer(true);
      const timer = setTimeout(() => setAnimer(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [requeteId]);

  return (
    <div className="panneau overflow-hidden">
      <div className="p-6 lg:p-8">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <p className="font-corps text-sm text-aeris-texte-secondaire">
              Derniere decision de routage
            </p>
            <p className="font-titre text-lg font-semibold text-aeris-texte mt-0.5">
              Requete #{requeteId}
              <span className="font-corps text-sm font-normal text-aeris-texte-secondaire ml-3">
                {horodatage}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-medium text-aeris-texte">
              {tempsTotal}
              <span className="text-sm text-aeris-texte-secondaire ml-1">ms</span>
            </p>
            <p className="font-corps text-xs text-aeris-texte-secondaire">temps total</p>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          <div className="flex-shrink-0 w-full lg:w-[340px]">
            <svg viewBox="0 0 340 220" className="w-full" xmlns="http://www.w3.org/2000/svg">
              <NoeudAnalyse />
              <CheminEdge actif={estEdge} animer={animer && estEdge} />
              <CheminCloud actif={!estEdge} animer={animer && !estEdge} />
              <NoeudEdge actif={estEdge} />
              <NoeudCloud actif={!estEdge} />
              {animer && <PointAnime destination={destination} />}
            </svg>
          </div>

          <div className="flex-1 space-y-5">
            <p className="font-corps text-sm text-aeris-texte leading-relaxed">
              {raison}
            </p>

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <MetriqueContexte label="CPU Edge" valeur={cpu} unite="%" seuil={seuilCpu} />
              <MetriqueContexte label="RAM Edge" valeur={ram} unite="%" seuil={seuilRam} />
              <MetriqueContexte label="Latence reseau" valeur={latence} unite="ms" seuil={seuilLatence} />
            </div>

            <div className="flex gap-5 pt-2">
              <ResultatCompact
                pathologie="TB"
                prediction={resultatTb.prediction}
                confiance={resultatTb.confiance}
              />
              <ResultatCompact
                pathologie="PN"
                prediction={resultatPn.prediction}
                confiance={resultatPn.confiance}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoeudAnalyse() {
  return (
    <g>
      <rect x="120" y="10" width="100" height="36" rx="6" fill="#0F2B46" />
      <text x="170" y="33" textAnchor="middle" fill="white" fontSize="13" fontFamily="Space Grotesk" fontWeight="600">
        Analyse
      </text>
    </g>
  );
}

function CheminEdge({ actif, animer }: { actif: boolean; animer: boolean }) {
  const couleur = actif ? "#D4A84B" : "#DDE1E8";
  return (
    <path
      d="M 145 46 C 145 80, 80 90, 80 130"
      fill="none"
      stroke={couleur}
      strokeWidth={actif ? 2.5 : 1.5}
      strokeLinecap="round"
      className={animer ? "transition-all duration-700" : ""}
    />
  );
}

function CheminCloud({ actif, animer }: { actif: boolean; animer: boolean }) {
  const couleur = actif ? "#5B9BD5" : "#DDE1E8";
  return (
    <path
      d="M 195 46 C 195 80, 260 90, 260 130"
      fill="none"
      stroke={couleur}
      strokeWidth={actif ? 2.5 : 1.5}
      strokeLinecap="round"
      className={animer ? "transition-all duration-700" : ""}
    />
  );
}

function NoeudEdge({ actif }: { actif: boolean }) {
  return (
    <g>
      <rect
        x="30" y="130" width="100" height="70" rx="8"
        fill={actif ? "#FDF6E9" : "#F1F3F6"}
        stroke={actif ? "#D4A84B" : "#DDE1E8"}
        strokeWidth={actif ? 2 : 1}
      />
      <text x="80" y="158" textAnchor="middle" fill={actif ? "#D4A84B" : "#5A6275"} fontSize="12" fontFamily="Space Grotesk" fontWeight="600">
        Edge
      </text>
      <text x="80" y="178" textAnchor="middle" fill="#5A6275" fontSize="10" fontFamily="IBM Plex Sans">
        Traitement local
      </text>
      {actif && <circle cx="80" cy="195" r="3" fill="#D4A84B" />}
    </g>
  );
}

function NoeudCloud({ actif }: { actif: boolean }) {
  return (
    <g>
      <rect
        x="210" y="130" width="100" height="70" rx="8"
        fill={actif ? "#EBF3FB" : "#F1F3F6"}
        stroke={actif ? "#5B9BD5" : "#DDE1E8"}
        strokeWidth={actif ? 2 : 1}
      />
      <text x="260" y="158" textAnchor="middle" fill={actif ? "#5B9BD5" : "#5A6275"} fontSize="12" fontFamily="Space Grotesk" fontWeight="600">
        Cloud
      </text>
      <text x="260" y="178" textAnchor="middle" fill="#5A6275" fontSize="10" fontFamily="IBM Plex Sans">
        Traitement distant
      </text>
      {actif && <circle cx="260" cy="195" r="3" fill="#5B9BD5" />}
    </g>
  );
}

function PointAnime({ destination }: { destination: "edge" | "cloud" }) {
  const chemin = destination === "edge"
    ? "M 145 46 C 145 80, 80 90, 80 130"
    : "M 195 46 C 195 80, 260 90, 260 130";
  const couleur = destination === "edge" ? "#D4A84B" : "#5B9BD5";

  return (
    <>
      <circle r="5" fill={couleur}>
        <animateMotion dur="1.2s" fill="freeze" path={chemin} />
        <animate attributeName="opacity" values="0;1;1;0.6" dur="1.2s" fill="freeze" />
      </circle>
      <circle r="10" fill={couleur} opacity="0.2">
        <animateMotion dur="1.2s" fill="freeze" path={chemin} />
        <animate attributeName="r" values="5;12;8" dur="1.2s" fill="freeze" />
        <animate attributeName="opacity" values="0;0.3;0" dur="1.2s" fill="freeze" />
      </circle>
    </>
  );
}

function MetriqueContexte({
  label,
  valeur,
  unite,
  seuil,
}: {
  label: string;
  valeur: number;
  unite: string;
  seuil: number;
}) {
  const ratio = Math.min(valeur / seuil, 1.2);
  const critique = valeur > seuil;

  return (
    <div className="min-w-[120px]">
      <p className="font-corps text-xs text-aeris-texte-secondaire mb-1.5">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`font-mono text-lg font-medium ${critique ? "text-aeris-alerte" : "text-aeris-texte"}`}>
          {valeur}
        </span>
        <span className="font-corps text-xs text-aeris-texte-secondaire">{unite}</span>
      </div>
      <div className="mt-1.5 h-1.5 bg-aeris-bordure rounded-full relative">
        <div
          className={`h-full rounded-full ${critique ? "bg-aeris-alerte" : "bg-aeris-accent"}`}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
        <div
          className="absolute top-[-3px] w-px h-[9px] bg-aeris-texte-secondaire"
          style={{ left: `${(1 / 1.2) * 100}%` }}
          title={`Seuil: ${seuil}${unite}`}
        />
      </div>
      <p className="font-corps text-[10px] text-aeris-texte-secondaire mt-0.5">
        seuil {seuil}{unite}
      </p>
    </div>
  );
}

function ResultatCompact({
  pathologie,
  prediction,
  confiance,
}: {
  pathologie: string;
  prediction: string;
  confiance: number;
}) {
  const estPositif = prediction === "positif";
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${estPositif ? "bg-aeris-alerte" : "bg-aeris-succes"}`} />
      <span className="font-titre text-sm font-semibold text-aeris-texte">{pathologie}</span>
      <span className={estPositif ? "pastille-alerte" : "pastille-succes"}>{prediction}</span>
      <span className="font-mono text-xs text-aeris-texte-secondaire">{(confiance * 100).toFixed(0)}%</span>
    </div>
  );
}

export default MoteurDecisionHero;
