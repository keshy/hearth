"""Reference values from Swiss Ephemeris for astro.test.mjs.

    uv run --python 3.11 --with pyswisseph python apps/naal/test/reference.py

Writes reference.json: raw positions at sample instants, and sunrise,
sunset, thithi and nakshatram at sunrise for every day of 2026-2029 in two
places (computed in each place's own time zone, as the app does).
"""

import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import swisseph as swe

swe.set_sid_mode(swe.SIDM_LAHIRI)

PLACES = {
    "bayarea": (37.55, -121.99, "America/Los_Angeles"),
    "chennai": (13.08, 80.27, "Asia/Kolkata"),
}


def jd_of(dt):
    return dt.timestamp() / 86400 + 2440587.5


def ms_of(jd):
    return round((jd - 2440587.5) * 86400000)


def lon(jd, body, sidereal=False):
    flags = swe.FLG_SWIEPH | (swe.FLG_SIDEREAL if sidereal else 0)
    return swe.calc_ut(jd, body, flags)[0][0]


def elong(jd):
    return (lon(jd, swe.MOON) - lon(jd, swe.SUN)) % 360


def moon_sid(jd):
    return lon(jd, swe.MOON, True)


def next_reach(fn, target, jd, rate):
    ahead = (target - fn(jd)) % 360
    guess = jd + ahead / rate
    lo, hi = guess - 2, guess + 2
    for _ in range(50):
        mid = (lo + hi) / 2
        if ((fn(mid) - target + 180) % 360) - 180 < 0:
            lo = mid
        else:
            hi = mid
    return hi


def rise_set(day, lat, lng, tz):
    start = datetime(day.year, day.month, day.day, tzinfo=ZoneInfo(tz))
    jd0 = jd_of(start)
    geo = (lng, lat, 0)
    rise = swe.rise_trans(jd0, swe.SUN, swe.CALC_RISE, geo, 0, 0)[1][0]
    sset = swe.rise_trans(rise, swe.SUN, swe.CALC_SET, geo, 0, 0)[1][0]
    return rise, sset


def main():
    samples = []
    t = jd_of(datetime(2025, 1, 1, tzinfo=timezone.utc))
    end = jd_of(datetime(2031, 1, 1, tzinfo=timezone.utc))
    while t < end:
        samples.append({
            "ms": ms_of(t),
            "sun": lon(t, swe.SUN),
            "moon": lon(t, swe.MOON),
            "sunSid": lon(t, swe.SUN, True),
            "moonSid": lon(t, swe.MOON, True),
            "ayanamsa": swe.get_ayanamsa_ut(t),
        })
        t += 3.7316

    days = {}
    for name, (lat, lng, tz) in PLACES.items():
        rows = []
        d = date(2026, 1, 1)
        while d < date(2030, 1, 1):
            rise, sset = rise_set(d, lat, lng, tz)
            e = elong(rise)
            tithi = int(e // 12) + 1
            nak = int(moon_sid(rise) // (360 / 27)) + 1
            tithi_end = next_reach(elong, (tithi * 12) % 360, rise, 12.19)
            nak_end = next_reach(moon_sid, (nak * 360 / 27) % 360, rise, 13.18)
            rows.append({
                "key": d.isoformat(),
                "sunrise": ms_of(rise),
                "sunset": ms_of(sset),
                "tithi": tithi,
                "tithiEnd": ms_of(tithi_end),
                "nakshatra": nak,
                "nakshatraEnd": ms_of(nak_end),
            })
            d += timedelta(days=1)
        days[name] = {"lat": lat, "lon": lng, "tz": tz, "days": rows}

    out = Path(__file__).with_name("reference.json")
    out.write_text(json.dumps({"samples": samples, "places": days}))
    print(f"wrote {out} ({len(samples)} samples)")


if __name__ == "__main__":
    main()
