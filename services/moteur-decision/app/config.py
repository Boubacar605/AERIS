"""Configuration du moteur de decision via variables d'environnement."""

from pydantic_settings import BaseSettings


class ConfigMoteurDecision(BaseSettings):
    """Configuration chargee depuis les variables d'environnement."""

    moteur_decision_port: int = 8003

    # URLs des services
    url_service_tb_edge: str = "http://service-tuberculose-edge:8001"
    url_service_tb_cloud: str = "http://service-tuberculose-cloud:8001"
    url_service_pn_edge: str = "http://service-pneumonie-edge:8002"
    url_service_pn_cloud: str = "http://service-pneumonie-cloud:8002"

    # Seuils de decision
    seuil_cpu: int = 80
    seuil_ram: int = 85
    seuil_latence_ms: int = 100

    # Monitoring
    prometheus_url: str = "http://prometheus:9090"

    class Config:
        env_file = ".env"
        extra = "ignore"


config = ConfigMoteurDecision()
