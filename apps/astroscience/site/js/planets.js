// Sidereal (Lahiri) positions of the nine grahas and the lagna for one
// instant and place. Sun and Moon come from astro.js (Meeus); the planets use
// Paul Schlyter's orbital elements with the main Jupiter-Saturn
// perturbations, plus light-time. test/planets.test.mjs checks everything
// against Swiss Ephemeris.
import { ayanamsa, jdOf, moonSidereal, norm360, nutation, sunGeometric, sunSidereal, ttT } from "./astro.js";

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const atan2 = (y, x) => Math.atan2(y, x) / RAD;

// [N0, N1, i0, i1, w0, w1, a, e0, e1, M0, M1], d = days from 2000 Jan 0.0 TT.
const ELEMENTS = {
  mercury: [48.3313, 3.24587e-5, 7.0047, 5.0e-8, 29.1241, 1.01444e-5, 0.387098, 0.205635, 5.59e-10, 168.6562, 4.0923344368],
  venus: [76.6799, 2.4659e-5, 3.3946, 2.75e-8, 54.891, 1.38374e-5, 0.72333, 0.006773, -1.302e-9, 48.0052, 1.6021302244],
  mars: [49.5574, 2.11081e-5, 1.8497, -1.78e-8, 286.5016, 2.92961e-5, 1.523688, 0.093405, 2.516e-9, 18.6021, 0.5240207766],
  jupiter: [100.4542, 2.76854e-5, 1.303, -1.557e-7, 273.8777, 1.64505e-5, 5.20256, 0.048498, 4.469e-9, 19.895, 0.0830853001],
  saturn: [113.6634, 2.3898e-5, 2.4886, -1.081e-7, 339.3939, 2.97661e-5, 9.55475, 0.055546, -9.499e-9, 316.967, 0.0334442282],
};

function heliocentric(name, d) {
  const [N0, N1, i0, i1, w0, w1, a, e0, e1, M0, M1] = ELEMENTS[name];
  const N = N0 + N1 * d, i = i0 + i1 * d, w = w0 + w1 * d, e = e0 + e1 * d, M = norm360(M0 + M1 * d);
  let E = M + (e / RAD) * sin(M) * (1 + e * cos(M));
  for (let k = 0; k < 8; k++) E -= (E - (e / RAD) * sin(E) - M) / (1 - e * cos(E));
  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);
  const v = atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const x = r * (cos(N) * cos(v + w) - sin(N) * sin(v + w) * cos(i));
  const y = r * (sin(N) * cos(v + w) + cos(N) * sin(v + w) * cos(i));
  const z = r * sin(v + w) * sin(i);
  let lon = atan2(y, x);
  let lat = atan2(z, Math.hypot(x, y));
  if (name === "jupiter" || name === "saturn") {
    const Mj = norm360(19.895 + 0.0830853001 * d);
    const Ms = norm360(316.967 + 0.0334442282 * d);
    if (name === "jupiter") {
      lon += -0.332 * sin(2 * Mj - 5 * Ms - 67.6) - 0.056 * sin(2 * Mj - 2 * Ms + 21) + 0.042 * sin(3 * Mj - 5 * Ms + 21) -
        0.036 * sin(Mj - 2 * Ms) + 0.022 * cos(Mj - Ms) + 0.023 * sin(2 * Mj - 3 * Ms + 52) - 0.016 * sin(Mj - 5 * Ms - 69);
    } else {
      lon += 0.812 * sin(2 * Mj - 5 * Ms - 67.6) - 0.229 * cos(2 * Mj - 4 * Ms - 2) + 0.119 * sin(Mj - 2 * Ms - 3) +
        0.046 * sin(2 * Mj - 6 * Ms - 69) + 0.014 * sin(Mj - 3 * Ms + 32);
      lat += -0.02 * cos(2 * Mj - 4 * Ms - 2) + 0.018 * sin(2 * Mj - 6 * Ms - 49);
    }
  }
  return [r * cos(lon) * cos(lat), r * sin(lon) * cos(lat), r * sin(lat)];
}

// Geocentric tropical longitude (mean equinox of date), corrected for light-time.
function planetTropical(name, jd) {
  const T = ttT(jd);
  const d = T * 36525 + 1.5;
  const { lon: sl, R } = sunGeometric(T);
  const ex = R * cos(sl), ey = R * sin(sl);
  let tau = 0;
  let g;
  for (let k = 0; k < 2; k++) {
    const [x, y, z] = heliocentric(name, d - tau);
    g = [x + ex, y + ey, z];
    tau = 0.0057755183 * Math.hypot(...g);
  }
  // Annual aberration (Meeus 23.2, ecliptic, ignoring e).
  const lam = atan2(g[1], g[0]);
  return norm360(lam - (20.49552 / 3600) * cos(sl - lam));
}

const meanNode = (jd) => {
  const T = ttT(jd);
  return norm360(125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + (T * T * T) / 467441);
};

export const GRAHAS = ["sun", "moon", "mars", "mercury", "jupiter", "venus", "saturn", "rahu", "ketu"];

export function siderealLongitude(name, jd) {
  switch (name) {
    case "sun": return sunSidereal(jd);
    case "moon": return moonSidereal(jd);
    case "rahu": return norm360(meanNode(jd) - ayanamsa(jd));
    case "ketu": return norm360(meanNode(jd) + 180 - ayanamsa(jd));
    default: return norm360(planetTropical(name, jd) - ayanamsa(jd));
  }
}

// Sidereal ascendant for a place (lat/lon in degrees, east positive).
export function lagnaLongitude(jd, place) {
  const T = ttT(jd);
  const { eps, dpsi } = nutation(T);
  const Tu = (jd - 2451545) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * Tu * Tu;
  const theta = norm360(gmst + dpsi * cos(eps) + place.lon);
  const asc = atan2(cos(theta), -(sin(theta) * cos(eps) + Math.tan(place.lat * RAD) * sin(eps)));
  return norm360(asc - ayanamsa(jd));
}

// Everything for one instant: longitude, daily motion and retrograde flag.
export function positions(ms, place, withSpeed = true) {
  const jd = jdOf(ms);
  const out = { jd, lagna: lagnaLongitude(jd, place), grahas: {} };
  for (const g of GRAHAS) {
    const lon = siderealLongitude(g, jd);
    let speed;
    if (g === "rahu" || g === "ketu") speed = -0.0529539;
    else if (!withSpeed) speed = 1;
    else speed = ((siderealLongitude(g, jd + 0.5) - siderealLongitude(g, jd - 0.5) + 540) % 360) - 180;
    out.grahas[g] = { lon, speed, retro: speed < 0 && g !== "rahu" && g !== "ketu" };
  }
  return out;
}
