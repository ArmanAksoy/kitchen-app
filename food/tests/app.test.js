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
  assert.deepStrictEqual(errors, []);
  console.log(n + ' app tests passed'); await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
