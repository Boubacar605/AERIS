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
    <div className="grid min-h-screen place-items-center bg-navy px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/logo-aeris.png" alt="AERIS" className="mx-auto w-40 object-contain" />
          <p className="mt-3 font-mono text-[11px] tracking-[0.18em] text-navy-muted uppercase">
            Accès restreint · prototype
          </p>
        </div>

        <form
          onSubmit={(e) => void soumettre(e)}
          className="rounded-lg border border-navy-line bg-card p-6 shadow-raise"
        >
          <h1 className="text-base font-semibold text-foreground">Connexion</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Compte Administrateur ou Clinicien — créé par l'administrateur.
          </p>

          <label className="mt-5 block">
            <span className="label-xs">Email</span>
            <div className="relative mt-1.5">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                required
                autoComplete="username"
                placeholder="prenom.nom@exemple.sn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-background py-2 pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ok/60"
              />
            </div>
          </label>

          <label className="mt-4 block">
            <span className="label-xs">Mot de passe</span>
            <div className="relative mt-1.5">
              <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type={visible ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                className="w-full rounded-md border border-border bg-background py-2 pr-10 pl-9 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ok/60"
              />
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>

          {erreur && (
            <p className="mt-4 flex items-start gap-2 rounded-md border border-alert/40 bg-alert-soft/40 p-3 text-xs leading-relaxed text-alert">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              {erreur}
            </p>
          )}

          <button
            type="submit"
            disabled={ok}
            className={cn(
              "mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-ok px-4 py-2.5 text-sm font-semibold text-navy transition-opacity",
              ok ? "cursor-wait opacity-70" : "hover:opacity-90",
            )}
          >
            {ok && <Loader2 className="size-4 animate-spin" />}
            Se connecter
          </button>

          <p className="mt-4 text-center font-mono text-[10px] text-muted-foreground">
            Patient ? Vos résultats arrivent par email avec un code OTP.
          </p>
        </form>

        <p className="mt-6 text-center font-mono text-[10px] leading-relaxed text-navy-muted">
          Prototype de recherche · Master 2 SI · UADB · 2025-2026
        </p>
      </div>
    </div>
  );
}
