"""Renewable assets listed on the platform, loaded from shared/assets.json (single source of truth).

Names are fictional; locations and sizes are realistic.
"""

import json
from dataclasses import dataclass
from pathlib import Path

ASSETS_JSON = Path(__file__).resolve().parent.parent / "shared" / "assets.json"


@dataclass(frozen=True)
class Asset:
    id: str
    token_id: int
    name: str
    kind: str  # "solar" | "wind"
    region: str
    lat: float
    lon: float
    capacity_kw: float
    # Wind only: number of turbines and long-run mean wind speed at hub height
    turbines: int = 0
    mean_wind_ms: float = 0.0


ASSETS: list[Asset] = [
    Asset(
        id=a["id"],
        token_id=a["tokenId"],
        name=a["name"],
        kind=a["kind"],
        region=a["region"],
        lat=a["lat"],
        lon=a["lon"],
        capacity_kw=a["capacity_kw"],
        turbines=a.get("turbines", 0),
        mean_wind_ms=a.get("mean_wind_ms", 0.0),
    )
    for a in json.loads(ASSETS_JSON.read_text(encoding="utf-8"))
]

ASSETS_BY_ID = {a.id: a for a in ASSETS}

# Baku time (UTC+4) is used for all simulated timestamps
UTC_OFFSET_HOURS = 4
