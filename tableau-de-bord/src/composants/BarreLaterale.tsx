import { NavLink } from "react-router-dom";

const liens = [
  { chemin: "/", label: "Tableau de bord", icone: IconeTableauDeBord },
  { chemin: "/diagnostic", label: "Diagnostic", icone: IconeDiagnostic },
  { chemin: "/historique", label: "Historique", icone: IconeHistorique },
  { chemin: "/monitoring", label: "Monitoring", icone: IconeMonitoring },
];

function BarreLaterale() {
  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-aeris-profond flex flex-col">
      <div className="px-6 py-8">
        <h1 className="font-titre text-2xl font-bold text-white tracking-wide">
          AERIS
        </h1>
        <p className="font-corps text-xs text-aeris-accent mt-1 tracking-wider uppercase">
          Radiologie Intelligente
        </p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {liens.map((lien) => (
          <NavLink
            key={lien.chemin}
            to={lien.chemin}
            end={lien.chemin === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-corps ${
                isActive
                  ? "bg-aeris-profond-clair text-white"
                  : "text-slate-400 hover:text-white hover:bg-aeris-profond-clair/50"
              }`
            }
          >
            <lien.icone />
            {lien.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-6 py-6 border-t border-white/10">
        <p className="text-xs text-slate-500 font-corps">
          Universite Alioune Diop de Bambey
        </p>
        <p className="text-xs text-slate-600 font-corps mt-0.5">
          Master 2 SI — 2025-2026
        </p>
      </div>
    </aside>
  );
}

function IconeTableauDeBord() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function IconeDiagnostic() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
    </svg>
  );
}

function IconeHistorique() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconeMonitoring() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

export default BarreLaterale;
