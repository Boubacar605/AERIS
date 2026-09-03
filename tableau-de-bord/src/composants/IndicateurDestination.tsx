interface PropsIndicateur {
  destination: "edge" | "cloud";
  raison?: string;
}

function IndicateurDestination({ destination, raison }: PropsIndicateur) {
  const estEdge = destination === "edge";

  return (
    <div
      className={`panneau p-5 transition-edge-cloud ${
        estEdge
          ? "border-l-4 border-l-aeris-edge bg-aeris-edge-pale/30"
          : "border-l-4 border-l-aeris-cloud bg-aeris-cloud-pale/30"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-aeris-texte-secondaire font-corps">
            Destination active
          </p>
          <p className="font-titre text-xl font-semibold mt-1 text-aeris-texte">
            {estEdge ? "Edge — Traitement local" : "Cloud — Traitement distant"}
          </p>
        </div>
        <div
          className={`transition-edge-cloud w-12 h-12 rounded-full flex items-center justify-center ${
            estEdge ? "bg-aeris-edge/15" : "bg-aeris-cloud/15"
          }`}
        >
          {estEdge ? <IconeEdge /> : <IconeCloud />}
        </div>
      </div>
      {raison && (
        <p className="text-xs text-aeris-texte-secondaire mt-3 font-corps">
          {raison}
        </p>
      )}
    </div>
  );
}

function IconeEdge() {
  return (
    <svg className="w-6 h-6 text-aeris-edge" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function IconeCloud() {
  return (
    <svg className="w-6 h-6 text-aeris-cloud" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
    </svg>
  );
}

export default IndicateurDestination;
