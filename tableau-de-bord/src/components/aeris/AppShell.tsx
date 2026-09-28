import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  CalendarClock,
  ClipboardList,
  FileText,
  Gauge,
  History,
  Home,
  LayoutGrid,
  ListChecks,
  LogOut,
  Network,
  RefreshCw,
  ScanLine,
  Settings,
  UserRound,
  Users,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchAPI } from "@/lib/api";
import {
  deconnecter,
  useRole,
  useUtilisateur,
  type RoleUtilisateur,
} from "@/lib/authentification-store";
import { StatusDot, Tag } from "./primitives";
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
        // /historique est lisible par les deux rôles connectés (contrairement à
        // /etat-systeme réservé à l'admin) : la jauge de connexion du shell
        // demeure fiable pour un clinicien comme pour un administrateur.
        await fetchAPI("/historique");
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

const NAV: ReadonlyArray<{
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  roles?: readonly RoleUtilisateur[];
  /** « Accueil » : ferme la session puis revient à la page publique. */
  deconnecte?: boolean;
}> = [
  { to: "/", label: "Accueil", icon: Home, deconnecte: true },
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid, roles: ["admin"] },
  // Tableau de bord du poste : l'état de la charge avant d'ouvrir quoi que ce soit.
  { to: "/poste", label: "Poste", icon: Gauge, roles: ["clinicien"] },
  { to: "/diagnostic", label: "Diagnostic", icon: ScanLine, roles: ["clinicien"] },
  { to: "/resultat", label: "Résultat", icon: FileText, roles: ["clinicien"] },
  // File de triage : la première porte du poste, ce qui attend une décision.
  { to: "/triage", label: "Triage", icon: ListChecks, roles: ["clinicien"] },
  // Dossier et échéances : le quotidien du clinicien, entre deux examens.
  { to: "/patients", label: "Patients", icon: UserRound, roles: ["clinicien"] },
  { to: "/suivi", label: "Suivi", icon: CalendarClock, roles: ["clinicien"] },
  // Bilan de charge du poste : où en est la file, et ce que le protocole a tranché.
  { to: "/protocole", label: "Protocole", icon: ClipboardList, roles: ["clinicien"] },
  { to: "/historique", label: "Historique", icon: History, roles: ["admin", "clinicien"] },
  // Sous-menus d'administration (réservés à l'admin IT).
  { to: "/admin/utilisateurs", label: "Utilisateurs", icon: Users, roles: ["admin"] },
  { to: "/admin/patients", label: "Patients", icon: UserRound, roles: ["admin"] },
  { to: "/monitoring", label: "Monitoring", icon: Activity, roles: ["admin"] },
  { to: "/architecture", label: "Architecture", icon: Network, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
];

/**
 * « Accueil » n'est pas une simple navigation : quitter la plateforme doit
 * terminer la session, sinon le poste reste connecté après une fermeture
 * d'onglet.
 *
 * L'ordre est déterminant : on navigue d'abord, on déconnecte ensuite. Vider la
 * session alors que l'URL est encore un chemin protégé (`/dashboard`,
 * `/monitoring`…) déclenche la garde post-hydratation de `__root.tsx`, qui lit
 * `window.location.pathname` et renvoie vers `/login` : c'était la landing page
 * qui se transformait en page de connexion. Une fois sur `/`, le chemin n'est
 * plus protégé et la garde ne redirige plus.
 */
function useRetourAccueil() {
  const navigate = useNavigate();
  return useCallback(async () => {
    await navigate({ to: "/" });
    deconnecter();
  }, [navigate]);
}

/** Navigation visible pour un rôle donné (null = aucune session). */
function navigationPour(role: RoleUtilisateur | null) {
  return NAV.filter(({ roles }) => !roles || (role !== null && roles.includes(role)));
}

const LIBELLES_ROLE: Record<RoleUtilisateur, string> = {
  admin: "Administrateur",
  clinicien: "Clinicien",
};

