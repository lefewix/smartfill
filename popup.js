// SmartFill popup — profile management + fill trigger.

const FIELDS = [
  "firstName", "lastName", "email", "phone", "dob", "address", "address2",
  "city", "region", "postal", "country", "company", "bandaiName", "bandaiId", "discord"
];

let profiles = [];
let activeProfileId = null;
let autoSites = [];
let pins = {};          // { baseDomain: { descriptor: profileField } }
let currentBase = null; // base domain of the active tab

const $ = (id) => document.getElementById(id);

// ---- domain normalization ----
const TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
  "co.jp", "ne.jp", "or.jp", "co.nz", "com.br", "com.mx", "co.in", "co.kr"
]);

function baseDomain(host) {
  host = (host || "").toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host || null;
  const lastTwo = parts.slice(-2).join(".");
  return TWO_PART_TLDS.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

// Accepts "xyz.abc", "xyz.abc/sakldfj...", "https://tickets.xyz.abc/x?y=z"
function normalizeSite(input) {
  let s = (input || "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try {
    const host = new URL(s).hostname;
    if (!host || !host.includes(".")) return null;
    return baseDomain(host);
  } catch {
    return null;
  }
}

async function load() {
  const data = await chrome.storage.local.get(["profiles", "activeProfileId", "autoSites", "pins"]);
  profiles = data.profiles || [];
  autoSites = data.autoSites || [];
  pins = data.pins || {};
  activeProfileId = data.activeProfileId || (profiles[0] && profiles[0].id) || null;
  if (!profiles.length) {
    newProfile();
    $("editor").open = true;
  }

  // Resolve the active tab's base domain for the toggle
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = tab?.url ? new URL(tab.url).hostname : null;
    currentBase = host && host.includes(".") ? baseDomain(host) : null;
  } catch { currentBase = null; }

  render();
  renderSites();
}

// Pins are also written by the content script after each fill, so they are
// persisted on their own rather than round-tripped through every save here.
function persist() {
  return chrome.storage.local.set({ profiles, activeProfileId, autoSites });
}

// Pins are written by the background worker only — it serializes writes from
// every frame and from here, always against a freshly read object. Sending a
// whole copy of `pins` from the popup would clobber whatever a fill just wrote.
function pinOp(msg) {
  return chrome.runtime.sendMessage(Object.assign({ action: "pins" }, msg));
}

async function refreshPins() {
  const { pins: p = {} } = await chrome.storage.local.get(["pins"]);
  pins = p;
  renderPins();
}

function renderSites() {
  // Current-site toggle
  const toggle = $("autoToggle");
  const siteName = $("siteName");
  if (currentBase) {
    siteName.textContent = currentBase;
    toggle.disabled = false;
    toggle.checked = autoSites.includes(currentBase);
  } else {
    siteName.textContent = "this site";
    toggle.disabled = true;
    toggle.checked = false;
  }

  // Allowlist
  const list = $("siteList");
  list.innerHTML = "";
  for (const s of autoSites) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = s + " ";
    const x = document.createElement("button");
    x.textContent = "✕";
    x.title = "Remove";
    x.addEventListener("click", async () => {
      autoSites = autoSites.filter(v => v !== s);
      await persist();
      renderSites();
    });
    chip.appendChild(x);
    list.appendChild(chip);
  }

  renderPins();
}

// Sites where a previous fill pinned descriptor → profile field mappings.
// Click a site to inspect its individual pins and remove them one at a time.
let openPinSite = null;

