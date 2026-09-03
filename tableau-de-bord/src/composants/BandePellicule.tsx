import { useState } from "react";

interface SegmentInference {
  id: number;
  destination: "edge" | "cloud";
  tb: string;
  pn: string;
  confianceTb: number;
  confiancePn: number;
  temps: number;
}

interface PropsBande {
  inferences: SegmentInference[];
}

function BandePellicule({ inferences }: PropsBande) {
  const [survol, setSurvol] = useState<SegmentInference | null>(null);
  const [positionSurvol, setPositionSurvol] = useState(0);

  return (
    <div className="space-y-3">
      <h3 className="font-titre text-base font-semibold text-aeris-texte">
        Activite recente
      </h3>

      <div className="relative">
        <div className="flex gap-[2px] h-3 rounded-sm overflow-hidden">
          {inferences.map((inf) => (
            <div
              key={inf.id}
              className={`flex-1 cursor-pointer ${
                inf.destination === "edge" ? "bg-aeris-edge" : "bg-aeris-cloud"
              } ${survol?.id === inf.id ? "opacity-100 scale-y-150" : "opacity-80 hover:opacity-100"}`}
              style={{ transformOrigin: "bottom" }}
              onMouseEnter={(e) => {
                setSurvol(inf);
                const rect = e.currentTarget.getBoundingClientRect();
                const parent = e.currentTarget.parentElement?.getBoundingClientRect();
                if (parent) {
                  setPositionSurvol(rect.left - parent.left + rect.width / 2);
                }
              }}
              onMouseLeave={() => setSurvol(null)}
            />
          ))}
        </div>

        {survol && (
          <div
            className="absolute top-5 z-10 panneau p-3 text-xs pointer-events-none"
            style={{
              left: `${positionSurvol}px`,
              transform: "translateX(-50%)",
            }}
          >
            <p className="font-titre font-semibold text-aeris-texte">
              #{survol.id}
              <span className={`ml-2 ${survol.destination === "edge" ? "pastille-edge" : "pastille-cloud"}`}>
                {survol.destination}
              </span>
            </p>
            <p className="font-corps text-aeris-texte-secondaire mt-1">
              TB {survol.tb} {(survol.confianceTb * 100).toFixed(0)}% — PN {survol.pn} {(survol.confiancePn * 100).toFixed(0)}%
            </p>
            <p className="font-mono text-aeris-texte-secondaire mt-0.5">
              {survol.temps} ms
            </p>
          </div>
        )}

        <div className="flex justify-between mt-1.5">
          <span className="font-corps text-[10px] text-aeris-texte-secondaire flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-aeris-edge" /> edge
          </span>
          <span className="font-corps text-[10px] text-aeris-texte-secondaire flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-aeris-cloud" /> cloud
          </span>
        </div>
      </div>
    </div>
  );
}

export default BandePellicule;
