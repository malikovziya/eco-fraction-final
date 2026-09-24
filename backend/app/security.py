"""Custodial wallet key encryption and password hashing."""

import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet

from .config import DATA_DIR

_KEY_FILE = DATA_DIR / "wallet.key"


def _fernet() -> Fernet:
    if not _KEY_FILE.exists():
        _KEY_FILE.write_bytes(Fernet.generate_key())
    return Fernet(_KEY_FILE.read_bytes())


def encrypt_key(private_key_hex: str) -> str:
    return _fernet().encrypt(private_key_hex.encode()).decode()


def decrypt_key(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()
    return f"{salt}${digest}"


def check_password(password: str, stored: str) -> bool:
    salt, digest = stored.split("$")
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()
    return hmac.compare_digest(candidate, digest)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)
