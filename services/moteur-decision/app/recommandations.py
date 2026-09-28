"""Recommandations cliniques derivees des verdicts d'un examen (Vague 2).

Deux destinataires, donc deux tons, a partir de la **meme** source de verite :
le clinicien au poste, et le patient dans son espace.

Trois precautions non negociables, etables au fait que ces modeles ne sont
pas calibres (voir `AGENTS.md` §12, risque clinique n°1) :

1. **Aucun traitement n'est prescribe ni dose.** Une recommandation est une
   orientation de prise en charge, pas une ordonnance. « Evaluer une
   antibiotherapie » n'est pas « prendre amoxicilline ».
2. **Une positivite n'est jamais une preuve.** Le libelle dit « modele
   en faveur de », jamais « vous avez ».
3. **Un negatif n'annule rien.** Aucune recommandation n'est produite sur la
   seule confiance d'un modele : le clinicien garde la main, et le rappel de
   correlation clinique est toujours joint.

Le module ne fait aucun appel reseau : il transforme des verdicts en phrases.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Confiance minimale pour qu'une positivite soit mentionnee comme piste. En
# dessous, la recommendation ne serait pas differenciee d'un bruit : mieux vaut
# ne rien dire que surinterpreter une sortie de modele.
CONFIANCE_MENTIONNABLE = 0.60

# Les deux pathologies sont dosees par le meme modele de forme, et se
# confondent partiellement sur les opacites. Deux positivites simultanees
# meritent donc une relecture, pas une somme de diagnostics.
AVERTISSEMENT_CROISEMENT = (
    "Les deux lectures se positivisent. Tuberculose et pneumonie partagent des "
    "signes radiologiques proches : ce croisement appelle une relecture clinique, "
    "pas deux diagnostics."
)


@dataclass(frozen=True)
class Recommandation:
    """Une recommandation, avec le motif qui l'a declenchee.

    ``cible`` vaut ``clinicien`` ou ``patient`` : les deux listes sont produites
    a partir des memes verdicts mais ne se recoupent pas, un patient ne doit
    pas lire les hypotheses de travail du soignant.
    """

    texte: str
    cible: str
    motif: str
    pathologie: str | None = None
    confiance: float | None = None
    tags: list[str] = field(default_factory=list)


def _positif(verdicts: list[dict], pathologie: str) -> dict | None:
    for verdict in verdicts:
        if verdict.get("pathologie") == pathologie and verdict.get("prediction") == "positif":
            return verdict
    return None


def _confiance(verdict: dict | None) -> float:
    if verdict is None:
        return 0.0
    return float(verdict.get("confiance") or 0.0)


def generer_recommandations(
    verdicts: list[dict],
    *,
    valide: bool = False,
) -> list[Recommandation]:
    """Oriente la prise en charge a partir des verdicts d'un examen.

    ``valide`` designe un examen dont la validation clinique a ete enregistree.
    Un examen non valide ne produit pas de recommandation patient : il n'est pas
    encore un resultat livrable (Vague 2, portail patient).
    """
    recommandations: list[Recommandation] = []

    tb = _positif(verdicts, "tuberculose")
    pn = _positif(verdicts, "pneumonie")

    tb_significatif = tb is not None and _confiance(tb) >= CONFIANCE_MENTIONNABLE
    pn_significatif = pn is not None and _confiance(pn) >= CONFIANCE_MENTIONNABLE

    if tb_significatif:
        recommandations.append(
            Recommandation(
                texte=(
                    "Orientation vers un avis specialise (pneumologie ou infectiologie) "
                    "pour evaluer une suspicion de tuberculose et demander les examens "
                    "de confirmation appropries."
                ),
                cible="clinicien",
                motif="Verdict tuberculose positif",
                pathologie="tuberculose",
                confiance=_confiance(tb),
                tags=["avis specialise", "confirmation microbiologique"],
            )
        )
        if valide:
            recommandations.append(
                Recommandation(
                    texte=(
                        "Le modele est en faveur d'une suspicion de tuberculose. "
                        "Un avis medical specialise est recommande : les examens de "
                        "confirmation (bacteriologie, gene Xpert) seront decides par "
                        "votre medecin. Ni votre radiographie ni ce compte rendu ne "
                        "peuvent poser le diagnostic a eux seuls."
                    ),
                    cible="patient",
                    motif="Verdict tuberculose positif",
                    pathologie="tuberculose",
                    confiance=_confiance(tb),
                    tags=["consulter"],
                )
            )

    if pn_significatif:
        recommandations.append(
            Recommandation(
                texte=(
                    "Evaluer une antibiotherapie et une surveillance radiologique de "
                    "controle : la prise en charge depend des signes cliniques, de "
                    "l'oxygene et de l'age, pas de la seule imagerie."
                ),
                cible="clinicien",
                motif="Verdict pneumonie positif",
                pathologie="pneumonie",
                confiance=_confiance(pn),
                tags=["antibiotherapie a evaluer", "controle radiologique"],
            )
        )
        if valide:
            recommandations.append(
                Recommandation(
                    texte=(
                        "Le modele est en faveur de signes de pneumonie. Une radiographie "
                        "de controle et une consultation medicale sont recommandees. "
                        "Votre medecin decidera du traitement : aucun medicament ne doit "
                        "etre pris sans son avis."
                    ),
                    cible="patient",
                    motif="Verdict pneumonie positif",
                    pathologie="pneumonie",
                    confiance=_confiance(pn),
                    tags=["consulter", "controle"],
                )
            )

    if tb_significatif and pn_significatif:
        recommandations.append(
            Recommandation(
                texte=AVERTISSEMENT_CROISEMENT,
                cible="clinicien",
                motif="Deux positivites simultanees",
                tags=["relecture"],
            )
        )

    if not recommandations:
        if valide:
            recommandations.append(
                Recommandation(
                    texte=(
                        "Aucune orientation ne decoule de cet examen. Signes persistants "
                        "fievre, toux, dyspnee, amaigrissement : consultez, ces signes "
                        "ne sont pas evaluates par la radiographie seule."
                    ),
                    cible="patient",
                    motif="Aucun verdict positif",
                    tags=["consulter si symptomes"],
                )
            )
        else:
            recommandations.append(
                Recommandation(
                    texte=(
                        "Aucun verdict positif significatif : la priorite du dossier "
                        "redescend. A croiser avec l'historique du patient."
                    ),
                    cible="clinicien",
                    motif="Aucun verdict positif",
                    tags=[],
                )
            )

    return recommandations


def resumer_verdicts(verdicts: list[dict]) -> str:
    """Phrase de synthese d'un examen, pour un canal etroit (SMS, WhatsApp).

    Volontairement une phrase : le detail reste dans le portail, le message ne
    fait qu'ouvrir la porte. Aucune identite technique, aucun destine, aucune
    latence.
    """
    if not verdicts:
        return "examen analyse, aucun verdict pathologique"

    pieces = []
    for pathologie in ("tuberculose", "pneumonie"):
        positif = _positif(verdicts, pathologie)
        if positif is None:
            continue
        # Comparaison sur la confiance brute : le seuil est exprime en ratio,
        # le pourcentage n'est qu'un affichage.
        if _confiance(positif) >= CONFIANCE_MENTIONNABLE:
            pourcentage = round(_confiance(positif) * 100)
            pieces.append(f"modele en faveur de {pathologie} ({pourcentage} %)")
        else:
            pieces.append(f"{pathologie} non confirmee (confiance faible)")

    if not pieces:
        return "aucun signe en faveur d'une pathologie"
    return " ; ".join(pieces)