function renderPins() {
  const head = $("pinHead");
  const list = $("pinList");
  const detail = $("pinDetail");
  list.innerHTML = "";
  detail.innerHTML = "";

  const sites = Object.keys(pins).filter(s => Object.keys(pins[s] || {}).length).sort();
  if (!sites.length) {
    head.textContent = "No pinned fields yet";
    openPinSite = null;
    return;
  }
  head.textContent = "";
  head.append("Pinned fields on ");
  const n = document.createElement("b");
  n.textContent = String(sites.length);
  head.append(n, ` site${sites.length === 1 ? "" : "s"}`);

  for (const s of sites) {
    const chip = document.createElement("span");
    chip.className = "chip" + (s === openPinSite ? " on" : "");

    const name = document.createElement("button");
    name.className = "chip-label";
    name.textContent = `${s} ${Object.keys(pins[s]).length}`;
    name.title = `Show pinned fields on ${s}`;
    name.addEventListener("click", () => {
      openPinSite = openPinSite === s ? null : s;
      renderPins();
    });

    const x = document.createElement("button");
    x.textContent = "✕";
    x.title = `Clear pinned fields for ${s}`;
    x.addEventListener("click", async () => {
      if (openPinSite === s) openPinSite = null;
      await pinOp({ op: "clearSite", site: s });
      await refreshPins();
    });
    chip.append(name, x);
    list.appendChild(chip);
  }

  if (!openPinSite || !pins[openPinSite]) return;
  for (const [desc, type] of Object.entries(pins[openPinSite]).sort()) {
    const row = document.createElement("div");
    row.className = "pinrow";
    const d = document.createElement("span");
    d.className = "pindesc";
    d.textContent = desc;
    d.title = desc;
    const t = document.createElement("span");
    t.className = "pintype";
    t.textContent = type;
    const x = document.createElement("button");
    x.textContent = "✕";
    x.title = "Remove this pin";
    x.addEventListener("click", async () => {
      await pinOp({ op: "remove", site: openPinSite, descriptors: [desc] });
      await refreshPins();
    });
    row.append(d, t, x);
    detail.appendChild(row);
  }
}

function activeProfile() {
  return profiles.find(p => p.id === activeProfileId) || profiles[0];
}

function render() {
  const sel = $("profileSelect");
  sel.innerHTML = "";
  for (const p of profiles) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label || "(unnamed)";
    if (p.id === activeProfileId) o.selected = true;
    sel.appendChild(o);
  }
  const p = activeProfile();
  if (!p) return;
  $("p_label").value = p.label || "";
  for (const f of FIELDS) $("p_" + f).value = (p.fields && p.fields[f]) || "";
  renderCustom(p);
}

// A custom keyword bypasses scoring entirely and the first match wins, so a
// one-word keyword like "code" lands in whatever field it reaches first
// ("Postal code", "Discount code"). Content script and popup must agree on
// what counts as specific enough — keep in sync with customKeywordOk there.
const CUSTOM_KW_MIN_CHARS = 5;
const BLOCKLIST_WORDS = [
  "card", "cardnumber", "cvv", "cvc", "exp", "expiry", "expiration", "password",
  "pin", "iban", "routing", "sin", "ssn", "security code"
];

