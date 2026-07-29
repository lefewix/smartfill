# SmartFill

A browser extension for smart form prefill on event signup pages (Weeztix, OrganizedPlay, Eventbrite, and similar). Profiles are stored locally, filling is explicitly triggered, and forms are never auto-submitted.

## Features

- **One-click fill** — click the toolbar icon and press **Fill**, or use the **Alt+Shift+F** keyboard shortcut
- **Preview before filling** — press **Preview** to outline every field that would be filled, and what would go in it, without writing anything
- **Undo** — a summary chip appears on the page after a fill ("Filled 7 · 2 skipped · 1 blocked · Undo"); it restores every field to its pre-fill value and forgets the pins that fill created. The chip stays for 20 seconds, pauses its countdown while you hover or tab into it, and accumulates across multiple fill passes on the same page so Undo covers all of them
- **Per-site pinning** — once a field is filled on a site with a confident match, that mapping is remembered and wins over scoring on later visits; pins can be inspected and removed one at a time from the popup. Pins are keyed by label text plus `name` only, so they survive frameworks that generate a fresh `id` on every render
- **Export / import** — back up profiles, custom fields, allowlist, and pins as JSON. Import only ever adds: colliding or unnamed profile names are suffixed rather than overwritten, so existing data is never replaced. Domains from an imported allowlist are listed for confirmation before auto-fill is switched on for any of them
- **Multiple profiles** — maintain separate profiles (e.g. personal, work) and switch between them
- **Smart field detection** — form fields are classified by their labels, placeholders, names, and `autocomplete` attributes, so no per-site configuration is needed
- **Custom fields** — define keyword-to-value pairs for site-specific fields (membership IDs, allergies, and other non-standard inputs). Custom keywords skip scoring entirely, so they must be two words or at least five characters; the popup warns about keywords too generic to be safe
- **Auto-fill allowlist** — optionally enable automatic filling on specific domains you choose
- **Privacy-first** — all data lives in `chrome.storage.local` on your machine and the extension makes no network calls. Note that this is local privacy, not isolation: the content script is injected into every page (`<all_urls>`) so a form can be filled without a per-site prompt, and **Export** writes your profile — including date of birth, address, and phone — to a plaintext JSON file on disk

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome, Brave, or Edge
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this project folder
5. Click the SmartFill icon, fill in a profile, and press **Save**

## Usage

1. Open a signup form
2. Click the SmartFill icon and press **Fill**, or press **Alt+Shift+F** (press **Preview** first to see what would be filled)
3. Filled fields flash violet — review everything, then submit the form yourself

Existing values in a form are never overwritten, and SmartFill never submits a form on your behalf.

## How it works

Each visible input, select, and textarea is given a descriptor built from its `<label>`, `placeholder`, `name`, `id`, `aria-label`, `aria-labelledby`, `autocomplete` attribute, and nearby label-like elements. That descriptor is scored against keyword dictionaries per field type (first name, email, date of birth, postal code, and so on); the highest score above a threshold wins. `autocomplete` attributes carry the most weight, since they are authoritative when present.

Keywords match whole words only: "tel" does not match "Hotel name", and "prov" does not match "Insurance provider". Multi-word keywords match a run of consecutive words. Concatenated attributes (`name="streetaddress"`, `name="cellphone"`) are split back into known words before matching, so they classify like their spaced equivalents while unknown compounds such as "hotelname" stay unmatched.

The blocklist plays by looser rules on purpose: a blocklist keyword matches as a whole word *or* as a substring of any token, so `name="creditcardnumber"` and `name="cardexpiry"` are blocked. Only short, collision-prone entries ("sin", "ssn", "pin", "exp") are whole-word-only, which is what keeps "Business name", "Cousin", "Shipping" and "Expense report" fillable. A blocklist false positive costs one skipped field; a false negative writes a card number into a form.

