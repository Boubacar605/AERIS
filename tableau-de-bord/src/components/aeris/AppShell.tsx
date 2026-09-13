import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Cpu,
  FileText,
  LayoutGrid,
  Network,
  RefreshCw,
  ScanLine,
  Settings,
  History,
  Home,
} from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchAPI } from "@/lib/api";
import { StatusDot } from "./primitives";
import { useClock } from "@/lib/aeris";
import { cn } from "@/lib/utils";

/**
 * Contexte de connexion global au moteur de décision.
 *
 * Un seul polling GET /etat-systeme (12 s) alimente tous les indicateurs
 * du shell (badge PageHeader + boîte sidebar). Si le backend est injoignable,
 * `connecte` vaut false : aucune page n'invente de données, chacune affiche
 * son propre état « indisponible » via son hook.
 */
type ContexteConnexionType = {
  connecte: boolean;
  verifier: () => void;
};

const ContexteConnexion = createContext<ContexteConnexionType | null>(null);

export function useConnexion(): ContexteConnexionType {
  const ctx = useContext(ContexteConnexion);
  if (!ctx) throw new Error("useConnexion doit être utilisé sous <AppShell>");
  return ctx;
}

function FournisseurConnexion({ children }: { children: ReactNode }) {
  const [connecte, setConnecte] = useState(false);
  const [pulsation, setPulsation] = useState(0);

  useEffect(() => {
    let actif = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function sonder() {
      try {
        await fetchAPI("/etat-systeme");
        if (actif) setConnecte(true);
      } catch {
        if (actif) setConnecte(false);
      }
      if (actif) timer = setTimeout(sonder, 12_000);
    }

    void sonder();
    return () => {
      actif = false;
      if (timer) clearTimeout(timer);
    };
  }, [pulsation]);

  const verifier = () => setPulsation((n) => n + 1);

  return (
    <ContexteConnexion.Provider value={{ connecte, verifier }}>
      {children}
    </ContexteConnexion.Provider>
  );
}

/** Indicateur global de connexion au moteur (consomme le contexte global). */
function ModeGlobal() {
  const { connecte, verifier } = useConnexion();

  return (
    <button
      type="button"
      onClick={verifier}
      title={
        connecte
          ? "Connecté au moteur — cliquer pour re-sonder"
          : "Moteur indisponible — cliquer pour re-tenter"
      }
      className={cn(
        "w-full rounded-md border p-2.5 text-left transition-colors",
        connecte
          ? "border-ok/30 bg-ok/10 hover:bg-ok/15"
          : "border-alert/30 bg-alert/10 hover:bg-alert/15",
      )}
    >
      <p
        className={cn(
          "font-mono text-[10px] tracking-[0.14em] uppercase",
          connecte ? "text-ok" : "text-alert",
        )}
      >
        {connecte ? "● Connecté" : "● Moteur injoignable"}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-navy-muted">
        {connecte ? "au moteur de décision" : "backend indisponible"}
      </p>
    </button>
  );
}

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/", label: "Présentation", icon: Home },
  { to: "/diagnostic", label: "Diagnostic", icon: ScanLine },
  { to: "/resultat", label: "Résultat", icon: FileText },
  { to: "/historique", label: "Historique", icon: History },
  { to: "/monitoring", label: "Monitoring", icon: Activity },
  { to: "/architecture", label: "Architecture", icon: Network },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="sticky top-0 hidden h-screen w-[15rem] shrink-0 flex-col bg-navy text-navy-foreground md:flex">
      <div className="flex items-center gap-2.5 border-b border-navy-line px-4 py-4">
        <span className="grid size-8 place-items-center rounded-md bg-cloud/20 ring-1 ring-cloud/40">
          <Cpu className="size-4 text-cloud" />
        </span>
        <div className="leading-tight">
          <p className="font-mono text-sm font-bold tracking-[0.22em]">AERIS</p>
          <p className="text-[10px] tracking-wide text-navy-muted">Adaptive Edge-Cloud AI</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 p-2.5">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-white/10 text-navy-foreground"
                  : "text-navy-muted hover:bg-white/5 hover:text-navy-foreground",
              )}
            >
              {active && (
                <span className="absolute top-1.5 bottom-1.5 -left-0.5 w-0.5 rounded-full bg-cloud" />
              )}
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-navy-line p-3">
        <ModeGlobal />
        <p className="mt-3 px-1 font-mono text-[10px] text-navy-muted">build 0.9.3 · research</p>
      </div>
    </aside>
  );
}

function MobileNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-navy-line bg-navy px-3 py-2 md:hidden">
      {NAV.map(({ to, label, icon: Icon }) => {
        const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap",
              active ? "bg-white/12 text-navy-foreground" : "text-navy-muted",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description: string;
  right?: ReactNode;
}) {
  const now = useClock();
  const { connecte } = useConnexion();
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-card/60 px-5 py-3 backdrop-blur">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        {right}
        <div
          className={cn(
            "hidden items-center gap-2 rounded-md border px-2.5 py-1.5 sm:flex",
            connecte ? "border-ok/30 bg-ok-soft" : "border-alert/30 bg-alert-soft",
          )}
        >
          <StatusDot tone={connecte ? "ok" : "alert"} />
          <span
            className={cn(
              "font-mono text-[10px] font-semibold tracking-[0.12em] uppercase",
              connecte ? "text-ok" : "text-alert",
            )}
          >
            {connecte ? "System operational" : "Backend indisponible"}
          </span>
        </div>
        <div className="text-right">
          <p className="label-xs">Last sync</p>
          <p className="font-mono text-xs tabular-nums">
            {now ? now.toLocaleTimeString("fr-FR", { hour12: false }) : "--:--:--"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          aria-label="Rafraîchir"
          className="grid size-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <FournisseurConnexion>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav />
          {children}
        </div>
      </div>
    </FournisseurConnexion>
  );
}