function keywordWarning(raw) {
  const kws = (raw || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const weak = [], blocked = [];
  for (const k of kws) {
    const toks = k.split(/[^a-z0-9]+/).filter(Boolean);
    if (toks.length < 2 && (toks[0] || "").length < CUSTOM_KW_MIN_CHARS) weak.push(k);
    if (toks.some(t => BLOCKLIST_WORDS.includes(t))) blocked.push(k);
  }
  if (blocked.length) {
    return `“${blocked[0]}” overlaps a blocked payment/credential term — that field is never filled.`;
  }
  if (weak.length) {
    return `“${weak[0]}” is too generic and is ignored — use two words or ${CUSTOM_KW_MIN_CHARS}+ characters.`;
  }
  return "";
}

function renderCustom(p) {
  const list = $("customList");
  list.innerHTML = "";
  for (const [i, c] of (p.custom || []).entries()) {
    const row = document.createElement("div");
    row.className = "custom-row";

    const warn = document.createElement("div");
    warn.className = "kw-warn";

    const kw = document.createElement("input");
    kw.placeholder = "keywords, e.g. bandai id, membership";
    kw.value = c.keywords || "";
    const showWarn = () => {
      warn.textContent = keywordWarning(kw.value);
      warn.hidden = !warn.textContent;
    };
    showWarn();
    kw.addEventListener("input", () => { p.custom[i].keywords = kw.value; showWarn(); });

    const val = document.createElement("input");
    val.placeholder = "value";
    val.value = c.value || "";
    val.addEventListener("input", () => { p.custom[i].value = val.value; });

    const del = document.createElement("button");
    del.textContent = "✕";
    del.className = "ghost";
    del.addEventListener("click", () => { p.custom.splice(i, 1); renderCustom(p); });

    row.append(kw, val, del);
    list.append(row, warn);
  }
}

function readEditor(p) {
  p.label = $("p_label").value.trim();
  p.fields = p.fields || {};
  for (const f of FIELDS) p.fields[f] = $("p_" + f).value.trim();
}

function newProfile() {
  const p = { id: crypto.randomUUID(), label: "", fields: {}, custom: [] };
  profiles.push(p);
  activeProfileId = p.id;
  return p;
}

function status(msg, cls) {
  const s = $("status");
  s.hidden = false;
  s.textContent = msg;
  s.className = "status" + (cls ? " " + cls : "");
}

// --- events ---

$("profileSelect").addEventListener("change", async (e) => {
  activeProfileId = e.target.value;
  await persist();
  render();
});

$("saveBtn").addEventListener("click", async () => {
  const p = activeProfile();
  if (!p) return;
  readEditor(p);
  await persist();
  render();
  status("Saved.", "ok");
});

$("newBtn").addEventListener("click", async () => {
  newProfile();
  await persist();
  render();
  $("editor").open = true;
  $("p_label").focus();
});

$("deleteBtn").addEventListener("click", async () => {
  if (!confirm("Delete this profile?")) return;
  profiles = profiles.filter(p => p.id !== activeProfileId);
  activeProfileId = profiles[0] ? profiles[0].id : null;
  if (!profiles.length) newProfile();
  await persist();
  render();
});

$("addCustom").addEventListener("click", () => {
  const p = activeProfile();
  p.custom = p.custom || [];
  p.custom.push({ keywords: "", value: "" });
  renderCustom(p);
});

$("autoToggle").addEventListener("change", async (e) => {
  if (!currentBase) return;
  if (e.target.checked) {
    if (!autoSites.includes(currentBase)) autoSites.push(currentBase);
  } else {
    autoSites = autoSites.filter(v => v !== currentBase);
  }
  await persist();
  renderSites();
});

$("addSite").addEventListener("click", async () => {
  const base = normalizeSite($("siteInput").value);
  if (!base) return status("Couldn't parse that as a domain.", "err");
  if (!autoSites.includes(base)) autoSites.push(base);
  $("siteInput").value = "";
  await persist();
  renderSites();
  status(`Auto-fill enabled on ${base} and its subdomains.`, "ok");
});

$("siteInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("addSite").click();
});

// Sends `action` to every frame of the active tab (signup forms often live in
// an iframe) and totals the responses. Frames without a content script simply
// never answer.
async function frameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const ids = (frames || []).map(f => f.frameId);
    return ids.length ? ids : [0];
  } catch {
    return [0];
  }
}

async function runOnPage(action) {
  const p = activeProfile();
  if (!p) { status("No profile.", "err"); return null; }
  readEditor(p); // act on whatever is on screen, saved or not
  await persist();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { status("No active tab.", "err"); return null; }

  const totals = { filled: 0, skipped: 0, blocked: 0, preview: 0 };
  let responded = false;

  await Promise.all((await frameIds(tab.id)).map(frameId => new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { action, profile: p }, { frameId }, (resp) => {
      void chrome.runtime.lastError; // swallow frames without content script
      if (resp?.ok) {
        responded = true;
        totals.filled += resp.result.filled || 0;
        totals.skipped += resp.result.skipped || 0;
        totals.blocked += resp.result.blocked || 0;
        totals.preview += resp.result.preview || 0;
      }
      resolve();
    });
  })));

  if (!responded) {
    status("Couldn't reach the page. Reload the tab and try again.", "err");
    return null;
  }
  return totals;
}

