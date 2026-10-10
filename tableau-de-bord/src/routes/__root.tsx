import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { hydraterSession, useSession } from "@/lib/authentification-store";
import { pageAccueilPourRole, rolesRequisesPour } from "@/lib/authentification";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page introuvable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          La page que vous recherchez n'existe pas ou a été déplacée.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retour à l'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Cette page n'a pas pu se charger
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Une erreur est survenue de notre côté. Réessayez ou revenez à l'accueil.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Réessayer
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Retour à l'accueil
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AERIS — Plateforme d'IA adaptative Edge-Cloud" },
      {
        name: "description",
        content: "Architecture Edge-Cloud pour la Radiologie Intelligente au Sénégal",
      },
      { name: "author", content: "Boubacar NIANG" },
      { property: "og:title", content: "AERIS — Plateforme d'IA adaptative Edge-Cloud" },
      {
        property: "og:description",
        content: "Architecture Edge-Cloud pour la Radiologie Intelligente au Sénégal",
      },
      { property: "og:type", content: "website" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/logo-aeris.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Garde post-hydratation : après lecture de la session (sessionStorage), on
 * vérifie que le chemin courant est autorisé pour le rôle connecté. Couvre le
 * cas d'un rechargement direct d'une page protégée : le `beforeLoad` ne voit
 * pas encore de session au moment du boot, ce contrôle rétablit la sécurité.
 */
function GardeAcheminement() {
  const session = useSession();
  const router = useRouter();
  const [hydrate, setHydrate] = useState(false);

  useEffect(() => {
    hydraterSession(); // lit sessionStorage une fois, côté client uniquement
    setHydrate(true);
  }, []);

  useEffect(() => {
    if (!hydrate) return; // avant hydratation, le rendu « serveur » s'applique

    const chemin = window.location.pathname;
    const requis = rolesRequisesPour(chemin);
    if (!requis) return;

    if (!session) {
      void router.navigate({
        to: "/login",
        search: { retro: chemin + window.location.search },
      });
      return;
    }
    if (!requis.includes(session.personne.role)) {
      void router.navigate({ to: pageAccueilPourRole(session.personne.role) });
    }
  }, [session, router, hydrate]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <GardeAcheminement />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
