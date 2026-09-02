"""Schemas Pydantic pour les requetes et reponses de diagnostic."""

from pydantic import BaseModel, Field


class RequeteDiagnostic(BaseModel):
    """Schema de requete pour un diagnostic (metadonnees optionnelles)."""

    identifiant_patient: str | None = Field(default=None, description="Identifiant anonymise du patient")
    notes: str | None = Field(default=None, description="Notes cliniques optionnelles")


class ReponseDiagnostic(BaseModel):
    """Schema de reponse apres analyse d'une radiographie."""

    pathologie: str = Field(description="Pathologie recherchee (pneumonie)")
    prediction: str = Field(description="Resultat : 'positif' ou 'negatif'")
    confiance: float = Field(description="Score de confiance entre 0 et 1", ge=0.0, le=1.0)
    mode_deploiement: str = Field(description="Mode d'execution : 'edge' ou 'cloud'")
    temps_inference_ms: float = Field(default=0.0, description="Temps d'inference en millisecondes")
