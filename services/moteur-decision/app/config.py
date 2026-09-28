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

    # Filet de securite de confiance (controle qualite post-inference)
    seuil_confiance_escalade: float = 0.75  # sous ce seuil, une pathologie est jugee ambiguee
    seuil_confiance_indetermine: float = 0.60  # sous ce seuil, le verdict final est "indetermine"

    # Profilage image : regles de triage vers les specialistes
    seuil_ratio_carre_inf: float = 0.9  # PNG carre -> profil TB
    seuil_ratio_carre_sup: float = 1.1
    seuil_ratio_pn: float = 1.1  # JPEG etire -> profil PN
    format_image_tb: str = "PNG"
    format_image_pn: str = "JPEG"
    profilage_active: bool = True  # kill-switch de securite (False -> comportement actuel)

    # Monitoring
    prometheus_url: str = "http://prometheus:9090"

    # Persistance PostgreSQL. Vide = persistance désactivée (le registre en
    # mémoire reste seul maître) : permet de tourner en dev/tests sans base.
    # Ex. postgresql+psycopg://aeris:motdepasse@postgres:5432/aeris
    database_url: str = ""
    # Flush par lot du worker de persistance (secondes)
    persistance_interval_seconde: float = 2.0

    # --- Authentification RBAC ---
    jwt_secret: str = "aeris-dev-secret-a-changer"
    jwt_ttl_acces_minutes: int = 30
    jwt_ttl_rafraichissement_jours: int = 7

    # OTP patient (acces resultat sans compte)
    # Les codes ne sont plus soumis a expiration : le patient doit pouvoir
    # consulter ses resultats indefiniment. `otp_ttl_minutes` est conserve pour
    # les deploiements existants mais n'est plus applique.
    otp_ttl_minutes: int = 15
    otp_longueur: int = 6

    # SMTP (MailHog en dev, vide = fallback log)
    smtp_hote: str = ""
    smtp_port: int = 1025
    smtp_utilisateur: str = ""
    smtp_mot_de_passe: str = ""
    smtp_expediteur: str = "aeris@local"
    # STARTTLS : Gmail (587) l'exige, MailHog (1025) ne l'annonce pas.
    smtp_start_tls: bool = True

    # WhatsApp via le relais AERIS (Baileys, session WhatsApp Web). URL vide
    # = fallback log simulé (même principe que l'email sans SMTP). L'URL
    # réelle (http://relay-whatsapp:3500) est injectée par docker-compose.
    whatsapp_url_relay: str = ""
    # Secret partagé avec le relais WhatsApp (X-Relay-Secret)
    whatsapp_relay_secret: str = ""
    # Préfixe téléphonique international appliqué aux numéros sans +/préfixe
    # (ex. "77 123 45 67" -> "221771234567"). Vide = numéro utilisé tel quel.
    whatsapp_prefixe_pays: str = "221"

    # URL du tableau de bord (pour construire le lien OTP dans les emails)
    url_tableau_de_bord: str = "http://localhost:3000"

    # Compte admin initial (bootstrap au demarrage si aucun admin n'existe)
    admin_initial_email: str = "admin@aeris.local"
    admin_initial_mot_de_passe: str = "Admin@aeris2026"

    # Compte clinicien initial : /routage/analyser et /routage/patient sont
    # reserves au role clinicien (le role admin est purement IT). Sans ce
    # bootstrap, aucun compte ne peut passer une radiographie apres un
    # demarrage vierge : la demonstration et les scenarios d'experimentation
    # ont besoin d'un clinicien. Meme regle que l'admin : cree seulement si
    # aucun clinicien n'existe.
    clinicien_initial_email: str = "clinicien@aeris.local"
    clinicien_initial_mot_de_passe: str = "Clinicien@aeris2026"

    class Config:
        env_file = ".env"
        extra = "ignore"


config = ConfigMoteurDecision()
