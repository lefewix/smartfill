# SmartFill

A browser extension for smart form prefill on event signup pages (Weeztix, OrganizedPlay, Eventbrite, and similar). Profiles are stored locally, filling is explicitly triggered, and forms are never auto-submitted.

## Features

- **One-click fill** — click the toolbar icon and press **Fill**, or use the **Alt+Shift+F** keyboard shortcut
- **Preview before filling** — press **Preview** to outline every field that would be filled, and what would go in it, without writing anything
- **Undo** — a summary chip appears on the page after a fill ("Filled 7 · 1 blocked · Undo"); it restores every field to its pre-fill value and forgets the pins that fill created
- **Per-site pinning** — once a field is filled on a site, that label-to-profile-field mapping is remembered and wins over scoring on later visits; pins can be inspected and removed one at a time from the popup
- **Export / import** — back up profiles, custom fields, allowlist, and pins as JSON. Import only ever adds: colliding or unnamed profile names are suffixed rather than overwritten, so existing data is never replaced
- **Multiple profiles** — maintain separate profiles (e.g. personal, work) and switch between them
- **Smart field detection** — form fields are classified by their labels, placeholders, names, and `autocomplete` attributes, so no per-site configuration is needed
- **Custom fields** — define keyword-to-value pairs for site-specific fields (membership IDs, allergies, and other non-standard inputs)
- **Auto-fill allowlist** — optionally enable automatic filling on specific domains you choose
- **Privacy-first** — all data lives in `chrome.storage.local` on your machine; the extension makes no network calls

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome, Brave, or Edge
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this project folder
5. Click the SmartFill icon, fill in a profile, and press **Save**

## Usage

1. Open a signup form
2. Click the SmartFill icon and press **Fill**, or press **Alt+Shift+F** (press **Preview** first to see what would be filled)
3. Filled fields flash green — review everything, then submit the form yourself

Existing values in a form are never overwritten, and SmartFill never submits a form on your behalf.

## How it works

Each visible input, select, and textarea is given a descriptor built from its `<label>`, `placeholder`, `name`, `id`, `aria-label`, `aria-labelledby`, `autocomplete` attribute, and nearby label-like elements. That descriptor is scored against keyword dictionaries per field type (first name, email, date of birth, postal code, and so on); the highest score above a threshold wins. `autocomplete` attributes carry the most weight, since they are authoritative when present.

Keywords match whole words only: "tel" does not match "Hotel name", and "prov" does not match "Insurance provider". Multi-word keywords match a run of consecutive words. Concatenated attributes (`name="streetaddress"`, `name="cellphone"`) are split back into known words before matching, so they classify like their spaced equivalents while unknown compounds such as "hotelname" stay unmatched.

The blocklist plays by looser rules on purpose: a blocklist keyword matches as a whole word *or* as a substring of any token, so `name="creditcardnumber"` and `name="cardexpiry"` are blocked. Only short, collision-prone entries ("sin", "ssn") are whole-word-only, which is what keeps "Business name" fillable. A blocklist false positive costs one skipped field; a false negative writes a card number into a form.

Every field runs through one decision, in a fixed order: **blocklist → never overwrite → per-site pin or custom field → classifier**. Blocked fields and fields that already have a value are settled before anything can write to them.

Additional handling:

- **Framework-safe fills** — uses the native value setter and dispatches `input`/`change`/`blur` events so React and Vue controlled components register the value
- **Select elements** — fuzzy matched: exact value → exact text → prefix → contains ("Ontario" matches an `ON` option, "Canada" matches a `CA` option)
- **Dates of birth** — stored as `YYYY-MM-DD` and formatted per field hint (`type="date"` receives ISO format; text fields receive `MM/DD/YYYY` unless the placeholder indicates otherwise)
- **Confirm-email fields** — detected and filled with the same email address
- **Full-name demotion** — when a form has dedicated first/last name fields, weakly matched "name" fields (such as "event name") are skipped
- **Custom fields** — per-profile keyword-to-value pairs take priority over the built-in classifier
- **Iframes** — signup forms often live in an iframe, so both the popup and the keyboard shortcut send the fill request to every frame of the tab (the `webNavigation` permission is used to enumerate them) and the reported counts cover all of them

## Security

Payment and credential fields are blocklisted and never filled, even on a keyword collision: card numbers, CVV/CVC, expiry dates, passwords, IBAN/routing/account numbers, and SIN/SSN. Payment autofill is left to the browser.

Pin storage is written only by the background service worker, which applies every change from the popup and from each frame one at a time against freshly read data, and drops entries that are not a known field type.

## Limitations

- Custom widget dropdowns (div-based comboboxes, react-select) are not real `<select>` elements and are not filled
- If a field fails to classify, add a custom field using its label as the keyword

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Felix Wang
