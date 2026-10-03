/**
 * End to end, in a real browser at phone size, with nothing real behind it:
 *   index.html  ->  the real backend/Code.gs (running on fake Google services)
 *               ->  a canned AI answer and a canned Open Food Facts answer
 *
 *   NODE_PATH=$(npm root -g) node tests/app.test.js          (needs the "playwright" package)
 *   add --shots to also write screenshots into the system temp folder (kitchen-app-shots)
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { loadBackend } = require('./fake-google');
const { sampleReceipt } = require('./helpers');

const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = path.join(os.tmpdir(), 'kitchen-app-shots');
const BACKEND_URL = 'https://script.google.com/macros/s/TEST/exec';
// A 2x2 white PNG: enough for the app to treat it as a photo.
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8z4AATAxEcQAz0QEHOoQ+uAAAAABJRU5ErkJggg==', 'base64');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.message || e).split('\n').join('\n       ')); process.exitCode = 1; }
}

(async () => {
  console.log('app');

  // What the fake AI answers next. Tests change this.
  let aiAnswer = JSON.stringify(sampleReceipt());
  const backend = loadBackend({
    props: { GEMINI_API_KEY: 'g-key' },
    fetch: () => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: aiAnswer }] } }] } })
  });
  backend.gs.setup();
  const token = backend.props.TOKEN;
  const book = backend.books[backend.props.SHEET_ID];
  const receipts = () => (book.getSheetByName('Receipts') ? book.getSheetByName('Receipts').records() : []);
  const products = () => (book.getSheetByName('Products') ? book.getSheetByName('Products').records() : []);

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-CA' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  const sentToBackend = [];
  await page.route(BACKEND_URL, async route => {
    const req = route.request();
    assert.strictEqual(req.headers()['content-type'], 'text/plain;charset=utf-8', 'must stay a CORS-simple request');
    const body = JSON.parse(req.postData());
    sentToBackend.push(body);
    const out = backend.gs.doPost({ postData: { contents: req.postData() } });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.text });
  });
  const offAsked = [];
  await page.route('https://world.openfoodfacts.org/**', async route => {
    const code = route.request().url().match(/product\/(\d+)\.json/)[1];
    offAsked.push(code);
    const hit = code === '060383664145'
      ? { status: 1, product: { product_name_fr: 'Pois chiches', brands: 'Sans Nom', quantity: '540 mL', product_quantity: '540', product_quantity_unit: 'ml' } }
      : { status: 0 };
    await route.fulfill({ status: hit.status ? 200 : 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(hit) });
  });
  await page.route('**/favicon.ico', r => r.fulfill({ status: 204, body: '' }));

  const shot = async name => { if (SHOTS) { fs.mkdirSync(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, name + '.png'), fullPage: true }); } };
  const scanPhoto = async () => {
    await page.setInputFiles('#fileCam', { name: 'receipt.png', mimeType: 'image/png', buffer: PHOTO });
    await page.waitForSelector('#status', { state: 'hidden' });
  };

  await test('first visit opens Settings, and a wrong token is explained', async () => {
    await page.goto(base);
    assert.ok(await page.isVisible('#settings'));
    await shot('1-first-run');
    await page.fill('#cfgUrl', BACKEND_URL);
    await page.fill('#cfgToken', 'wrong');
    await page.click('#btnSaveCfg');
    await page.waitForSelector('#cfgMsg.bad');
    assert.ok((await page.textContent('#cfgMsg')).includes('Wrong token'));
  });

  await test('the right token connects and shows the sheet link', async () => {
    await page.fill('#cfgToken', token);
    await page.click('#btnSaveCfg');
    await page.waitForSelector('#cfgMsg.good:has-text("Connected")');
    assert.ok((await page.getAttribute('#lnkSheet', 'href')).includes('docs.google.com/spreadsheets'));
    await shot('2-connected');
    await page.click('#btnCloseCfg');
  });

  await test('one photo in, every line saved, nothing to confirm', async () => {
    await scanPhoto();
    await page.waitForSelector('#result .note.good');
    const rows = receipts();
    assert.strictEqual(rows.length, 10);
    assert.strictEqual(rows[0].receipt_id, '20261002-1807-maxi-3644');
    assert.strictEqual(rows[0].date, '2026-10-02');
    assert.strictEqual(rows[0].code, '06038312345');
    assert.strictEqual(rows[1].pack_size, 540, 'pack size found by barcode');
    assert.strictEqual(rows[1].pack_unit, 'ml');
    assert.strictEqual(Math.round(rows.reduce((a, r) => a + r.total, 0) * 100), 3644);
    assert.deepStrictEqual(products().map(p => [p.code, p.pack_size, p.pack_unit, p.source]), [
      ['06038312345', 750, 'g', 'receipt'], ['06038366414', 540, 'ml', 'openfoodfacts'], ['06038300001', 12, 'unit', 'receipt']
    ]);
    const ai = sentToBackend.find(b => b.action === 'ai');
    assert.strictEqual(ai.images.length, 1);
    assert.strictEqual(ai.images[0].mimeType, 'image/jpeg');
    assert.ok(ai.images[0].data.length > 100 && !ai.images[0].data.startsWith('data:'));
    assert.ok((await page.textContent('#result')).includes('36,44'));
    await shot('3-saved');
  });

  await test('the photo is not kept: nothing image-like is in browser storage', async () => {
    const stored = await page.evaluate(() => Object.keys(localStorage).map(k => [k, localStorage.getItem(k).length]));
    assert.deepStrictEqual(stored.map(s => s[0]).sort(), ['kitchen.probe', 'kitchen.savedAt', 'kitchen.sheetUrl', 'kitchen.token', 'kitchen.url']);
    assert.ok(stored.every(s => s[1] < 300));
  });

  await test('scanning the same receipt again adds nothing', async () => {
    await scanPhoto();
    await page.waitForSelector('#message .note.warn');
    assert.ok((await page.textContent('#message')).includes('already in the sheet'));
    assert.strictEqual(receipts().length, 10);
    assert.strictEqual(products().length, 3);
  });

  await test('a known product is not looked up again', async () => {
    const before = offAsked.length;
    const p = sampleReceipt(); p.time = '19:30'; aiAnswer = JSON.stringify(p);
    await scanPhoto();
    await page.waitForSelector('#result .note.good');
    assert.strictEqual(receipts().length, 20);
    assert.deepStrictEqual(offAsked.slice(before), ['060383888886'], 'only the still unknown paper towels');
    assert.strictEqual(products().length, 3);
  });

  await test('lines that do not add up are saved anyway, flagged, and say so', async () => {
    const p = sampleReceipt(); p.date = '2026-09-28'; p.total = 41.1; p.lines[1].unreadable = true; aiAnswer = JSON.stringify(p);
    await scanPhoto();
    await page.waitForSelector('#result .note.warn');
    const mine = receipts().filter(r => r.receipt_id === '20260928-1807-maxi-4110');
    assert.strictEqual(mine.length, 10);
    assert.ok(mine.every(r => r.flag.includes('total_mismatch')));
    assert.ok(mine[1].flag.includes('unreadable'));
    assert.ok((await page.textContent('#result')).includes('hard to read'));
    await shot('4-flagged');
  });

  await test('an unusable AI answer saves nothing and gives a plain message', async () => {
    aiAnswer = 'I am sorry, this image is too blurry.';
    const before = receipts().length;
    await scanPhoto();
    await page.waitForSelector('#message .note.bad');
    assert.ok((await page.textContent('#message')).includes('could not be read'));
    assert.strictEqual(receipts().length, before);
  });

  await test('long receipt: several photos go out as one request', async () => {
    const p = sampleReceipt(); p.date = '2026-09-20'; aiAnswer = JSON.stringify(p);
    await page.click('#btnLong');
    assert.ok(await page.isDisabled('#btnMultiDone'));
    for (let i = 0; i < 3; i++) await page.setInputFiles('#fileCam', { name: 'part' + i + '.png', mimeType: 'image/png', buffer: PHOTO });
    assert.ok((await page.textContent('#multiCount')).includes('3 photos'));
    await shot('5-long-receipt');
    const before = sentToBackend.filter(b => b.action === 'ai').length;
    await page.click('#btnMultiDone');
    await page.waitForSelector('#result .note.good');
    const calls = sentToBackend.filter(b => b.action === 'ai');
    assert.strictEqual(calls.length, before + 1);
    assert.strictEqual(calls[calls.length - 1].images.length, 3);
    assert.ok(await page.isVisible('#btnScan'), 'back to the normal screen');
  });

  await test('the last scanned receipts are listed, newest entry first, and one can be deleted', async () => {
    await page.reload();
    await page.waitForSelector('#recent details');
    assert.ok(!(await page.isVisible('#settings')), 'settings were remembered');
    const titles = await page.$$eval('#recent details summary', els => els.map(e => e.textContent));
    assert.strictEqual(titles.length, 4);
    assert.ok(titles[0].includes('2026-09-20') && titles[3].includes('18:07'));
    assert.ok(titles[1].includes('flagged'));
    await page.click('#recent details:nth-of-type(2) summary');
    await shot('6-recent');
    page.once('dialog', d => d.accept());
    await page.click('#recent details:nth-of-type(2) button.danger');
    await page.waitForSelector('#message .note.good');
    assert.strictEqual(receipts().filter(r => r.receipt_id === '20260928-1807-maxi-4110').length, 0);
    assert.strictEqual(receipts().length, 30);
    await page.waitForFunction(() => document.querySelectorAll('#recent details').length === 3);
  });

  const decodeHash = url => JSON.parse(Buffer.from(new URL(url).hash.replace('#c=', ''), 'base64url').toString());
  const routeBackend = p => p.route(BACKEND_URL, async route => {
    const out = backend.gs.doPost({ postData: { contents: route.request().postData() } });
    await route.fulfill({ status: 200, contentType: 'application/json', body: out.text });
  });

  await test('once connected, the page address itself carries the connection', async () => {
    const c = decodeHash(page.url());
    assert.strictEqual(c.u, BACKEND_URL);
    assert.strictEqual(c.t, token);
    assert.ok(c.s > 0);
  });

  await test('a browser that forgets its storage stays connected when opened from the bookmark', async () => {
    const bookmark = page.url();
    await page.evaluate(() => localStorage.clear());
    await page.goto('about:blank');
    await page.goto(bookmark);
    await page.waitForSelector('#recent details');
    assert.ok(!(await page.isVisible('#settings')), 'no need to paste anything again');
    assert.strictEqual(decodeHash(page.url()).t, token);
  });

  await test('a link opened on a brand new device connects it, and that device can be bookmarked too', async () => {
    const link = base + '#c=' + Buffer.from(JSON.stringify({ u: BACKEND_URL, t: token })).toString('base64url');
    const other = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const p2 = await other.newPage();
    await routeBackend(p2);
    await p2.goto(link);
    await p2.waitForSelector('#recent details');
    assert.ok(!(await p2.isVisible('#settings')));
    assert.strictEqual(decodeHash(p2.url()).t, token, 'the address keeps the connection');
    if (SHOTS) await p2.screenshot({ path: path.join(SHOT_DIR, '7-dark.png'), fullPage: true });
    await other.close();
  });

  await test('an old bookmark does not undo newer settings saved on the same device', async () => {
    const stale = base + '#c=' + Buffer.from(JSON.stringify({ u: BACKEND_URL, t: 'old-token', s: 5 })).toString('base64url');
    await page.goto('about:blank');
    await page.goto(stale);
    await page.waitForSelector('#recent details');
    assert.strictEqual(decodeHash(page.url()).t, token, 'the newer saved token wins and replaces the stale one in the address');
  });

  await test('without any connection, a wrong deployment setting is named in the error', async () => {
    const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p3 = await other.newPage();
    await p3.route(BACKEND_URL, r => r.abort('failed')); // what the browser does when Google answers with its sign-in page
    await p3.goto(base);
    await p3.fill('#cfgUrl', BACKEND_URL);
    await p3.fill('#cfgToken', token);
    await p3.click('#btnSaveCfg');
    await p3.waitForSelector('#cfgMsg.bad');
    assert.ok((await p3.textContent('#cfgMsg')).includes('Who has access: Anyone'));
    await other.close();
  });

  await test('a dead backend URL is explained, not a blank screen', async () => {
    await page.route(BACKEND_URL, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>Sign in</html>' }));
    await scanPhoto();
    await page.waitForSelector('#message .note.bad');
    assert.ok((await page.textContent('#message')).includes('did not answer as expected'));
  });

  await test('no JavaScript error was thrown on the page', async () => { assert.deepStrictEqual(pageErrors, []); });

  await browser.close();
  server.close();
  console.log(passed + ' passed' + (process.exitCode ? ', with failures' : ''));
})().catch(e => { console.error(e); process.exit(1); });
