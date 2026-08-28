import { BrowserRouter, Routes, Route } from "react-router-dom";
import PageAccueil from "./pages/PageAccueil";

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <h1 className="text-2xl font-bold text-gray-900">
              AERIS — Tableau de Bord
            </h1>
            <p className="text-sm text-gray-500">
              Architecture Edge-Cloud pour la Radiologie Intelligente au Senegal
            </p>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<PageAccueil />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
