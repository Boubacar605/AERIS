"""Generation et hachage de codes OTP (One-Time Password).

Les codes OTP sont composes de chiffres uniquement (ex: 847293).
Le hash SHA-256 est stocke en base ; le code en clair n'est jamais persiste.
"""

import hashlib
import secrets
import string


def generer_otp(longueur: int = 6) -> str:
    """Genere un code OTP numerique de la longueur demandee."""
    alphabet = string.digits
    return "".join(secrets.choice(alphabet) for _ in range(longueur))


def hacher_otp(code: str) -> str:
    """Retourne le hash SHA-256 d'un code OTP (pour stockage en base)."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()
