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


class ResultatDiagnostic(BaseModel):
    """Resultat d'un diagnostic individuel."""

    pathologie: str = Field(description="Pathologie detectee")
    prediction: str = Field(description="Resultat : 'positif' ou 'negatif'")
    confiance: float = Field(description="Score de confiance", ge=0.0, le=1.0)
    temps_inference_ms: float = Field(default=0.0, description="Temps d'inference en ms")


class ReponseRoutage(BaseModel):
    """Reponse complete du moteur de decision apres routage et inference."""

    decision: DecisionRoutage = Field(description="Details de la decision de routage")
    resultats: list[ResultatDiagnostic] = Field(description="Resultats des diagnostics")
    temps_total_ms: float = Field(description="Temps total de traitement en ms")
