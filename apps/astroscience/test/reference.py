"""Swiss Ephemeris reference positions for test/planets.test.mjs.

Run: uv run --python 3.11 --with pyswisseph python apps/astroscience/test/reference.py
"""
import json
import random
from pathlib import Path

import swisseph as swe

swe.set_sid_mode(swe.SIDM_LAHIRI)
FLAGS = swe.FLG_MOSEPH | swe.FLG_SIDEREAL | swe.FLG_SPEED
BODIES = {
    "sun": swe.SUN, "moon": swe.MOON, "mars": swe.MARS, "mercury": swe.MERCURY,
    "jupiter": swe.JUPITER, "venus": swe.VENUS, "saturn": swe.SATURN, "rahu": swe.MEAN_NODE,
}

rng = random.Random(7)
samples = []
for _ in range(600):
    jd = rng.uniform(swe.julday(1900, 1, 1), swe.julday(2100, 1, 1))
    lat = rng.uniform(-60, 60)
    lon = rng.uniform(-180, 180)
    row = {"jd": jd, "lat": lat, "lon": lon}
    for name, body in BODIES.items():
        pos, _ = swe.calc_ut(jd, body, FLAGS)
        row[name] = pos[0]
        row[name + "_speed"] = pos[3]
    row["ketu"] = (row["rahu"] + 180) % 360
    _, ascmc = swe.houses_ex(jd, lat, lon, b"W", swe.FLG_SIDEREAL)
    row["lagna"] = ascmc[0]
    samples.append(row)

out = Path(__file__).with_name("reference.json")
out.write_text(json.dumps(samples, separators=(",", ":")))
print(f"wrote {len(samples)} samples to {out}")
