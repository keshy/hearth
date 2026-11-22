// Sun and Moon positions (Meeus, "Astronomical Algorithms", ch. 22, 25, 47),
// rise/set times, and the Lahiri ayanamsa. Accurate to well under a minute of
// arc for 1900-2100, which puts thithi and nakshatram boundaries within a
// couple of minutes. test/astro.test.mjs checks this against Swiss Ephemeris.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;

export const norm360 = (x) => ((x % 360) + 360) % 360;
const wrap180 = (x) => norm360(x + 180) - 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);

export const jdOf = (ms) => ms / DAY_MS + 2440587.5;
const msOf = (jd) => (jd - 2440587.5) * DAY_MS;

// TT - UT in days. Smooth fit to observed and predicted values for 1950-2100.
function deltaT(jd) {
  const y = 2000 + (jd - 2451545) / 365.25;
  const t = y - 2025;
  return (69.2 + 0.4 * t + 0.0025 * t * t) / 86400;
}

function nutation(T) {
  const om = 125.04452 - 1934.136261 * T;
  const L = 280.4665 + 36000.7698 * T;
  const Lm = 218.3165 + 481267.8813 * T;
  const dpsi = (-17.2 * sin(om) - 1.32 * sin(2 * L) - 0.23 * sin(2 * Lm) + 0.21 * sin(2 * om)) / 3600;
  const deps = (9.2 * cos(om) + 0.57 * cos(2 * L) + 0.1 * cos(2 * Lm) - 0.09 * cos(2 * om)) / 3600;
  const eps0 = 23.43929111 - 0.0130041667 * T - 1.6389e-7 * T * T + 5.0361e-7 * T * T * T;
  return { dpsi, eps: eps0 + deps };
}

// Geometric sun longitude (mean equinox of date) and distance in AU.
function sunGeometric(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);
  const e = 0.016708634 - 0.000042037 * T;
  const v = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(v));
  // Moon (Earth-Moon barycentre), Venus, Jupiter and Mars perturbations,
  // fitted against Swiss Ephemeris; they take the error from ~35" to ~4".
  const L = 280.466 + 36000.77 * T;
  const D = 297.85 + 445267.1115 * T;
  const V = L - (181.98 + 58517.8157 * T);
  const J = L - (34.35 + 3034.9057 * T);
  const Ma = L - (355.43 + 19140.3 * T);
  const P =
    -10.28 + 6.46 * sin(D) - 0.4 * sin(2 * M) - 0.18 * cos(2 * M) +
    5.52 * sin(2 * V) - 0.19 * cos(2 * V) + 4.94 * sin(V) + 0.13 * cos(V) +
    5.3 * sin(J) - 0.93 * cos(J) + 2.84 * sin(2 * J) + 0.1 * cos(2 * J) -
    3.72 * sin(2 * Ma) - 1.41 * cos(2 * Ma);
  return { lon: norm360(L0 + C + P / 3600), R };
}

// Moon: [D, M, M', F, sum_l coefficient (1e-6 deg)]
const MOON_LON = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618],
  [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332], [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066],
  [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528], [0, 0, 1, -2, 10980],
  [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034], [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888],
  [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665], [0, 1, -2, 0, -2689],
  [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390], [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236],
  [0, 1, 2, 0, -2120], [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
  [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110], [3, 0, -1, 0, -892],
  [2, 1, 1, 0, -810], [4, -1, -2, 0, 759], [0, 2, -1, 0, -713], [2, 2, -1, 0, -700],
  [2, 1, -2, 0, 691], [2, -1, 0, -2, 596], [4, 0, 1, 0, 549], [0, 0, 4, 0, 537],
  [4, -1, 0, 0, 520], [1, 0, -2, 0, -487], [2, 1, 0, -2, -399], [0, 0, 2, -2, -381],
  [1, 1, 1, 0, 351], [3, 0, -2, 0, -340], [4, 0, -3, 0, 330], [2, -1, 2, 0, 327],
  [0, 2, 1, 0, -323], [1, 1, -1, 0, 299], [2, 0, 3, 0, 294],
];
// [D, M, M', F, sum_b coefficient (1e-6 deg)], largest terms of Meeus table 47.B
const MOON_LAT = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
];

// Geometric moon longitude/latitude (mean equinox of date).
function moonGeometric(T) {
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + (T * T * T) / 538841 - (T ** 4) / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T * T * T) / 545868 - (T ** 4) / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + (T * T * T) / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + (T * T * T) / 69699 - (T ** 4) / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T - (T * T * T) / 3526000 + (T ** 4) / 863310000;
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.29 * T;
  const A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const efac = (m) => (m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E);

  let sl = 0;
  for (const [d, m, mp, f, c] of MOON_LON) sl += c * efac(m) * sin(d * D + m * M + mp * Mp + f * F);
  sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);

  let sb = 0;
  for (const [d, m, mp, f, c] of MOON_LAT) sb += c * efac(m) * sin(d * D + m * M + mp * Mp + f * F);
  sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);

  return { lon: norm360(Lp + sl / 1e6), lat: sb / 1e6 };
}

