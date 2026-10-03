# Kitchen app: context for agents

Read this whole file before changing anything. It holds the owner's decisions, the reasons behind the design, and what has and has not been verified.

## Who this is for

One user, Arman, on his phone, in Montreal. He shops mostly at Maxi (Côte-des-Neiges). Receipts are in French, prices in CAD. He batch-cooks (4 to 20 portions) and wants to know what his food costs.

He is not a developer. He will not run build steps, install tools or debug deployments. Anything he must do by hand has to be written as numbered clicks in `README.md`. He does not want to review or double-check data: if the app is unsure, it saves and flags, it never asks.

This app replaces an older one (a Google Sheet with a sheet-bound Apps Script) that he found far too complicated and whose code was hard to reach. This is a rebuild, not a port. Do not recreate the old structure.

## Roadmap (his decisions)

1. **Receipts (built, v1.0.0).** Photo in, lines saved with price, date, time and place. No review screen. Barcode used to find the pack size. The photo is not kept.
2. **Calories.** A food database plus a daily log. The only success criterion is that logging what he ate takes seconds; in the old app it was tedious and he stopped doing it. He also wants to save recipes.
3. **Connect 1 and 2.** What his food costs, including price per portion of a recipe.
4. **Budget.** Spending categories, items assigned to categories, a default category per shop. Anything from a restaurant is food. Amazon stays undefined until he defines it, unless the item is obviously food.

Build one stage at a time. Do not start a stage he has not asked for.

## Hard rules

- No review or confirmation step for scanned data. Save, and set a flag when unsure.
- Never keep the receipt photo: not in the sheet, not in Drive, not in browser storage.
- Write plain values to the sheet, never formulas. His Sheets locale is French and comma-separated formulas break with `#ERROR`. All calculation happens in code.
- Always store the real unit of a quantity (`g`, `ml`, `unit`, ...). The old app hardcoded grams and left units blank, which corrupted the data.
- A save is all or nothing: every row of a receipt goes in one write. The old app saved partially on errors.
- No secret in this repo. It is public. The AI key lives in Script Properties. The connection (web app URL + token) lives on the device, in two places: localStorage, and the page address after `#c=` (never sent to GitHub). The address copy exists because his browser did not keep localStorage between visits: a bookmark or home screen icon made after connecting stays connected. Each copy carries a save time and the newer one wins.
- Few tabs, flat tables, obvious column names. If a feature needs a clever structure, simplify the feature.
- No build step, no framework, no dependency in the shipped app. `index.html` must work when opened as a static file.
- When you change a file, deliver the complete file. He does not apply partial patches.

## Architecture

```
phone browser                       Google                          outside
+-------------------+   POST JSON   +----------------------+
| index.html        | ------------> | Apps Script web app  | ---> AI model (Gemini or Claude)
| (GitHub Pages)    | <------------ | backend/Code.gs      |      reads the photo
|                   |               |  token check         |
|  all app logic    |               |  ai / read / append  | ---> Google Sheet
|                   |               |  / remove            |      tabs: Receipts, Products
|                   | ------------------------------------------> Open Food Facts
+-------------------+        GET by barcode (pack size)            (free, no key)
```

Why this shape:

- **Sheets access with zero Google Cloud setup.** An Apps Script web app runs as him and can open his sheet. The alternative (OAuth in the browser) needs a Cloud project, a consent screen and hourly re-login.
- **The AI key never reaches the phone or the repo.** The backend adds it.
- **The backend is thin and generic on purpose.** It knows nothing about receipts. It relays a prompt and images to the AI, and reads, appends or removes rows by column name. All logic (the prompt, parsing, the column list, pack sizes) is in `index.html`, which goes live on every push. `backend/Code.gs` has to be pasted by hand into script.google.com and redeployed, which he dislikes. So: put new logic in `index.html`, and touch `Code.gs` only when there is no other way.
- **Standalone script, not bound to the sheet.** GitHub is the source of truth for the code.

Live URL: `https://armanaksoy.github.io/kitchen-app/` (GitHub Pages, branch `main`, root).

## Files

