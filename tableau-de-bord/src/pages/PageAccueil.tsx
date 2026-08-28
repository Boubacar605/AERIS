function PageAccueil() {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CarteStatut titre="Service Tuberculose" statut="operationnel" />
        <CarteStatut titre="Service Pneumonie" statut="operationnel" />
        <CarteStatut titre="Moteur de Decision" statut="operationnel" />
      </section>

      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">
          Soumettre une radiographie
        </h2>
        <p className="text-gray-500">
          TODO: Formulaire d'upload d'image et affichage des resultats de
          diagnostic.
        </p>
      </section>

      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Metriques en temps reel</h2>
        <p className="text-gray-500">
          TODO: Graphiques Recharts affichant CPU, RAM, latence, decisions de
          routage.
        </p>
      </section>
    </div>
  );
}

function CarteStatut({
  titre,
  statut,
}: {
  titre: string;
  statut: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-medium text-gray-700">{titre}</h3>
      <span className="inline-block mt-2 px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
        {statut}
      </span>
    </div>
  );
}

export default PageAccueil;
