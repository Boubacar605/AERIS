import { createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCw, ShieldCheck, Stethoscope, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Panel, Tag } from "@/components/aeris/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  creerUtilisateur,
  listerUtilisateurs,
  modifierUtilisateur,
  type UtilisateurAdmin,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/utilisateurs")({
  component: UtilisateursPage,
  head: () => ({
    meta: [{ title: "Utilisateurs · Administration · AERIS" }],
  }),
});

function UtilisateursPage() {
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurAdmin[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [dialogOuvert, setDialogOuvert] = useState(false);

  const recharger = async () => {
    try {
      setUtilisateurs(await listerUtilisateurs());
      setErreur(null);
    } catch (ex) {
      setErreur(
        ex instanceof ApiError ? `Erreur ${ex.status} lors du chargement` : "Erreur réseau",
      );
    }
  };

  useEffect(() => {
    void recharger();
  }, []);

  return (
    <div className="space-y-4">
      <Panel
        title="Comptes utilisateurs"
        subtitle="Admin et cliniciens — créés et gérés par l'administrateur"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void recharger()}
              aria-label="Actualiser"
            >
              <RefreshCw className="size-3.5" />
            </Button>
            <Button size="sm" onClick={() => setDialogOuvert(true)}>
              <UserPlus className="size-3.5" />
              Créer un compte
            </Button>
          </div>
        }
      >
        {erreur && (
          <p className="border-b border-border bg-alert-soft/30 px-4 py-2 text-xs text-alert">
            {erreur}
          </p>
        )}
        {utilisateurs === null && !erreur ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Chargement des comptes…
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {utilisateurs?.map((u) => (
                <UtilisateurRow
                  key={u.id_utilisateur}
                  utilisateur={u}
                  onSauvegarde={() => void recharger()}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <CreerUtilisateurDialog
        ouvert={dialogOuvert}
        surOuvertureChange={setDialogOuvert}
        onCree={() => {
          setDialogOuvert(false);
          void recharger();
        }}
      />
    </div>
  );
}

function UtilisateurRow({
  utilisateur: u,
  onSauvegarde,
}: {
  utilisateur: UtilisateurAdmin;
  onSauvegarde: () => void;
}) {
  const [enCours, setEnCours] = useState(false);

  const basculer = async () => {
    setEnCours(true);
    try {
      await modifierUtilisateur(u.id_utilisateur, { actif: !u.actif });
      onSauvegarde();
    } finally {
      setEnCours(false);
    }
  };

  return (
    <TableRow>
      <TableCell className="font-medium">
        {u.prenom} {u.nom}
      </TableCell>
      <TableCell className="font-mono text-xs">{u.email}</TableCell>
      <TableCell>
        <Tag tone={u.role === "admin" ? "ok" : "cloud"}>
          {u.role === "admin" ? (
            <ShieldCheck className="size-3" />
          ) : (
            <Stethoscope className="size-3" />
          )}
          {u.role === "admin" ? "Administrateur" : "Clinicien"}
        </Tag>
      </TableCell>
      <TableCell>
        <Tag tone={u.actif ? "ok" : "alert"}>{u.actif ? "Actif" : "Désactivé"}</Tag>
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="outline"
          size="sm"
          disabled={enCours}
          onClick={() => void basculer()}
          className={cn(u.actif && "text-alert hover:bg-alert-soft/40")}
        >
          {u.actif ? "Désactiver" : "Réactiver"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CreerUtilisateurDialog({
  ouvert,
  surOuvertureChange,
  onCree,
}: {
  ouvert: boolean;
  surOuvertureChange: (v: boolean) => void;
  onCree: () => void;
}) {
  const empty = { prenom: "", nom: "", email: "", role: "clinicien", mot_de_passe: "" };
  const [form, setForm] = useState(empty);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const changer = (cle: keyof typeof empty, valeur: string) =>
    setForm((f) => ({ ...f, [cle]: valeur }));

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    setEnCours(true);
    setErreur(null);
    try {
      await creerUtilisateur({
        prenom: form.prenom.trim(),
        nom: form.nom.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role === "admin" ? "admin" : "clinicien",
        mot_de_passe: form.mot_de_passe,
      });
      setForm(empty);
      onCree();
    } catch (ex) {
      setErreur(
        ex instanceof ApiError && ex.status === 409
          ? "Cet email est déjà utilisé."
          : "Création impossible, vérifiez les champs.",
      );
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Dialog open={ouvert} onOpenChange={surOuvertureChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void soumettre(e)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-4" />
              Créer un compte
            </DialogTitle>
            <DialogDescription>
              Le compte sera immédiatement actif et pourra se connecter.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="prenom">Prénom</Label>
                <Input
                  id="prenom"
                  required
                  value={form.prenom}
                  onChange={(e) => changer("prenom", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nom">Nom</Label>
                <Input
                  id="nom"
                  required
                  value={form.nom}
                  onChange={(e) => changer("nom", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="off"
                value={form.email}
                onChange={(e) => changer("email", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">Rôle</Label>
              <Select value={form.role} onValueChange={(v) => changer("role", v)}>
                <SelectTrigger id="role" className="w-full">
                  <SelectValue placeholder="Rôle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clinicien">Clinicien</SelectItem>
                  <SelectItem value="admin">Administrateur</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mdp">Mot de passe initial</Label>
              <Input
                id="mdp"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                value={form.mot_de_passe}
                onChange={(e) => changer("mot_de_passe", e.target.value)}
              />
            </div>
          </div>

          {erreur && <p className="mb-3 text-xs text-alert">{erreur}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => surOuvertureChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={enCours}>
              {enCours ? "Création…" : "Créer le compte"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
