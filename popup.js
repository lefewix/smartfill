// SmartFill popup — profile management + fill trigger.

const FIELDS = [
  "firstName", "lastName", "email", "phone", "dob", "address", "address2",
  "city", "region", "postal", "country", "company", "bandaiName", "bandaiId", "discord"
];

let profiles = [];
let activeProfileId = null;
let autoSites = [];
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
  const data = await chrome.storage.local.get(["profiles", "activeProfileId", "autoSites"]);
  profiles = data.profiles || [];
  autoSites = data.autoSites || [];
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

function persist() {
  return chrome.storage.local.set({ profiles, activeProfileId, autoSites });
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

$("fillBtn").addEventListener("click", async () => {
  const p = activeProfile();
  if (!p) return status("No profile.", "err");
  readEditor(p); // fill with whatever is on screen, saved or not
  await persist();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return status("No active tab.", "err");

  let totals = { filled: 0, blocked: 0 };
  let responded = false;

  // Broadcast to all frames via scripting-less messaging: sendMessage without
  // frameId goes to the top frame; iterate frames when the API is available.
  const send = (frameId) => new Promise((resolve) => {
    const opts = frameId != null ? { frameId } : {};
    chrome.tabs.sendMessage(tab.id, { action: "smartfill", profile: p }, opts, (resp) => {
      void chrome.runtime.lastError; // swallow frames without content script
      if (resp?.ok) {
        responded = true;
        totals.filled += resp.result.filled;
        totals.blocked += resp.result.blocked;
      }
      resolve();
    });
  });

  try {
    // Try all frames if we can enumerate them; otherwise top frame only.
    await send(null);
  } catch { /* ignore */ }

  if (!responded) {
    status("Couldn't reach the page. Reload the tab and try again.", "err");
  } else {
    let msg = `Filled ${totals.filled} field${totals.filled === 1 ? "" : "s"}.`;
    if (totals.blocked) msg += ` Skipped ${totals.blocked} payment/password field${totals.blocked === 1 ? "" : "s"}.`;
    status(msg, "ok");
  }
});

load();
