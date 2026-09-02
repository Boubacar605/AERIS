"""Configuration du service pneumonie via variables d'environnement."""

from pydantic_settings import BaseSettings


class ConfigServicePN(BaseSettings):
    """Configuration chargee depuis les variables d'environnement."""

    service_pn_port: int = 8002
    service_pn_chemin_modele_edge: str = "./modeles_entraines/modele_pneumonie.h5"
    service_pn_chemin_modele_cloud: str = "./modeles_entraines/modele_pneumonie_cloud.h5"
    mode_deploiement: str = "cloud"

    @property
    def chemin_modele(self) -> str:
        if self.mode_deploiement == "edge":
            return self.service_pn_chemin_modele_edge
        return self.service_pn_chemin_modele_cloud

    class Config:
        env_file = ".env"
        extra = "ignore"


config = ConfigServicePN()
