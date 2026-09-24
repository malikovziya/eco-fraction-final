"""Renewable assets listed on the platform. Names are fictional; locations and sizes are realistic."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Asset:
    id: str
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
    Asset("gobustan-solar", "Gobustan Solar Park", "solar", "Gobustan", 40.53, 48.93, 60_000),
    Asset("bilasuvar-solar", "Bilasuvar Sun Fields", "solar", "Bilasuvar", 39.46, 48.55, 120_000),
    Asset("nakhchivan-solar", "Sharur Highland Solar", "solar", "Nakhchivan", 39.55, 44.98, 30_000),
    Asset("sumgait-rooftop", "Sumgait Rooftop Cluster", "solar", "Sumgait", 40.59, 49.67, 5_000),
    Asset("khizi-wind", "Khizi Ridge Wind Farm", "wind", "Khizi", 40.91, 49.07, 240_000, turbines=40, mean_wind_ms=9.2),
    Asset("absheron-wind", "Absheron Coastal Wind", "wind", "Absheron", 40.46, 50.05, 80_000, turbines=16, mean_wind_ms=9.6),
]

ASSETS_BY_ID = {a.id: a for a in ASSETS}

# Baku time (UTC+4) is used for all simulated timestamps
UTC_OFFSET_HOURS = 4
