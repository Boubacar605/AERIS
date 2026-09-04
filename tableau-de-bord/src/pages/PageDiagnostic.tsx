import { useState, useRef } from "react";
import {
  soumettreDiagnostic,
  type ReponseRoutage,
} from "../services-api/client";

type ModeRoutage = "auto" | "edge" | "cloud" | "comparaison";

function PageDiagnostic() {
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeRoutage>("auto");
  const [resultatPrincipal, setResultatPrincipal] =
    useState<ReponseRoutage | null>(null);
  const [resultatComparaison, setResultatComparaison] =
    useState<ReponseRoutage | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function gererSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFichier(f);
    setApercu(URL.createObjectURL(f));
    setResultatPrincipal(null);
    setResultatComparaison(null);
    setErreur(null);
  }

  async function gererSoumission() {
    if (!fichier) return;
    setChargement(true);
    setErreur(null);
    setResultatPrincipal(null);
    setResultatComparaison(null);

    try {
      if (mode === "comparaison") {
        const [edge, cloud] = await Promise.all([
          soumettreDiagnostic(fichier, "edge"),
          soumettreDiagnostic(fichier, "cloud"),
        ]);
        setResultatPrincipal(edge);
        setResultatComparaison(cloud);
      } else {
        const force = mode === "auto" ? null : mode;
        const reponse = await soumettreDiagnostic(fichier, force);
        setResultatPrincipal(reponse);
      }
    } catch {
      setErreur("Erreur de communication avec le moteur de decision.");
    } finally {
      setChargement(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="font-titre text-3xl font-bold text-aeris-texte">
          Diagnostic
        </h2>
        <p className="font-corps text-base text-aeris-texte-secondaire mt-1">
          Soumettez une radiographie thoracique pour analyse
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-2 space-y-5">
          <div className="panneau p-6 space-y-5">
            <h3 className="font-titre text-base font-semibold text-aeris-texte">
              Radiographie
            </h3>

            <div
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer ${
                apercu
                  ? "border-aeris-accent"
                  : "border-aeris-bordure hover:border-aeris-accent/50"
              }`}
            >
              {apercu ? (
                <img
                  src={apercu}
                  alt="Apercu radiographie"
                  className="max-h-64 mx-auto rounded"
                />
              ) : (
                <div className="space-y-2 py-8">
                  <svg
                    className="w-10 h-10 mx-auto text-aeris-texte-secondaire"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                    />
                  </svg>
                  <p className="text-sm text-aeris-texte-secondaire font-corps">
                    Cliquez pour selectionner une radiographie
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
          </div>

          <div className="panneau p-6 space-y-4">
            <h3 className="font-titre text-base font-semibold text-aeris-texte">
              Mode de routage
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["auto", "Automatique"],
                  ["edge", "Edge uniquement"],
                  ["cloud", "Cloud uniquement"],
                  ["comparaison", "Comparer Edge/Cloud"],
                ] as const
              ).map(([valeur, label]) => (
                <button
                  key={valeur}
                  onClick={() => setMode(valeur)}
                  className={`px-3 py-2.5 rounded-md text-xs font-corps text-center border ${
                    mode === valeur
                      ? valeur === "edge"
                        ? "border-aeris-edge bg-aeris-edge-pale text-aeris-edge font-medium"
                        : valeur === "cloud"
                          ? "border-aeris-cloud bg-aeris-cloud-pale text-aeris-cloud font-medium"
                          : valeur === "comparaison"
                            ? "border-aeris-accent bg-aeris-accent-pale text-aeris-accent font-medium"
                            : "border-aeris-profond bg-aeris-profond text-white font-medium"
                      : "border-aeris-bordure text-aeris-texte-secondaire hover:border-aeris-accent/30"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="font-corps text-[11px] text-aeris-texte-secondaire leading-relaxed">
              {mode === "auto" &&
                "Le moteur de decision choisit automatiquement Edge ou Cloud selon l'etat du systeme."}
              {mode === "edge" &&
                "L'inference est forcee sur l'Edge (modele leger, traitement local)."}
              {mode === "cloud" &&
                "L'inference est forcee sur le Cloud (modele DenseNet121, plus precis)."}
              {mode === "comparaison" &&
                "Les deux modeles analysent l'image en parallele pour comparer les resultats."}
            </p>
          </div>

          <button
            onClick={gererSoumission}
            disabled={!fichier || chargement}
            className={`w-full py-3.5 rounded-md font-titre text-sm font-semibold tracking-wide ${
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
        </div>

        <div className="lg:col-span-3 space-y-5">
          {resultatPrincipal && resultatComparaison ? (
            <AffichageComparaison edge={resultatPrincipal} cloud={resultatComparaison} />
          ) : resultatPrincipal ? (
            <AffichageResultat reponse={resultatPrincipal} />
          ) : (
            <div className="panneau p-8 flex items-center justify-center min-h-[400px]">
              <div className="text-center space-y-3">
                <svg
                  className="w-12 h-12 mx-auto text-aeris-bordure"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={0.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
                  />
                </svg>
                <p className="text-sm text-aeris-texte-secondaire font-corps">
                  Selectionnez une image et lancez le diagnostic
                </p>
                <p className="text-xs text-aeris-texte-secondaire/60 font-corps">
                  Le mode "Comparer Edge/Cloud" est recommande pour la demonstration
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AffichageResultat({ reponse }: { reponse: ReponseRoutage }) {
  return (
    <div className="space-y-4">
      <BandeauDecision reponse={reponse} />
      {reponse.resultats.map((r) => (
        <CarteResultat key={r.pathologie} resultat={r} />
      ))}
      <BandeauMetriques reponse={reponse} />
    </div>
  );
}

function AffichageComparaison({
  edge,
  cloud,
}: {
  edge: ReponseRoutage;
  cloud: ReponseRoutage;
}) {
  return (
    <div className="space-y-5">
      <div className="panneau border-l-4 border-l-aeris-accent p-4">
        <p className="font-titre text-sm font-semibold text-aeris-texte">
          Comparaison Edge vs Cloud
        </p>
        <p className="font-corps text-xs text-aeris-texte-secondaire mt-1">
          La meme radiographie analysee par les deux pipelines en parallele
        </p>
      </div>

      {["tuberculose", "pneumonie"].map((pathologie) => {
        const rEdge = edge.resultats.find((r) => r.pathologie === pathologie);
        const rCloud = cloud.resultats.find((r) => r.pathologie === pathologie);
        if (!rEdge || !rCloud) return null;

        return (
          <div key={pathologie} className="panneau p-5">
            <p className="font-titre text-base font-semibold text-aeris-texte capitalize mb-4">
              {pathologie}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <ColonneResultat
                label="Edge"
                type="edge"
                resultat={rEdge}
              />
              <ColonneResultat
                label="Cloud (DenseNet121)"
                type="cloud"
                resultat={rCloud}
              />
            </div>
          </div>
        );
      })}

      <div className="grid grid-cols-2 gap-4">
        <div className="panneau border-l-[3px] border-l-aeris-edge p-4">
          <p className="font-corps text-xs text-aeris-texte-secondaire">
            Temps total Edge
          </p>
          <p className="font-mono text-xl text-aeris-texte mt-1">
            {edge.temps_total_ms.toFixed(0)}
            <span className="text-sm text-aeris-texte-secondaire"> ms</span>
          </p>
        </div>
        <div className="panneau border-l-[3px] border-l-aeris-cloud p-4">
          <p className="font-corps text-xs text-aeris-texte-secondaire">
            Temps total Cloud
          </p>
          <p className="font-mono text-xl text-aeris-texte mt-1">
            {cloud.temps_total_ms.toFixed(0)}
            <span className="text-sm text-aeris-texte-secondaire"> ms</span>
          </p>
        </div>
      </div>

      <BandeauMetriques reponse={edge} />
    </div>
  );
}

function ColonneResultat({
  label,
  type,
  resultat,
}: {
  label: string;
  type: "edge" | "cloud";
  resultat: { prediction: string; confiance: number; temps_inference_ms: number };
}) {
  const estPositif = resultat.prediction === "positif";
  const estErreur = resultat.prediction === "erreur";
  const pastilleType = type === "edge" ? "pastille-edge" : "pastille-cloud";

  return (
    <div
      className={`rounded-md p-4 ${
        type === "edge" ? "bg-aeris-edge-pale/30" : "bg-aeris-cloud-pale/30"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={pastilleType}>{label}</span>
        {estErreur ? (
          <span className="pastille-alerte">erreur</span>
        ) : (
          <span className={estPositif ? "pastille-alerte" : "pastille-succes"}>
            {resultat.prediction}
          </span>
        )}
      </div>
      <div className="space-y-2">
        <div>
          <p className="font-corps text-[10px] text-aeris-texte-secondaire">
            Confiance
          </p>
          <p className="font-mono text-lg text-aeris-texte">
            {(resultat.confiance * 100).toFixed(1)}
            <span className="text-xs text-aeris-texte-secondaire">%</span>
          </p>
        </div>
        <div>
          <p className="font-corps text-[10px] text-aeris-texte-secondaire">
            Inference
          </p>
          <p className="font-mono text-lg text-aeris-texte">
            {resultat.temps_inference_ms.toFixed(0)}
            <span className="text-xs text-aeris-texte-secondaire"> ms</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function BandeauDecision({ reponse }: { reponse: ReponseRoutage }) {
  const estEdge = reponse.decision.destination === "edge";
  return (
    <div
      className={`panneau border-l-4 p-5 ${
        estEdge ? "border-l-aeris-edge" : "border-l-aeris-cloud"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-corps text-xs text-aeris-texte-secondaire">
            Traite sur
          </p>
          <p className="font-titre text-lg font-semibold text-aeris-texte mt-0.5">
            {estEdge ? "Edge — modele leger" : "Cloud — DenseNet121"}
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
  );
}

function CarteResultat({
  resultat,
}: {
  resultat: { pathologie: string; prediction: string; confiance: number; temps_inference_ms: number };
}) {
  const estPositif = resultat.prediction === "positif";
  const estErreur = resultat.prediction === "erreur";

  return (
    <div className="panneau p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              estErreur
                ? "bg-aeris-texte-secondaire"
                : estPositif
                  ? "bg-aeris-alerte"
                  : "bg-aeris-succes"
            }`}
          />
          <p className="font-titre text-base font-semibold text-aeris-texte capitalize">
            {resultat.pathologie}
          </p>
        </div>
        {estErreur ? (
          <span className="pastille text-aeris-texte-secondaire bg-slate-100">
            service indisponible
          </span>
        ) : (
          <span className={estPositif ? "pastille-alerte" : "pastille-succes"}>
            {estPositif ? "Detection positive" : "Aucune detection"}
          </span>
        )}
      </div>
      {!estErreur && (
        <div className="mt-4 flex items-end gap-8">
          <div>
            <p className="text-xs text-aeris-texte-secondaire font-corps">
              Confiance du modele
            </p>
            <p className="font-mono text-2xl text-aeris-texte mt-0.5">
              {(resultat.confiance * 100).toFixed(1)}
              <span className="text-sm text-aeris-texte-secondaire">%</span>
            </p>
            <div className="mt-1.5 w-40 h-1.5 bg-aeris-bordure rounded-full">
              <div
                className={`h-full rounded-full ${
                  estPositif ? "bg-aeris-alerte" : "bg-aeris-succes"
                }`}
                style={{ width: `${resultat.confiance * 100}%` }}
              />
            </div>
          </div>
          <div>
            <p className="text-xs text-aeris-texte-secondaire font-corps">
              Temps d'inference
            </p>
            <p className="font-mono text-2xl text-aeris-texte mt-0.5">
              {resultat.temps_inference_ms.toFixed(0)}
              <span className="text-sm text-aeris-texte-secondaire"> ms</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function BandeauMetriques({ reponse }: { reponse: ReponseRoutage }) {
  const m = reponse.decision.metriques;
  return (
    <div className="panneau p-4">
      <p className="font-corps text-xs text-aeris-texte-secondaire mb-2">
        Etat du systeme au moment de la decision
      </p>
      <div className="flex gap-6 font-mono text-sm text-aeris-texte">
        <span>
          CPU <span className="font-medium">{m.cpu_pourcentage.toFixed(1)}%</span>
        </span>
        <span>
          RAM <span className="font-medium">{m.ram_pourcentage.toFixed(1)}%</span>
        </span>
        <span>
          Latence{" "}
          <span className="font-medium">{m.latence_reseau_ms.toFixed(1)} ms</span>
        </span>
        <span>
          Reseau{" "}
          <span className={m.reseau_disponible ? "text-aeris-succes" : "text-aeris-alerte"}>
            {m.reseau_disponible ? "ok" : "coupe"}
          </span>
        </span>
      </div>
    </div>
  );
}

export default PageDiagnostic;