| Path | Role |
|---|---|
| `index.html` | The app. One file: CSS, markup, then script in three parts: `K` (pure logic), network, screen. |
| `backend/Code.gs` | The Apps Script backend. Header comment lists the Script Properties. |
| `README.md` | Setup and use, written for Arman. Keep it in sync with any change to setup. |
| `tests/logic.test.js` | Tests the `K` block of `index.html` under Node. |
| `tests/backend.test.js` | Runs the real `Code.gs` against fake Google services. |
| `tests/app.test.js` | Runs `index.html` in Chromium at phone size against the real `Code.gs` on fake services, with canned AI and Open Food Facts answers. |
| `tests/fake-google.js`, `tests/helpers.js` | The fakes, and the sample receipt used by the tests. |

## Data model

One spreadsheet, two tabs. Tabs and columns are created by the backend the first time a row needs them, from the keys the app sends. To add a column, add it to `RECEIPT_COLS` or `PRODUCT_COLS` in `index.html` and send it. No backend change, no manual sheet edit.

Text is stored as text (dates, times, barcodes), numbers as numbers.

### `Receipts`: one row per line of a receipt

| Column | Meaning |
|---|---|
| `receipt_id` | `YYYYMMDD-HHMM-shop-cents`, for example `20261002-1807-maxi-3644`. Same shop, date, time and total means same receipt. This is what refuses a double scan. |
| `date` | `YYYY-MM-DD`, text. Receipt date. If unreadable: the day of the scan, with flag `date_guessed`. |
| `time` | `HH:MM` 24h, text. May be empty. |
| `shop` | Store or restaurant name as a customer says it. |
| `shop_type` | `grocery`, `restaurant`, `pharmacy`, `online`, `other`. Meant for stage 4 default categories. |
| `location` | Branch or address as printed. |
| `type` | `item`, `discount`, `fee` (deposit, bag, eco fee), `tip`, `tax`. |
| `item` | Readable name, abbreviations expanded by the AI. |
| `item_raw` | The line exactly as printed. Ground truth, since nothing is reviewed. |
| `code` | Product number printed on the line (barcode, PLU, store number), text. |
| `qty` | Number of packages, or the weight or volume for items sold that way. |
| `unit` | Unit of `qty`: `unit`, `kg`, `g`, `lb`, `l`, `ml`. |
| `unit_price` | Price per `unit`. |
| `total` | Amount of the line. Negative for discounts. |
| `pack_size`, `pack_unit` | Content of ONE package, in `g`, `ml` or `unit`. Empty for items sold by weight (their amount is `qty` and `unit`) and for non-items. |
| `flag` | Comma-separated, empty when all is well. See below. |
| `added_at` | Local time of the scan, `YYYY-MM-DDTHH:MM:SS`. |

Invariant: the `total` of all rows of one `receipt_id` adds up to what was paid, taxes included. If it does not match the printed total by more than 0.02, every row of that receipt carries `total_mismatch`.

Flags: `unreadable` (line), `no_pack_size` (line, counted items outside restaurants), `total_mismatch`, `no_total`, `date_guessed` (whole receipt, repeated on each row).

Amount actually bought, for stage 3: if `unit` is a weight or volume, it is `qty` in that unit. Otherwise it is `qty * pack_size` in `pack_unit`.

### `Products`: pack sizes learned so far

`code`, `name`, `brand`, `pack_size`, `pack_unit`, `source` (`receipt`, `openfoodfacts`, or `manual` when he edits it), `updated_at`.

`code` is the key: the barcode as printed when it has 10 to 14 digits, otherwise `shop-slug:code` (a Costco item number means nothing at Maxi). If a key appears twice, the lower row wins, so a correction can be made by editing the row or by adding one.

Pack size order of trust: `Products` tab, then Open Food Facts by barcode, then what was printed on the receipt line. The AI is told not to guess sizes.

`Products` is expected to become, or link to, the food database of stage 2 (Open Food Facts also returns nutrition for the same barcode).

## Backend API

One endpoint, `POST` to the web app URL, body is JSON sent as `text/plain` (this keeps the request CORS-simple; Apps Script cannot answer a preflight). Every body carries `token` and `action`. Every answer is JSON with `ok: true`, or `ok: false` and `error`.