const TONES_ROLE: Record<RoleUtilisateur, "ok" | "cloud"> = {
  admin: "ok",
  clinicien: "cloud",
};

function BlocUtilisateur() {
  const role = useRole();
  const utilisateur = useUtilisateur();
  const navigate = useNavigate();

  const seDeconnecter = useCallback(() => {
    deconnecter();
    void navigate({ to: "/login", search: {} });
  }, [navigate]);

  if (!utilisateur || !role) return null;

  const initiales = `${utilisateur.nom[0] ?? ""}${utilisateur.prenom[0] ?? ""}`.toUpperCase();

  return (
    <div className="flex items-center gap-2 border-t border-navy-line p-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ok/20 font-mono text-[11px] font-bold text-ok">
        {initiales || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-navy-foreground">
          {utilisateur.prenom} {utilisateur.nom}
        </p>
        <Tag tone={TONES_ROLE[role]} className="mt-0.5">
          {LIBELLES_ROLE[role]}
        </Tag>
      </div>
      <button
        type="button"
        onClick={seDeconnecter}
        title="Se déconnecter"
        aria-label="Se déconnecter"
        className="grid size-8 shrink-0 place-items-center rounded-md text-navy-muted transition-colors hover:bg-white/10 hover:text-alert"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const role = useRole();
  const retourAccueil = useRetourAccueil();
  const entrées = navigationPour(role);
  return (
    <aside className="sticky top-0 hidden h-screen w-[15rem] shrink-0 flex-col border-r border-navy-line bg-navy text-navy-foreground md:flex">
      <div className="flex shrink-0 flex-col border-b border-navy-line">
        <Link to="/">
          <img src="/logo-aeris.png" alt="AERIS" className="w-full object-contain" />
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
        {entrées.map(({ to, label, icon: Icon, deconnecte }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          const classes = cn(
            "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
            active
              ? "bg-white/10 text-navy-foreground"
              : "text-navy-muted hover:bg-white/5 hover:text-navy-foreground",
          );
          const contenu = (
            <>
              {active && (
                <span className="absolute top-1.5 bottom-1.5 -left-0.5 w-0.5 rounded-full bg-cloud" />
              )}
              <Icon className="size-4" />
              {label}
            </>
          );
          return deconnecte ? (
            <button
              key={to}
              type="button"
              onClick={() => void retourAccueil()}
              title="Revenir à l'accueil et se déconnecter"
              className={cn(classes, "w-full cursor-pointer text-left")}
            >
              {contenu}
            </button>
          ) : (
            <Link key={to} to={to} className={classes}>
              {contenu}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0">
        <div className="border-t border-navy-line p-3">
          <ModeGlobal />
          <p className="mt-3 px-1 font-mono text-[10px] text-navy-muted">build 0.9.3 · research</p>
        </div>
        <BlocUtilisateur />
      </div>
    </aside>
  );
}

function MobileNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const role = useRole();
  const navigate = useNavigate();
  const retourAccueil = useRetourAccueil();
  const entrées = navigationPour(role);
  return (
    <div className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-navy-line bg-navy px-3 py-2 md:hidden">
      {entrées.map(({ to, label, icon: Icon, deconnecte }) => {
        const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
        const classes = cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap",
          active ? "bg-white/12 text-navy-foreground" : "text-navy-muted",
        );
        return deconnecte ? (
          <button
            key={to}
            type="button"
            onClick={() => void retourAccueil()}
            title="Revenir à l'accueil et se déconnecter"
            className={cn(classes, "cursor-pointer")}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ) : (
          <Link key={to} to={to} className={classes}>
            <Icon className="size-3.5" />
            {label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => {
          deconnecter();
          void navigate({ to: "/login", search: {} });
        }}
        aria-label="Se déconnecter"
        title="Se déconnecter"
        className="ml-auto grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-navy-muted hover:bg-white/10 hover:text-alert"
      >
        <LogOut className="size-3.5" />
      </button>
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
