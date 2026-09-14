import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { UserRound, Users } from "lucide-react";
import { useEffect } from "react";
import { AppShell, PageHeader } from "@/components/aeris/AppShell";
import { exigerRole } from "@/lib/authentification";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  beforeLoad: () => exigerRole("admin"),
  component: AdminLayout,
  head: () => ({
    meta: [{ title: "Administration · AERIS" }],
  }),
});

const ONGLETS = [
  { to: "/admin/utilisateurs", label: "Utilisateurs", icon: Users },
  { to: "/admin/patients", label: "Patients", icon: UserRound },
] as const;

function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  // /admin seul n'a pas de contenu : on bascule sur le premier onglet.
  useEffect(() => {
    if (pathname === "/admin") void navigate({ to: "/admin/utilisateurs" });
  }, [pathname, navigate]);

  return (
    <AppShell>
      <PageHeader
        title="Administration"
        description="Gestion des comptes et des patients — profil administrateur uniquement"
      />
      <nav className="flex gap-1 border-b border-border bg-card/40 px-5 py-2">
        {ONGLETS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              pathname.startsWith(to)
                ? "bg-navy text-navy-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        ))}
      </nav>
      <main className="p-5">
        <Outlet />
      </main>
    </AppShell>
  );
}
