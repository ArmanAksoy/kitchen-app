# Food log

A phone app that records what Arman eats, with calories, macros, vitamins and minerals. Once published it lives at:

    https://armanaksoy.github.io/kitchen-app/food/

Nothing is sent anywhere. There is no account, no Google Sheet, no AI service and no backend. The food database, the label reader and all the data sit on the phone. Once the app has been opened one time with a connection, it works offline.

This folder is independent from the receipts app at the root of the repo. The two share nothing.

## For Arman

### First time
1. On the phone, open the address above in Chrome.
2. Chrome menu (three dots) > **Add to Home screen** > **Install**. Always open the app from that icon. An installed app is what makes Chrome keep the data.
3. The first label scan downloads the reader (about 8 MB, once). Do it on Wi-Fi.

### Three ways to log
- **Type it**: tap **Add food** and type `130 g banana`, `2 eggs`, `poutine`. Pick the line, check the amount, **Add**. English and French both work.
- **Packaged food**: **Add food > Scan a label**, photograph the Nutrition Facts table flat and without glare, type the product name, **Save**. Boxes outlined in yellow were not read or look wrong: compare those with the package. This is done once per product.
- **Batch cooking**: **My foods > New recipe**. Add each ingredient with its raw weight, then the cooked weight of the whole batch and the weight of one portion. After that, logging a portion is one tap.

When nothing is typed, the Add screen shows three lists (since 1.1.0):
- **Favourites**: whatever you starred. Tap the star on any line, or on the amount screen.
- **Mine**: every recipe and packaged food you created, by name, so you never have to remember what it was called.
- **Recent**: the last things you logged.

On every line, **+** adds it straight away with the amount you used last time (or one portion), and tapping the name lets you change the amount first.

### Good to know
- Restaurant dishes are only there if Health Canada lists them (poutine, pad thai, sushi, donair, hamburgers, pizza). Shawarma, for example, is not. Use the closest thing, or **Add by hand** once with numbers from the restaurant.
- A package label only carries calories, macros, sodium, potassium, calcium and iron. For days that include packaged food, the vitamin lines show "3 of 4 items": they are a minimum.
- Editing or deleting a recipe or a packaged food never changes what is already in the diary.

### Spreadsheet and backup (More screen)
- **Export a spreadsheet** makes one .xlsx file with four tabs: every entry, totals per day, recipes, packaged foods. It opens in Excel or Google Sheets.
- **Save a backup file** makes one file with everything. **Restore a backup** puts it back, on this phone or a new one. Do it now and then: if Chrome's data for this site is cleared, the diary is gone and the backup is the only copy.
- The More screen says since when the data has been kept. If that date ever jumps to today, Chrome wiped it.

## For an agent or developer

Read this before changing anything, together with `../CLAUDE.md` for who the owner is and how he works (not a developer, no build steps, complete files, no review passes).

### His decisions (November 2026)
- Independence first: no external AI, no service the app depends on.
- Simple to use, modelled on Cronometer, which he liked. Logging must take seconds or he stops doing it.
- Budget, receipts and food cost are set aside for now. Do not wire this app to the receipts app unless he asks.
- He does not fill databases. The food database ships with the app.
- The Google Drive and Sheets route of the old app was slow and tiresome. Export is a file, on demand.

### Files
| Path | Role |
|---|---|
| `index.html` | Screen and storage. No framework, no build step. |
| `logic.js` | All arithmetic and parsing, pure (global `F`, also a Node module): quick-entry parsing, search, nutrient maths, recipe maths, label parsing, the .xlsx writer. |
| `cnf.js` | Canadian Nutrient File 2026 (Health Canada, Open Government Licence), 5993 foods, 37 nutrients per 100 g, up to 8 household measures each. Generated, do not edit by hand. |
| `vendor/` | tesseract.js 7 (Apache-2.0): the text reader, its three engine builds, English and French language data. Loaded only when a label is scanned. |
| `sw.js`, `manifest.json`, `icon-*.png` | Offline cache and home screen install. Bump `CACHE` in `sw.js` when `cnf.js` or `vendor/` changes. |
| `tests/` | `sh food/tests/run.sh`. `logic.test.js` needs only Node. `app.test.js` drives the real page in Chromium at phone size (needs `playwright-core`, set `PLAYWRIGHT` to its path if it is not installed locally, and `CHROMIUM_PATH`), including a real on-device read of `label-sample.jpg`. Run both before every push. |

### Data (IndexedDB database `foodlog`, on the device)
- `log`: one row per thing eaten. `date`, `time`, `name`, `ref`, `amount` and `unit` (g or ml, always the real unit), `qty` and `measure` when it was entered as "2 x 1 large egg", `source`, and `nut`: the nutrients of that entry, frozen at the time of logging.
- `foods`: packaged foods. `vals` is what was printed per serving, with `serving`, `unit`, and `per100` derived from them.
- `recipes`: `items` (ref, name, amount, unit), `batch_g` (cooked weight, may be empty), `portion_g`, the `weight` used, and `per100` of the finished dish.
- `kv`: `targets`, `uses` and `last` (drive search ranking and the Recent list), `favs` (starred refs as `t:id` strings, in the order starred), `firstOpen`, `lastBackup`.