Every field runs through one decision, in a fixed order: **blocklist → never overwrite → custom field → full-name demotion → per-site pin → classifier**. Blocked fields and fields that already have a value are settled before anything can write to them. Custom fields strictly beat pins, and the demotion guard sits above the pin so a mapping the guard would reject cannot come back through a pin learned on an earlier visit.

Only confident classifications (comfortably above the scoring threshold) are pinned. A borderline guess is still filled — you can see it and undo it — but it is not learned, so one wrong guess does not become permanent.

Additional handling:

- **Framework-safe fills** — uses the native value setter and dispatches `input`/`change`/`blur` events so React and Vue controlled components register the value
- **Select elements** — fuzzy matched: exact value → exact text → prefix → contains ("Ontario" matches an `ON` option, "Canada" matches a `CA` option)
- **Dates of birth** — stored as `YYYY-MM-DD`. A `type="date"` field gets ISO; a text field gets the order its placeholder, title, or label spells out (`MM/DD/YYYY`, `DD/MM/YYYY`). With no hint at all it also gets ISO rather than a guess, since `03/07/1990` means two different days on either side of the Atlantic
- **Confirm-email fields** — detected and filled with the same email address
- **Full-name demotion** — when a form has dedicated first/last name fields, weakly matched "name" fields (such as "event name") are skipped
- **Custom fields** — per-profile keyword-to-value pairs take priority over both pins and the built-in classifier, which is why they carry a minimum specificity
- **Iframes** — signup forms often live in an iframe, so both the popup and the keyboard shortcut send the fill request to every frame of the tab (the `webNavigation` permission is used to enumerate them). The popup's status line totals every frame; the keyboard shortcut has no popup to report into, so it puts the total filled count on the toolbar badge for a few seconds. Each frame shows its own chip, and a chip's Undo covers that frame's fill
- **Skipped fields** — the summary reports how many visible fields matched nothing ("Filled 7 · 2 skipped"), and Preview outlines them with a muted "no match" tag, so you can see exactly which labels need a custom field

## Security

Payment and credential fields are blocklisted and never filled, even on a keyword collision: card numbers, cardholder names, CVV/CVC, expiry fields in every spelling the payment world uses (`expiry`, `expiration`, `exp-date`, `expMonth`, `cc-exp-month`), PINs, passwords, IBAN/routing/account numbers, and SIN/SSN. The blocklist is checked before custom keywords, so a custom field cannot reach a payment input either. Payment autofill is left to the browser.

Pin storage is written only by the background service worker, which applies every change from the popup and from each frame one at a time against freshly read data, drops entries that are not a known field type, and caps each site's *accumulated* map (not just each incoming message) so stored pins cannot grow without bound.

Visibility is checked before anything else: disabled, read-only, zero-sized, `display: none`, `visibility: hidden`, `opacity: 0` (including a transparent ancestor) and far-off-screen fields are never candidates. That last pair is what keeps SmartFill out of signup honeypots.

## Limitations

- Custom widget dropdowns (div-based comboboxes, react-select) are not real `<select>` elements and are not filled
- Fields inside a shadow root are not seen: the page is scanned with `document.querySelectorAll`, which does not cross shadow boundaries
- Honeypot fields (spam traps hidden with `opacity: 0` or parked off-screen) are detected and skipped, but the detection is heuristic — a trap hidden by some other trick could still be filled, which some signup platforms treat as bot traffic
- If a field fails to classify, add a custom field using its label as the keyword (two words or five-plus characters — shorter keywords are ignored because they collide with too much)

## Tests

`node test.js` — no dependencies, no build step. The harness shims the small
part of the DOM and `chrome.*` that the extension touches, then exercises the
blocklist (including the false positives it must *not* catch), the custom-keyword
threshold, honeypot rejection, pin ordering and key stability, the reported
counts, and the invariant that nothing ever writes into a blocked or non-empty
field by any path.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Felix Wang
