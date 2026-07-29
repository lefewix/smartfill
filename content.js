// SmartFill content script — field classification + fill engine.
// Runs in all frames. Fills only when explicitly triggered. Never submits.

(() => {
  if (window.__smartfillLoaded) return;
  window.__smartfillLoaded = true;

  // ---------------------------------------------------------------
  // Field type dictionaries. Each keyword has a weight; the highest
  // scoring field type above THRESHOLD wins. Order-insensitive.
  // ---------------------------------------------------------------
  const THRESHOLD = 3;

  const FIELD_DEFS = {
    firstName: {
      autocomplete: ["given-name"],
      keywords: [
        ["first name", 6], ["firstname", 6], ["given name", 6], ["fname", 5],
        ["first", 3], ["prenom", 5], ["voornaam", 5]
      ]
    },
    lastName: {
      autocomplete: ["family-name"],
      keywords: [
        ["last name", 6], ["lastname", 6], ["surname", 6], ["family name", 6],
        ["lname", 5], ["last", 3], ["nom de famille", 5], ["achternaam", 5]
      ]
    },
    fullName: {
      autocomplete: ["name"],
      keywords: [
        ["full name", 6], ["fullname", 6], ["your name", 5], ["attendee name", 5],
        ["player name", 5], ["name", 2]
      ]
    },
    email: {
      autocomplete: ["email"],
      keywords: [
        ["email", 6], ["e-mail", 6], ["courriel", 5]
      ]
    },
    emailConfirm: {
      autocomplete: [],
      keywords: [
        ["confirm email", 7], ["email confirm", 7], ["repeat email", 7],
        ["verify email", 7], ["re-enter email", 7], ["email again", 6]
      ]
    },
    phone: {
      autocomplete: ["tel", "tel-national"],
      keywords: [
        ["phone", 6], ["mobile", 5], ["cell", 5], ["telephone", 6], ["tel", 3]
      ]
    },
    dob: {
      autocomplete: ["bday"],
      keywords: [
        ["date of birth", 7], ["birth date", 7], ["birthdate", 7], ["dob", 6],
        ["birthday", 6], ["born", 3]
      ]
    },
    address: {
      autocomplete: ["street-address", "address-line1"],
      keywords: [
        ["address line 1", 7], ["street address", 7], ["address1", 6],
        ["addr1", 5], ["street", 4], ["address", 4]
      ]
    },
    address2: {
      autocomplete: ["address-line2"],
      keywords: [
        ["address line 2", 7], ["address2", 6], ["apt", 4], ["suite", 4],
        ["unit", 4]
      ]
    },
    city: {
      autocomplete: ["address-level2"],
      keywords: [["city", 6], ["town", 4], ["ville", 5]]
    },
    region: {
      autocomplete: ["address-level1"],
      keywords: [
        ["province", 6], ["state", 5], ["region", 4], ["prov", 4],
        ["state/province", 7], ["province/state", 7]
      ]
    },
    postal: {
      autocomplete: ["postal-code"],
      keywords: [
        ["postal code", 7], ["postcode", 6], ["zip code", 7], ["zip", 5],
        ["postal", 5]
      ]
    },
    country: {
      autocomplete: ["country", "country-name"],
      keywords: [["country", 6], ["pays", 5]]
    },
    company: {
      autocomplete: ["organization"],
      keywords: [["company", 5], ["organization", 5], ["organisation", 5], ["employer", 5]]
    },
    bandaiName: {
      autocomplete: ["nickname"],
      keywords: [
        ["bandai tcg name", 9], ["bandai name", 9], ["tcg+ name", 9], ["tcg plus name", 9],
        ["bandai nickname", 9], ["nickname", 6], ["display name", 5],
        ["in game name", 5], ["ign", 5], ["screen name", 5], ["username", 4]
      ]
    },
    bandaiId: {
      autocomplete: [],
      keywords: [
        ["bandai membership", 9], ["bandai member", 9], ["bandai id", 9],
        ["bandai number", 9], ["tcg+ id", 9], ["tcg+ member", 9], ["tcg plus id", 9],
        ["membership number", 8], ["member number", 8], ["membership id", 8],
        ["member id", 7], ["membership", 6], ["player id", 6], ["player number", 6]
      ]
    },
    discord: {
      autocomplete: [],
      keywords: [
        ["discord username", 9], ["discord id", 9], ["discord tag", 9],
        ["discord handle", 9], ["discord name", 9], ["discord user", 8],
        ["discord", 7]
      ]
    },
    // Split date-of-birth fields. Bare "month"/"day"/"year" only score 2 —
    // below threshold — unless birth context is detected nearby (+3 boost).
    dobMonth: {
      autocomplete: ["bday-month"],
      keywords: [
        ["birth month", 8], ["month of birth", 8], ["dob month", 8],
        ["bday month", 7], ["birthmonth", 8], ["bmonth", 6], ["month", 2], ["mm", 2]
      ]
    },
    dobDay: {
      autocomplete: ["bday-day"],
      keywords: [
        ["birth day", 8], ["day of birth", 8], ["dob day", 8],
        ["bday day", 7], ["birthday day", 7], ["bday", 4], ["day", 2], ["dd", 2]
      ]
    },
    dobYear: {
      autocomplete: ["bday-year"],
      keywords: [
        ["birth year", 8], ["year of birth", 8], ["dob year", 8],
        ["byear", 6], ["birthyear", 8], ["year", 2], ["yyyy", 2]
      ]
    }
  };

  // Never fill these, no matter what. Payment belongs to the browser/user.
  const BLOCKLIST = [
    "card number", "cardnumber", "card-number", "cc-number", "ccnumber",
    "cvv", "cvc", "cvv2", "security code", "expiry", "expiration",
    "password", "passwd", "iban", "routing", "account number", "sin",
    "social insurance", "social security", "ssn"
  ];

  // ---------------------------------------------------------------
  // Descriptor extraction: gather every scrap of text describing a field
  // ---------------------------------------------------------------
  function getLabelText(el) {
    const parts = [];
    if (el.labels) {
      for (const l of el.labels) parts.push(l.textContent || "");
    }
    // aria-labelledby
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      lb.split(/\s+/).forEach(id => {
        const n = document.getElementById(id);
        if (n) parts.push(n.textContent || "");
      });
    }
    // Wrapping label without `for`
    const wrap = el.closest("label");
    if (wrap) parts.push(wrap.textContent || "");
    // Common pattern: label-ish sibling/parent text in form frameworks
    const parent = el.closest("div, li, fieldset, td");
    if (parent) {
      const cand = parent.querySelector("label, .label, [class*='label' i], legend");
      if (cand && !cand.contains(el)) parts.push(cand.textContent || "");
    }
    return parts.join(" ");
  }

  function descriptor(el) {
    return [
      getLabelText(el),
      el.getAttribute("placeholder") || "",
      el.getAttribute("name") || "",
      el.id || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("data-testid") || "",
      el.getAttribute("data-name") || ""
    ]
      .join(" ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // split camelCase: contactEmail → contact email
      .toLowerCase()
      .replace(/[_\-\.\[\]:*]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isBlocked(desc, el) {
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac.startsWith("cc-") || ac === "current-password" || ac === "new-password") return true;
    if (el.type === "password") return true;
    return BLOCKLIST.some(k => desc.includes(k));
  }

  // Look for "birth"/"dob" hints in ancestor ids/classes/legends so that a
  // bare <select name="month"> inside a "Date of birth" section classifies.
  function birthContext(el) {
    let n = el.parentElement, depth = 0;
    while (n && depth < 5) {
      const bits = [
        n.id || "", typeof n.className === "string" ? n.className : "",
        n.getAttribute?.("data-testid") || ""
      ].join(" ").toLowerCase();
      if (/birth|dob|bday/.test(bits)) return true;
      if (n.tagName === "FIELDSET") {
        const lg = n.querySelector("legend");
        if (lg && /birth|dob|bday/i.test(lg.textContent)) return true;
      }
      const lbl = n.querySelector?.(":scope > label, :scope > .label, :scope > span");
      if (lbl && lbl.textContent.length < 60 && /birth|dob|bday/i.test(lbl.textContent)) return true;
      n = n.parentElement; depth++;
    }
    return false;
  }

  function classify(el) {
    const desc = descriptor(el);
    if (!desc && !el.getAttribute("autocomplete")) return null;
    if (isBlocked(desc, el)) return { type: "__blocked__", score: 99 };

    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    const inputType = (el.type || "").toLowerCase();

    let best = null;
    for (const [type, def] of Object.entries(FIELD_DEFS)) {
      let score = 0;
      if (ac && def.autocomplete.includes(ac)) score += 10;
      // Take the single best keyword weight plus a small bonus for extras
      let kwBest = 0, extras = 0;
      for (const [kw, w] of def.keywords) {
        if (desc.includes(kw)) {
          if (w > kwBest) { extras += kwBest; kwBest = w; }
          else extras += 1;
        }
      }
      score += kwBest + Math.min(extras, 2);

      // Input-type hints
      if (type === "email" && inputType === "email") score += 4;
      if (type === "phone" && inputType === "tel") score += 4;
      if (type === "dob" && inputType === "date") score += 2;
      // Birth-context boost lifts bare month/day/year fields over threshold
      if ((type === "dobMonth" || type === "dobDay" || type === "dobYear") &&
          score > 0 && score < THRESHOLD + 3 && birthContext(el)) {
        score += 3;
      }

      if (score >= THRESHOLD && (!best || score > best.score)) {
        best = { type, score };
      }
    }

    // fullName is greedy ("name" appears everywhere) — demote it if a more
    // specific name field also matched on this form elsewhere; handled at fill
    // time by preferring first/last when both exist.
    return best;
  }

  // ---------------------------------------------------------------
  // Alternate representations: Ontario↔ON, Canada↔CA, 11↔November
  // ---------------------------------------------------------------
  const MONTHS = ["january","february","march","april","may","june",
                  "july","august","september","october","november","december"];

  const REGIONS = {
    // Canada
    "alberta":"AB","british columbia":"BC","manitoba":"MB","new brunswick":"NB",
    "newfoundland and labrador":"NL","nova scotia":"NS","northwest territories":"NT",
    "nunavut":"NU","ontario":"ON","prince edward island":"PE","quebec":"QC",
    "saskatchewan":"SK","yukon":"YT",
    // US
    "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
    "colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA",
    "hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA",
    "kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD",
    "massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS",
    "missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH",
    "new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC",
    "north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA",
    "rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN",
    "texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA",
    "west virginia":"WV","wisconsin":"WI","wyoming":"WY",
    "district of columbia":"DC"
  };
  const REGIONS_REV = Object.fromEntries(Object.entries(REGIONS).map(([k, v]) => [v, k]));

  const COUNTRIES = {
    "canada": ["CA", "CAN"], "united states": ["US", "USA", "United States of America"],
    "usa": ["US", "United States"], "united kingdom": ["GB", "UK"],
    "mexico": ["MX"], "japan": ["JP"], "france": ["FR"], "germany": ["DE"]
  };

  function titleCase(s) {
    return s.replace(/\b\w/g, c => c.toUpperCase());
  }

  // Returns an ordered list of alternate spellings/formats for a value.
  function regionCandidates(v) {
    const low = v.toLowerCase().trim();
    const out = [v];
    if (REGIONS[low]) out.push(REGIONS[low]);                 // Ontario → ON
    else if (REGIONS_REV[v.toUpperCase()]) out.push(titleCase(REGIONS_REV[v.toUpperCase()])); // ON → Ontario
    return out;
  }

  function countryCandidates(v) {
    const low = v.toLowerCase().trim();
    const out = [v];
    if (COUNTRIES[low]) out.push(...COUNTRIES[low]);
    return out;
  }

  function dobParts(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return null;
    return { y, m, d };
  }

  // ---------------------------------------------------------------
  // Value setting — React/Vue-safe
  // ---------------------------------------------------------------
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function flash(el) {
    const prev = el.style.boxShadow;
    el.style.boxShadow = "0 0 0 2px #8b5cf6";
    setTimeout(() => { el.style.boxShadow = prev; }, 1200);
  }

  // Fuzzy select matching: exact value, exact text, then contains.
  function fillSelect(el, value) {
    if (!value) return false;
    const v = String(value).toLowerCase().trim();
    const opts = Array.from(el.options);
    const tryers = [
      o => o.value.toLowerCase() === v,
      o => o.textContent.trim().toLowerCase() === v,
      o => o.textContent.trim().toLowerCase().startsWith(v),
      o => o.textContent.toLowerCase().includes(v),
      o => v.length <= 3 && o.value.toLowerCase() === v // e.g. "ON", "CA"
    ];
    for (const test of tryers) {
      const hit = opts.find(test);
      if (hit) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(el, hit.value);
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        flash(el);
        return true;
      }
    }
    return false;
  }

  // DOB formatting: stored as YYYY-MM-DD; adapt to what the field wants.
  function formatDob(el, iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    if ((el.type || "").toLowerCase() === "date") return iso;
    const hint = (descriptor(el));
    if (hint.includes("mm/dd")) return `${m}/${d}/${y}`;
    if (hint.includes("dd/mm")) return `${d}/${m}/${y}`;
    if (hint.includes("yyyy-mm-dd") || hint.includes("yyyy mm dd")) return iso;
    // Default to the common North American format for text inputs
    return `${m}/${d}/${y}`;
  }

  // Ordered list of value representations to try for a field.
  function candidatesFor(type, profile, el) {
    const f = profile.fields || {};
    const p = dobParts(f.dob);
    switch (type) {
      case "firstName": return [f.firstName];
      case "lastName": return [f.lastName];
      case "fullName":
        return [f.fullName || [f.firstName, f.lastName].filter(Boolean).join(" ")];
      case "email":
      case "emailConfirm": return [f.email];
      case "phone": return [f.phone];
      case "dob": return [formatDob(el, f.dob)];
      case "dobMonth": {
        if (!p) return [];
        const idx = parseInt(p.m, 10) - 1;
        const name = MONTHS[idx] ? titleCase(MONTHS[idx]) : null;
        // padded numeric first, then unpadded, then November / Nov
        return [p.m, String(parseInt(p.m, 10)), name, name && name.slice(0, 3)].filter(Boolean);
      }
      case "dobDay": {
        if (!p) return [];
        return [p.d, String(parseInt(p.d, 10))];
      }
      case "dobYear": return p ? [p.y] : [];
      case "address": return [f.address];
      case "address2": return [f.address2];
      case "city": return [f.city];
      case "region": return f.region ? regionCandidates(f.region) : [];
      case "postal": return [f.postal];
      case "country": return f.country ? countryCandidates(f.country) : [];
      case "company": return [f.company];
      case "bandaiName": return [f.bandaiName];
      case "bandaiId": return [f.bandaiId];
      case "discord": return [f.discord];
      default: return [];
    }
  }

  // Pick the best candidate for a plain text input, honoring maxlength and
  // format hints in the field's own descriptor.
  function chooseTextCandidate(el, cands, type) {
    const desc = descriptor(el);
    const max = el.maxLength > 0 ? el.maxLength : Infinity;
    let pool = cands.filter(c => String(c).length <= max);
    if (!pool.length) pool = cands;

    if (type === "dobMonth") {
      // "Nov" / "November" style text fields are rare but hinted by mon/mmm
      if (/\bmmm\b|month name|jan\b/.test(desc)) {
        const named = pool.find(c => /[a-z]/i.test(c));
        if (named) return named;
      }
      return pool[0]; // padded numeric default
    }
    if (type === "region") {
      // 2-char fields want the abbreviation
      if (max <= 3) {
        const abbr = pool.find(c => c.length <= 3);
        if (abbr) return abbr;
      }
      return pool[0];
    }
    return pool[0];
  }

  function matchCustom(desc, profile) {
    for (const c of profile.custom || []) {
      const kws = (c.keywords || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
      if (kws.some(k => k && desc.includes(k))) return c.value;
    }
    return null;
  }

  function visible(el) {
    if (el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }

  // ---------------------------------------------------------------
  // Main fill pass
  // ---------------------------------------------------------------
  function fillPage(profile) {
    const inputs = Array.from(document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select"
    )).filter(visible);

    // First pass: classify everything so we can resolve fullName vs first/last
    const classified = inputs.map(el => ({ el, cls: classify(el), desc: descriptor(el) }));
    const types = new Set(classified.filter(c => c.cls).map(c => c.cls.type));
    const hasSplitName = types.has("firstName") && types.has("lastName");

    let filled = 0, skipped = 0, blocked = 0;

    for (const { el, cls, desc } of classified) {
      // Custom fields get first shot — user-defined keywords are intent.
      const customVal = matchCustom(desc, profile);
      if (customVal != null && customVal !== "") {
        if (el.tagName === "SELECT" ? fillSelect(el, customVal) : (setNativeValue(el, customVal), flash(el), true)) {
          filled++;
          continue;
        }
      }

      if (!cls) { skipped++; continue; }
      if (cls.type === "__blocked__") { blocked++; continue; }
      // If the form has proper first/last fields, don't also stuff fullName
      // into some weakly-matched "name" field like "event name".
      if (cls.type === "fullName" && hasSplitName && cls.score < 8) { skipped++; continue; }

      const cands = candidatesFor(cls.type, profile, el)
        .filter(v => v != null && String(v).trim() !== "");
      if (!cands.length) { skipped++; continue; }
      if (el.value && el.value.trim() !== "") { skipped++; continue; } // never overwrite

      if (el.tagName === "SELECT") {
        // Try each representation: "11" → "November" → "Nov", "Ontario" → "ON"
        let ok = false;
        for (const c of cands) {
          if (fillSelect(el, c)) { ok = true; break; }
        }
        ok ? filled++ : skipped++;
      } else {
        setNativeValue(el, String(chooseTextCandidate(el, cands.map(String), cls.type)));
        flash(el);
        filled++;
      }
    }
    return { filled, skipped, blocked, total: inputs.length };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.action === "smartfill" && msg.profile) {
      try {
        sendResponse({ ok: true, result: fillPage(msg.profile) });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    }
    return true;
  });

  // ---------------------------------------------------------------
  // Auto-fill on load — per-site opt-in only. Never overwrites,
  // never submits. Re-fills when new form fields render (SPAs,
  // multi-step checkouts); fillPage is idempotent on filled fields.
  // ---------------------------------------------------------------
  // Entry "xyz.abc" matches xyz.abc and every subdomain of it.
  function siteMatches(hostname, sites) {
    const host = hostname.toLowerCase().replace(/^www\./, "");
    return sites.some(s => host === s || host.endsWith("." + s));
  }

  async function maybeAutofill() {
    try {
      const { autoSites = [], profiles = [], activeProfileId } =
        await chrome.storage.local.get(["autoSites", "profiles", "activeProfileId"]);
      if (!siteMatches(location.hostname, autoSites)) return;
      const profile = profiles.find(p => p.id === activeProfileId) || profiles[0];
      if (!profile) return;

      const run = () => { try { fillPage(profile); } catch { /* noop */ } };
      setTimeout(run, 800); // let the framework finish first paint

      let t;
      const obs = new MutationObserver((muts) => {
        const relevant = muts.some(m =>
          Array.from(m.addedNodes).some(n =>
            n.nodeType === 1 &&
            (n.matches?.("input, select, textarea, form") ||
             n.querySelector?.("input, select, textarea"))
          )
        );
        if (!relevant) return;
        clearTimeout(t);
        t = setTimeout(run, 600); // debounce bursts of DOM changes
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch { /* storage unavailable in this frame — ignore */ }
  }
  maybeAutofill();
})();
