import CarteMetrique from "../composants/CarteMetrique";
import CarteStatutService from "../composants/CarteStatutService";
import IndicateurDestination from "../composants/IndicateurDestination";

function PageAccueil() {
  return (
    <div className="space-y-8">
      <header>
        <h2 className="font-titre text-2xl font-bold text-aeris-texte">
          Tableau de bord
        </h2>
        <p className="font-corps text-sm text-aeris-texte-secondaire mt-1">
          Vue d'ensemble du systeme de triage radiologique
        </p>
      </header>

      <IndicateurDestination
        destination="edge"
        raison="Conditions normales - traitement local privilegie"
      />

      <section>
        <h3 className="font-titre text-sm font-semibold text-aeris-texte-secondaire uppercase tracking-wider mb-4">
          Statut des services
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <CarteStatutService
            nom="Service Tuberculose"
            statut="operationnel"
            mode="edge"
          />
          <CarteStatutService
            nom="Service Tuberculose"
            statut="operationnel"
            mode="cloud"
          />
          <CarteStatutService
            nom="Service Pneumonie"
            statut="operationnel"
            mode="edge"
          />
          <CarteStatutService
            nom="Service Pneumonie"
            statut="operationnel"
            mode="cloud"
          />
        </div>
      </section>

      <section>
        <h3 className="font-titre text-sm font-semibold text-aeris-texte-secondaire uppercase tracking-wider mb-4">
          Metriques systeme
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <CarteMetrique
            label="Utilisation CPU (Edge)"
            valeur="42"
            unite="%"
            variante="edge"
          />
          <CarteMetrique
            label="Utilisation RAM (Edge)"
            valeur="58"
            unite="%"
            variante="edge"
          />
          <CarteMetrique
            label="Latence reseau"
            valeur="34"
            unite="ms"
            variante="cloud"
          />
          <CarteMetrique
            label="Derniere inference"
            valeur="187"
            unite="ms"
            variante="neutre"
          />
        </div>
      </section>

      <section>
        <h3 className="font-titre text-sm font-semibold text-aeris-texte-secondaire uppercase tracking-wider mb-4">
          Dernier diagnostic
        </h3>
        <div className="panneau p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ResultatPathologie
              pathologie="Tuberculose"
              prediction="negatif"
              confiance={0.92}
              temps={156}
            />
            <ResultatPathologie
              pathologie="Pneumonie"
              prediction="negatif"
              confiance={0.87}
              temps={143}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function ResultatPathologie({
  pathologie,
  prediction,
  confiance,
  temps,
}: {
  pathologie: string;
  prediction: string;
  confiance: number;
  temps: number;
}) {
  const estPositif = prediction === "positif";

  return (
    <div className="flex items-start gap-4">
      <div
        className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${
          estPositif ? "bg-aeris-alerte" : "bg-aeris-succes"
        }`}
      />
      <div className="flex-1">
        <p className="font-titre text-base font-semibold text-aeris-texte">
          {pathologie}
        </p>
        <div className="flex items-baseline gap-2 mt-1">
          <span
            className={estPositif ? "pastille-alerte" : "pastille-succes"}
          >
            {prediction}
          </span>
          <span className="font-mono text-sm text-aeris-texte-secondaire">
            {(confiance * 100).toFixed(1)}%
          </span>
        </div>
        <p className="text-xs text-aeris-texte-secondaire mt-1.5 font-corps">
          Inference en{" "}
          <span className="font-mono">{temps}</span> ms
        </p>
      </div>
    </div>
  );
}

export default PageAccueil;
