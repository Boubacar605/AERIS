import { useState, useRef } from "react";
import { soumettreDiagnostic, type ReponseRoutage } from "../services-api/client";

function PageDiagnostic() {
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ReponseRoutage | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function gererSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFichier(f);
    setApercu(URL.createObjectURL(f));
    setResultat(null);
    setErreur(null);
  }

  async function gererSoumission() {
    if (!fichier) return;
    setChargement(true);
    setErreur(null);
    try {
      const reponse = await soumettreDiagnostic(fichier);
      setResultat(reponse);
    } catch {
      setErreur("Erreur de communication avec le moteur de decision.");
    } finally {
      setChargement(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="font-titre text-2xl font-bold text-aeris-texte">
          Diagnostic
        </h2>
        <p className="font-corps text-sm text-aeris-texte-secondaire mt-1">
          Soumettez une radiographie thoracique pour analyse
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="panneau p-6 space-y-5">
          <h3 className="font-titre text-base font-semibold text-aeris-texte">
            Radiographie
          </h3>

          <div
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer ${
              apercu
                ? "border-aeris-accent"
                : "border-aeris-bordure hover:border-aeris-accent/50"
            }`}
          >
            {apercu ? (
              <img
                src={apercu}
                alt="Apercu radiographie"
                className="max-h-72 mx-auto rounded"
              />
            ) : (
              <div className="space-y-2">
                <svg className="w-10 h-10 mx-auto text-aeris-texte-secondaire" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm text-aeris-texte-secondaire font-corps">
                  Cliquez pour selectionner une radiographie
                </p>
                <p className="text-xs text-aeris-texte-secondaire/60 font-corps">
                  PNG, JPEG — radiographie thoracique
                </p>
              </div>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={gererSelection}
            className="hidden"
          />

          <button
            onClick={gererSoumission}
            disabled={!fichier || chargement}
            className={`w-full py-3 rounded-md font-titre text-sm font-semibold tracking-wide ${
              !fichier || chargement
                ? "bg-aeris-bordure text-aeris-texte-secondaire cursor-not-allowed"
                : "bg-aeris-accent text-white hover:bg-aeris-accent/90"
            }`}
          >
            {chargement ? "Analyse en cours..." : "Lancer le diagnostic"}
          </button>

          {erreur && (
            <p className="text-sm text-aeris-alerte font-corps">{erreur}</p>
          )}
        </section>

        <section className="space-y-5">
          {resultat ? (
            <AffichageResultat reponse={resultat} />
          ) : (
            <div className="panneau p-6 flex items-center justify-center min-h-[320px]">
              <p className="text-sm text-aeris-texte-secondaire font-corps">
                Les resultats apparaitront ici apres l'analyse
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function AffichageResultat({ reponse }: { reponse: ReponseRoutage }) {
  const estEdge = reponse.decision.destination === "edge";

  return (
    <div className="space-y-5">
      <div
        className={`panneau p-5 transition-edge-cloud ${
          estEdge
            ? "border-l-4 border-l-aeris-edge"
            : "border-l-4 border-l-aeris-cloud"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-aeris-texte-secondaire font-corps uppercase tracking-wider">
              Traite sur
            </p>
            <p className="font-titre text-lg font-semibold text-aeris-texte mt-0.5">
              {estEdge ? "Edge" : "Cloud"}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-medium text-aeris-texte">
              {reponse.temps_total_ms.toFixed(0)}
              <span className="text-sm text-aeris-texte-secondaire ml-1">ms</span>
            </p>
            <p className="text-xs text-aeris-texte-secondaire font-corps">
              temps total
            </p>
          </div>
        </div>
        <p className="text-xs text-aeris-texte-secondaire mt-3 font-corps">
          {reponse.decision.raison}
        </p>
      </div>

      {reponse.resultats.map((r) => {
        const estPositif = r.prediction === "positif";
        return (
          <div key={r.pathologie} className="panneau p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    estPositif ? "bg-aeris-alerte" : "bg-aeris-succes"
                  }`}
                />
                <p className="font-titre text-base font-semibold text-aeris-texte capitalize">
                  {r.pathologie}
                </p>
              </div>
              <span className={estPositif ? "pastille-alerte" : "pastille-succes"}>
                {r.prediction}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-6">
              <div>
                <p className="text-xs text-aeris-texte-secondaire font-corps">Confiance</p>
                <p className="font-mono text-xl text-aeris-texte">
                  {(r.confiance * 100).toFixed(1)}
                  <span className="text-sm text-aeris-texte-secondaire">%</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-aeris-texte-secondaire font-corps">Inference</p>
                <p className="font-mono text-xl text-aeris-texte">
                  {r.temps_inference_ms.toFixed(0)}
                  <span className="text-sm text-aeris-texte-secondaire"> ms</span>
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default PageDiagnostic;
