import MoteurDecisionHero from "../composants/MoteurDecisionHero";
import BlocNoeud from "../composants/JaugeNoeud";
import BandePellicule from "../composants/BandePellicule";

const INFERENCES_RECENTES = [
  { id: 47, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.92, confiancePn: 0.87, temps: 187, heure: "14:23" },
  { id: 46, destination: "cloud" as const, tb: "pos", pn: "neg", confianceTb: 0.78, confiancePn: 0.91, temps: 342, heure: "14:18" },
  { id: 45, destination: "edge" as const, tb: "neg", pn: "pos", confianceTb: 0.95, confiancePn: 0.83, temps: 201, heure: "13:55" },
  { id: 44, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.97, confiancePn: 0.90, temps: 175, heure: "13:40" },
  { id: 43, destination: "cloud" as const, tb: "neg", pn: "neg", confianceTb: 0.94, confiancePn: 0.88, temps: 410, heure: "13:12" },
];

const DONNEES_PELLICULE = [
  ...INFERENCES_RECENTES,
  { id: 42, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.91, confiancePn: 0.85, temps: 160 },
  { id: 41, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.93, confiancePn: 0.89, temps: 155 },
  { id: 40, destination: "cloud" as const, tb: "neg", pn: "neg", confianceTb: 0.96, confiancePn: 0.92, temps: 380 },
  { id: 39, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.90, confiancePn: 0.86, temps: 170 },
  { id: 38, destination: "edge" as const, tb: "pos", pn: "neg", confianceTb: 0.81, confiancePn: 0.94, temps: 195 },
  { id: 37, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.98, confiancePn: 0.91, temps: 148 },
  { id: 36, destination: "cloud" as const, tb: "neg", pn: "pos", confianceTb: 0.95, confiancePn: 0.76, temps: 365 },
  { id: 35, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.92, confiancePn: 0.88, temps: 162 },
  { id: 34, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.94, confiancePn: 0.90, temps: 157 },
  { id: 33, destination: "cloud" as const, tb: "neg", pn: "neg", confianceTb: 0.93, confiancePn: 0.87, temps: 395 },
  { id: 32, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.96, confiancePn: 0.91, temps: 143 },
  { id: 31, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.91, confiancePn: 0.85, temps: 168 },
  { id: 30, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.95, confiancePn: 0.89, temps: 151 },
  { id: 29, destination: "cloud" as const, tb: "neg", pn: "neg", confianceTb: 0.92, confiancePn: 0.90, temps: 388 },
  { id: 28, destination: "edge" as const, tb: "neg", pn: "neg", confianceTb: 0.97, confiancePn: 0.93, temps: 140 },
];

function PageAccueil() {
  return (
    <div className="space-y-8">
      <header>
        <h2 className="font-titre text-3xl font-bold text-aeris-texte">
          Tableau de bord
        </h2>
        <p className="font-corps text-base text-aeris-texte-secondaire mt-1">
          Systeme de triage radiologique adaptatif
        </p>
      </header>

      <MoteurDecisionHero
        requeteId={47}
        horodatage="03/09/2026 14:23:12"
        destination="edge"
        raison="Reseau stable (34 ms, sous le seuil de 100 ms) et ressources Edge disponibles (CPU 42%, RAM 58%) — traitement local privilegie."
        cpu={42}
        ram={58}
        latence={34}
        seuilCpu={80}
        seuilRam={85}
        seuilLatence={100}
        resultatTb={{ prediction: "negatif", confiance: 0.92 }}
        resultatPn={{ prediction: "negatif", confiance: 0.87 }}
        tempsTotal={187}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BlocNoeud
          type="edge"
          metriques={[
            { label: "CPU", valeur: 42, unite: "%", seuil: 80 },
            { label: "RAM", valeur: 58, unite: "%", seuil: 85 },
          ]}
          services={[
            { nom: "TB", statut: "ok" },
            { nom: "PN", statut: "ok" },
          ]}
        />
        <BlocNoeud
          type="cloud"
          metriques={[
            { label: "Latence", valeur: 34, unite: "ms", seuil: 100 },
          ]}
          services={[
            { nom: "TB", statut: "ok" },
            { nom: "PN", statut: "ok" },
          ]}
        />
      </div>

      <BandePellicule inferences={DONNEES_PELLICULE} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <h3 className="font-titre text-base font-semibold text-aeris-texte mb-4">
            Dernieres inferences
          </h3>
          <div className="space-y-2">
            {INFERENCES_RECENTES.map((inf) => {
              const aPositif = inf.tb === "pos" || inf.pn === "pos";
              return (
                <div
                  key={inf.id}
                  className={`panneau border-l-[3px] px-4 py-3 flex items-center justify-between ${
                    aPositif ? "border-l-aeris-alerte" : "border-l-aeris-succes"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm text-aeris-texte font-medium">
                      #{inf.id}
                    </span>
                    <span className={inf.destination === "edge" ? "pastille-edge" : "pastille-cloud"}>
                      {inf.destination}
                    </span>
                    <span className="font-corps text-sm text-aeris-texte">
                      TB{" "}
                      <span className={inf.tb === "pos" ? "text-aeris-alerte font-medium" : "text-aeris-succes"}>
                        {inf.tb}
                      </span>
                      {" "}{(inf.confianceTb * 100).toFixed(0)}%
                      <span className="text-aeris-bordure mx-2">|</span>
                      PN{" "}
                      <span className={inf.pn === "pos" ? "text-aeris-alerte font-medium" : "text-aeris-succes"}>
                        {inf.pn}
                      </span>
                      {" "}{(inf.confiancePn * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-aeris-texte-secondaire">
                      {inf.temps} ms
                    </span>
                    <span className="font-corps text-xs text-aeris-texte-secondaire">
                      {inf.heure}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="font-titre text-base font-semibold text-aeris-texte mb-4">
            Performance
          </h3>
          <div className="space-y-3">
            <BlocPerformance
              valeur="187"
              unite="ms"
              label="Latence moyenne"
              contexte="dans la norme"
              statut="ok"
            />
            <BlocPerformance
              valeur="12"
              unite="req/min"
              label="Debit"
              contexte="stable"
              statut="ok"
            />
            <BlocPerformance
              valeur="99.2"
              unite="%"
              label="Disponibilite"
              contexte="nominal"
              statut="ok"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function BlocPerformance({
  valeur,
  unite,
  label,
  contexte,
  statut,
}: {
  valeur: string;
  unite: string;
  label: string;
  contexte: string;
  statut: "ok" | "attention" | "critique";
}) {
  const couleurContexte = {
    ok: "text-aeris-succes",
    attention: "text-aeris-edge",
    critique: "text-aeris-alerte",
  }[statut];

  return (
    <div className="panneau p-4">
      <p className="font-corps text-xs text-aeris-texte-secondaire">{label}</p>
      <div className="flex items-baseline justify-between mt-1">
        <div>
          <span className="font-mono text-2xl font-medium text-aeris-texte">{valeur}</span>
          <span className="font-corps text-xs text-aeris-texte-secondaire ml-1">{unite}</span>
        </div>
        <span className={`font-corps text-xs ${couleurContexte}`}>{contexte}</span>
      </div>
    </div>
  );
}

export default PageAccueil;