// Lahiri (Chitrapaksha) ayanamsa, fitted to Swiss Ephemeris SE_SIDM_LAHIRI.
export function ayanamsa(jd) {
  const T = (jd - 2451545) / 36525;
  return 23.85709 + 1.396971 * T + 0.000308 * T * T;
}

const ttT = (jd) => (jd + deltaT(jd) - 2451545) / 36525;

// Apparent tropical longitudes of date, in degrees.
export function sunLongitude(jd) {
  const T = ttT(jd);
  const { lon, R } = sunGeometric(T);
  return norm360(lon + nutation(T).dpsi - 0.005691611 / R);
}
export function moonLongitude(jd) {
  const T = ttT(jd);
  return norm360(moonGeometric(T).lon + nutation(T).dpsi);
}

// Sidereal (nirayana) longitudes on the mean equinox, as panchangams use.
export function sunSidereal(jd) {
  const T = ttT(jd);
  const { lon, R } = sunGeometric(T);
  return norm360(lon - 0.005691611 / R - ayanamsa(jd));
}
export function moonSidereal(jd) {
  return norm360(moonGeometric(ttT(jd)).lon - ayanamsa(jd));
}

// Moon minus Sun: 0 at new moon, 180 at full moon.
export const elongation = (jd) => norm360(moonLongitude(jd) - sunLongitude(jd));

function equatorial(lon, lat, eps) {
  const ra = Math.atan2(sin(lon) * cos(eps) - Math.tan(lat * RAD) * sin(eps), cos(lon));
  const dec = Math.asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon));
  return { ra: ra / RAD, dec: dec / RAD };
}

function altitude(jd, body, place) {
  const T = ttT(jd);
  const { eps } = nutation(T);
  let pos;
  if (body === "sun") {
    pos = equatorial(sunLongitude(jd), 0, eps);
  } else {
    const m = moonGeometric(T);
    pos = equatorial(norm360(m.lon + nutation(T).dpsi), m.lat, eps);
  }
  const Tu = (jd - 2451545) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * Tu * Tu;
  const H = gmst + place.lon - pos.ra;
  const s = sin(place.lat) * sin(pos.dec) + cos(place.lat) * cos(pos.dec) * cos(H);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

// Upper limb with standard refraction for the Sun; for the Moon, the
// parallax-corrected horizon (Meeus 15.1).
const HORIZON = { sun: -0.8333, moon: 0.125 };

// Times (ms) when the body crosses the horizon between two instants.
export function crossings(body, place, fromMs, toMs, stepMin = 20) {
  const f = (ms) => altitude(jdOf(ms), body, place) - HORIZON[body];
  const out = [];
  const step = stepMin * 60000;
  let a = fromMs;
  let fa = f(a);
  while (a < toMs) {
    const b = Math.min(a + step, toMs);
    const fb = f(b);
    if ((fa < 0) !== (fb < 0)) {
      let lo = a, hi = b, flo = fa;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else { hi = mid; }
      }
      out.push({ ms: (lo + hi) / 2, rising: fa < 0 });
    }
    a = b;
    fa = fb;
  }
  return out;
}

// Mean daily motion in degrees, used to bracket searches.
export const RATE = { elongation: 12.19, moon: 13.18, sun: 0.9856 };

// Instant near guessMs when fn (steadily increasing) reaches target. The
// window is small enough that the angle can't wrap and the answer is unique.
function solveNear(fn, target, guessMs, windowDays) {
  const g = (ms) => wrap180(fn(jdOf(ms)) - target);
  let lo = guessMs - windowDays * DAY_MS;
  let hi = guessMs + windowDays * DAY_MS;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) < 0) lo = mid; else hi = mid;
  }
  return hi;
}

// Instant (ms) at or after `fromMs` when fn next reaches `target` degrees.
export function nextReach(fn, target, fromMs, rate) {
  const ahead = norm360(target - fn(jdOf(fromMs)));
  return solveNear(fn, target, fromMs + (ahead / rate) * DAY_MS, Math.min(3, 30 / rate));
}

// Instant (ms) before `fromMs` when fn last reached `target`.
export function prevReach(fn, target, fromMs, rate) {
  const behind = norm360(fn(jdOf(fromMs)) - target);
  return solveNear(fn, target, fromMs - (behind / rate) * DAY_MS, Math.min(3, 30 / rate));
}

export { msOf };

// Shared with planets.js.
export { deltaT, nutation, sunGeometric, ttT, equatorial };
