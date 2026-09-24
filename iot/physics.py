"""Physical generation models: solar geometry with clouds, wind with a turbine power curve."""

import math
import random
from datetime import datetime

from .assets import UTC_OFFSET_HOURS, Asset

SOLAR_CONSTANT_CLEAR_SKY = 1000.0  # W/m² at the surface, sun at zenith, clear sky


def solar_elevation_deg(lat: float, lon: float, local_time: datetime) -> float:
    """Approximate solar elevation angle (NOAA simplified model)."""
    day = local_time.timetuple().tm_yday
    hour = local_time.hour + local_time.minute / 60 + local_time.second / 3600
    decl = 23.44 * math.sin(math.radians(360 / 365 * (day - 81)))
    b = math.radians(360 / 365 * (day - 81))
    eot = 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)  # minutes
    solar_time = hour + (4 * (lon - 15 * UTC_OFFSET_HOURS) + eot) / 60
    hour_angle = 15 * (solar_time - 12)
    lat_r, decl_r, ha_r = map(math.radians, (lat, decl, hour_angle))
    sin_el = math.sin(lat_r) * math.sin(decl_r) + math.cos(lat_r) * math.cos(decl_r) * math.cos(ha_r)
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_el))))


class SolarModel:
    """Clear-sky irradiance from sun elevation, attenuated by a Markov cloud process."""

    def __init__(self, asset: Asset, rng: random.Random):
        self.asset = asset
        self.rng = rng
        self.cloud = 0.0  # 0 = clear, 1 = fully overcast

    def step(self, local_time: datetime, dt_s: float) -> dict:
        # Cloud cover drifts slowly, with occasional passing cloud banks (rates tuned per 5 min)
        k = dt_s / 300
        if self.rng.random() < 0.03 * k:
            self.cloud = min(0.9, self.cloud + self.rng.uniform(0.3, 0.6))
        self.cloud = max(0.0, self.cloud * 0.93**k + self.rng.gauss(0, 0.02 * math.sqrt(k)))

        elevation = solar_elevation_deg(self.asset.lat, self.asset.lon, local_time)
        if elevation <= 0:
            irradiance = 0.0
        else:
            air_mass_factor = math.sin(math.radians(elevation)) ** 1.15
            irradiance = SOLAR_CONSTANT_CLEAR_SKY * air_mass_factor * (1 - 0.75 * self.cloud)
        irradiance = max(0.0, irradiance + self.rng.gauss(0, 5) if irradiance > 0 else 0.0)

        # Panel temperature rises with irradiance; efficiency drops ~0.4%/°C above 25°C
        ambient = 18 + 10 * math.sin(math.radians((local_time.hour - 9) * 15))
        panel_temp = ambient + irradiance * 0.03
        temp_derate = 1 - 0.004 * max(0.0, panel_temp - 25)
        power_kw = self.asset.capacity_kw * (irradiance / SOLAR_CONSTANT_CLEAR_SKY) * temp_derate * 0.97

        return {
            "power_kw": max(0.0, power_kw),
            "irradiance_wm2": round(irradiance, 1),
            "temperature_c": round(panel_temp, 1),
            "sun_elevation_deg": round(elevation, 1),
        }


class WindModel:
    """Mean-reverting wind speed with gusts, converted by a typical 6 MW-class turbine curve."""

    CUT_IN, RATED, CUT_OUT = 3.0, 12.5, 25.0

    def __init__(self, asset: Asset, rng: random.Random):
        self.asset = asset
        self.rng = rng
        self.mean = asset.mean_wind_ms
        self.speed = asset.mean_wind_ms

    @classmethod
    def power_fraction(cls, v: float) -> float:
        if v < cls.CUT_IN or v >= cls.CUT_OUT:
            return 0.0
        if v >= cls.RATED:
            return 1.0
        return ((v - cls.CUT_IN) / (cls.RATED - cls.CUT_IN)) ** 3

    def step(self, local_time: datetime, dt_s: float) -> dict:
        # Absheron winds are stronger in the afternoon (sea breeze); rates tuned per 5 min
        k = dt_s / 300
        diurnal = 1.5 * math.sin(math.radians((local_time.hour - 8) * 15))
        target = self.mean + diurnal
        self.speed += min(1.0, 0.15 * k) * (target - self.speed) + self.rng.gauss(0, 0.8 * math.sqrt(k))
        self.speed = max(0.0, min(30.0, self.speed))
        gust = self.speed + abs(self.rng.gauss(0, 1.5))

        availability = 0.97  # share of turbines online
        power_kw = self.asset.capacity_kw * self.power_fraction(self.speed) * availability
        return {
            "power_kw": max(0.0, power_kw + self.rng.gauss(0, self.asset.capacity_kw * 0.002)),
            "wind_speed_ms": round(self.speed, 2),
            "gust_ms": round(gust, 2),
            "temperature_c": round(16 + 6 * math.sin(math.radians((local_time.hour - 9) * 15)), 1),
        }
