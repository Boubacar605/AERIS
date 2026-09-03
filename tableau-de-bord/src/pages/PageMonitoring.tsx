import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import CarteMetrique from "../composants/CarteMetrique";

const donneesLatence = [
  { t: "14:00", edge: 45, cloud: 210 },
  { t: "14:05", edge: 52, cloud: 195 },
  { t: "14:10", edge: 38, cloud: 220 },
  { t: "14:15", edge: 41, cloud: 180 },
  { t: "14:20", edge: 67, cloud: 240 },
  { t: "14:25", edge: 55, cloud: 200 },
  { t: "14:30", edge: 43, cloud: 190 },
  { t: "14:35", edge: 50, cloud: 215 },
];

const donneesRessources = [
  { t: "14:00", cpu: 35, ram: 52 },
  { t: "14:05", cpu: 42, ram: 55 },
  { t: "14:10", cpu: 38, ram: 53 },
  { t: "14:15", cpu: 71, ram: 68 },
  { t: "14:20", cpu: 85, ram: 72 },
  { t: "14:25", cpu: 56, ram: 60 },
  { t: "14:30", cpu: 44, ram: 57 },
  { t: "14:35", cpu: 40, ram: 54 },
];

const donneesDecisions = [
  { t: "14:00", edge: 4, cloud: 1 },
  { t: "14:05", edge: 3, cloud: 2 },
  { t: "14:10", edge: 5, cloud: 0 },
  { t: "14:15", edge: 2, cloud: 3 },
  { t: "14:20", edge: 0, cloud: 5 },
  { t: "14:25", edge: 3, cloud: 2 },
  { t: "14:30", edge: 4, cloud: 1 },
  { t: "14:35", edge: 4, cloud: 1 },
];

const COULEURS = {
  edge: "#D4A84B",
  cloud: "#5B9BD5",
  cpu: "#0F2B46",
  ram: "#3CBBB1",
  grille: "#DDE1E8",
};

function PageMonitoring() {
  return (
    <div className="space-y-8">
      <header>
        <h2 className="font-titre text-2xl font-bold text-aeris-texte">
          Monitoring
        </h2>
        <p className="font-corps text-sm text-aeris-texte-secondaire mt-1">
          Metriques systeme et decisions de routage en temps reel
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <CarteMetrique label="CPU actuel" valeur="40" unite="%" variante="neutre" />
        <CarteMetrique label="RAM actuelle" valeur="54" unite="%" variante="neutre" />
        <CarteMetrique label="Latence Cloud" valeur="215" unite="ms" variante="cloud" />
        <CarteMetrique label="Requetes traitees" valeur="47" unite="req" variante="succes" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panneau p-6">
          <h3 className="font-titre text-sm font-semibold text-aeris-texte-secondaire uppercase tracking-wider mb-5">
            Temps d'inference — Edge vs Cloud
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={donneesLatence}>
              <CartesianGrid strokeDasharray="3 3" stroke={COULEURS.grille} />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                stroke={COULEURS.grille}
              />
              <YAxis
                tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                stroke={COULEURS.grille}
                unit=" ms"
              />
              <Tooltip
                contentStyle={{
                  fontFamily: "IBM Plex Sans",
                  fontSize: 12,
                  border: `1px solid ${COULEURS.grille}`,
                  borderRadius: 6,
                }}
              />
              <Area
                type="monotone"
                dataKey="edge"
                stroke={COULEURS.edge}
                fill={COULEURS.edge}
                fillOpacity={0.15}
                strokeWidth={2}
                name="Edge"
              />
              <Area
                type="monotone"
                dataKey="cloud"
                stroke={COULEURS.cloud}
                fill={COULEURS.cloud}
                fillOpacity={0.15}
                strokeWidth={2}
                name="Cloud"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="panneau p-6">
          <h3 className="font-titre text-sm font-semibold text-aeris-texte-secondaire uppercase tracking-wider mb-5">
            Ressources Edge — CPU et RAM
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={donneesRessources}>
              <CartesianGrid strokeDasharray="3 3" stroke={COULEURS.grille} />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                stroke={COULEURS.grille}
              />
              <YAxis
                tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                stroke={COULEURS.grille}
                unit=" %"
                domain={[0, 100]}
              />
              <Tooltip
                contentStyle={{
                  fontFamily: "IBM Plex Sans",
                  fontSize: 12,
                  border: `1px solid ${COULEURS.grille}`,
                  borderRadius: 6,
                }}
              />
              <Area
                type="monotone"
                dataKey="cpu"
                stroke={COULEURS.cpu}
                fill={COULEURS.cpu}
                fillOpacity={0.1}
                strokeWidth={2}
                name="CPU"
              />
              <Area
                type="monotone"
                dataKey="ram"
                stroke={COULEURS.ram}
                fill={COULEURS.ram}
                fillOpacity={0.15}
                strokeWidth={2}
                name="RAM"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panneau p-6">
        <h3 className="font-titre text-sm font-semibold text-aeris-texte-secondaire uppercase tracking-wider mb-5">
          Decisions de routage dans le temps
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={donneesDecisions}>
            <CartesianGrid strokeDasharray="3 3" stroke={COULEURS.grille} />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
              stroke={COULEURS.grille}
            />
            <YAxis
              tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
              stroke={COULEURS.grille}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                fontFamily: "IBM Plex Sans",
                fontSize: 12,
                border: `1px solid ${COULEURS.grille}`,
                borderRadius: 6,
              }}
            />
            <Bar dataKey="edge" fill={COULEURS.edge} name="Edge" radius={[3, 3, 0, 0]} />
            <Bar dataKey="cloud" fill={COULEURS.cloud} name="Cloud" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default PageMonitoring;
