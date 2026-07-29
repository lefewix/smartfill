// SmartFill test harness — dependency-free. Run with: node test.js
//
// content.js / popup.js / background.js are browser code: they touch window,
// document, chrome and the HTML*Element prototypes at load time. Rather than
// pulling in jsdom (not installed), this file hand-rolls the smallest shim that
// makes those modules loadable and their pure logic exercisable.

"use strict";

// ---------------------------------------------------------------
// Minimal DOM / extension shim
// ---------------------------------------------------------------
class HTMLElementShim {
  constructor() {
    this.attrs = {};
    this.style = {};
    this.labels = null;
    this.disabled = false;
    this.readOnly = false;
    this.maxLength = -1;
    this.id = "";
    this.isConnected = true;
    this.parentElement = null;
    this.rect = { left: 10, top: 10, width: 200, height: 30, right: 210, bottom: 40 };
    this.css = { visibility: "visible", display: "block", opacity: "1" };
  }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = v; }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  matches() { return false; }
  getBoundingClientRect() { return this.rect; }
  dispatchEvent() { return true; }
  addEventListener() {}
  removeEventListener() {}
  append() {}
  appendChild(n) { return n; }
  remove() { this.isConnected = false; }
  attachShadow() {
    const shadow = new HTMLElementShim();
    shadow.host = this;
    return shadow;
  }
}

class HTMLInputElement extends HTMLElementShim {
  get value() { return this._value === undefined ? "" : this._value; }
  set value(v) { this._value = String(v); }
}
class HTMLTextAreaElement extends HTMLInputElement {}
class HTMLSelectElement extends HTMLElementShim {
  get value() { return this._value === undefined ? "" : this._value; }
  set value(v) { this._value = String(v); }
}

let PAGE_FIELDS = [];
const idCache = new Map();

const documentShim = {
  body: new HTMLElementShim(),
  documentElement: Object.assign(new HTMLElementShim(), { clientWidth: 1200, clientHeight: 800 }),
  getElementById(id) {
    if (!idCache.has(id)) idCache.set(id, new HTMLInputElement());
    return idCache.get(id);
  },
  createElement() { return new HTMLElementShim(); },
  querySelectorAll(sel) { return String(sel).includes("input") ? PAGE_FIELDS : []; },
  querySelector() { return null; },
  addEventListener() {},
  removeEventListener() {}
};

const windowShim = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {}
};

globalThis.window = windowShim;
globalThis.document = documentShim;
globalThis.location = { hostname: "eventbrite.com" };
globalThis.HTMLInputElement = HTMLInputElement;
globalThis.HTMLTextAreaElement = HTMLTextAreaElement;
globalThis.HTMLSelectElement = HTMLSelectElement;
globalThis.getComputedStyle = (el) => el.css || { visibility: "visible", display: "block", opacity: "1" };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
// The extension arms real timers (flash highlight, chip dismissal, preview
// teardown). None of them matter here and they would keep node alive, so the
// harness runs with timers stubbed out.
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.alert = () => {};
globalThis.confirm = () => CONFIRM_ANSWER;
let CONFIRM_ANSWER = true;

const storage = { data: {} };
const sentMessages = [];
globalThis.chrome = {
  runtime: {
    onMessage: { addListener() {} },
    sendMessage: async (m) => { sentMessages.push(m); return { ok: true }; },
    lastError: null
  },
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        for (const k of [].concat(keys)) if (k in storage.data) out[k] = storage.data[k];
        return out;
      },
      set: async (obj) => { Object.assign(storage.data, obj); }
    }
  },
  commands: { onCommand: { addListener() {} } },
  tabs: { query: async () => [], sendMessage() {} },
  webNavigation: { getAllFrames: async () => [{ frameId: 0 }] },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
};

