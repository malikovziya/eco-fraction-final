"""In-memory platform state shared by the services and the API."""

import json
import threading

from iot.assets import ASSETS, ASSETS_BY_ID, Asset

from .ai.anomaly import AnomalyDetector
from .ai.features import FeatureState
from .ai.forecast import ForecastService
from .config import ASSETS_FILE

_static = {a["id"]: a for a in json.loads(ASSETS_FILE.read_text(encoding="utf-8"))}


class Platform:
    def __init__(self):
        self.assets: dict[str, Asset] = dict(ASSETS_BY_ID)
        self.by_token: dict[int, Asset] = {a.token_id: a for a in ASSETS}
        self.social = {aid: s["social"] for aid, s in _static.items()}
        self.detector = AnomalyDetector()
        self.forecaster = ForecastService()
        self.features = {a.id: FeatureState() for a in ASSETS}
        self.latest: dict[str, dict] = {}  # asset -> last scored reading
        self.forecasts: dict[str, list[dict]] = {}  # asset -> next 24h
        self.sim_status: dict = {}
        self.stats = {"verified": 0, "rejected": 0, "batches": 0, "flagged": 0}
        self.lock = threading.Lock()


_platform: Platform | None = None


def platform() -> Platform:
    global _platform
    if _platform is None:
        _platform = Platform()
    return _platform
