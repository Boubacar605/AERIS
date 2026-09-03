import { BrowserRouter, Routes, Route } from "react-router-dom";
import MiseEnPage from "./composants/MiseEnPage";
import PageAccueil from "./pages/PageAccueil";
import PageDiagnostic from "./pages/PageDiagnostic";
import PageHistorique from "./pages/PageHistorique";
import PageMonitoring from "./pages/PageMonitoring";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MiseEnPage />}>
          <Route path="/" element={<PageAccueil />} />
          <Route path="/diagnostic" element={<PageDiagnostic />} />
          <Route path="/historique" element={<PageHistorique />} />
          <Route path="/monitoring" element={<PageMonitoring />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
