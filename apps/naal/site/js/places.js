// Where we are, for sunrise and sunset. A saved device location wins;
// otherwise the device's time zone picks a nearby city. Sunrise only moves
// a few minutes across a city, so a zone-level guess is good enough.

const ZONES = {
  "America/Los_Angeles": ["San Francisco Bay Area", 37.55, -121.99],
  "America/Vancouver": ["Vancouver", 49.28, -123.12],
  "America/Phoenix": ["Phoenix", 33.45, -112.07],
  "America/Denver": ["Denver", 39.74, -104.99],
  "America/Chicago": ["Chicago", 41.88, -87.63],
  "America/New_York": ["New York", 40.71, -74.01],
  "America/Toronto": ["Toronto", 43.65, -79.38],
  "America/Detroit": ["Detroit", 42.33, -83.05],
  "Pacific/Honolulu": ["Honolulu", 21.31, -157.86],
  "America/Anchorage": ["Anchorage", 61.22, -149.9],
  "Asia/Kolkata": ["Chennai", 13.08, 80.27],
  "Asia/Calcutta": ["Chennai", 13.08, 80.27],
  "Asia/Colombo": ["Colombo", 6.93, 79.86],
  "Asia/Singapore": ["Singapore", 1.35, 103.82],
  "Asia/Kuala_Lumpur": ["Kuala Lumpur", 3.14, 101.69],
  "Asia/Dubai": ["Dubai", 25.2, 55.27],
  "Asia/Qatar": ["Doha", 25.29, 51.53],
  "Asia/Muscat": ["Muscat", 23.59, 58.41],
  "Asia/Riyadh": ["Riyadh", 24.71, 46.68],
  "Asia/Tokyo": ["Tokyo", 35.68, 139.69],
  "Asia/Hong_Kong": ["Hong Kong", 22.32, 114.17],
  "Europe/London": ["London", 51.51, -0.13],
  "Europe/Dublin": ["Dublin", 53.35, -6.26],
  "Europe/Berlin": ["Berlin", 52.52, 13.4],
  "Europe/Paris": ["Paris", 48.86, 2.35],
  "Europe/Amsterdam": ["Amsterdam", 52.37, 4.9],
  "Europe/Zurich": ["Zurich", 47.38, 8.54],
  "Australia/Sydney": ["Sydney", -33.87, 151.21],
  "Australia/Melbourne": ["Melbourne", -37.81, 144.96],
  "Australia/Perth": ["Perth", -31.95, 115.86],
  "Pacific/Auckland": ["Auckland", -36.85, 174.76],
  "Africa/Johannesburg": ["Johannesburg", -26.2, 28.05],
};

const KEY = "naal.place";

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function currentPlace() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) return { ...saved, source: "device" };
  } catch { /* fall through to the zone guess */ }
  const zone = timeZone();
  const hit = ZONES[zone];
  if (hit) return { name: hit[0], lat: hit[1], lon: hit[2], source: "zone" };
  // Unknown zone: mid-latitude at the zone's own meridian.
  const offsetHours = -new Date().getTimezoneOffset() / 60;
  return { name: zone.split("/").pop().replace(/_/g, " "), lat: 30, lon: offsetHours * 15, source: "zone" };
}

export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser can't share its location."));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const place = {
          name: "This device",
          lat: Math.round(pos.coords.latitude * 100) / 100,
          lon: Math.round(pos.coords.longitude * 100) / 100,
        };
        localStorage.setItem(KEY, JSON.stringify(place));
        resolve({ ...place, source: "device" });
      },
      (err) => reject(new Error(err.code === 1 ? "Location permission was denied." : "Couldn't get a location fix.")),
      { timeout: 15000, maximumAge: 86400000 },
    );
  });
}

export function forgetLocation() {
  localStorage.removeItem(KEY);
}
