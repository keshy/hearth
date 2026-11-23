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
    placeFeedback();
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

  // Feedback: a button beside the theme switch (or floating, if the app has
  // none) that opens a small form. It lives in a shadow root so an app's own
  // CSS can't restyle it. <html data-hearth-feedback="off"> leaves it out.
  var FB_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14.5h4.5"/></svg>';
  var FB_CSS = "<style>" +
    ":host{display:inline-flex;vertical-align:middle;font:15px/1.45 var(--font-sans,system-ui,sans-serif);color:var(--fg,#1f1a15)}" +
    ":host(.floating){position:fixed;right:16px;bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483000;margin:0}" +
    "*{box-sizing:border-box}" +
    "button{font:inherit;cursor:pointer}" +
    ".open{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border:1px solid var(--line,#e8e1d6);border-radius:999px;background:var(--card,#fff);color:var(--fg,#1f1a15);font:500 13px/1 var(--font-sans,system-ui,sans-serif);white-space:nowrap}" +
    ".open:hover{border-color:var(--line-strong,#d5cab9)}" +
    ":host(.floating) .open{box-shadow:var(--shadow-2,0 8px 24px rgba(0,0,0,.18))}" +
    ".open svg{width:16px;height:16px;flex:none}" +
    "@media (max-width:520px){:host(:not(.floating)) .open .lbl{display:none}:host(:not(.floating)) .open{padding:0 10px}}" +
    "dialog{width:min(460px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;padding:20px;border:1px solid var(--line,#e8e1d6);border-radius:var(--radius-lg,20px);background:var(--card,#fff);color:var(--fg,#1f1a15);box-shadow:var(--shadow-2,0 12px 34px rgba(0,0,0,.25))}" +
    "dialog::backdrop{background:var(--scrim,rgba(25,18,10,.4))}" +
    "h2{margin:0;font:600 21px/1.2 var(--font-display,Georgia,serif)}" +
    ".about{margin:4px 0 14px;color:var(--muted,#6b6257);font-size:13px}" +
    "label{display:block;margin:0 0 12px;font-weight:600;font-size:14px}" +
    ".opt{font-weight:400;color:var(--muted,#6b6257)}" +
    "textarea,input{display:block;width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--line-strong,#d5cab9);border-radius:var(--radius-sm,10px);background:var(--card-2,#fbf9f6);color:inherit;font:inherit;font-weight:400}" +
    "textarea{resize:vertical;min-height:110px}" +
    "textarea:focus,input:focus{outline:3px solid color-mix(in srgb,var(--accent,#c2410c) 45%,transparent);outline-offset:0;border-color:var(--accent,#c2410c)}" +
    ".names{display:flex;flex-wrap:wrap;gap:6px;margin:-4px 0 12px}" +
    ".names button{padding:4px 11px;border-radius:999px;border:1px solid var(--line,#e8e1d6);background:var(--card,#fff);color:inherit;font-size:13px}" +
    ".names button[aria-pressed=true]{background:var(--accent,#c2410c);border-color:var(--accent,#c2410c);color:var(--accent-fg,#fff)}" +
    ".ghost{padding:8px 13px;border-radius:var(--radius-sm,10px);border:1px solid var(--line-strong,#d5cab9);background:transparent;color:var(--fg,#1f1a15);font-size:14px}" +
    ".ghost:hover{background:var(--bg-2,#efe9e0)}" +
    "figure{position:relative;margin:0;display:inline-block}" +
    "figure img{display:block;max-width:100%;max-height:180px;border-radius:var(--radius-sm,10px);border:1px solid var(--line,#e8e1d6)}" +
    ".x{position:absolute;top:6px;right:6px;width:28px;height:28px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:17px;line-height:1}" +
    ".hint{margin:6px 0 0;font-size:12px;color:var(--muted,#6b6257)}" +
    ".ctx{margin:14px 0 0;font-size:12px;color:var(--muted,#6b6257)}" +
    ".err{margin:10px 0 0;color:var(--danger,#b91c1c);font-size:14px}.err:empty{display:none}" +
    ".row{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}" +
    ".send{padding:8px 18px;border-radius:var(--radius-sm,10px);border:1px solid var(--accent,#c2410c);background:var(--accent,#c2410c);color:var(--accent-fg,#fff);font-weight:600;font-size:14px}" +
    ".send:disabled{opacity:.6;cursor:wait}" +
    ".thanks{text-align:center;padding:18px 4px 6px}.thanks p{color:var(--muted,#6b6257);margin:6px 0 0}" +
    "[hidden]{display:none!important}" +
    "</style>";
  var FB_HTML =
    '<button type="button" class="open" aria-haspopup="dialog">' + FB_ICON + '<span class="lbl">Feedback</span></button>' +
    '<dialog aria-labelledby="fb-title"><form novalidate>' +
    '<h2 id="fb-title">Feedback</h2><p class="about"></p>' +
    '<label>What\'s working, what isn\'t, or what you wish it did<textarea name="m" maxlength="2000" required></textarea></label>' +
    '<label>Your name <span class="opt">(optional)</span><input name="n" maxlength="40" autocomplete="name"></label>' +
    '<div class="names" hidden></div>' +
    '<div class="pic"><button type="button" class="ghost add">Add a screenshot or photo</button>' +
    '<input type="file" accept="image/*" hidden><figure hidden><img alt="Attached picture"><button type="button" class="x" aria-label="Remove picture">\u00d7</button></figure>' +
    '<p class="hint">You can also paste a screenshot here.</p></div>' +
    '<p class="ctx"></p><p class="err" role="alert"></p>' +
    '<div class="row"><button type="button" class="ghost cancel">Cancel</button><button type="submit" class="send">Send</button></div>' +
    '</form><div class="thanks" hidden><h2>Thank you</h2><p>It\'s in the inbox on the admin page.</p></div></dialog>';

  var fb = null, fbHost = null;

  // Beside the first theme switch; floating when the app has none (yet).
  function placeFeedback() {
    if (!fbHost) return;
    var toggle = document.querySelector("[data-hearth-theme-toggle]");
    if (toggle && toggle.parentNode) {
      fbHost.className = "";
      if (toggle.nextSibling === fbHost) return;
      // One group in the switch's slot, so the app's header layout sees a
      // single item where it had one.
      var group = toggle.parentNode;
      if (!group.hasAttribute("data-hearth-tools")) {
        group = document.createElement("span");
        group.setAttribute("data-hearth-tools", "");
        group.style.cssText = "display:inline-flex;align-items:center;gap:6px;flex:none";
        toggle.parentNode.insertBefore(group, toggle);
        group.appendChild(toggle);
      }
      group.appendChild(fbHost);
    } else if (!fbHost.parentNode) {
      fbHost.className = "floating";
      document.body.appendChild(fbHost);
    }
  }

  // Phone photos are large; send a JPEG no bigger than 1600px on a side.
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error("That isn't a picture."));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That picture couldn't be read.")); };
      img.src = url;
    });
  }

  function feedbackUI() {
    if (fb || root.getAttribute("data-hearth-feedback") === "off" || !document.body || !document.body.attachShadow) return;
    var host = document.createElement("span");
    host.setAttribute("data-hearth-feedback", "");
    var sh = host.attachShadow({ mode: "open" });
    sh.innerHTML = FB_CSS + FB_HTML;
    fbHost = host;
    placeFeedback();

    var q = function (s) { return sh.querySelector(s); };
    var dlg = q("dialog"), form = q("form"), msg = q("textarea"), name = q("input[name=n]"), names = q(".names");
    var file = q("input[type=file]"), fig = q("figure"), err = q(".err"), send = q(".send");
    var image = "";

    function setImage(dataURL) {
      image = dataURL || "";
      fig.hidden = !image;
      q(".add").hidden = !!image;
      q("figure img").src = image || "";
    }
    function attach(f) {
      err.textContent = "";
      shrink(f).then(setImage, function (e) { err.textContent = e.message; });
    }
    function paintNames(list) {
      names.innerHTML = "";
      for (var i = 0; i < list.length; i++) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = list[i];
        b.setAttribute("aria-pressed", String(list[i] === name.value));
        b.addEventListener("click", function (e) { name.value = e.currentTarget.textContent; paintNames(list); });
        names.appendChild(b);
      }
      names.hidden = !list.length;
      name.oninput = function () { paintNames(list); };
    }

    function open(prefill) {
      form.hidden = false;
      q(".thanks").hidden = true;
      err.textContent = "";
      if (prefill) msg.value = String(prefill);
      q(".about").textContent = "About " + ((document.title || location.hostname).split(/\s[\u00b7|\u2014-]\s/).pop());
      q(".ctx").textContent = "Also sent: this page's address, " + resolved() + " mode, a " +
        window.innerWidth + "\u00d7" + window.innerHeight + " window, and your browser.";
      fetch("/_hearth/feedback/me", { cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) return;
          if (d.app) q(".about").textContent = "About " + d.app;
          if (!name.value && d.name) name.value = d.name;
          paintNames(d.names || []);
        })
        .catch(function () {});
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
      msg.focus();
    }
    function close() { if (dlg.open) dlg.close ? dlg.close() : dlg.removeAttribute("open"); }

    q(".open").addEventListener("click", function () { open(); });
    q(".cancel").addEventListener("click", close);
    q(".add").addEventListener("click", function () { file.click(); });
    q(".x").addEventListener("click", function () { setImage(""); file.value = ""; });
    file.addEventListener("change", function () { if (file.files[0]) attach(file.files[0]); });
    dlg.addEventListener("paste", function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image/") === 0) { e.preventDefault(); attach(items[i].getAsFile()); return; }
      }
    });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!msg.value.trim()) { err.textContent = "Write a few words first."; msg.focus(); return; }
      send.disabled = true;
      send.textContent = "Sending\u2026";
      err.textContent = "";
      fetch("/_hearth/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({
          message: msg.value, name: name.value.trim(), page: location.href, theme: resolved(),
          viewport: window.innerWidth + "\u00d7" + window.innerHeight, image: image
        })
      }).then(function (r) {
        if (r.ok) return;
        return r.json().then(function (d) { throw new Error(d && d.error); }, function () { throw new Error(); });
      }).then(function () {
        msg.value = "";
        setImage("");
        file.value = "";
        form.hidden = true;
        q(".thanks").hidden = false;
        setTimeout(close, 1800);
      }, function (e2) {
        err.textContent = (e2 && e2.message) || "Couldn't send. Check the connection and try again.";
      }).then(function () {
        send.disabled = false;
        send.textContent = "Send";
      });
    });

    fb = { open: open };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", feedbackUI);
  else feedbackUI();

  window.hearth = window.hearth || {};
  window.hearth.theme = {
    get: function () { return { pref: pref, theme: resolved() }; },
    set: set,
    wire: wire
  };
  window.hearth.report = function (message, detail) {
    report("app", message, "", 0, 0, detail ? String(detail) : "");
  };
  // Apps can open the form themselves, optionally with text filled in.
  window.hearth.feedback = function (prefill) {
    feedbackUI();
    if (fb) fb.open(prefill);
  };
})();
