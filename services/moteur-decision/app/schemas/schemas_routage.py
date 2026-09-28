"""Schemas Pydantic pour les requetes et reponses du moteur de decision."""

from pydantic import BaseModel, Field


class MetriquesSysteme(BaseModel):
    """Metriques collectees au moment de la decision."""

    cpu_pourcentage: float = Field(description="Utilisation CPU de l'Edge en pourcentage")
    ram_pourcentage: float = Field(description="Utilisation RAM de l'Edge en pourcentage")
    latence_reseau_ms: float = Field(description="Latence reseau vers le Cloud en ms")
    reseau_disponible: bool = Field(description="Connectivite reseau vers le Cloud")


class DecisionRoutage(BaseModel):
    """Detail de la decision prise par le moteur."""

    destination: str = Field(description="Destination choisie : 'edge' ou 'cloud'")
    raison: str = Field(description="Justification de la decision")
    metriques: MetriquesSysteme = Field(description="Metriques au moment de la decision")
    second_avis: bool = Field(
        default=True,
        description=(
            "Second avis (controle qualite Edge <-> Cloud) autorise. Faux quand "
            "la destination est forcee : le verdict provient alors de la seule "
            "source imposee, ce qui rend la mesure de scenario exploitable."
        ),
    )


class ResultatDiagnostic(BaseModel):
    """Resultat d'un diagnostic individuel, enrichi de la tracabilite.

    Chaque resultat expose la source reelle du verdict retenu (edge ou cloud)
    ainsi que l'historique d'un eventuel controle qualite (escalade). Tous les
    champs nouveaux ont une valeur par defaut pour rester compatibles avec les
    usages n'ayant pas subi d'escalade.
    """

    pathologie: str = Field(description="Pathologie detectee")
    prediction: str = Field(description="Resultat : 'positif' ou 'negatif'")
    confiance: float = Field(description="Score de confiance", ge=0.0, le=1.0)
    temps_inference_ms: float = Field(default=0.0, description="Temps d'inference en ms")
    source: str = Field(
        default="edge", description="Source reelle du verdict retenu : 'edge' ou 'cloud'"
    )
    escalade: bool = Field(
        default=False, description="Indique si ce verdict a subi un controle qualite"
    )
    confiance_initiale: float | None = Field(
        default=None, description="Confiance avant escalade (trace du controle)"
    )
    source_initiale: str | None = Field(
        default=None, description="Source avant escalade (trace du controle)"
    )
    indetermine: bool = Field(
        default=False,
        description="Verdict trop ambigu pour etre utilise (relecture requise)",
    )


class EvenementEscalade(BaseModel):
    """Evenement trace d'un controle qualite (escalade Edge <-> Cloud)."""

    pathologie: str = Field(description="Pathologie controlee")
    source_initiale: str = Field(description="Source qui a produit le resultat primaire")
    confiance_initiale: float = Field(description="Confiance du resultat primaire")
    source_controle: str = Field(description="Source sollicitee pour le second avis")
    confiance_controle: float = Field(description="Confiance du second avis")
    decision: str = Field(
        description=(
            "'arbitrage_a_prevalu', 'arbitrage_conserve_initial' ou "
            "'escalade_impossible'"
        )
    )
    raison: str = Field(description="Justification de la decision d'escalade")


class ProfilImage(BaseModel):
    """Profil technique d'une image extrait de l'entete du fichier.

    Utilise pour le routage selectif des specialistes : les regles de
    profilage se basent sur ces champs pour determiner quel(s) modele(s)
    doit ventiler une radiographie.
    """

    nom_fichier: str | None = Field(default=None, description="Nom du fichier source")
    format: str | None = Field(default=None, description="Format detecte (PNG, JPEG)")
    largeur_px: int | None = Field(default=None, description="Largeur en pixels")
    hauteur_px: int | None = Field(default=None, description="Hauteur en pixels")
    ratio_largeur_hauteur: float | None = Field(
        default=None, description="Ratio largeur/hauteur"
    )
    mode_canaux: str | None = Field(default=None, description="Mode couleur (RGB, L...)")
    taille_octets: int = Field(default=0, description="Taille du fichier en octets")
    indecodable: bool = Field(default=False, description="True si l'image n'a pas pu etre decodee")


class FiltrageSpecialistes(BaseModel):
    """Resultat du profilage image et du routage selectif des specialistes.

    Decrit quel(s) specialiste(s) sont admissibles pour traiter l'image,
    la regle appliquee, et la pathologie eventuellement ecartee.
    """

    profil: ProfilImage = Field(description="Profil technique extrait du fichier")
    specialistes_admissibles: list[str] = Field(
        description="Pathologies sollicitees pour l'inference"
    )
    regle_appliquee: str = Field(description="Libelle lisible de la regle de triage")
    cle_regle: str = Field(description="Cle stable de la regle appliquee")
    specialiste_ecarte: str | None = Field(
        default=None, description="Pathologie non sollicitee"
    )
    raison: str = Field(description="Justification complete du triage")


class ReponseRoutage(BaseModel):
    """Reponse complete du moteur de decision apres routage et inference."""

    decision: DecisionRoutage = Field(description="Details de la decision de routage")
    resultats: list[ResultatDiagnostic] = Field(description="Resultats des diagnostics")
    escalades: list[EvenementEscalade] = Field(
        default_factory=list, description="Traces des controles qualite effectues"
    )
    temps_total_ms: float = Field(description="Temps total de traitement en ms")
    temps_escalade_ms: float | None = Field(
        default=None, description="Latence ajoutee par le(s) controle(s) qualite"
    )
    filtrage: FiltrageSpecialistes | None = Field(
        default=None,
        description="Profilage image et triage des specialistes",
    )
    # Poignee de l'examen enregistre : c'est elle que la page Resultat adresse
    # pour approuver, desapprover ou programmer un suivi (Vague 1). None si la
    # base est indisponible — l'analyse est alors servie sans persistance.
    id_examen: int | None = Field(
        default=None,
        description="Identifiant de l'examen enregistre, null si non persiste",
    )
