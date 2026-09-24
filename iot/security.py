"""Per-device Ed25519 identities. Private keys stay with the device; the bridge only knows public keys."""

import json
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

IOT_DIR = Path(__file__).parent
KEYS_DIR = IOT_DIR / ".keys"  # device private keys (never shared)
REGISTRY_PATH = IOT_DIR / "device_registry.json"  # public keys, like an AWS IoT thing registry


def device_id_for(asset_id: str) -> str:
    return f"dev-{asset_id}"


def canonical(payload: dict) -> bytes:
    """Deterministic bytes to sign: every field except the signature, sorted keys."""
    body = {k: v for k, v in payload.items() if k != "sig"}
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode()


def sign(key: Ed25519PrivateKey, payload: dict) -> dict:
    return {**payload, "sig": key.sign(canonical(payload)).hex()}


def verify(public_key_hex: str, payload: dict) -> bool:
    try:
        key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
        key.verify(bytes.fromhex(payload.get("sig", "")), canonical(payload))
        return True
    except (InvalidSignature, ValueError):
        return False


def load_or_create_keys(asset_ids: list[str]) -> dict[str, Ed25519PrivateKey]:
    """Provision a key per device on first run and publish its public key to the registry."""
    KEYS_DIR.mkdir(exist_ok=True)
    registry = load_registry()
    keys = {}
    for asset_id in asset_ids:
        device_id = device_id_for(asset_id)
        path = KEYS_DIR / f"{device_id}.pem"
        if path.exists():
            key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        else:
            key = Ed25519PrivateKey.generate()
            path.write_bytes(
                key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                )
            )
        keys[device_id] = key
        registry[device_id] = {
            "asset_id": asset_id,
            "public_key": key.public_key()
            .public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
            .hex(),
        }
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2))
    return keys


def load_registry() -> dict:
    return json.loads(REGISTRY_PATH.read_text()) if REGISTRY_PATH.exists() else {}
