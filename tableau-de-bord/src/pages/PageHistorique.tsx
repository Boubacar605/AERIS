function PageHistorique() {
  const exempleDonnees = [
    { id: 1, date: "2026-09-03 14:23", destination: "edge" as const, tb: "negatif", pn: "negatif", temps: 187 },
    { id: 2, date: "2026-09-03 14:18", destination: "cloud" as const, tb: "positif", pn: "negatif", temps: 342 },
    { id: 3, date: "2026-09-03 13:55", destination: "edge" as const, tb: "negatif", pn: "positif", temps: 201 },
    { id: 4, date: "2026-09-03 13:40", destination: "edge" as const, tb: "negatif", pn: "negatif", temps: 175 },
    { id: 5, date: "2026-09-03 13:12", destination: "cloud" as const, tb: "negatif", pn: "negatif", temps: 410 },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h2 className="font-titre text-2xl font-bold text-aeris-texte">
          Historique
        </h2>
        <p className="font-corps text-sm text-aeris-texte-secondaire mt-1">
          Journal des diagnostics et decisions de routage
        </p>
      </header>

      <div className="panneau overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-aeris-bordure bg-aeris-fond/50">
              <th className="px-5 py-3 text-left text-xs font-titre font-semibold text-aeris-texte-secondaire uppercase tracking-wider">
                Date
              </th>
              <th className="px-5 py-3 text-left text-xs font-titre font-semibold text-aeris-texte-secondaire uppercase tracking-wider">
                Destination
              </th>
              <th className="px-5 py-3 text-left text-xs font-titre font-semibold text-aeris-texte-secondaire uppercase tracking-wider">
                Tuberculose
              </th>
              <th className="px-5 py-3 text-left text-xs font-titre font-semibold text-aeris-texte-secondaire uppercase tracking-wider">
                Pneumonie
              </th>
              <th className="px-5 py-3 text-right text-xs font-titre font-semibold text-aeris-texte-secondaire uppercase tracking-wider">
                Temps
              </th>
            </tr>
          </thead>
          <tbody>
            {exempleDonnees.map((ligne, idx) => (
              <tr
                key={ligne.id}
                className={idx % 2 === 0 ? "bg-aeris-surface" : "bg-aeris-fond/30"}
              >
                <td className="px-5 py-3.5 font-mono text-sm text-aeris-texte">
                  {ligne.date}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={
                      ligne.destination === "edge"
                        ? "pastille-edge"
                        : "pastille-cloud"
                    }
                  >
                    {ligne.destination}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={
                      ligne.tb === "positif"
                        ? "pastille-alerte"
                        : "pastille-succes"
                    }
                  >
                    {ligne.tb}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={
                      ligne.pn === "positif"
                        ? "pastille-alerte"
                        : "pastille-succes"
                    }
                  >
                    {ligne.pn}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-sm text-aeris-texte">
                  {ligne.temps}
                  <span className="text-aeris-texte-secondaire text-xs"> ms</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PageHistorique;
