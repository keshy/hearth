// Birthplaces: a short list of cities families are likely to need, plus
// wall-clock <-> UTC conversion in any IANA zone (historic offsets included,
// courtesy of the browser's time zone database).

export const CITIES = [
  ["Chennai", 13.08, 80.27, "Asia/Kolkata"],
  ["Madurai", 9.93, 78.12, "Asia/Kolkata"],
  ["Coimbatore", 11.02, 76.96, "Asia/Kolkata"],
  ["Tiruchirappalli", 10.8, 78.69, "Asia/Kolkata"],
  ["Thanjavur", 10.79, 79.14, "Asia/Kolkata"],
  ["Kumbakonam", 10.96, 79.38, "Asia/Kolkata"],
  ["Tirunelveli", 8.71, 77.76, "Asia/Kolkata"],
  ["Salem", 11.66, 78.15, "Asia/Kolkata"],
  ["Vellore", 12.92, 79.13, "Asia/Kolkata"],
  ["Kanchipuram", 12.83, 79.7, "Asia/Kolkata"],
  ["Erode", 11.34, 77.72, "Asia/Kolkata"],
  ["Nagercoil", 8.18, 77.41, "Asia/Kolkata"],
  ["Karaikudi", 10.07, 78.78, "Asia/Kolkata"],
  ["Puducherry", 11.94, 79.81, "Asia/Kolkata"],
  ["Bengaluru", 12.97, 77.59, "Asia/Kolkata"],
  ["Mysuru", 12.3, 76.64, "Asia/Kolkata"],
  ["Hyderabad", 17.39, 78.49, "Asia/Kolkata"],
  ["Tirupati", 13.63, 79.42, "Asia/Kolkata"],
  ["Kochi", 9.93, 76.27, "Asia/Kolkata"],
  ["Thiruvananthapuram", 8.52, 76.94, "Asia/Kolkata"],
  ["Palakkad", 10.79, 76.65, "Asia/Kolkata"],
  ["Mumbai", 19.08, 72.88, "Asia/Kolkata"],
  ["Pune", 18.52, 73.86, "Asia/Kolkata"],
  ["New Delhi", 28.61, 77.21, "Asia/Kolkata"],
  ["Kolkata", 22.57, 88.36, "Asia/Kolkata"],
  ["Ahmedabad", 23.02, 72.57, "Asia/Kolkata"],
  ["Colombo", 6.93, 79.86, "Asia/Colombo"],
  ["Jaffna", 9.66, 80.01, "Asia/Colombo"],
  ["Singapore", 1.35, 103.82, "Asia/Singapore"],
  ["Kuala Lumpur", 3.14, 101.69, "Asia/Kuala_Lumpur"],
  ["Dubai", 25.2, 55.27, "Asia/Dubai"],
  ["Doha", 25.29, 51.53, "Asia/Qatar"],
  ["Fremont, CA", 37.55, -121.99, "America/Los_Angeles"],
  ["San Jose, CA", 37.34, -121.89, "America/Los_Angeles"],
  ["San Francisco, CA", 37.77, -122.42, "America/Los_Angeles"],
  ["Los Angeles, CA", 34.05, -118.24, "America/Los_Angeles"],
  ["Seattle, WA", 47.61, -122.33, "America/Los_Angeles"],
  ["Phoenix, AZ", 33.45, -112.07, "America/Phoenix"],
  ["Denver, CO", 39.74, -104.99, "America/Denver"],
  ["Dallas, TX", 32.78, -96.8, "America/Chicago"],
  ["Houston, TX", 29.76, -95.37, "America/Chicago"],
  ["Austin, TX", 30.27, -97.74, "America/Chicago"],
  ["Chicago, IL", 41.88, -87.63, "America/Chicago"],
  ["Atlanta, GA", 33.75, -84.39, "America/New_York"],
  ["Raleigh, NC", 35.78, -78.64, "America/New_York"],
  ["Washington, DC", 38.91, -77.04, "America/New_York"],
  ["Edison, NJ", 40.52, -74.41, "America/New_York"],
  ["New York, NY", 40.71, -74.01, "America/New_York"],
  ["Boston, MA", 42.36, -71.06, "America/New_York"],
  ["Toronto", 43.65, -79.38, "America/Toronto"],
  ["Vancouver", 49.28, -123.12, "America/Vancouver"],
  ["London", 51.51, -0.13, "Europe/London"],
  ["Frankfurt", 50.11, 8.68, "Europe/Berlin"],
  ["Paris", 48.86, 2.35, "Europe/Paris"],
  ["Zurich", 47.38, 8.54, "Europe/Zurich"],
  ["Johannesburg", -26.2, 28.05, "Africa/Johannesburg"],
  ["Tokyo", 35.68, 139.69, "Asia/Tokyo"],
  ["Hong Kong", 22.32, 114.17, "Asia/Hong_Kong"],
  ["Sydney", -33.87, 151.21, "Australia/Sydney"],
  ["Melbourne", -37.81, 144.96, "Australia/Melbourne"],
  ["Auckland", -36.85, 174.76, "Pacific/Auckland"],
].map(([name, lat, lon, tz]) => ({ name, lat, lon, tz }));

const DEFAULT_FOR_ZONE = {
  "America/Los_Angeles": "Fremont, CA", "America/Chicago": "Dallas, TX", "America/New_York": "New York, NY",
  "America/Denver": "Denver, CO", "America/Phoenix": "Phoenix, AZ", "Asia/Kolkata": "Chennai", "Asia/Calcutta": "Chennai",
  "Asia/Colombo": "Colombo", "Asia/Singapore": "Singapore", "Asia/Dubai": "Dubai", "Europe/London": "London",
  "Australia/Sydney": "Sydney", "America/Toronto": "Toronto",
};

export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export function defaultCity() {
  const name = DEFAULT_FOR_ZONE[deviceZone()];
  return CITIES.find((c) => c.name === name) || CITIES[0];
}

const fmtCache = new Map();
function parts(ms, tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  const o = {};
  for (const p of fmtCache.get(tz).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
}

// Minutes the zone is ahead of UTC at an instant.
export function offsetMinutes(ms, tz) {
  const p = parts(ms, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUTC - Math.floor(ms / 1000) * 1000) / 60000);
}

// Wall-clock time in a zone -> UTC milliseconds.
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let ms = wall - offsetMinutes(wall, tz) * 60000;
  ms = wall - offsetMinutes(ms, tz) * 60000;
  return ms;
}

export function utcToZoned(ms, tz) {
  const p = parts(ms, tz);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute };
}

export function formatZoned(ms, tz, opts = { dateStyle: "medium", timeStyle: "short" }) {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(ms));
}
