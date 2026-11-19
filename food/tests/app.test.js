// Drives the real app in Chromium at phone size. Run: sh food/tests/run.sh
// Needs the playwright-core npm package and a Chromium (CHROMIUM_PATH).
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright-core');
const assert = require('assert'), path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..'), shots = process.env.SHOTS;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.gz': 'application/gzip' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(b); }); });
(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, acceptDownloads: true });
  /* Chrome on Android reads barcodes on the phone (BarcodeDetector); desktop Chromium has no reader, so the test plays it. */
  await ctx.addInitScript(() => { window.BarcodeDetector = class { static async getSupportedFormats() { return ['ean_13', 'upc_a']; }
    async detect() { return window.__barcode ? [{ rawValue: window.__barcode }] : []; } }; });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/Estimating resolution|Detected \d+ diacritics/.test(m.text())) errors.push(m.text()); });   // the reader's own chatter is not an error
  const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: false }); };
  const ok = async sel => { await page.click(sel || '#ok'); await page.waitForSelector('#sheetbg.on', { state: 'detached' }); };
  let n = 0; const step = async (name, fn) => { await fn(); n++; console.log('  ok ' + name); };
  await page.goto(url); await page.waitForSelector('#prev');

  await step('typed entry: 130 g banana', async () => {
    await page.click('#fab'); await page.fill('#q', '130 g banana');
    await page.click('#results li >> nth=0');
    assert.strictEqual(await page.inputValue('#amt'), '130');
    assert.match(await page.textContent('#preview'), /116/);
    await shot('2-amount'); await ok();
    assert.match(await page.textContent('#main'), /Banana, raw/); assert.match(await page.textContent('.big'), /116/);
  });
  await step('counted entry: 2 eggs uses a per-egg measure, not 2 g and not 100', async () => {
    await page.click('#fab'); await page.fill('#q', '2 eggs'); await page.click('#results li >> nth=0');
    assert.strictEqual(await page.inputValue('#amt'), '2');
    assert.match(await page.textContent('#unit option:checked'), /egg/);
    await ok(); assert.match(await page.textContent('#main'), /2 x 1 large egg/);
  });
  await step('label photo is read on the device and saved as a food', async () => {
    await page.click('#fab'); await page.click('#hand');
    await page.setInputFiles('#file', path.join(__dirname, 'label-sample.jpg'));
    await page.waitForFunction(() => /Read \d+ of|No numbers|stopped/.test(document.querySelector('#ocr').textContent), null, { timeout: 120000 });
    console.log('     ' + await page.textContent('#ocr'));
    const got = {}; for (const k of ['kcal', 'fat', 'satfat', 'carbs', 'sugars', 'protein', 'sodium', 'calcium']) got[k] = await page.inputValue('#v_' + k);
    console.log('     ' + JSON.stringify(got) + ' serving ' + await page.inputValue('#serv'));
    assert.strictEqual(got.kcal, '130'); assert.strictEqual(got.protein, '17'); assert.strictEqual(await page.inputValue('#serv'), '175');
    await page.fill('#fname', 'Greek yogurt test'); await shot('3-label'); await page.click('#fsave');
    await page.waitForSelector('#amt'); assert.strictEqual(await page.inputValue('#amt'), '1');     // one serving by default
    await page.click('[data-frac="0.5"]'); assert.strictEqual(await page.inputValue('#amt'), '0.5'); assert.match(await page.textContent('#preview'), /\b65\b/);
    await page.selectOption('#unit', '-1'); assert.strictEqual(await page.inputValue('#amt'), '87.5');    // switching to grams keeps what was eaten
    assert.match(await page.textContent('#amtLabel'), /How much \(g\)/);
    await page.fill('#amt', '200'); await page.selectOption('#unit', '0'); assert.strictEqual(await page.inputValue('#amt'), '1.14');
    await page.fill('#amt', '1'); await shot('3b-quick');
    await ok(); assert.match(await page.textContent('#main'), /Greek yogurt test/);
    assert.match(await page.textContent('#main'), /come from a package label/);
  });
  await step('same name again updates the food instead of duplicating it', async () => {
    await page.click('nav [data-view=foods]'); await page.click('[data-tab=foods]'); await page.click('#hand');
    await page.fill('#fname', 'greek yogurt TEST'); await page.fill('#serv', '100'); await page.fill('#v_kcal', '60'); await page.click('#fsave'); await page.waitForSelector('#over.on', { state: 'detached' });
    assert.match(await page.textContent('.seg'), /Packaged \(1\)/);
  });
  await step('recipe: ingredients by weight, cooked weight, portion', async () => {
    await page.click('[data-tab=recipes]'); await page.click('#newRecipe'); await page.fill('#rname', 'Test mercimek');
    for (const q of ['1300 g ground beef', '2000 g lentils']) { await page.click('#addIng'); await page.fill('#q', q); await page.click('#results li >> nth=0'); await page.waitForSelector('#rname'); }
    assert.strictEqual(await page.inputValue('[data-amt="0"]'), '1300');
    await page.fill('#batch', '3617'); await page.fill('#portion', '390');
    assert.match(await page.textContent('#overBody'), /9\.27 portions/);
    await shot('4-recipe'); await page.click('#rsave'); await page.waitForSelector('#over.on', { state: 'detached' });
    assert.match(await page.textContent('#main'), /Test mercimek/);
    await page.click('nav [data-view=today]'); await page.click('#fab'); await page.fill('#q', 'mercimek'); await page.click('#results li >> nth=0');
    assert.strictEqual(await page.inputValue('#amt'), '1'); assert.match(await page.textContent('#unit option:checked'), /1 portion/);
    await ok(); assert.match(await page.textContent('#main'), /1 x 1 portion \(390 g\)/);
  });
  await step('recent list adds again in one tap; entries can be edited and deleted', async () => {
    await page.click('#fab'); await page.click('[data-again] >> nth=0'); await page.waitForSelector('#over.on', { state: 'detached' });
    assert.strictEqual(await page.locator('[data-entry]').count(), 5);
    await page.click('[data-entry] >> nth=0'); await page.fill('#amt', '200'); await ok();
    await page.click('[data-entry] >> nth=4'); await ok('#del');
    assert.strictEqual(await page.locator('[data-entry]').count(), 4); await shot('1-today');
    await page.evaluate(() => window.scrollTo(0, 900)); await shot('5-nutrients'); await page.evaluate(() => window.scrollTo(0, 0));
  });
  await step('a link opens the food form already filled, and a recipe link the recipe screen', async () => {
    const block = 'Name: Croissant test\nPer 1 croissant (175 g)\nCalories 760\nFat 49 g\nCarbohydrate 68 g\nProtein 17 g\nSodium 310 mg';
    await page.goto(url + '#food=' + encodeURIComponent(block)); await page.waitForSelector('#fname');
    assert.strictEqual(await page.inputValue('#fname'), 'Croissant test'); assert.strictEqual(await page.inputValue('#serv'), '175');
    assert.strictEqual(await page.inputValue('#v_kcal'), '760'); assert.strictEqual(await page.inputValue('#slabel'), '1 croissant');
    assert.ok(!page.url().includes('#'));
    await page.fill('#ptext', 'Calories 500').catch(() => {}); await page.click('#fsave'); await page.waitForSelector('#over.on', { state: 'detached' });
    assert.match(await page.textContent('#main'), /Croissant test/);
    const rec = '{"name":"Linked recipe","batch_g":1000,"portion_g":250,"items":[{"code":125,"g":500},{"name":"croissant test","g":350}]}';
    await page.goto(url + '#recipe=' + encodeURIComponent(rec)); await page.waitForSelector('#rname');
    assert.strictEqual(await page.inputValue('#rname'), 'Linked recipe'); assert.strictEqual(await page.inputValue('[data-amt="1"]'), '350');
    await page.click('#back'); await page.click('nav [data-view=today]');
  });
  await step('favourites and the list of own recipes and foods: found without remembering a name', async () => {
    await page.click('#fab'); await page.click('[data-addtab=mine]');
    const mine = (await page.textContent('#results .card')).toLowerCase();
    for (const name of ['test mercimek', 'greek yogurt test', 'croissant test']) assert.ok(mine.includes(name), name + ' missing from Mine');
    assert.match(await page.textContent('[data-addtab=fav]'), /\(0\)/);
    await page.click('#results li:has-text("Test mercimek") [data-star]');
    await page.waitForFunction(() => /\(1\)/.test(document.querySelector('[data-addtab=fav]').textContent));
    await page.click('#back'); await page.click('#fab');                      // favourites now open first
    assert.match(await page.textContent('#results .card'), /Test mercimek.*1 x 1 portion \(390 g\)/);
    const before = await page.locator('[data-entry]').count();
    await page.click('#results [data-again] >> nth=0'); await page.waitForSelector('#over.on', { state: 'detached' });
    assert.strictEqual(await page.locator('[data-entry]').count(), before + 1);
    await page.click('[data-entry] >> nth=0'); assert.ok(await page.locator('#favBtn').count() === 1);
    await page.click('#sheetbg', { position: { x: 5, y: 5 } }); await page.waitForSelector('#sheetbg.on', { state: 'detached' });
    await page.click('[data-entry]:has-text("Test mercimek") >> nth=0'); await ok('#del');
  });
  await step('whole package: one tap logs the package, not the label serving', async () => {
    await page.click('nav [data-view=foods]'); await page.click('[data-tab=foods]'); await page.click('[data-food]:has-text("Croissant test")');
    await page.fill('#fpack', '525'); await page.click('#fsave'); await page.waitForSelector('#over.on', { state: 'detached' });
    await page.click('nav [data-view=today]'); const before = await page.locator('[data-entry]').count();
    await page.click('#fab'); await page.fill('#q', 'croissant test'); await page.click('#results li >> nth=0');
    await page.click('#chips button:has-text("Whole package")'); assert.match(await page.textContent('#preview'), /2280/);
    await ok(); assert.match(await page.textContent('#main'), /1 x whole package \(525 g\)/);
    await page.click('[data-entry]:has-text("whole package")'); assert.match(await page.textContent('#unit option:checked'), /whole package/); await ok('#del');
    assert.strictEqual(await page.locator('[data-entry]').count(), before);
  });
  let backup;
  await step('spreadsheet and backup files download; data survives a reload', async () => {
    await page.click('nav [data-view=more]'); await shot('6-more');
    let [d] = await Promise.all([page.waitForEvent('download'), page.click('#xlsx')]);
    const x = await d.path(); assert.ok(fs.statSync(x).size > 3000); if (process.env.KEEP) fs.copyFileSync(x, path.join(process.env.KEEP, 'export.xlsx'));
    [d] = await Promise.all([page.waitForEvent('download'), page.click('#backup')]); backup = path.join(require('os').tmpdir(), 'foodlog-backup-test.json'); await d.saveAs(backup);
    await page.reload(); await page.waitForSelector('#prev'); assert.strictEqual(await page.locator('[data-entry]').count(), 4);
  });
  await step('a backup restores everything into an empty app', async () => {
    await page.evaluate(() => new Promise(ok => { indexedDB.databases().then(async () => { const r = indexedDB.open('foodlog'); r.onsuccess = () => { const tx = r.result.transaction(['foods', 'recipes', 'log', 'kv'], 'readwrite'); for (const s of ['foods', 'recipes', 'log', 'kv']) tx.objectStore(s).clear(); tx.oncomplete = ok; }; }); }));
    await page.reload(); await page.waitForSelector('#prev'); assert.strictEqual(await page.locator('[data-entry]').count(), 0);
    await page.click('nav [data-view=more]'); await page.setInputFiles('#rfile', backup); await page.waitForFunction(() => /4 entries/.test(document.querySelector('#main').textContent));
    await page.setInputFiles('#rfile', path.join(__dirname, 'app.test.js')); await page.waitForFunction(() => /Not restored/.test(document.querySelector('#toast').textContent));
    await page.click('nav [data-view=today]'); assert.strictEqual(await page.locator('[data-entry]').count(), 4);
  });
  await step('kitchen measures: 2 tbsp of oil is weighed through its density, 2 slices picks the slice', async () => {
    await page.click('#fab'); await page.fill('#q', '2 tbsp olive oil'); await page.click('#results li:has-text("olive")');
    assert.strictEqual(await page.inputValue('#amt'), '27.4'); assert.match(await page.textContent('#conv'), /30 ml is about 27.4 g/);
    await shot('7-tbsp'); await page.click('#sheetbg', { position: { x: 5, y: 5 } });
    await page.fill('#q', '2 slices white bread'); await page.click('#results li >> nth=0');
    assert.strictEqual(await page.inputValue('#amt'), '2'); assert.match(await page.textContent('#unit option:checked'), /1 slice/);
    await page.click('#sheetbg', { position: { x: 5, y: 5 } }); await page.click('#back');
  });
  await step('copy a day to today, and log one past entry again today', async () => {
    const today = await page.locator('[data-entry]').count();
    await page.click('#prev'); assert.strictEqual(await page.locator('#copyDay').count(), 0);
    await page.click('#fab'); await page.fill('#q', '2 eggs'); await page.click('#results li >> nth=0'); await ok();
    assert.match(await page.textContent('h1'), /Yesterday/);
    await page.click('#fab'); await page.fill('#q', '130 g banana'); await page.click('#results li >> nth=0'); await ok();
    assert.match(await page.textContent('#copyDay'), /Copy this day to today.*2 items/); await shot('8-copy');
    await page.click('#copyDay'); await page.waitForFunction(() => document.querySelector('h1').textContent === 'Today');
    assert.strictEqual(await page.locator('[data-entry]').count(), today + 2);
    await page.click('#prev'); await page.click('[data-entry]:has-text("Egg")'); await ok('#again');
    assert.match(await page.textContent('h1'), /Today/); assert.strictEqual(await page.locator('[data-entry]').count(), today + 3);
    assert.match(await page.textContent('.card'), /7-day average: <?b?>?\d+|7-day average: \d+/);
    /* An empty today offers the last day that has entries. */
    await page.evaluate(() => { S.today = F.addDays(S.today, 1); S.date = S.today; render(); });
    assert.match(await page.textContent('#copyDay'), /Copy .*items/);
    await page.evaluate(() => { S.today = F.addDays(S.today, -1); S.date = S.today; render(); });
  });
  await step('an app left open overnight moves to the new day by itself', async () => {
    await page.evaluate(() => { S.today = F.addDays(S.today, -1); S.date = S.today; render(); });
    assert.strictEqual(await page.textContent('h1'), 'Yesterday');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.strictEqual(await page.textContent('h1'), 'Today');
  });
  await step('barcode: an unknown one opens a new food with it, a known one goes straight to the amount', async () => {
    await page.evaluate(() => { window.__barcode = '0060383035527'; });
    await page.click('#fab'); await page.setInputFiles('#bfile', path.join(__dirname, 'label-sample.jpg'));
    await page.waitForSelector('#fcode'); assert.strictEqual(await page.inputValue('#fcode'), '60383035527');
    await page.fill('#fname', 'Barcode test'); await page.fill('#serv', '100'); await page.fill('#v_kcal', '200'); await page.fill('#v_protein', '10');
    await shot('9-barcode-form'); await page.click('#fsave'); await page.waitForSelector('#amt'); await ok();
    await page.evaluate(() => { window.__barcode = '060383035527'; });                    // same product, printed as 12 digits
    await page.click('#fab'); await page.setInputFiles('#bfile', path.join(__dirname, 'label-sample.jpg'));
    await page.waitForSelector('#amt'); assert.match(await page.textContent('#sheet h1'), /Barcode test/);
    await page.click('#sheetbg', { position: { x: 5, y: 5 } });
    await page.fill('#q', '60383035527'); assert.match(await page.textContent('#results'), /Barcode test/);      // typing the digits finds it too
    await page.click('#back');
    await page.evaluate(() => { window.__barcode = ''; });
    await page.click('#fab'); await page.setInputFiles('#bfile', path.join(__dirname, 'label-sample.jpg'));
    await page.waitForFunction(() => /No barcode found/.test(document.querySelector('#toast').textContent)); await page.click('#back');
  });
  await step('editing a diary line keeps the values it was logged with, even after the food changed', async () => {
    await page.click('nav [data-view=foods]'); await page.click('[data-tab=foods]'); await page.click('[data-food]:has-text("Barcode test")');
    await page.fill('#v_kcal', '400'); await page.click('#fsave'); await page.waitForSelector('#over.on', { state: 'detached' });
    assert.match(await page.textContent('[data-tab=foods]'), /Packaged \(3\)/);             // same barcode and name: updated, not duplicated
    await page.click('nav [data-view=today]'); await page.click('[data-entry]:has-text("Barcode test")');
    await page.fill('#amt', '2'); assert.match(await page.textContent('#preview'), /^\s*400/);
    await page.click('#sheetbg', { position: { x: 5, y: 5 } });
  });
  await step('restoring an old backup never erases newer entries', async () => {
    const before = await page.locator('[data-entry]').count();
    await page.click('nav [data-view=more]'); await page.setInputFiles('#rfile', backup);
    await page.waitForFunction(() => /Restored\. 0 entries added/.test(document.querySelector('#toast').textContent));
    await page.click('nav [data-view=today]'); assert.strictEqual(await page.locator('[data-entry]').count(), before);
    await shot('1b-today');
  });
  assert.deepStrictEqual(errors, []);
  console.log(n + ' app tests passed'); await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