// ---------------------------------------------------------------
// Field builder
// ---------------------------------------------------------------
function field(opts = {}) {
  const tag = (opts.tag || "input").toUpperCase();
  const el = tag === "SELECT" ? new HTMLSelectElement()
    : tag === "TEXTAREA" ? new HTMLTextAreaElement() : new HTMLInputElement();
  el.tagName = tag;
  el.type = opts.type || (tag === "select" ? "select-one" : "text");
  el.id = opts.id || "";
  el.attrs = {
    name: opts.name || "",
    placeholder: opts.placeholder || "",
    "aria-label": opts.ariaLabel || "",
    "data-testid": opts.testid || "",
    autocomplete: opts.autocomplete || ""
  };
  if (opts.label) el.labels = [{ textContent: opts.label }];
  el._value = opts.value || "";
  if (opts.maxLength) el.maxLength = opts.maxLength;
  if (opts.rect) el.rect = Object.assign({}, el.rect, opts.rect);
  if (opts.css) el.css = Object.assign({}, el.css, opts.css);
  if (opts.options) {
    el.options = opts.options.map(o => (typeof o === "string"
      ? { value: o, textContent: o }
      : { value: o.value, textContent: o.text || o.value }));
  }
  return el;
}

const PROFILE = {
  fields: {
    firstName: "Felix", lastName: "Wang", email: "f@example.com", phone: "4165550123",
    dob: "1990-03-07", address: "1 King St W", city: "Toronto", region: "Ontario",
    postal: "M5H 1A1", country: "Canada", company: "Acme", bandaiName: "flx",
    bandaiId: "12345", discord: "flx#1"
  },
  custom: []
};

// ---------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; return; }
  fail++; failures.push(name);
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fail++; failures.push(`${name}\n      expected ${b}\n      actual   ${a}`);
}
function group(name) { console.log("\n" + name); }

const C = require("./content.js");

// Assertions below call these; stub the missing ones so a build without them
// reports failures instead of crashing the harness.
for (const n of ["visible", "pinKey", "chipSummary", "customKeywordOk", "previewPage", "showChip"]) {
  ok(typeof C[n] === "function", `content.js exports ${n}`);
  if (typeof C[n] !== "function") C[n] = () => undefined;
}

// ---------------------------------------------------------------
// 1. Blocklist — payment/credential terms must be blocked
// ---------------------------------------------------------------
group("blocklist: blocked terms");
const BLOCKED_CASES = [
  // pre-existing coverage
  "card number", "cardNumber", "creditcardnumber", "cc-number", "cvv", "cvc",
  "security code", "expiry", "expiration date", "password", "iban", "routing",
  "account number", "SIN", "ssn", "social insurance number",
  // P1-1: the exp* prefix hole and friends
  "exp-date", "expMonth", "expYear", "exp_month", "cc-exp", "cc-exp-month",
  "expdate", "cardnum", "secCode", "pin", "nameOnCard"
];
for (const raw of BLOCKED_CASES) {
  const el = field({ name: raw });
  ok(C.isBlockedDesc(C.descriptor(el)), `blocked: ${raw}`);
}

group("blocklist: false-positive guards (must stay fillable)");
const NOT_BLOCKED = [
  "Business name", "Insurance provider", "Hotel name", "Casino night", "Basin",
  "Cousin", "Singapore", "Account name", "Discard notes", "Accreditation",
  "Scorecard", "Placard", "Postcode", "Expense report", "Experience level",
  "Export preferences", "Shipping address", "Zip code", "Full name",
  "First name", "Email address", "Postal code"
];
for (const raw of NOT_BLOCKED) {
  const el = field({ label: raw });
  ok(!C.isBlockedDesc(C.descriptor(el)), `not blocked: ${raw}`);
}

// The built-in classifier declining is not a defence: a custom keyword can
// reach any unblocked field, so blocking must hold at the blocklist layer.
group("blocklist: holds even against a custom keyword");
{
  const el = field({ name: "expMonth", label: "Month" });
  const profile = { fields: {}, custom: [{ keywords: "month", value: "12" }] };
  PAGE_FIELDS = [el];
  const res = C.fillPage(profile, {});
  eq(el.value, "", "custom keyword cannot write into a card-expiry select");
  ok(res.blocked >= 1, "card-expiry field counted as blocked");
}

