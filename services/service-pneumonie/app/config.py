"""Configuration du service pneumonie via variables d'environnement."""

from pydantic_settings import BaseSettings


class ConfigServicePN(BaseSettings):
    """Configuration chargee depuis les variables d'environnement."""

    service_pn_port: int = 8002
    service_pn_chemin_modele: str = "./modeles_entraines/modele_pneumonie.h5"
    mode_deploiement: str = "cloud"

    class Config:
        env_file = ".env"
        extra = "ignore"


config = ConfigServicePN()
