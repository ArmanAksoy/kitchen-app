# Kitchen app

A personal phone app. Version 1 does one thing: you photograph a store receipt, and every line of it lands in a Google Sheet (item, price, quantity, pack size, shop, place, date, time). There is no review screen and the photo is not kept.

Later stages (not built yet): calories and a food log, food cost and price per portion, then a budget. See `CLAUDE.md`.

## What is in this repo

| File | What it is |
|---|---|
| `index.html` | The whole app. GitHub Pages serves it, so every push to `main` updates the app on the phone. |
| `backend/Code.gs` | A small Google Apps Script that writes to the sheet and holds the AI key. Pasted by hand into script.google.com. Rarely changes. |
| `CLAUDE.md` | Everything an AI agent (or a developer) needs to know before changing anything. |
| `tests/` | Automated tests. Not needed to run the app. |

## One-time setup (about 15 minutes)

### 1. Put the files in this repo
On the repo page: **Add file > Upload files**, drag everything in (keep the `backend` and `tests` folders as folders), then **Commit changes**.

### 2. Turn on GitHub Pages
Repo **Settings > Pages**. Under "Build and deployment": Source = **Deploy from a branch**, Branch = **main**, folder = **/ (root)**, **Save**.
After a minute or two the app is live at:

    https://armanaksoy.github.io/kitchen-app/

### 3. Get an AI key (this is what reads the receipt)
Pick one. If the old kitchen app already used a key, reuse it.

- **Google Gemini**: go to https://aistudio.google.com/apikey, sign in, **Create API key**, copy it.
- **Anthropic Claude**: go to https://console.anthropic.com, **API keys > Create key**, copy it. This needs prepaid credit on the account.

Check the current price on the provider's own page. A receipt is one small request.

### 4. Create the backend
1. Go to https://script.google.com and click **New project**. Name it "Kitchen app backend".
2. Delete what is in the editor, paste the full content of `backend/Code.gs`, and save.
3. Left sidebar: **Project Settings** (gear) > **Script Properties** > **Add script property**:
   - Property `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`), Value = the key from step 3.
   - Optional: to use an existing spreadsheet instead of a new one, add `SHEET_ID` with the sheet's address as value.
4. Back in the **Editor**: choose `setup` in the function list at the top, click **Run**.
   Google asks for permission the first time: **Review permissions** > your account > **Advanced** > **Go to Kitchen app backend (unsafe)** > **Allow**. The warning is normal for a script you wrote yourself.
5. The **Execution log** at the bottom now shows three things. Keep the tab open:
   - `Sheet:` the spreadsheet where receipts will go
   - `TOKEN:` a long password
   - `AI: working` (if it says NOT working, the key is wrong)
6. Top right: **Deploy > New deployment**. Click the gear next to "Select type" > **Web app**. Set Execute as = **Me** first (in French: "Exécuter en tant que : Moi"), then Who has access = **Anyone** ("Tout le monde"; this choice only appears once "Me" is selected). **Deploy**. Copy the **Web app URL** (it ends with `/exec`).

"Anyone" is required for the phone to reach it. The address is unguessable and every request must also carry the token, so nobody else can read or write.

### 5. Connect the app
1. On the computer, open https://armanaksoy.github.io/kitchen-app/
2. Paste the Web app URL and the TOKEN, then **Save and test**. It should say "Connected".
3. Click **Copy link for another device**, send that link to yourself, and open it on the phone. The phone is now connected too.
4. On the phone, use the browser's **Add to Home Screen** right away, and always open the app from that icon. The icon remembers the connection, even if the browser forgets everything else.

## Using it
- **Scan a receipt**: take the photo, wait a few seconds, done.
- **Long receipt**: for a receipt too long to be sharp in one photo. Take it in parts from top to bottom, then **Done, save it**.
- The result card says whether the lines add up to the receipt total. If not, the receipt is saved anyway and flagged.
- **Delete this receipt** removes it from the sheet (to rescan a bad one).
- Scanning the same receipt twice adds nothing.

## The sheet
- `Receipts`: one row per line of a receipt. The rows of one receipt add up to what was paid (taxes are rows too).
- `Products`: pack sizes the app has learned, by barcode. To correct a pack size, edit it here, or add a row; the app uses it from then on.

The `flag` column says what the app was unsure about: `unreadable`, `no_pack_size`, `total_mismatch`, `no_total`, `date_guessed`.

## Updating
- Changes to `index.html` go live by themselves a minute or two after a push.
- Changes to `backend/Code.gs` must be pasted again into script.google.com, then **Deploy > Manage deployments > pencil > Version: New version > Deploy**. The URL stays the same.

## If something is wrong
| Message | What to do |
|---|---|
| The app asks for the URL and token again | Open it from the home screen icon or bookmark made after connecting (the connection is stored in that address). If there is none, paste once more, then add the page to the home screen. |
| "Could not reach the backend" | In Apps Script: Deploy > Manage deployments > pencil. Set "Execute as" to **Me** first (the "Anyone" choice only appears after that), then "Who has access" to **Anyone**, Version: New version, Deploy. |
| "Wrong token" | Paste the TOKEN again in Settings (the gear). It is in Script Properties. |
| "The web app URL did not answer as expected" | The URL must end with `/exec`, and the deployment must be "Who has access: Anyone". |
| "No AI key found" or an API error | Check the key in Script Properties, then run `setup` again to test it. |
| An error mentioning "Timeout" | Try again. If it keeps happening on long receipts, use "Long receipt", or ask Claude to set a faster model (see `CLAUDE.md`). |
| A receipt is badly read | Delete it, rescan in better light or with "Long receipt". |
