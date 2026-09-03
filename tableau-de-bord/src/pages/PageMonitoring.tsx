import { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { obtenirEtatSysteme, type EtatSysteme } from "../services-api/client";

const COULEURS = {
  edge: "#D4A84B",
  cloud: "#5B9BD5",
  cpu: "#0F2B46",
  ram: "#3CBBB1",
  grille: "#DDE1E8",
  fond: "#F1F3F6",
  seuil: "#A63D40",
};

const SEUILS = { cpu: 80, ram: 85, latence: 100 };
const INTERVALLE_POLLING = 3000;
const MAX_POINTS = 20;

interface PointTemps {
  t: string;
  cpu: number;
  ram: number;
  latence: number;
}

function horodatage(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

function PageMonitoring() {
  const [etat, setEtat] = useState<EtatSysteme | null>(null);
  const [historique, setHistorique] = useState<PointTemps[]>([]);
  const [connecte, setConnecte] = useState(false);
  const historiqueRef = useRef(historique);
  historiqueRef.current = historique;

  const interroger = useCallback(async () => {
    try {
      const donnees = await obtenirEtatSysteme();
      setEtat(donnees);
      setConnecte(true);

      const point: PointTemps = {
        t: horodatage(),
        cpu: donnees.edge.cpu_pourcentage,
        ram: donnees.edge.ram_pourcentage,
        latence: donnees.cloud.latence_ms,
      };

      setHistorique((prev) => {
        const maj = [...prev, point];
        return maj.length > MAX_POINTS ? maj.slice(-MAX_POINTS) : maj;
      });
    } catch {
      setConnecte(false);
    }
  }, []);

  useEffect(() => {
    interroger();
    const intervalle = setInterval(interroger, INTERVALLE_POLLING);
    return () => clearInterval(intervalle);
  }, [interroger]);

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-titre text-3xl font-bold text-aeris-texte">
            Monitoring
          </h2>
          <p className="font-corps text-base text-aeris-texte-secondaire mt-1">
            Metriques systeme en temps reel
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              connecte ? "bg-aeris-succes" : "bg-aeris-alerte"
            }`}
          />
          <span className="font-corps text-xs text-aeris-texte-secondaire">
            {connecte
              ? `Connecte — rafraichissement ${INTERVALLE_POLLING / 1000}s`
              : "Moteur de decision injoignable"}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <CarteMetriqueVivante
          label="CPU Edge"
          valeur={etat?.edge.cpu_pourcentage}
          unite="%"
          seuil={SEUILS.cpu}
          variante="edge"
          connecte={connecte}
        />
        <CarteMetriqueVivante
          label="RAM Edge"
          valeur={etat?.edge.ram_pourcentage}
          unite="%"
          seuil={SEUILS.ram}
          variante="edge"
          connecte={connecte}
        />
        <CarteMetriqueVivante
          label="Latence Cloud"
          valeur={etat?.cloud.latence_ms}
          unite="ms"
          seuil={SEUILS.latence}
          variante="cloud"
          connecte={connecte}
        />
        <CarteMetriqueVivante
          label="RAM utilisee"
          valeur={etat?.edge.ram_utilisee_mb}
          unite="MB"
          seuil={undefined}
          variante="neutre"
          connecte={connecte}
          sousTitre={
            etat
              ? `sur ${etat.edge.ram_totale_mb} MB`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panneau p-6">
          <h3 className="font-titre text-base font-semibold text-aeris-texte mb-5">
            Ressources Edge
          </h3>
          {historique.length < 2 ? (
            <PlaceholderGraphique connecte={connecte} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={historique}>
                <CartesianGrid strokeDasharray="3 3" stroke={COULEURS.grille} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                  stroke={COULEURS.grille}
                />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                  stroke={COULEURS.grille}
                  domain={[0, 100]}
                  unit=" %"
                />
                <ReferenceLine y={SEUILS.cpu} stroke={COULEURS.seuil} strokeDasharray="4 4" strokeWidth={1} label={{ value: `CPU ${SEUILS.cpu}%`, fontSize: 9, fill: COULEURS.seuil }} />
                <ReferenceLine y={SEUILS.ram} stroke={COULEURS.seuil} strokeDasharray="4 4" strokeWidth={1} label={{ value: `RAM ${SEUILS.ram}%`, fontSize: 9, fill: COULEURS.seuil }} />
                <Tooltip content={<TooltipPersonnalise />} />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  stroke={COULEURS.cpu}
                  fill={COULEURS.cpu}
                  fillOpacity={0.08}
                  strokeWidth={2}
                  name="CPU"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="ram"
                  stroke={COULEURS.ram}
                  fill={COULEURS.ram}
                  fillOpacity={0.12}
                  strokeWidth={2}
                  name="RAM"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panneau p-6">
          <h3 className="font-titre text-base font-semibold text-aeris-texte mb-5">
            Latence reseau vers le Cloud
          </h3>
          {historique.length < 2 ? (
            <PlaceholderGraphique connecte={connecte} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={historique}>
                <CartesianGrid strokeDasharray="3 3" stroke={COULEURS.grille} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                  stroke={COULEURS.grille}
                />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                  stroke={COULEURS.grille}
                  unit=" ms"
                />
                <ReferenceLine y={SEUILS.latence} stroke={COULEURS.seuil} strokeDasharray="4 4" strokeWidth={1} label={{ value: `Seuil ${SEUILS.latence}ms`, fontSize: 9, fill: COULEURS.seuil }} />
                <Tooltip content={<TooltipPersonnalise />} />
                <Area
                  type="monotone"
                  dataKey="latence"
                  stroke={COULEURS.cloud}
                  fill={COULEURS.cloud}
                  fillOpacity={0.12}
                  strokeWidth={2}
                  name="Latence"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function CarteMetriqueVivante({
  label,
  valeur,
  unite,
  seuil,
  variante,
  connecte,
  sousTitre,
}: {
  label: string;
  valeur: number | undefined;
  unite: string;
  seuil: number | undefined;
  variante: "edge" | "cloud" | "neutre";
  connecte: boolean;
  sousTitre?: string;
}) {
  const critique = seuil !== undefined && valeur !== undefined && valeur > seuil;
  const bordure = {
    edge: "border-l-aeris-edge",
    cloud: "border-l-aeris-cloud",
    neutre: "border-l-aeris-bordure",
  }[variante];

  return (
    <div className={`panneau border-l-4 ${bordure} p-5`}>
      <p className="text-sm text-aeris-texte-secondaire font-corps mb-2">
        {label}
      </p>
      {connecte && valeur !== undefined ? (
        <>
          <div className="flex items-baseline">
            <span
              className={`font-mono text-3xl font-medium tracking-tight ${
                critique ? "text-aeris-alerte" : "text-aeris-texte"
              }`}
            >
              {typeof valeur === "number" ? valeur.toFixed(valeur > 100 ? 0 : 1) : valeur}
            </span>
            <span className="font-corps text-sm text-aeris-texte-secondaire ml-1">
              {unite}
            </span>
          </div>
          {seuil !== undefined && (
            <div className="mt-2">
              <div className="h-1.5 bg-aeris-bordure rounded-full relative">
                <div
                  className={`h-full rounded-full ${critique ? "bg-aeris-alerte" : "bg-aeris-accent/60"}`}
                  style={{ width: `${Math.min((valeur / seuil) * 100, 100)}%` }}
                />
                <div
                  className="absolute top-[-2px] w-[2px] h-[8px] bg-aeris-texte-secondaire/40 rounded-full"
                  style={{ left: `${Math.min(100, 100)}%` }}
                />
              </div>
              <p className="font-corps text-[10px] text-aeris-texte-secondaire/50 mt-0.5">
                seuil {seuil}{unite}
              </p>
            </div>
          )}
          {sousTitre && (
            <p className="font-corps text-xs text-aeris-texte-secondaire mt-1">
              {sousTitre}
            </p>
          )}
        </>
      ) : (
        <p className="font-mono text-lg text-aeris-texte-secondaire/40">---</p>
      )}
    </div>
  );
}

function PlaceholderGraphique({ connecte }: { connecte: boolean }) {
  return (
    <div className="flex items-center justify-center h-[260px]">
      <p className="font-corps text-sm text-aeris-texte-secondaire">
        {connecte
          ? "Collecte des donnees en cours..."
          : "En attente de connexion au moteur de decision"}
      </p>
    </div>
  );
}

function TooltipPersonnalise({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panneau p-3 text-xs">
      <p className="font-mono text-aeris-texte-secondaire mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.stroke }} className="font-corps">
          {p.name}: <span className="font-mono font-medium">{p.value.toFixed(1)}</span>
        </p>
      ))}
    </div>
  );
}

export default PageMonitoring;