// ---------------------------------------------------------------
// 2. Custom-keyword threshold (P1-2)
// ---------------------------------------------------------------
group("custom keywords: length/token threshold");
ok(typeof C.customKeywordOk === "function", "customKeywordOk is exported");
if (typeof C.customKeywordOk === "function") {
  ok(!C.customKeywordOk("code"), "reject 1-token 4-char keyword 'code'");
  ok(!C.customKeywordOk("id"), "reject 'id'");
  ok(!C.customKeywordOk("name"), "reject 'name'");
  ok(C.customKeywordOk("allergy"), "accept 'allergy' (>=5 chars)");
  ok(C.customKeywordOk("team code"), "accept 2-token 'team code'");
  ok(C.customKeywordOk("bandai id"), "accept 2-token 'bandai id'");
}
{
  const profile = { fields: {}, custom: [{ keywords: "code", value: "XYZ" }] };
  eq(C.matchCustom(C.descriptor(field({ label: "Postal code" })), profile), null,
    "'code' does not hijack Postal code");
  eq(C.matchCustom(C.descriptor(field({ label: "Discount code" })), profile), null,
    "'code' does not hijack Discount code");
  const p2 = { fields: {}, custom: [{ keywords: "discount code", value: "XYZ" }] };
  eq(C.matchCustom(C.descriptor(field({ label: "Discount code" })), p2), "XYZ",
    "'discount code' still matches Discount code");
}

// ---------------------------------------------------------------
// 3. Honeypot rejection (P1-3)
// ---------------------------------------------------------------
group("honeypots are not visible fields");
ok(C.visible(field({ label: "Email" })), "an ordinary field is visible");
ok(!C.visible(field({ label: "Email", css: { opacity: "0" } })), "opacity:0 rejected");
ok(!C.visible(field({ label: "Nickname", rect: { left: -9999, right: -9799, width: 200 } })),
  "left:-9999px rejected");
ok(!C.visible(field({ label: "Name", rect: { left: 11000, right: 11200 } })),
  "far off-screen right rejected");
ok(!C.visible(field({ label: "Email", css: { display: "none" } })), "display:none rejected");
ok(!C.visible(field({ label: "Email", rect: { width: 0, height: 0 } })), "0x0 rejected");
ok(C.visible(field({ label: "Email", rect: { top: -400, bottom: -370 } })),
  "a field scrolled above the viewport is still visible");
{
  // End to end: a spam trap named `email` sitting under opacity:0 must not fill.
  const trap = field({ name: "email", css: { opacity: "0" } });
  const real = field({ name: "email", label: "Email address" });
  PAGE_FIELDS = [trap, real];
  C.fillPage(PROFILE, {});
  eq(trap.value, "", "honeypot email left empty");
  eq(real.value, "f@example.com", "real email filled");
}

// ---------------------------------------------------------------
// 4. Pin / demotion ordering + marginal pinning (P1-4)
// ---------------------------------------------------------------
group("pins: demotion guard runs before the pin");
{
  const base = { blocked: false, hasValue: false, profile: { fields: {}, custom: [] } };
  const d = C.decide(Object.assign({}, base, {
    desc: "event name", cls: { type: "fullName", score: 2 },
    pinnedType: "fullName", hasSplitName: true
  }));
  eq(d.action, "skip", "pinned fullName is demoted when the form has first/last");

  const d2 = C.decide(Object.assign({}, base, {
    desc: "your name", cls: { type: "fullName", score: 9 },
    pinnedType: "fullName", hasSplitName: true
  }));
  eq(d2.action, "fill", "a strongly matched fullName still fills with a pin");

  const d3 = C.decide(Object.assign({}, base, {
    desc: "handle", cls: null, pinnedType: "discord", hasSplitName: false
  }));
  eq(d3, { action: "fill", type: "discord", pinned: true },
    "a pin still fills a field the classifier cannot place");

  const d4 = C.decide(Object.assign({}, base, {
    desc: "postal code", cls: { type: "postal", score: 7 },
    pinnedType: null, hasSplitName: false
  }));
  eq(d4.action, "fill", "classifier fills when there is no pin");
}

group("pins: marginal classifications are not learned");
{
  PAGE_FIELDS = [field({ label: "Town", name: "town" })]; // "town" scores 4 (marginal)
  const res = C.fillPage(PROFILE, {});
  eq(Object.keys(res.learned).length, 0, "a marginal score is filled but not pinned");

  PAGE_FIELDS = [field({ label: "Email address", name: "email", type: "email" })];
  const res2 = C.fillPage(PROFILE, {});
  ok(Object.values(res2.learned).includes("email"), "a confident score is pinned");
}

