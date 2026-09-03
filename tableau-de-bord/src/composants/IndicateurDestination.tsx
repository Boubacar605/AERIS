interface PropsIndicateur {
  destination: "edge" | "cloud";
  raison?: string;
  cpu?: number;
  ram?: number;
  latence?: number;
}

function IndicateurDestination({
  destination,
  raison,
  cpu = 42,
  ram = 58,
  latence = 34,
}: PropsIndicateur) {
  const estEdge = destination === "edge";

  return (
    <div
      className={`panneau overflow-hidden transition-edge-cloud ${
        estEdge ? "border-l-4 border-l-aeris-edge" : "border-l-4 border-l-aeris-cloud"
      }`}
    >
      <div className="flex">
        <div
          className={`transition-edge-cloud w-2 self-stretch ${
            estEdge ? "bg-aeris-edge" : "bg-aeris-cloud"
          }`}
        />

        <div className="flex-1 p-6 lg:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-start gap-5">
              <div
                className={`transition-edge-cloud flex-shrink-0 w-16 h-16 rounded-xl flex items-center justify-center ${
                  estEdge ? "bg-aeris-edge/10" : "bg-aeris-cloud/10"
                }`}
              >
                {estEdge ? <SchemaEdge /> : <SchemaCloud />}
              </div>

              <div>
                <p className="font-corps text-sm text-aeris-texte-secondaire">
                  Routage actif
                </p>
                <p className="font-titre text-2xl font-bold text-aeris-texte mt-0.5">
                  {estEdge ? "Traitement local" : "Traitement distant"}
                </p>
                {raison && (
                  <p className="font-corps text-sm text-aeris-texte-secondaire mt-2 max-w-md">
                    {raison}
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-8 lg:gap-10">
              <MetriqueCompacte
                label="CPU"
                valeur={cpu}
                unite="%"
                seuil={80}
              />
              <MetriqueCompacte
                label="RAM"
                valeur={ram}
                unite="%"
                seuil={85}
              />
              <MetriqueCompacte
                label="Latence"
                valeur={latence}
                unite="ms"
                seuil={100}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetriqueCompacte({
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
  const critique = valeur > seuil;

  return (
    <div className="text-center">
      <p className="font-corps text-xs text-aeris-texte-secondaire mb-1">
        {label}
      </p>
      <p
        className={`font-mono text-2xl font-medium ${
          critique ? "text-aeris-alerte" : "text-aeris-texte"
        }`}
      >
        {valeur}
        <span className="text-xs text-aeris-texte-secondaire ml-0.5">
          {unite}
        </span>
      </p>
    </div>
  );
}

function SchemaEdge() {
  return (
    <svg className="w-8 h-8 text-aeris-edge" viewBox="0 0 32 32" fill="none">
      <rect x="4" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="18" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="19" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 15v2.5a1.5 1.5 0 001.5 1.5h0M23 15v2.5a1.5 1.5 0 01-1.5 1.5h0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SchemaCloud() {
  return (
    <svg className="w-8 h-8 text-aeris-cloud" viewBox="0 0 32 32" fill="none">
      <path d="M8 22a5 5 0 015-5h0a7 7 0 0113.5 2.5h0A4 4 0 0125 27H8.5A4.5 4.5 0 018 22z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 27v3M16 27v3M20 27v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 2" />
    </svg>
  );
}

export default IndicateurDestination;
