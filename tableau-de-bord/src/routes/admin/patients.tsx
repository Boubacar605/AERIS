import { createFileRoute } from "@tanstack/react-router";
import { Mail, Paperclip, Plus, RefreshCw, Send, UserPlus } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, creerPatient, listerPatients, renvoyerOtp, type PatientAdmin } from "@/lib/api";

export const Route = createFileRoute("/admin/patients")({
  component: PatientsPage,
  head: () => ({
    meta: [{ title: "Patients · Administration · AERIS" }],
  }),
});

function PatientsPage() {
  const [patients, setPatients] = useState<PatientAdmin[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [dialogOuvert, setDialogOuvert] = useState(false);

  const recharger = async () => {
    try {
      setPatients(await listerPatients());
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
        title="Patients enregistrés"
        subtitle="Nécessaires pour adresser la notification OTP après une analyse"
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
              Ajouter un patient
            </Button>
          </div>
        }
      >
        {erreur && (
          <p className="border-b border-border bg-alert-soft/30 px-4 py-2 text-xs text-alert">
            {erreur}
          </p>
        )}
        {patients === null && !erreur ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Chargement des patients…
          </p>
        ) : patients && patients.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun patient pour le moment. Ajoutez-en un pour pouvoir lui envoyer ses résultats.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Nom complet</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Sexe</TableHead>
                <TableHead className="text-right">Notification OTP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients?.map((p) => (
                <PatientRow key={p.id_patient} patient={p} />
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <CreerPatientDialog
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

function PatientRow({ patient: p }: { patient: PatientAdmin }) {
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const envoyer = async () => {
    setEnCours(true);
    setMessage(null);
    try {
      const rep = await renvoyerOtp(p.id_patient);
      setMessage(`OTP envoyé à ${rep.email}`);
    } catch (ex) {
      setMessage(ex instanceof ApiError ? `Erreur : ${ex.status}` : "Envoi impossible");
    } finally {
      setEnCours(false);
    }
  };

  return (
    <TableRow>
      <TableCell className="font-mono text-xs font-semibold">{p.code_patient}</TableCell>
      <TableCell>{p.nom_complet ?? "—"}</TableCell>
      <TableCell className="font-mono text-xs">
        {p.email ? (
          <span className="inline-flex items-center gap-1.5">
            <Mail className="size-3 text-muted-foreground" />
            {p.email}
          </span>
        ) : (
          <Tag tone="alert">sans email</Tag>
        )}
      </TableCell>
      <TableCell>{p.sexe ?? "—"}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {message && <span className="text-[11px] text-muted-foreground">{message}</span>}
          <Button
            variant="outline"
            size="sm"
            disabled={enCours || !p.email}
            title={p.email ? "Générer et envoyer un nouvel OTP" : "Patient sans email"}
            onClick={() => void envoyer()}
          >
            <Send className="size-3.5" />
            Renvoyer l'OTP
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreerPatientDialog({
  ouvert,
  surOuvertureChange,
  onCree,
}: {
  ouvert: boolean;
  surOuvertureChange: (v: boolean) => void;
  onCree: () => void;
}) {
  const [form, setForm] = useState({
    code_patient: "",
    nom_complet: "",
    email: "",
    sexe: "",
    annee_naissance: "",
  });
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const changer = (cle: keyof typeof form, valeur: string) =>
    setForm((f) => ({ ...f, [cle]: valeur }));

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    setEnCours(true);
    setErreur(null);
    try {
      await creerPatient({
        code_patient: form.code_patient.trim().toUpperCase(),
        nom_complet: form.nom_complet.trim() || null,
        email: form.email.trim().toLowerCase() || null,
        sexe: form.sexe.trim().toUpperCase() || null,
        annee_naissance: form.annee_naissance ? Number(form.annee_naissance) : null,
      });
      setForm({ code_patient: "", nom_complet: "", email: "", sexe: "", annee_naissance: "" });
      onCree();
    } catch (ex) {
      setErreur(
        ex instanceof ApiError
          ? `Erreur ${ex.status} : code peut-être déjà pris`
          : "Création impossible",
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
              Ajouter un patient
            </DialogTitle>
            <DialogDescription>
              Le code patient permet au clinicien de rattacher une analyse ; l'email reçoit l'OTP.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="code">Code patient *</Label>
              <div className="relative">
                <Paperclip className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="code"
                  required
                  placeholder="AERIS-2026-0001"
                  className="pl-8 font-mono"
                  value={form.code_patient}
                  onChange={(e) => changer("code_patient", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nom">Nom complet</Label>
              <Input
                id="nom"
                value={form.nom_complet}
                onChange={(e) => changer("nom_complet", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email (pour l'OTP)</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                placeholder="patient@exemple.sn"
                onChange={(e) => changer("email", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sexe">Sexe</Label>
                <Input
                  id="sexe"
                  maxLength={1}
                  placeholder="F / M / X"
                  value={form.sexe}
                  onChange={(e) => changer("sexe", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="annee">Année de naissance</Label>
                <Input
                  id="annee"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="1990"
                  value={form.annee_naissance}
                  onChange={(e) =>
                    changer("annee_naissance", e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                />
              </div>
            </div>
          </div>

          {erreur && <p className="mb-3 text-xs text-alert">{erreur}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => surOuvertureChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={enCours}>
              {enCours ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
