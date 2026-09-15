import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, connexion } from "@/lib/api";
import { definirSession, useSession, type Session } from "@/lib/authentification-store";
import { pageAccueilPourRole } from "@/lib/authentification";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { retro?: string } => {
    const retro = typeof search["retro"] === "string" ? search["retro"] : undefined;
    return retro ? { retro } : {};
  },
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Connexion · AERIS" },
      {
        name: "description",
        content: "Accès réservé aux profils Administrateur et Clinicien de la plateforme AERIS.",
      },
      { property: "og:title", content: "Connexion · AERIS" },
      { property: "og:type", content: "website" },
    ],
  }),
});

function LoginPage() {
  const navigate = useNavigate();
  const { retro } = Route.useSearch();
  const session = useSession();

  // Déjà connecté : on redirige vers la page du rôle dès l'affichage.
  useEffect(() => {
    if (session) void navigate({ to: pageAccueilPourRole(session.personne.role) });
  }, [session, navigate]);

  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [visible, setVisible] = useState(false);
  const [ok, setOk] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setOk(true);
    setErreur(null);
    try {
      const reponse = await connexion(email.trim(), motDePasse);
      const sess: Session = {
        personne: reponse.personne,
        acces_token: reponse.acces_token,
        rafraichissement_token: reponse.rafraichissement_token,
        expire_le: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      definirSession(sess);
      const cible =
        retro && retro.startsWith("/") ? retro : pageAccueilPourRole(sess.personne.role);
      void navigate({ to: cible });
    } catch (e) {
      setErreur(
        e instanceof ApiError && e.status === 401
          ? "Email ou mot de passe incorrect."
          : "Le moteur est injoignable. Réessayez dans un instant.",
      );
      setOk(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* ---- Panneau gauche : image + overlay navy + courbe organique ---- */}
      <div className="relative hidden w-[60%] lg:block">
        <img
          src="/landing-page.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-navy/80" />

        {/* Courbe organique blanche séparatrice — se fond dans le panneau droit */}
        <svg
          className="absolute inset-y-0 right-0 h-full w-[250px]"
          viewBox="0 0 250 1000"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M250 0V1000H130C100 780 30 630 30 500S100 220 130 0Z"
            style={{ fill: "var(--navy)" }}
          />
        </svg>

        {/* Branding superposé à l'image */}
        <div className="relative z-10 flex h-full flex-col items-center justify-center p-12">
          <img src="/logo-aeris.png" alt="AERIS" className="w-48 object-contain" />
          <p className="mt-4 max-w-xs text-center text-sm leading-relaxed text-white/70">
            Radiologie intelligente au Sénégal — triage assisté par IA en zones à faible
            connectivité.
          </p>
        </div>
      </div>

      {/* ---- Panneau droit : formulaire de connexion ---- */}
      <div className="flex w-full items-center justify-center bg-navy px-6 py-10 text-navy-foreground lg:w-[40%]">
        <div className="w-full max-w-md">
          {/* Logo mobile (masqué sur desktop) */}
          <div className="mb-8 text-center lg:hidden">
            <img src="/logo-aeris.png" alt="AERIS" className="mx-auto w-32 object-contain" />
          </div>

          <h1 className="text-center text-2xl font-bold tracking-tight text-navy-foreground">
            Bienvenue
          </h1>
          <p className="mt-1 text-center text-sm text-navy-muted">
            Connectez-vous pour accéder à votre compte
          </p>

          <form onSubmit={(e) => void soumettre(e)} className="mt-8 space-y-5">
            <label className="block">
              <span className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-navy-muted">
                Email
              </span>
              <div className="relative mt-2">
                <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/50" />
                <input
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="prenom.nom@exemple.sn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-white/10 py-3 pr-3 pl-10 text-sm text-white outline-none placeholder:text-white/40 focus:border-ok focus:ring-2 focus:ring-ok/30"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-navy-muted">
                Mot de passe
              </span>
              <div className="relative mt-2">
                <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/50" />
                <input
                  type={visible ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-white/10 py-3 pr-10 pl-10 text-sm text-white outline-none placeholder:text-white/40 focus:border-ok focus:ring-2 focus:ring-ok/30"
                />
                <button
                  type="button"
                  onClick={() => setVisible((v) => !v)}
                  aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-white/50 transition-colors hover:text-white"
                >
                  {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </label>

            {erreur && (
              <p className="flex items-start gap-2 rounded-lg border border-alert/40 bg-alert-soft/40 p-3 text-xs leading-relaxed text-alert">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                {erreur}
              </p>
            )}

            <button
              type="submit"
              disabled={ok}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-ok px-4 py-3 text-sm font-semibold text-white transition-opacity",
                ok ? "cursor-wait opacity-70" : "hover:opacity-90",
              )}
            >
              {ok && <Loader2 className="size-4 animate-spin" />}
              Se connecter
            </button>
          </form>

          <p className="mt-5 text-center text-[11px] text-navy-muted">
            Patient ? Vos résultats arrivent par email avec un code OTP.
          </p>
          <p className="mt-4 text-center font-mono text-[10px] text-navy-muted/70">
            Prototype de recherche · Master 2 SI · UADB · 2025-2026
          </p>
        </div>
      </div>
    </div>
  );
}