group("pins: key is stable across React re-renders");
{
  const a = field({ label: "Email address", name: "email", id: ":r3:", testid: "x-1" });
  const b = field({ label: "Email address", name: "email", id: ":r7q:", testid: "x-9" });
  ok(typeof C.pinKey === "function", "pinKey is exported");
  if (typeof C.pinKey === "function") {
    eq(C.pinKey(a), C.pinKey(b), "pin key ignores per-render id/data-testid");
    ok(C.pinKey(a) && C.pinKey(a).includes("email"), "pin key keeps label + name");
  }
  // and it round-trips through fillPage/learned
  PAGE_FIELDS = [a];
  const learnedA = Object.keys(C.fillPage(PROFILE, {}).learned)[0];
  PAGE_FIELDS = [b];
  const learnedB = Object.keys(C.fillPage(PROFILE, {}).learned)[0];
  eq(learnedA, learnedB, "learned pin key survives an id change");
}

// ---------------------------------------------------------------
// 5. Skipped count is surfaced (P2-1)
// ---------------------------------------------------------------
group("skipped fields are surfaced");
{
  PAGE_FIELDS = [
    field({ label: "First name", name: "firstName" }),
    field({ label: "How did you hear about us?", name: "referral" }),
    field({ label: "Card number", name: "cardNumber" })
  ];
  const res = C.fillPage(PROFILE, {});
  eq(res.filled, 1, "one field filled");
  eq(res.skipped, 1, "one field skipped");
  eq(res.blocked, 1, "one field blocked");
  ok(typeof C.chipSummary === "function", "chipSummary is exported");
  if (typeof C.chipSummary === "function") {
    eq(C.chipSummary(res), "Filled 1 · 1 skipped · 1 blocked", "chip text names all three");
    eq(C.chipSummary({ filled: 3, skipped: 0, blocked: 0 }), "Filled 3", "chip omits empty counts");
  }
}
{
  PAGE_FIELDS = [
    field({ label: "First name", name: "firstName" }),
    field({ label: "Dietary requirements", name: "diet" })
  ];
  const pv = C.previewPage(PROFILE, {}) || {};
  eq(pv.preview, 1, "preview counts the fillable field");
  eq(pv.skipped, 1, "preview counts and outlines the no-match field");
}

group("chip accumulates across fill passes");
{
  const a = field({ label: "First name", name: "firstName" });
  const b = field({ label: "Email", name: "email" });
  PAGE_FIELDS = [a];
  C.showChip(C.fillPage(PROFILE, {}));
  PAGE_FIELDS = [b];
  C.showChip(C.fillPage(PROFILE, {}));
  const st = typeof C.chipState === "function" ? C.chipState() : null;
  ok(st && st.filled === 2, "two passes report a combined count");
  ok(st && st.snapshot.length === 2, "undo snapshot covers both passes");
}

// ---------------------------------------------------------------
// 6. Safety invariants — never write into blocked or non-empty fields
// ---------------------------------------------------------------
group("safety invariants");
{
  const cases = [
    { what: "classifier", profile: PROFILE, pins: {} },
    { what: "custom", profile: { fields: {}, custom: [{ keywords: "card number", value: "4111" }] }, pins: {} },
    { what: "pin", profile: PROFILE, pins: null } // pins filled in below
  ];
  for (const c of cases) {
    const blockedEl = field({ label: "Card number", name: "cardNumber" });
    const filledEl = field({ label: "Email", name: "email", value: "existing@x.com" });
    PAGE_FIELDS = [blockedEl, filledEl];
    let pins = c.pins;
    if (pins === null) {
      pins = {};
      pins[C.pinKey ? C.pinKey(blockedEl) : C.descriptor(blockedEl)] = "firstName";
      pins[C.pinKey ? C.pinKey(filledEl) : C.descriptor(filledEl)] = "firstName";
    }
    C.fillPage(c.profile, pins);
    eq(blockedEl.value, "", `blocked field untouched via ${c.what}`);
    eq(filledEl.value, "existing@x.com", `non-empty field untouched via ${c.what}`);
  }
}
{
  // a select is not written either
  const sel = field({ tag: "select", label: "Expiry month", name: "cc-exp-month", options: ["01", "02", "03"] });
  PAGE_FIELDS = [sel];
  C.fillPage({ fields: {}, custom: [{ keywords: "expiry month", value: "03" }] }, {});
  eq(sel.value, "", "blocked select untouched");
}