$("fillBtn").addEventListener("click", async () => {
  const t = await runOnPage("smartfill");
  if (!t) return;
  let msg = `Filled ${t.filled} field${t.filled === 1 ? "" : "s"}.`;
  // The skipped count is the actionable one: those are the fields a custom
  // field would pick up.
  if (t.skipped) msg += ` ${t.skipped} unmatched — add a custom field for them.`;
  if (t.blocked) msg += ` ${t.blocked} payment/password field${t.blocked === 1 ? "" : "s"} blocked.`;
  status(msg, "ok");
  await refreshPins();
});

$("previewBtn").addEventListener("click", async () => {
  const t = await runOnPage("smartfill-preview");
  if (!t) return;
  let msg = `Previewing ${t.preview} field${t.preview === 1 ? "" : "s"}.`;
  if (t.skipped) msg += ` ${t.skipped} unmatched.`;
  if (t.blocked) msg += ` ${t.blocked} blocked.`;
  status(msg + " Click the page to dismiss.", "ok");
});

// --- export / import ---

$("exportBtn").addEventListener("click", async () => {
  const p = activeProfile();
  if (p) { readEditor(p); await persist(); }
  const payload = {
    smartfill: 1,
    exportedAt: new Date().toISOString(),
    profiles, autoSites, pins
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `smartfill-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  status(`Exported ${profiles.length} profile${profiles.length === 1 ? "" : "s"}.`, "ok");
});

$("importBtn").addEventListener("click", () => $("importFile").click());

// --- import validation ---

const PIN_TYPES = new Set([
  "firstName", "lastName", "fullName", "email", "emailConfirm", "phone", "dob",
  "dobMonth", "dobDay", "dobYear", "address", "address2", "city", "region",
  "postal", "country", "company", "bandaiName", "bandaiId", "discord"
]);

const LIMITS = {
  profiles: 50, value: 1000, label: 80, custom: 100, sites: 200,
  pinsPerSite: 200, descriptor: 300
};

const unsafeKey = (k) => k === "__proto__" || k === "constructor" || k === "prototype";
const str = (v, max) => (typeof v === "string" ? v : "").slice(0, max);

// Field values must be strings; objects/arrays/numbers are dropped rather than
// stored, so nothing can smuggle a non-string into a form field later.
function cleanFields(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const f of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, f)) continue;
    const v = raw[f];
    if (typeof v !== "string") continue;
    out[f] = v.trim().slice(0, LIMITS.value);
  }
  return out;
}

function cleanPins(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let sites = 0;
  for (const [rawSite, map] of Object.entries(raw)) {
    if (unsafeKey(rawSite) || !map || typeof map !== "object" || Array.isArray(map)) continue;
    const site = normalizeSite(rawSite);
    if (!site || ++sites > LIMITS.sites) continue;
    const clean = {};
    let n = 0;
    for (const [desc, type] of Object.entries(map)) {
      if (unsafeKey(desc) || !desc || desc.length > LIMITS.descriptor) continue;
      if (typeof type !== "string" || !PIN_TYPES.has(type)) continue;
      clean[desc] = type;
      if (++n >= LIMITS.pinsPerSite) break;
    }
    if (n) out[site] = Object.assign({}, out[site], clean);
  }
  return out;
}

// A label that is free, given what's already there plus what this import added.
function uniqueLabel(label, taken) {
  const base = label || "Imported profile";
  if (!taken.has(base.toLowerCase())) return base;
  const suffixed = `${base} (imported)`;
  if (!taken.has(suffixed.toLowerCase())) return suffixed;
  for (let i = 2; ; i++) {
    const n = `${base} (imported ${i})`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

// Merge rules: imported profiles are ALWAYS added as new entries — an import
// never overwrites or deletes existing data. Colliding or unnamed labels get a
// suffix. The allowlist is a union; pins are merged by the background worker.
function mergeImport(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.profiles)) {
    throw new Error("not a SmartFill export");
  }
  if (data.profiles.length > LIMITS.profiles) {
    throw new Error(`too many profiles (${data.profiles.length}, max ${LIMITS.profiles})`);
  }
  const clean = data.profiles.filter(p => p && typeof p === "object" && !Array.isArray(p)).map(p => ({
    label: str(p.label, LIMITS.label).trim(),
    fields: cleanFields(p.fields),
    custom: Array.isArray(p.custom)
      ? p.custom.filter(c => c && typeof c === "object" && !Array.isArray(c))
                .slice(0, LIMITS.custom)
                .map(c => ({
                  keywords: str(c.keywords, LIMITS.value),
                  value: str(c.value, LIMITS.value)
                }))
      : []
  }));
  if (!clean.length) throw new Error("no profiles in that file");

  const taken = new Set(profiles.map(p => (p.label || "").trim().toLowerCase()));
  let added = 0, renamed = 0;
  for (const inc of clean) {
    const label = uniqueLabel(inc.label, taken);
    if (label !== inc.label) renamed++;
    taken.add(label.toLowerCase());
    profiles.push({ id: crypto.randomUUID(), ...inc, label });
    added++;
  }

  // The allowlist is NOT unioned here. Auto-fill writes into pages without the
  // user asking, so turning it on for a domain must stay an explicit choice —
  // an imported file should not be able to make that choice for them. The
  // caller confirms the list first.
  const sites = [];
  if (Array.isArray(data.autoSites)) {
    for (const s of data.autoSites.slice(0, LIMITS.sites)) {
      const base = normalizeSite(typeof s === "string" ? s : "");
      if (base && !autoSites.includes(base) && !sites.includes(base)) sites.push(base);
    }
  }
  if (!activeProfileId || !profiles.some(p => p.id === activeProfileId)) {
    activeProfileId = profiles[0] ? profiles[0].id : null;
  }
  return { added, renamed, sites, pins: cleanPins(data.pins) };
}

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { added, renamed, sites, pins: incoming } = mergeImport(JSON.parse(await file.text()));
    let sitesAdded = 0;
    if (sites.length && confirm(
      `Also turn auto-fill ON for ${sites.length} imported domain${sites.length === 1 ? "" : "s"}?\n\n` +
      sites.slice(0, 12).join("\n") + (sites.length > 12 ? `\n…and ${sites.length - 12} more` : "") +
      "\n\nAuto-fill writes into forms on these domains without you asking."
    )) {
      for (const s of sites) if (!autoSites.includes(s)) { autoSites.push(s); sitesAdded++; }
    }
    await persist();
    if (Object.keys(incoming).length) await pinOp({ op: "import", pins: incoming });
    await refreshPins();
    render();
    renderSites();
    status(
      `Imported ${added} profile${added === 1 ? "" : "s"}` +
      (renamed ? `, ${renamed} renamed to avoid a collision.` : ".") +
      (sitesAdded ? ` Auto-fill enabled on ${sitesAdded} domain${sitesAdded === 1 ? "" : "s"}.` : ""),
      "ok"
    );
  } catch (err) {
    status(`Import failed — ${err.message}`, "err");
  }
});

load();

// Test hook: lets a Node harness exercise import merging without a browser.
// `module` is undefined in the popup, so this is inert in Chrome.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    mergeImport, normalizeSite, cleanFields, cleanPins,
    state: () => ({ profiles, autoSites, pins, activeProfileId }),
    setProfiles: (p) => { profiles = p; }
  };
}