A ref is `{t, id}`: `c` = database food code, `u` = packaged food, `r` = recipe.

### Rules that come from bugs in the old app
- **Unknown is not zero.** A nutrient the source does not give is `null`, never 0. Sums count how many entries lacked it and the screen says so. The old app showed 327 kcal for a 690 kcal burrito because four ingredients had empty rows.
- **A recipe is never saved with a hole.** Every ingredient must resolve to a food with values, or the save is refused.
- **Portions by weight.** A recipe stores the cooked batch weight; a portion is grams of it. Logging the whole batch returns exactly what went in.
- **No default of 100 for counted things.** A bare number picks a per-piece measure ("2 eggs"), and own foods and recipes default to one serving. An entry above 2500 kcal shows a warning. The old app once logged 100 cans of Red Bull.
- **No duplicates.** Saving a food or recipe under an existing name updates that one.
- **All or nothing.** Every save is one IndexedDB transaction. A pasted recipe with one unknown ingredient loads nothing.
- **One calculation path.** Everything is per 100 of its unit and goes through `F.scale`.
- **The spreadsheet holds numbers, not formulas, in a real .xlsx.** His spreadsheet locale is French, which broke comma formulas and would misread CSV decimals.
- **Never redraw a screen while he types.** It takes the keyboard away. Update only the summary.
- **The label photo is never stored.**

### Getting a food in without typing (since 1.0.3)
For foods with published numbers (a bakery, a restaurant), he does not want to type thirteen boxes. Two ways, both feeding the same `F.parseLabel` used for photos:
- **A link** prepared in a chat: `https://armanaksoy.github.io/kitchen-app/food/#food=` followed by the URL-encoded text block. It opens the form already filled; nothing is saved until he taps Save. `#recipe=` does the same with a recipe block. The part after `#` is never sent to a server.
- **Paste**: the food form has an "Or paste text" box that takes the same block, or a nutrition table copied from a web page.

The text block is plain lines, per serving, as on a label:

    Name: Croissant aux amandes Première Moisson
    Per 1 croissant (175 g)
    Calories 760
    Fat 49 g
    Sodium 310 mg

When he mentions something he ate that is not in the database, look up the maker's published values and answer with a ready link.

### Recipe block for pasting
The recipe screen accepts a block prepared in a chat (all or nothing):

    {"name":"Mercimek","batch_g":3617,"portion_g":390,"items":[{"code":2683,"g":1300},{"name":"lentils canned","g":2000}]}

`code` is a database food code from `cnf.js`; `name` is searched among his own foods first, then the database.

### Regenerating `cnf.js`
The official files are on open.canada.ca ("Canadian Nutrient File"). The build reads `Food_Name.csv`, `Nutrient_Amount.csv`, `Measure_Name.csv` and `Measure_Weight_Conversion.csv` (measure type 6 only), keeps the 37 nutrient codes whose keys are listed in `logic.js`, and drops foods without an energy value. The 2026 files used here were taken from a public GitHub mirror (emilyziraldo/cnf2026-dashboard) because the build sandbox could not reach canada.ca. Spot checks (banana 89 kcal, 2% milk 47 kcal per 100 g) are plausible, but the file was not compared line by line with the official download.

### Not verified on the real phone
Built and tested in a sandbox, in desktop Chrome at phone size. Unproven until he uses it:
1. Label reading on real photos. One real photo so far (2026-11-12, a Red Bull can held in a hand: curved, glossy, "Supplemented Food Facts" layout). Version 1.0.0 did not read it on his phone; the same photo in the sandbox gave 6 values, so the phone-side cause is unknown. Since 1.0.2 the photo is turned to grey levels and read twice (page segmentation 11, then 3), the two readings are merged by `F.parseLabel`, and the added vitamins and caffeine are captured: that photo now gives all 7 printed values plus 4 added ones. The scan screen has a "What the reader saw" link showing the raw text; ask him for a screenshot of it when a label reads badly. His photos are not committed (this repo is public); the raw text of that reading is a test case in `logic.test.js`.
2. Whether his Chrome keeps IndexedDB. The receipts app found that his browser did not keep localStorage between visits. The app asks for persistent storage and shows the result on the More screen; installing to the home screen is what normally grants it. If data still disappears, the fallback he was open to is an automatic background backup.
3. Download of the .xlsx and backup files from the installed app on Android.
4. The offline cache (`sw.js`) only runs over https, so the tests do not cover it.
5. Search ranking for his own vocabulary. `STAPLES` in `logic.js` maps everyday words to the right database rows; extend it when he reports a food that is hard to find.

### Ideas noted, not requested
- Barcode lookup (needs an outside service, so it conflicts with independence unless cached).
- Automatic background backup to a folder he picks.
- Copy a whole previous day.
