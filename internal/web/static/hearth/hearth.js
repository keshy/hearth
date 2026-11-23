/* Hearth platform script, served at /_hearth/hearth.js on every app.
   Load it in <head> (not as a module) so the theme applies before paint:
     <script src="/_hearth/hearth.js"></script>
   It sets data-theme on <html>, wires every [data-hearth-theme-toggle],
   links the platform's web app manifest so the app can be installed, and
   reports uncaught errors to the platform so the builder can show them. */
(function () {
  "use strict";
  var saved = "__PREF__"; // filled in by the server from the house cookie
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var pref = saved === "light" || saved === "dark" ? saved : "system";
  var NEXT = { system: "light", light: "dark", dark: "system" };
  var LABEL = { system: "Auto", light: "Light", dark: "Dark" };
  var ICON = {
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
  };

  function resolved() {
    if (pref !== "system") return pref;
    return mq && mq.matches ? "dark" : "light";
  }

  function paintToggles() {
    var els = document.querySelectorAll("[data-hearth-theme-toggle]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.innerHTML = ICON[pref] + '<span class="theme-label">' + LABEL[pref] + "</span>";
      el.setAttribute("aria-label", "Theme: " + LABEL[pref] + ". Switch to " + LABEL[NEXT[pref]]);
      el.title = "Theme: " + LABEL[pref] + " (applies to every app)";
    }
  }

  function apply() {
    var t = resolved();
    root.setAttribute("data-theme", t);
    root.setAttribute("data-theme-pref", pref);
    paintToggles();
    try {
      document.dispatchEvent(new CustomEvent("hearth:theme", { detail: { theme: t, pref: pref } }));
    } catch (e) { /* very old browser */ }
  }

  // Returns a promise that settles once the choice is saved (or saving failed).
  function set(next) {
    if (!LABEL[next]) return Promise.resolve();
    pref = next;
    apply();
    try {
      return fetch("/_hearth/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next }),
        credentials: "same-origin"
      }).then(function () {}, function () {});
    } catch (e) {
      return Promise.resolve();
    }
  }

  function wire() {
    var els = document.querySelectorAll("[data-hearth-theme-toggle]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.getAttribute("data-wired")) continue;
      el.setAttribute("data-wired", "1");
      if (el.tagName === "BUTTON") el.type = "button";
      el.classList.add("theme-toggle");
      el.addEventListener("click", function () { set(NEXT[pref]); });
    }
    paintToggles();
  }

  // Another app may have changed the house theme while this tab was hidden.
  function resync() {
    if (document.visibilityState !== "visible") return;
    fetch("/_hearth/theme", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var p = d && d.theme;
        if (p && LABEL[p] && p !== pref) { pref = p; apply(); }
      })
      .catch(function () {});
  }

  // An app's own manifest or touch icon wins over the platform's.
  function addLink(rel, href) {
    var head = document.head || document.getElementsByTagName("head")[0];
    if (!head || document.querySelector('link[rel="' + rel + '"]')) return;
    var l = document.createElement("link");
    l.rel = rel;
    l.href = href;
    // Private apps sit behind the admin password; the manifest fetch must send it.
    if (rel === "manifest") l.crossOrigin = "use-credentials";
    head.appendChild(l);
  }
  addLink("manifest", "/_hearth/manifest.webmanifest");
  addLink("apple-touch-icon", "/_hearth/icons/180.png");

  apply();
  if (mq) {
    var onChange = function () { if (pref === "system") apply(); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
  document.addEventListener("visibilitychange", resync);

  // Error reports: uncaught errors, rejected promises and files that fail to load.
  var sent = 0, seen = {};
  function report(kind, message, source, line, col, stack) {
    if (sent >= 10) return;
    var key = kind + "|" + message + "|" + source + "|" + line;
    if (seen[key]) return;
    seen[key] = 1;
    sent++;
    var body = JSON.stringify({
      kind: kind,
      message: String(message || "").slice(0, 500),
      source: String(source || "").slice(0, 300),
      line: line || 0,
      col: col || 0,
      stack: String(stack || "").slice(0, 2000),
      page: location.pathname + location.search,
      agent: navigator.userAgent.slice(0, 200)
    });
    try {
      fetch("/_hearth/errors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: body, keepalive: true, credentials: "same-origin"
      }).catch(function () {});
    } catch (e) { /* nothing to do */ }
  }
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) {
      report("resource", "couldn't load <" + t.tagName.toLowerCase() + ">", t.src || t.href, 0, 0, "");
      return;
    }
    report("error", e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason || {};
    report("promise", r.message || String(r), "", 0, 0, r.stack);
  });

  window.hearth = window.hearth || {};
  window.hearth.theme = {
    get: function () { return { pref: pref, theme: resolved() }; },
    set: set,
    wire: wire
  };
  window.hearth.report = function (message, detail) {
    report("app", message, "", 0, 0, detail ? String(detail) : "");
  };
})();
