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

function persistPins() {
  return chrome.storage.local.set({ pins });
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
function renderPins() {
  const head = $("pinHead");
  const list = $("pinList");
  list.innerHTML = "";

  const sites = Object.keys(pins).filter(s => Object.keys(pins[s] || {}).length).sort();
  if (!sites.length) {
    head.textContent = "No pinned fields yet";
    return;
  }
  head.textContent = "";
  head.append("Pinned fields on ");
  const n = document.createElement("b");
  n.textContent = String(sites.length);
  head.append(n, ` site${sites.length === 1 ? "" : "s"}`);

  for (const s of sites) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${s} ${Object.keys(pins[s]).length} `;
    const x = document.createElement("button");
    x.textContent = "✕";
    x.title = `Clear pinned fields for ${s}`;
    x.addEventListener("click", async () => {
      delete pins[s];
      await persistPins();
      renderPins();
    });
    chip.appendChild(x);
    list.appendChild(chip);
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

function renderCustom(p) {
  const list = $("customList");
  list.innerHTML = "";
  for (const [i, c] of (p.custom || []).entries()) {
    const row = document.createElement("div");
    row.className = "custom-row";

    const kw = document.createElement("input");
    kw.placeholder = "keywords, e.g. bandai id, membership";
    kw.value = c.keywords || "";
    kw.addEventListener("input", () => { p.custom[i].keywords = kw.value; });

    const val = document.createElement("input");
    val.placeholder = "value";
    val.value = c.value || "";
    val.addEventListener("input", () => { p.custom[i].value = val.value; });

    const del = document.createElement("button");
    del.textContent = "✕";
    del.className = "ghost";
    del.addEventListener("click", () => { p.custom.splice(i, 1); renderCustom(p); });

    row.append(kw, val, del);
    list.appendChild(row);
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

// Sends `action` to the active tab's content script and totals the response.
// Broadcast to all frames via scripting-less messaging: sendMessage without
// frameId goes to the top frame; iterate frames when the API is available.
async function runOnPage(action) {
  const p = activeProfile();
  if (!p) { status("No profile.", "err"); return null; }
  readEditor(p); // act on whatever is on screen, saved or not
  await persist();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { status("No active tab.", "err"); return null; }

  const totals = { filled: 0, blocked: 0, preview: 0 };
  let responded = false;

  await new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { action, profile: p }, {}, (resp) => {
      void chrome.runtime.lastError; // swallow frames without content script
      if (resp?.ok) {
        responded = true;
        totals.filled += resp.result.filled || 0;
        totals.blocked += resp.result.blocked || 0;
        totals.preview += resp.result.preview || 0;
      }
      resolve();
    });
  });

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
  if (t.blocked) msg += ` Skipped ${t.blocked} payment/password field${t.blocked === 1 ? "" : "s"}.`;
  status(msg, "ok");
  await refreshPins();
});

$("previewBtn").addEventListener("click", async () => {
  const t = await runOnPage("smartfill-preview");
  if (!t) return;
  let msg = `Previewing ${t.preview} field${t.preview === 1 ? "" : "s"}.`;
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

// Merge rules: profiles dedupe by name, imported wins on conflict;
// allowlist is a union; pins merge per site with imported winning.
function mergeImport(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.profiles)) {
    throw new Error("not a SmartFill export");
  }
  const clean = data.profiles.filter(p => p && typeof p === "object").map(p => ({
    label: typeof p.label === "string" ? p.label.trim() : "",
    fields: (p.fields && typeof p.fields === "object") ? p.fields : {},
    custom: Array.isArray(p.custom)
      ? p.custom.filter(c => c && typeof c === "object")
                .map(c => ({ keywords: String(c.keywords || ""), value: String(c.value || "") }))
      : []
  }));
  if (!clean.length) throw new Error("no profiles in that file");

  let added = 0, replaced = 0;
  for (const inc of clean) {
    const existing = profiles.find(p => (p.label || "").trim().toLowerCase() === inc.label.toLowerCase());
    if (existing) {
      existing.fields = inc.fields;
      existing.custom = inc.custom;
      replaced++;
    } else {
      profiles.push({ id: crypto.randomUUID(), ...inc });
      added++;
    }
  }
  if (Array.isArray(data.autoSites)) {
    for (const s of data.autoSites) {
      const base = normalizeSite(s);
      if (base && !autoSites.includes(base)) autoSites.push(base);
    }
  }
  if (data.pins && typeof data.pins === "object") {
    for (const [site, map] of Object.entries(data.pins)) {
      if (!map || typeof map !== "object") continue;
      pins[site] = Object.assign({}, pins[site], map);
    }
  }
  if (!activeProfileId || !profiles.some(p => p.id === activeProfileId)) {
    activeProfileId = profiles[0] ? profiles[0].id : null;
  }
  return { added, replaced };
}

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { added, replaced } = mergeImport(JSON.parse(await file.text()));
    await persist();
    await persistPins();
    render();
    renderSites();
    status(`Imported ${added} new, ${replaced} replaced.`, "ok");
  } catch (err) {
    status(`Import failed — ${err.message}`, "err");
  }
});

load();