// ---------------------------------------------------------------
// 7. Classifier regressions that must keep working
// ---------------------------------------------------------------
group("classifier still classifies");
{
  const cls = (o) => {
    const el = field(o);
    return C.classifyDesc(C.descriptor(el), {
      autocomplete: el.getAttribute("autocomplete") || "", inputType: el.type
    });
  };
  eq(cls({ label: "First name" }).type, "firstName", "First name");
  eq(cls({ label: "Email", type: "email" }).type, "email", "Email");
  eq(cls({ name: "streetaddress" }).type, "address", "streetaddress splits");
  eq(cls({ label: "Hotel name" }), null, "Hotel name unclassified");
  eq(cls({ label: "Insurance provider" }), null, "Insurance provider unclassified");
  eq(cls({ label: "Postal code" }).type, "postal", "Postal code");
}

// ---------------------------------------------------------------
// 8. DOB formatting (P3)
// ---------------------------------------------------------------
group("dob format is unambiguous by default");
{
  PAGE_FIELDS = [field({ label: "Date of birth", name: "dob" })];
  C.fillPage(PROFILE, {});
  eq(PAGE_FIELDS[0].value, "1990-03-07", "no format hint -> ISO, not mm/dd/yyyy");

  PAGE_FIELDS = [field({ label: "Date of birth", name: "dob", placeholder: "MM/DD/YYYY" })];
  C.fillPage(PROFILE, {});
  eq(PAGE_FIELDS[0].value, "03/07/1990", "explicit mm/dd hint honoured");

  PAGE_FIELDS = [field({ label: "Date of birth", name: "dob", placeholder: "DD/MM/YYYY" })];
  C.fillPage(PROFILE, {});
  eq(PAGE_FIELDS[0].value, "07/03/1990", "explicit dd/mm hint honoured");

  PAGE_FIELDS = [field({ label: "Date of birth", name: "dob", type: "date" })];
  C.fillPage(PROFILE, {});
  eq(PAGE_FIELDS[0].value, "1990-03-07", "type=date gets ISO");
}

// ---------------------------------------------------------------
// 9. Background: pin caps apply to the merged map (P2-2)
// ---------------------------------------------------------------
async function runBackgroundTests() {
  group("background: MAX_PINS_PER_SITE caps the merged map");
  const B = require("./background.js");
  ok(typeof B.applyPinOp === "function", "background exports applyPinOp");
  if (typeof B.applyPinOp !== "function") return;
  const existing = {};
  for (let i = 0; i < 200; i++) existing["old-" + i] = "email";
  storage.data.pins = { "example.com": existing };
  await B.applyPinOp({ action: "pins", op: "merge", site: "example.com", map: { "brand new": "phone" } });
  const n = Object.keys(storage.data.pins["example.com"]).length;
  ok(n <= B.MAX_PINS_PER_SITE, `merged map capped (got ${n}, max ${B.MAX_PINS_PER_SITE})`);
  eq(storage.data.pins["example.com"]["brand new"], "phone", "the newest pin survives the cap");
}

// ---------------------------------------------------------------
// 10. Popup: imported allowlist is opt-in (P2-4)
// ---------------------------------------------------------------
function runPopupTests() {
  group("popup: imported autoSites are opt-in");
  const P = require("./popup.js");
  P.setProfiles([]);
  const res = P.mergeImport({
    smartfill: 1,
    profiles: [{ label: "Imported", fields: { firstName: "A" }, custom: [] }],
    autoSites: ["evil.example", "eventbrite.com"]
  });
  eq(P.state().autoSites, [], "import does not silently switch auto-fill on");
  eq(res.sites, ["evil.example", "eventbrite.com"], "import returns the sites for confirmation");
}

function report() {
  console.log("\n" + "-".repeat(56));
  for (const f of failures) console.log("  FAIL  " + f);
  console.log(`${fail ? "FAILED" : "PASSED"} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

(async () => {
  try {
    await runBackgroundTests();
    runPopupTests();
  } catch (e) {
    fail++; failures.push("harness crashed: " + (e && e.stack || e));
  }
  report();
})();
