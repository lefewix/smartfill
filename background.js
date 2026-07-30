// Background service worker: keyboard shortcut + the single writer for pins.

// ---------------------------------------------------------------
// Pins: { baseDomain: { descriptor: fieldType } }
//
// Content scripts run in every frame and the popup writes too, so every pin
// change is funnelled through here and applied one at a time against a freshly
// read object. Without the queue, two frames finishing at once would each
// write back a copy of the state they read before the other one started.
// ---------------------------------------------------------------
const PIN_TYPES = new Set([
  "firstName", "lastName", "fullName", "email", "emailConfirm", "phone", "dob",
  "dobMonth", "dobDay", "dobYear", "address", "address2", "city", "region",
  "postal", "country", "company", "bandaiName", "bandaiId", "discord"
]);

const MAX_SITES = 200;
const MAX_PINS_PER_SITE = 200;
const MAX_KEY_LEN = 300;

const unsafeKey = (k) => k === "__proto__" || k === "constructor" || k === "prototype";

function cleanSite(site) {
  return typeof site === "string" && site && site.length <= 100 && /^[a-z0-9.-]+$/.test(site)
    && !unsafeKey(site) ? site : null;
}

// Keeps only descriptor â†’ known-field-type entries of a sane size.
function cleanMap(map) {
  const out = Object.create(null);
  if (!map || typeof map !== "object") return out;
  let n = 0;
  for (const [desc, type] of Object.entries(map)) {
    if (unsafeKey(desc) || !desc || desc.length > MAX_KEY_LEN) continue;
    if (typeof type !== "string" || !PIN_TYPES.has(type)) continue;
    out[desc] = type;
    if (++n >= MAX_PINS_PER_SITE) break;
  }
  return out;
}

// cleanMap caps what ONE message can add; this caps what a site accumulates
// across every merge, which is the number that actually grows without bound.
// Later entries win, so the newest pins are the ones kept.
function capMap(map) {
  const keys = Object.keys(map);
  if (keys.length <= MAX_PINS_PER_SITE) return map;
  const out = Object.create(null);
  for (const k of keys.slice(keys.length - MAX_PINS_PER_SITE)) out[k] = map[k];
  return out;
}

let queue = Promise.resolve();
function enqueue(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

// `mutate` receives the freshly read pins object and mutates it in place.
function mutatePins(mutate) {
  return enqueue(async () => {
    const { pins = {} } = await chrome.storage.local.get(["pins"]);
    mutate(pins);
    for (const site of Object.keys(pins)) {
      if (!pins[site] || !Object.keys(pins[site]).length) delete pins[site];
    }
    const sites = Object.keys(pins);
    if (sites.length > MAX_SITES) {
      for (const s of sites.slice(0, sites.length - MAX_SITES)) delete pins[s];
    }
    await chrome.storage.local.set({ pins });
  });
}

function applyPinOp(msg) {
  const site = cleanSite(msg.site);
  switch (msg.op) {
    case "merge":
      if (!site) return Promise.resolve();
      return mutatePins(pins => {
        pins[site] = capMap(Object.assign({}, pins[site], cleanMap(msg.map)));
      });
    case "remove":
      if (!site || !Array.isArray(msg.descriptors)) return Promise.resolve();
      return mutatePins(pins => {
        const cur = pins[site];
        if (!cur) return;
        for (const d of msg.descriptors) {
          if (typeof d === "string" && !unsafeKey(d)) delete cur[d];
        }
      });
    case "clearSite":
      if (!site) return Promise.resolve();
      return mutatePins(pins => { delete pins[site]; });
    case "import":
      return mutatePins(pins => {
        if (!msg.pins || typeof msg.pins !== "object") return;
        for (const [rawSite, map] of Object.entries(msg.pins)) {
          const s = cleanSite(rawSite);
          if (!s) continue;
          const clean = cleanMap(map);
          if (!Object.keys(clean).length) continue;
          pins[s] = capMap(Object.assign({}, pins[s], clean));
        }
      });
    default:
      return Promise.resolve();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.action !== "pins") return;
  applyPinOp(msg).then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String(e) })
  );
  return true;
});

// ---------------------------------------------------------------
// Keyboard shortcut (Alt+Shift+F) â†’ fill active tab with the active profile.
// Signup forms often live inside iframes, so the message goes to every frame
// (the content script is injected into all of them).
// ---------------------------------------------------------------
async function frameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const ids = (frames || []).map(f => f.frameId);
    return ids.length ? ids : [0];
  } catch {
    return [0];
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill-form") return;
  const { profiles = [], activeProfileId } = await chrome.storage.local.get(["profiles", "activeProfileId"]);
  const profile = profiles.find(p => p.id === activeProfileId) || profiles[0];
  if (!profile) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // The shortcut has no popup to report into, so the per-frame responses are
  // totalled onto the toolbar badge. Each frame still shows its own chip, and
  // that chip's Undo covers that frame's fill.
  const totals = { filled: 0, skipped: 0, blocked: 0 };
  await Promise.all((await frameIds(tab.id)).map(frameId => new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { action: "smartfill", profile }, { frameId }, (resp) => {
      void chrome.runtime.lastError; // frames without a content script never answer
      if (resp && resp.ok && resp.result) {
        totals.filled += resp.result.filled || 0;
        totals.skipped += resp.result.skipped || 0;
        totals.blocked += resp.result.blocked || 0;
      }
      resolve();
    });
  })));
  await showBadge(tab.id, totals);
});

async function showBadge(tabId, totals) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#433633" });
    await chrome.action.setBadgeText({ tabId, text: String(totals.filled) });
    await chrome.action.setTitle({
      tabId,
      title: `SmartFill â€” filled ${totals.filled}, skipped ${totals.skipped}, blocked ${totals.blocked}`
    });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
      chrome.action.setTitle({ tabId, title: "SmartFill" }).catch(() => {});
    }, 5000);
  } catch { /* tab closed */ }
}

// Test hook: `module` is undefined in a service worker, so this is inert.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { applyPinOp, cleanMap, capMap, cleanSite, MAX_PINS_PER_SITE, MAX_SITES };
}
