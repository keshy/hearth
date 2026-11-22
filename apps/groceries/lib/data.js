// Shared storage for this app on apps-home. Values are JSON and shared by
// everyone on the home network who opens the app. Supplied by the platform:
// the builder replaces this file on every build, so don't customize it.

const base = "/_api/data";

async function request(method, key, body) {
  const url = key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}

async function fail(res, what) {
  let detail = `HTTP ${res.status}`;
  try {
    detail = (await res.json()).error || detail;
  } catch (_) { /* not JSON */ }
  throw new Error(`${what}: ${detail}`);
}

/** Returns the stored value for key, or fallback if nothing is stored yet. */
export async function load(key, fallback = null) {
  const res = await request("GET", key);
  if (res.status === 404) return fallback;
  if (!res.ok) await fail(res, `couldn't load ${key}`);
  return res.json();
}

/** Stores any JSON-serializable value (up to 256 KB) under key. */
export async function save(key, value) {
  const res = await request("PUT", key, value);
  if (!res.ok) await fail(res, `couldn't save ${key}`);
}

export async function remove(key) {
  const res = await request("DELETE", key);
  if (!res.ok) await fail(res, `couldn't delete ${key}`);
}

/** Lists the keys this app has stored. */
export async function keys() {
  const res = await request("GET");
  if (!res.ok) await fail(res, "couldn't list keys");
  return (await res.json()).keys;
}

/** The portal's address, derived from this app's own host. */
export const portalURL = `${location.protocol}//${location.host.split(".").slice(1).join(".")}/`;
