import { Outlet } from "react-router-dom";
import BarreLaterale from "./BarreLaterale";

function MiseEnPage() {
  return (
    <div className="min-h-screen bg-aeris-fond">
      <BarreLaterale />
      <main className="ml-64 p-8">
        <Outlet />
      </main>
    </div>
  );
}

export default MiseEnPage;
