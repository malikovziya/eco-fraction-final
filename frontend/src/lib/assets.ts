// Display names for asset ids used in event payloads (full + short form).
export const ASSET_NAMES: Record<string, string> = {
  "gobustan-solar": "Gobustan Solar Park",
  "bilasuvar-solar": "Bilasuvar Sun Fields",
  "nakhchivan-solar": "Sharur Highland Solar",
  "sumgait-rooftop": "Sumgait Rooftop Cluster",
  "khizi-wind": "Khizi Ridge Wind Farm",
  "absheron-wind": "Absheron Coastal Wind",
};

export const ASSET_SHORT: Record<string, string> = {
  "gobustan-solar": "Gobustan",
  "bilasuvar-solar": "Bilasuvar",
  "nakhchivan-solar": "Sharur",
  "sumgait-rooftop": "Sumgait",
  "khizi-wind": "Khizi",
  "absheron-wind": "Absheron",
};

export const assetName = (id: string | null | undefined) => (id ? ASSET_NAMES[id] ?? id : "");
