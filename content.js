// SmartFill content script — field classification + fill engine.
// Runs in all frames. Fills only when explicitly triggered. Never submits.

(() => {
  if (window.__smartfillLoaded) return;
  window.__smartfillLoaded = true;

  // ---------------------------------------------------------------
  // Field type dictionaries. Each keyword has a weight; the highest
  // scoring field type above THRESHOLD wins. Order-insensitive.
  //
  // Keywords match whole words only (see hasKeyword). "tel" will not
  // match "hotel", "prov" will not match "provider". Multi-word
  // keywords match a run of consecutive words. Concatenated attributes
  // ("streetaddress") are split into known words first (see expandTokens).
  // The BLOCKLIST plays by looser rules on purpose — see isBlockedDesc.
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
        ["email", 6], ["e-mail", 6], ["emailaddress", 6], ["courriel", 5]
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
        ["phone", 6], ["phonenumber", 6], ["mobile", 5], ["cell", 5],
        ["telephone", 6], ["tel", 3]
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
        ["postal code", 7], ["postalcode", 7], ["postcode", 6], ["zip code", 7],
        ["zipcode", 7], ["zip", 5], ["postal", 5]
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
  // KEEP IN SYNC with BLOCKLIST in popup.js (keyword warning) — test.js
  // asserts the two lists match.
  const BLOCKLIST = [
    "card number", "cardnumber", "card-number", "cc-number", "ccnumber",
    "cardnum", "name on card", "cardholder", "card holder",
    "cvv", "cvc", "cvv2", "security code", "sec code", "expiry", "expiration",
    // "exp" is how most payment forms actually spell it: exp-date, expMonth,
    // cc-exp-month. It is whole-token-only so "expense"/"experience"/"export"
    // stay fillable; the concatenated spellings are listed separately.
    "exp", "expdate", "expmonth", "expyear",
    "password", "passwd", "pin", "pincode", "iban", "routing", "account number", "sin",
    "social insurance", "social security", "ssn"
  ];

  // Blocklist keywords that are short enough to hide inside ordinary words
  // ("sin" in "business", "pin" in "shipping", "exp" in "expense"). These match
  // whole tokens only; everything else on the blocklist also matches as a
  // substring of a token, because a blocklist false positive costs a skipped
  // field while a false negative writes a card number into a form.
  const BLOCK_TOKEN_EXACT = new Set(["sin", "ssn", "pin", "exp"]);

  // ---------------------------------------------------------------
  // Word-boundary keyword matching
  // ---------------------------------------------------------------
  // Splits on non-alphanumerics and on letter↔digit boundaries, so
  // "cardnumber2" → ["cardnumber", "2"] and "1stName" → ["1", "st", "name"].
  function tokenize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/([a-z])([0-9])/g, "$1 $2")
      .replace(/([0-9])([a-z])/g, "$1 $2")
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  const KW_CACHE = new Map();
  function kwTokens(kw) {
    let t = KW_CACHE.get(kw);
    if (!t) { t = tokenize(kw); KW_CACHE.set(kw, t); }
    return t;
  }

  // True when `kw`'s words appear as a consecutive run of whole words in toks.
  function hasKeyword(toks, kw) {
    const k = kwTokens(kw);
    if (!k.length || k.length > toks.length) return false;
    outer:
    for (let i = 0; i + k.length <= toks.length; i++) {
      for (let j = 0; j < k.length; j++) if (toks[i + j] !== k[j]) continue outer;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------
  // Concatenated-word handling for the FIELD dictionaries.
  //
  // Attributes like name="streetaddress" or name="cellphone" arrive as a
  // single token, so whole-token matching alone would miss them. A token that
  // isn't a known word is split once into two known words when possible; the
  // original token is kept too (after a separator, so it can't form a bogus
  // consecutive run). Unknown compounds like "hotelname" never split, which is
  // what keeps "hotel name" from classifying as a full name.
  // ---------------------------------------------------------------
  const CONCAT_MODIFIERS = [
    "home", "work", "billing", "shipping", "mailing", "personal", "business",
    "primary", "secondary", "contact", "main", "alternate", "current", "new",
    "daytime", "evening", "preferred", "residential", "legal"
  ];

  const VOCAB = (() => {
    const v = new Set(CONCAT_MODIFIERS);
    for (const def of Object.values(FIELD_DEFS)) {
      for (const [kw] of def.keywords) {
        for (const w of tokenize(kw)) if (w.length >= 3) v.add(w);
      }
    }
    return v;
  })();

  const SEP = " "; // never equal to a keyword token

  function splitConcat(tok) {
    if (tok.length < 6 || VOCAB.has(tok)) return null;
    for (let i = 3; i <= tok.length - 3; i++) {
      const a = tok.slice(0, i), b = tok.slice(i);
      if (VOCAB.has(a) && VOCAB.has(b)) return [a, b];
    }
    return null;
  }

  function expandTokens(toks) {
    const out = [], extra = [];
    for (const t of toks) {
      const parts = splitConcat(t);
      if (parts) { out.push(parts[0], parts[1]); extra.push(t); }
      else out.push(t);
    }
    for (const e of extra) out.push(SEP, e);
    return out;
  }

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

  function normalizeDesc(parts) {
    return parts
      .join(" ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // split camelCase: contactEmail → contact email
      .toLowerCase()
      .replace(/[_\-\.\[\]:*]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function descriptor(el) {
    return normalizeDesc([
      getLabelText(el),
      el.getAttribute("placeholder") || "",
      el.getAttribute("name") || "",
      el.id || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("data-testid") || "",
      el.getAttribute("data-name") || ""
    ]);
  }

  // Pins are keyed by this, NOT by the full descriptor: React's useId and Radix
  // emit a fresh id per render (":r3:", ":r7q:"), and generated test ids move
  // too, so a descriptor-keyed pin never matches again on the sites this
  // extension targets — it only grows the stored map. Label text plus `name`
  // is what actually survives a re-render.
  function pinKey(el) {
    const k = normalizeDesc([
      getLabelText(el),
      el.getAttribute("aria-label") || "",
      el.getAttribute("name") || ""
    ]);
    return k.length ? k.slice(0, 300) : null;
  }

  // Squashed form of a keyword: "card number" → "cardnumber", so a
  // concatenated attribute like "creditcardnumber" still matches.
  const SQUASH_CACHE = new Map();
  function squash(kw) {
    let s = SQUASH_CACHE.get(kw);
    if (s === undefined) { s = kwTokens(kw).join(""); SQUASH_CACHE.set(kw, s); }
    return s;
  }

  // Deliberately conservative: whole-token match, or substring of any token.
  function isBlockedDesc(desc) {
    const toks = tokenize(desc);
    return BLOCKLIST.some(k => {
      if (hasKeyword(toks, k)) return true;
      if (BLOCK_TOKEN_EXACT.has(k)) return false;
      const s = squash(k);
      return s.length >= 3 && toks.some(t => t.includes(s));
    });
  }

  function isBlocked(desc, el) {
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac.startsWith("cc-") || ac === "current-password" || ac === "new-password") return true;
    if (el.type === "password") return true;
    return isBlockedDesc(desc);
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

  // Pure scoring core — no DOM. `opts`: { autocomplete, inputType, birth }.
  function classifyDesc(desc, opts = {}) {
    const ac = (opts.autocomplete || "").toLowerCase();
    const inputType = (opts.inputType || "").toLowerCase();
    if (!desc && !ac) return null;

    const toks = expandTokens(tokenize(desc));
    let best = null;
    for (const [type, def] of Object.entries(FIELD_DEFS)) {
      let score = 0;
      if (ac && def.autocomplete.includes(ac)) score += 10;
      // Take the single best keyword weight plus a small bonus for extras
      let kwBest = 0, extras = 0;
      for (const [kw, w] of def.keywords) {
        if (hasKeyword(toks, kw)) {
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
          score > 0 && score < THRESHOLD + 3 && opts.birth) {
        score += 3;
      }

      if (score >= THRESHOLD && (!best || score > best.score)) {
        best = { type, score };
      }
    }
    return best;
  }

  function classify(el, desc) {
    return classifyDesc(desc, {
      autocomplete: el.getAttribute("autocomplete") || "",
      inputType: el.type || "",
      // Only pay for the ancestor walk when a bare month/day/year is plausible
      birth: /\b(month|day|year|mm|dd|yyyy|bday)\b/.test(desc) ? birthContext(el) : false
    });
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

  function setSelectValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Flash a mauve ring on a just-filled field. The original box-shadow is
  // captured once per element (WeakMap) so a rapid double-fill can't snapshot
  // the ring itself and leave it on permanently; a re-flash just re-arms the
  // restore timer. box-shadow is transitioned so the ring fades instead of
  // snapping.
  const FLASH_STATE = new WeakMap();
  const FLASH_MS = 1200;
  const EASE_OUT = "cubic-bezier(0.23,1,0.32,1)";
  function flash(el) {
    let st = FLASH_STATE.get(el);
    if (st) {
      clearTimeout(st.timer);
    } else {
      st = { prevShadow: el.style.boxShadow, prevTransition: el.style.transition };
      FLASH_STATE.set(el, st);
    }
    el.style.transition = `box-shadow .15s ${EASE_OUT}`;
    el.style.boxShadow = "0 0 0 2px #a288a6";
    st.timer = setTimeout(() => {
      el.style.boxShadow = st.prevShadow;
      // Let the fade-out play before the inline transition is removed.
      setTimeout(() => {
        if (FLASH_STATE.get(el) === st) {
          el.style.transition = st.prevTransition;
          FLASH_STATE.delete(el);
        }
      }, 200);
    }, FLASH_MS);
  }

  // Fuzzy select matching: exact value, exact text, then contains.
  function fillSelect(el, value) {
    if (!value) return false;
    const v = String(value).toLowerCase().trim();
    const opts = Array.from(el.options);
    const tryers = [
      o => o.value.toLowerCase() === v, // exact value covers "ON", "CA" too
      o => o.textContent.trim().toLowerCase() === v,
      o => o.textContent.trim().toLowerCase().startsWith(v),
      o => o.textContent.toLowerCase().includes(v)
    ];
    for (const test of tryers) {
      const hit = opts.find(test);
      if (hit) {
        setSelectValue(el, hit.value);
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
    // Read the raw attributes, not the normalized descriptor: the separators
    // ("mm/dd" vs "yyyy-mm-dd") are exactly what distinguishes the formats.
    const hint = [
      el.getAttribute("placeholder") || "", el.getAttribute("title") || "",
      el.getAttribute("aria-label") || "", getLabelText(el)
    ].join(" ").toLowerCase();
    if (/y{2,4}\s*[-\/. ]\s*mm/.test(hint)) return iso;
    if (/mm\s*[-\/. ]\s*dd/.test(hint)) return `${m}/${d}/${y}`;
    if (/dd\s*[-\/. ]\s*mm/.test(hint)) return `${d}/${m}/${y}`;
    // No hint: guessing mm/dd/yyyy silently turns 7 March into 3 July on every
    // form outside the US. ISO is the one format that cannot be misread.
    return iso;
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

  // Custom keywords bypass scoring entirely — first match wins — so a keyword
  // that is too generic ("code", "name", "id") silently hijacks whatever field
  // it touches first. Require either two words or a reasonably specific one.
  const CUSTOM_KW_MIN_CHARS = 5;
  function customKeywordOk(kw) {
    const toks = tokenize(kw);
    if (!toks.length) return false;
    if (toks.length >= 2) return true;
    return toks[0].length >= CUSTOM_KW_MIN_CHARS;
  }

  function customKeywords(c) {
    return (c && c.keywords || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  }

  function matchCustom(desc, profile) {
    const toks = expandTokens(tokenize(desc));
    for (const c of (profile && profile.custom) || []) {
      const kws = customKeywords(c).filter(customKeywordOk);
      if (kws.some(k => hasKeyword(toks, k))) return c.value;
    }
    return null;
  }

  // Honeypots. Spam traps on signup platforms are real fields named `email` /
  // `name` / `nickname` that are hidden with opacity or by being parked far
  // off-screen — both keep a non-zero rect, so a rect/visibility check alone
  // walks straight into them and silently fails the signup.
  const OFFSCREEN_MARGIN = 2000;
  function visible(el) {
    if (el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;

    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if (cs.opacity === "0") return false;
    // A transparent wrapper hides its children just as effectively.
    let n = el.parentElement, depth = 0;
    while (n && depth < 4) {
      const pcs = getComputedStyle(n);
      if (pcs && (pcs.opacity === "0" || pcs.visibility === "hidden")) return false;
      n = n.parentElement; depth++;
    }

    // Horizontal only: a rect above the viewport just means the page is
    // scrolled down, but nothing legitimate sits at left:-9999px.
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    if (r.right < -50) return false;
    if (vw && r.left > vw + OFFSCREEN_MARGIN) return false;
    return true;
  }

  // ---------------------------------------------------------------
  // The single decision point for one field. Order is a safety
  // guarantee: blocked fields and already-filled fields are settled
  // BEFORE custom keywords or classification get a say.
  // ---------------------------------------------------------------
  function decide(ctx) {
    if (ctx.blocked) return { action: "blocked" };
    if (ctx.hasValue) return { action: "skip" };

    const customVal = matchCustom(ctx.desc, ctx.profile);
    if (customVal != null && customVal !== "") return { action: "custom", value: customVal };

    const cls = ctx.cls;
    // If the form has proper first/last fields, don't also stuff fullName into
    // some weakly-matched "name" field like "event name". This runs BEFORE the
    // pin is consulted: a pin is a memory of an earlier fill, and a fill the
    // demotion guard would reject must not come back through the pin.
    const demoted = (type) =>
      type === "fullName" && ctx.hasSplitName && !(cls && cls.type === "fullName" && cls.score >= 8);

    // A per-site pin beats scoring, but not the guards above it.
    if (ctx.pinnedType && !demoted(ctx.pinnedType)) {
      return { action: "fill", type: ctx.pinnedType, pinned: true };
    }

    if (!cls) return { action: "skip" };
    if (demoted(cls.type)) return { action: "skip" };
    return { action: "fill", type: cls.type };
  }

  // ---------------------------------------------------------------
  // Survey the page: descriptor + classification + decision per field
  // ---------------------------------------------------------------
  function survey(profile, pins) {
    const inputs = Array.from(document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select"
    )).filter(visible);

    const rows = inputs.map(el => {
      const desc = descriptor(el);
      const blocked = isBlocked(desc, el);
      return {
        el, desc, blocked,
        key: pinKey(el),
        hasValue: !!(el_value(el) && el_value(el).trim() !== ""),
        cls: blocked ? null : classify(el, desc)
      };
    });
    const types = new Set(rows.filter(r => r.cls).map(r => r.cls.type));
    const hasSplitName = types.has("firstName") && types.has("lastName");

    for (const r of rows) {
      r.decision = decide({
        desc: r.desc,
        cls: r.cls,
        blocked: r.blocked,
        hasValue: r.hasValue,
        pinnedType: (pins && r.key && pins[r.key]) || null,
        profile,
        hasSplitName
      });
    }
    return { rows, total: inputs.length };
  }

  function el_value(el) {
    return typeof el.value === "string" ? el.value : "";
  }

  // Resolve a decision to the concrete value(s) that would be written.
  function valuesFor(r, profile) {
    const d = r.decision;
    if (d.action === "custom") return [String(d.value)];
    if (d.action !== "fill") return [];
    return candidatesFor(d.type, profile, r.el)
      .filter(v => v != null && String(v).trim() !== "")
      .map(String);
  }

  // ---------------------------------------------------------------
  // Main fill pass
  // ---------------------------------------------------------------
  // Scores at or just above THRESHOLD are guesses; they get filled (the user
  // can see and undo that) but are never learned as a pin.
  const PIN_MIN_SCORE = THRESHOLD + 2;

  function fillPage(profile, pins) {
    const { rows, total } = survey(profile, pins);
    let filled = 0, skipped = 0, blocked = 0;
    const snapshot = [];
    const learned = {};

    for (const r of rows) {
      const d = r.decision;
      if (d.action === "blocked") { blocked++; continue; }
      if (d.action === "skip") { skipped++; continue; }

      const cands = valuesFor(r, profile);
      if (!cands.length) { skipped++; continue; }

      const el = r.el;
      const prev = el_value(el);
      let ok = false;

      if (el.tagName === "SELECT") {
        // Try each representation: "11" → "November" → "Nov", "Ontario" → "ON"
        for (const c of cands) {
          if (fillSelect(el, c)) { ok = true; break; }
        }
      } else {
        const type = d.action === "fill" ? d.type : null;
        setNativeValue(el, chooseTextCandidate(el, cands, type));
        flash(el);
        ok = true;
      }

      if (ok) {
        filled++;
        snapshot.push({ el, prev, select: el.tagName === "SELECT" });
        // Only pin a confident, freshly classified match. A pin is written
        // without confirmation and replayed forever, so a barely-above-
        // threshold guess is exactly the one that must not become permanent.
        if (d.action === "fill" && !d.pinned && r.key &&
            r.cls && r.cls.type === d.type && r.cls.score >= PIN_MIN_SCORE) {
          learned[r.key] = d.type;
        }
      } else {
        skipped++;
      }
    }
    return { filled, skipped, blocked, total, snapshot, learned };
  }

  // ---------------------------------------------------------------
  // On-page UI (chip + preview overlays) — isolated in a shadow root
  // so host page styles can't reach it and it can't restyle the page.
  // ---------------------------------------------------------------
  // Accent matches the popup's dark-mauve system (#a288a6 family) — no vivid
  // purple. Entrances are a 140ms ease-out fade + 2px rise.
  const UI_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    @keyframes sf-in { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
    .chip {
      position: fixed; right: 16px; bottom: 16px; pointer-events: auto;
      display: flex; align-items: center; gap: 8px;
      background: #17161c; border: 1px solid rgba(255,255,255,.08);
      border-radius: 7px; box-shadow: 0 4px 16px rgba(8,5,20,.45);
      color: #ecebf0; font-size: 12px; line-height: 1.45; padding: 7px 9px;
      font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
      animation: sf-in .14s ${EASE_OUT};
    }
    .chip .n { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
               font-weight: 600; color: #fff; }
    .chip .sep { color: #7d7a90; }
    .chip .muted { color: #9a97ab; }
    .chip button {
      font: inherit; font-weight: 600; cursor: pointer;
      background: #a288a6; border: 1px solid #a288a6; color: #1c1d21;
      border-radius: 6px; padding: 3px 9px;
      transition: background .15s ${EASE_OUT}, border-color .15s ${EASE_OUT}, transform .15s ${EASE_OUT};
    }
    .chip button:hover { background: #b299b6; border-color: #b299b6; }
    .chip button:active { transform: scale(0.97); }
    .chip button:focus-visible { outline: 2px solid #a288a6; outline-offset: 2px; }
    .box { position: fixed; border: 2px solid #a288a6; border-radius: 4px; pointer-events: none;
           animation: sf-in .12s ${EASE_OUT}; }
    .box.blocked { border-color: #4a4857; border-style: dashed; }
    .box.skip { border-color: #3d3b49; border-style: dotted; }
    .tag {
      position: fixed; pointer-events: none; max-width: 220px; overflow: hidden;
      white-space: nowrap; text-overflow: ellipsis;
      background: #17161c; border: 1px solid rgba(255,255,255,.14);
      border-radius: 6px; padding: 2px 6px; font-size: 11px; letter-spacing: .01em;
      color: #c9b3cc; box-shadow: 0 4px 16px rgba(8,5,20,.45);
      animation: sf-in .12s ${EASE_OUT};
    }
    .tag.blocked { color: #9a97ab; }
    .tag.skip { color: #9a97ab; }
    @media (prefers-reduced-motion: reduce) {
      * { animation: none !important; transition: none !important; }
    }
  `;

  let uiRoot = null;
  function ui() {
    if (uiRoot && uiRoot.host.isConnected) return uiRoot;
    const host = document.createElement("div");
    host.id = "__smartfill_ui";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    (document.body || document.documentElement).appendChild(host);
    uiRoot = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = UI_CSS;
    uiRoot.appendChild(style);
    return uiRoot;
  }

  function clearUi(kind) {
    if (!uiRoot) return;
    uiRoot.querySelectorAll("." + kind).forEach(n => n.remove());
  }

  const CHIP_MS = 20000;
  const PREVIEW_MS = 8000;

  // "Filled 7 · 2 skipped · 1 blocked" — the skipped count is the signal that
  // tells a user there is something left to add a custom field for.
  function chipSummary(result) {
    const parts = [`Filled ${result.filled || 0}`];
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    if (result.blocked) parts.push(`${result.blocked} blocked`);
    return parts.join(" · ");
  }

  // A multi-step checkout fills in several passes. Each pass used to replace
  // the chip and throw away the previous snapshot, so Undo only ever reached
  // the last pass. Passes now accumulate into one chip while it is on screen.
  let chipState = null;
  let chipTimer = null;

  function showChip(result) {
    const root = ui();
    const live = chipState && chipState.el && chipState.el.isConnected;
    if (live) {
      chipState.filled += result.filled || 0;
      chipState.skipped += result.skipped || 0;
      chipState.blocked += result.blocked || 0;
      chipState.snapshot = chipState.snapshot.concat(result.snapshot || []);
      Object.assign(chipState.learned, result.learned || {});
    } else {
      chipState = {
        filled: result.filled || 0,
        skipped: result.skipped || 0,
        blocked: result.blocked || 0,
        snapshot: (result.snapshot || []).slice(),
        learned: Object.assign({}, result.learned),
        el: null
      };
    }

    clearUi("chip");
    const chip = document.createElement("div");
    chip.className = "chip";
    chipState.el = chip;

    const num = (v) => {
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(v);
      return n;
    };
    const dot = () => {
      const s = document.createElement("span");
      s.className = "sep"; s.textContent = "·";
      return s;
    };
    const count = (v, word) => {
      const s = document.createElement("span");
      s.className = "muted";
      s.append(num(v), " " + word);
      return s;
    };

    const filled = document.createElement("span");
    filled.append("Filled ", num(chipState.filled));
    chip.appendChild(filled);
    if (chipState.skipped) chip.append(dot(), count(chipState.skipped, "skipped"));
    if (chipState.blocked) chip.append(dot(), count(chipState.blocked, "blocked"));

    const undo = document.createElement("button");
    undo.textContent = "Undo";
    undo.addEventListener("click", () => {
      undoFill(chipState);
      chipState = null;
      clearTimeout(chipTimer);
      chip.remove();
    });
    chip.append(dot(), undo);

    // Pause the countdown while the user is reading or tabbing through it.
    const dismiss = () => { chip.remove(); if (chipState && chipState.el === chip) chipState = null; };
    const arm = () => { clearTimeout(chipTimer); chipTimer = setTimeout(dismiss, CHIP_MS); };
    chip.addEventListener("mouseenter", () => clearTimeout(chipTimer));
    chip.addEventListener("focusin", () => clearTimeout(chipTimer));
    chip.addEventListener("mouseleave", arm);
    chip.addEventListener("focusout", arm);

    root.appendChild(chip);
    arm();
  }

  const PREVIEW_LABELS = {
    firstName: "first name", lastName: "last name", fullName: "full name",
    email: "email", emailConfirm: "email", phone: "phone", dob: "date of birth",
    dobMonth: "birth month", dobDay: "birth day", dobYear: "birth year",
    address: "address", address2: "address 2", city: "city", region: "province/state",
    postal: "postal/zip", country: "country", company: "company",
    bandaiName: "Bandai TCG+ name", bandaiId: "Bandai member #", discord: "Discord"
  };

  function previewPage(profile, pins) {
    const { rows } = survey(profile, pins);
    clearUi("box");
    clearUi("tag");
    const root = ui();
    const tracked = [];
    let shown = 0, blocked = 0, skipped = 0;

    for (const r of rows) {
      const d = r.decision;
      let kind = "fill", text = null;

      if (d.action === "blocked") {
        kind = "blocked";
        text = "blocked — never filled";
      } else if (d.action === "skip" && r.hasValue) {
        continue; // already has a value; nothing to show and nothing to fix
      } else {
        const cands = valuesFor(r, profile);
        if (!cands.length) {
          // Surfacing these is the whole point of the README's "add a custom
          // field using its label as the keyword" advice.
          kind = "skip";
          text = "no match";
        } else {
          const label = d.action === "custom" ? "custom" : (PREVIEW_LABELS[d.type] || d.type);
          text = `${label}: ${cands[0]}`;
        }
      }

      const box = document.createElement("div");
      box.className = "box" + (kind === "fill" ? "" : " " + kind);
      const tag = document.createElement("div");
      tag.className = "tag" + (kind === "fill" ? "" : " " + kind);
      tag.textContent = text;
      root.append(box, tag);
      tracked.push({ el: r.el, box, tag });
      if (kind === "blocked") blocked++;
      else if (kind === "skip") skipped++;
      else shown++;
    }

    const position = () => {
      for (const t of tracked) {
        const rect = t.el.getBoundingClientRect();
        t.box.style.left = (rect.left - 2) + "px";
        t.box.style.top = (rect.top - 2) + "px";
        t.box.style.width = (rect.width + 4) + "px";
        t.box.style.height = (rect.height + 4) + "px";
        t.tag.style.left = rect.left + "px";
        t.tag.style.top = Math.max(0, rect.top - 20) + "px";
      }
    };
    position();

    const stop = () => {
      clearUi("box"); clearUi("tag");
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      document.removeEventListener("click", stop, true);
      clearTimeout(timer);
    };
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    document.addEventListener("click", stop, true);
    const timer = setTimeout(stop, PREVIEW_MS);

    // total = fields actually annotated; fields skipped because they already
    // hold a value are neither shown nor counted, so rows.length would lie.
    return { preview: shown, skipped, blocked, total: shown + skipped + blocked };
  }

  // ---------------------------------------------------------------
  // Per-site pins: descriptor → profile field, keyed by base domain
  // ---------------------------------------------------------------
  // KEEP IN SYNC with TWO_PART_TLDS in popup.js — a content script and the
  // popup can't share a module without a build step; test.js asserts equality.
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

  function siteKey() {
    try { return baseDomain(location.hostname); } catch { return null; }
  }

  async function loadPins() {
    const key = siteKey();
    if (!key) return {};
    try {
      const { pins = {} } = await chrome.storage.local.get(["pins"]);
      return pins[key] || {};
    } catch { return {}; }
  }

  // All pin writes go through the background service worker, which serializes
  // them. Every frame on a page fills independently, so read-modify-write here
  // would lose whichever frame finished first.
  async function savePins(learned) {
    const key = siteKey();
    if (!key || !learned || !Object.keys(learned).length) return;
    try {
      await chrome.runtime.sendMessage({ action: "pins", op: "merge", site: key, map: learned });
    } catch { /* worker asleep or context invalidated */ }
  }

  async function unlearnPins(descriptors) {
    const key = siteKey();
    if (!key || !descriptors || !descriptors.length) return;
    try {
      await chrome.runtime.sendMessage({ action: "pins", op: "remove", site: key, descriptors });
    } catch { /* worker asleep or context invalidated */ }
  }

  // Undo restores the previous values AND unlearns the pins that fill created,
  // so an explicitly rejected mapping doesn't come back on the next fill.
  function undoFill(result) {
    for (const s of result.snapshot || []) {
      try {
        if (s.select) setSelectValue(s.el, s.prev);
        else setNativeValue(s.el, s.prev);
      } catch { /* element gone */ }
    }
    return unlearnPins(Object.keys(result.learned || {}));
  }

  // ---------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.profile) return;

    if (msg.action === "smartfill") {
      (async () => {
        try {
          const pins = await loadPins();
          const result = fillPage(msg.profile, pins);
          // Await the round-trip through the background pin queue BEFORE
          // responding: the popup refreshes its pin list as soon as this
          // response lands, and a fire-and-forget write would still be queued.
          await savePins(result.learned);
          if (result.filled || result.blocked || result.skipped) showChip(result);
          sendResponse({
            ok: true,
            result: { filled: result.filled, skipped: result.skipped, blocked: result.blocked, total: result.total }
          });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }

    if (msg.action === "smartfill-preview") {
      (async () => {
        try {
          const pins = await loadPins();
          sendResponse({ ok: true, result: previewPage(msg.profile, pins) });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
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

      const run = async () => {
        try {
          const pins = await loadPins();
          const result = fillPage(profile, pins);
          await savePins(result.learned);
          if (result.filled) showChip(result);
        } catch { /* noop */ }
      };
      setTimeout(run, 800); // let the framework finish first paint

      // Watch for late-rendered form fields (SPAs, multi-step checkouts), but
      // not forever: after MAX_OBSERVED_RUNS debounced re-fills the observer
      // disconnects, so a chatty SPA isn't re-surveyed for the life of the tab.
      let t, observedRuns = 0;
      const MAX_OBSERVED_RUNS = 12;
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
        t = setTimeout(() => {
          if (++observedRuns >= MAX_OBSERVED_RUNS) obs.disconnect();
          run();
        }, 600); // debounce bursts of DOM changes
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener("pagehide", () => { obs.disconnect(); clearTimeout(t); }, { once: true });
    } catch { /* storage unavailable in this frame — ignore */ }
  }
  maybeAutofill();

  // Test hook: lets a Node harness exercise the pure matching logic.
  // `module` is undefined in a content script, so this is inert in Chrome.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      tokenize, hasKeyword, expandTokens, isBlockedDesc, classifyDesc, matchCustom,
      customKeywordOk, decide, baseDomain, descriptor, pinKey, visible,
      fillPage, previewPage, chipSummary, showChip, chipState: () => chipState,
      savePins, undoFill, loadPins, flash, fillSelect,
      BLOCKLIST, BLOCK_TOKEN_EXACT, TWO_PART_TLDS,
      THRESHOLD, PIN_MIN_SCORE
    };
  }
})();
