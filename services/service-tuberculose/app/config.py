"""Configuration du service tuberculose via variables d'environnement."""

from pydantic_settings import BaseSettings


class ConfigServiceTB(BaseSettings):
    """Configuration chargee depuis les variables d'environnement."""

    service_tb_port: int = 8001
    service_tb_chemin_modele: str = "./modeles_entraines/modele_tuberculose.h5"
    mode_deploiement: str = "cloud"

    class Config:
        env_file = ".env"
        extra = "ignore"


config = ConfigServiceTB()