| action | In | Out |
|---|---|---|
| `ping` | | `version`, `sheetUrl`, `sheetName`, `tabs`, `provider`, `model` |
| `ai` | `prompt`, `images: [{mimeType, data}]` (base64), `json` | `text`, `provider`, `model` |
| `read` | `tab`, `tail` (optional, last N rows) | `headers`, `rows` (arrays). A missing tab reads as empty. |
| `append` | `tab`, `rows: [{column: value}]`, `ifAbsent: {column, value}` (optional) | `appended`, and `skipped: true` if `ifAbsent` matched |
| `remove` | `tab`, `column`, `value` | `removed` |

AI provider: whichever key exists in Script Properties (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`; `AI_PROVIDER` decides if both). No model id is hard-coded, because ids get retired: Gemini uses the `gemini-flash-latest` alias; Claude lists the models and takes the newest Sonnet. `AI_MODEL` forces an exact id.

Busy answers (429, 500, 502, 503, 504, 529) are retried after 1.5 s and 4 s. If Gemini is still busy, or the model name is gone (404), the backend lists the plain Flash models and tries the two newest others, then remembers the one that answered (10 minutes if busy, 6 hours if gone). A forced `AI_MODEL` is retried but never swapped. This was added in 1.0.1 after the very first real call (setup, 2026-10-03) came back "503 high demand" on `gemini-flash-latest`.

After changing `Code.gs`: bump `VERSION`, tell Arman to paste it and do Deploy > Manage deployments > pencil > New version. Say this explicitly in your summary to him, every time.

## Tests

    sh tests/run.sh            # everything
    sh tests/run.sh --shots    # also writes phone-size screenshots to <tmp>/kitchen-app-shots

`logic` and `backend` need only Node. `app` needs the `playwright` npm package and a Chromium (`CHROMIUM_PATH` can point to one). Run all three before every push, and look at the screenshots after any change to the screen.

Keep the `K` block of `index.html` pure (no DOM, no network): `tests/helpers.js` extracts it by its first line `const K = (() => {` and its closing `})();`.

## What has NOT been verified against the real services

Version 1.0.0 was written in a sandbox with no API keys and no access to Google or Open Food Facts. All 59 tests pass, but they run against fakes. Until Arman has done the setup and scanned real receipts, treat these as unproven:

1. The Gemini and Claude request and response shapes in `Code.gs`, and the automatic model choice. (Known so far, 2026-10-03: Arman uses a Gemini key, and `setup` got a real text answer from `gemini-flash-latest`. An image request has not been seen yet. The Claude path is untested.)
2. That the browser can call the Apps Script web app the way `api()` does (text/plain POST, redirect followed).
3. That Open Food Facts allows the lookup from the browser (CORS). If it does not, pack sizes silently fall back to the receipt text; moving the lookup into the backend would be the fix.
4. Reading quality on real Maxi receipts: whether the product number on each line is a barcode Open Food Facts knows, how discounts and "2 @ 1,29" lines are attributed, and whether one photo of a long receipt is sharp enough. The prompt (`K.PROMPT`) is the first thing to tune.
5. Whether Sheets keeps the automatic number format on appended cells (the code reads the existing format and writes it back, changing only text columns to `@`).

6. Speed. Apps Script gives an outside request about a minute. A slow model on a very long receipt could time out (the app then shows the error and saves nothing). If that happens, set `AI_MODEL` in Script Properties to a faster model.

Seen in his old sheet: Maxi prints lines such as `06038303552 SN PATE TOMATE MRJ` and `(4)06038367407 SN LENTILLES MRJ`. The 11 digits are a barcode without its check digit (`K.upcCandidates` rebuilds it), `(4)` is the quantity, `MRJ` is a tax code.

Setup problems he actually hit, already handled in the README: the web app was first deployed as "Execute as: user accessing the web app", which hides the "Anyone" choice and makes every call fail; and the old app (sheet `kitchen-tracker`, Drive folder `Kitchen inbox`) is still installed on his phone and easy to open by mistake.

When the first real receipts are in, check them against the paper and fix what is off before building stage 2.

## Ideas noted, not requested

- An app icon and a web manifest, so the home screen icon looks right (needs PNG files).
- Slicing a tall photo into overlapping tiles before sending, to read long receipts from a single photo.
- Deploying `Code.gs` from GitHub with clasp, so nothing is pasted by hand.
