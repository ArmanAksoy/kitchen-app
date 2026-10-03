/**
 * Tests the pure logic block (const K = ...) of index.html under Node.
 *   node tests/logic.test.js
 */
const assert = require('assert');
const { loadK, sampleReceipt } = require('./helpers');

const K = loadK();
let passed = 0;
const pending = [];
function test(name, fn) {
  const done = () => { passed++; console.log('  ok   ' + name); };
  const fail = e => { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; };
  try { const r = fn(); if (r && r.then) pending.push(r.then(done, fail)); else done(); } catch (e) { fail(e); }
}

console.log('logic');

test('toNumber reads French and English amounts', () => {
  assert.strictEqual(K.toNumber('12,50'), 12.5);
  assert.strictEqual(K.toNumber('1 234,56 $'), 1234.56);
  assert.strictEqual(K.toNumber('1,234.56'), 1234.56);
  assert.strictEqual(K.toNumber('3,00-'), -3);
  assert.strictEqual(K.toNumber(4.2), 4.2);
  assert.strictEqual(K.toNumber(''), null);
  assert.strictEqual(K.toNumber('abc'), null);
  assert.strictEqual(K.toNumber(NaN), null);
});

test('normDate accepts only real, non-future ISO dates', () => {
  assert.strictEqual(K.normDate('2026-10-02', '2026-10-03'), '2026-10-02');
  assert.strictEqual(K.normDate('2026/1/5', '2026-10-03'), '2026-01-05');
  assert.strictEqual(K.normDate('2026-02-30', '2026-10-03'), '');
  assert.strictEqual(K.normDate('2062-10-02', '2026-10-03'), '');
  assert.strictEqual(K.normDate('02/10/2026', '2026-10-03'), '');
  assert.strictEqual(K.normDate('', '2026-10-03'), '');
});

test('normTime returns 24h HH:MM', () => {
  assert.strictEqual(K.normTime('18:07'), '18:07');
  assert.strictEqual(K.normTime('9h05'), '09:05');
  assert.strictEqual(K.normTime('6:07 PM'), '18:07');
  assert.strictEqual(K.normTime('12:10 am'), '00:10');
  assert.strictEqual(K.normTime('18:07:33'), '18:07');
  assert.strictEqual(K.normTime('25:00'), '');
  assert.strictEqual(K.normTime(''), '');
});

test('pack sizes are converted to g, ml or unit', () => {
  assert.deepStrictEqual(K.toBase(2, 'L'), { size: 2000, unit: 'ml' });
  assert.deepStrictEqual(K.toBase('1,5', 'kg'), { size: 1500, unit: 'g' });
  assert.deepStrictEqual(K.toBase(12, 'unit'), { size: 12, unit: 'unit' });
  assert.deepStrictEqual(K.toBase(1, 'lb'), { size: 453.59, unit: 'g' });
  assert.strictEqual(K.toBase(0, 'g'), null);
  assert.strictEqual(K.toBase(5, 'bananas'), null);
  assert.strictEqual(K.toBase(null, null), null);
});

test('parseQuantity reads the free text found in Open Food Facts', () => {
  assert.deepStrictEqual(K.parseQuantity('750 g'), { size: 750, unit: 'g' });
  assert.deepStrictEqual(K.parseQuantity('1,89 L'), { size: 1890, unit: 'ml' });
  assert.deepStrictEqual(K.parseQuantity('12 x 355 mL'), { size: 4260, unit: 'ml' });
  assert.deepStrictEqual(K.parseQuantity('2x125g'), { size: 250, unit: 'g' });
  assert.deepStrictEqual(K.parseQuantity('6 un'), { size: 6, unit: 'unit' });
  assert.deepStrictEqual(K.parseQuantity('3 fromages 250 g'), { size: 250, unit: 'g' });
  assert.deepStrictEqual(K.parseQuantity('100% pur jus 1 L'), { size: 1000, unit: 'ml' });
  assert.strictEqual(K.parseQuantity('family size'), null);
  assert.strictEqual(K.parseQuantity(''), null);
});

test('barcode check digits', () => {
  assert.strictEqual(K.gtinCheck('03600029145'), '2');   // UPC-A 036000291452
  assert.strictEqual(K.gtinCheck('400638133393'), '1');  // EAN-13 4006381333931
  assert.ok(K.gtinValid('036000291452'));
  assert.ok(K.gtinValid('4006381333931'));
  assert.ok(!K.gtinValid('036000291453'));
  assert.ok(!K.gtinValid('12345'));
});

test('upcCandidates rebuilds a barcode printed without its check digit or leading zero', () => {
  assert.deepStrictEqual(K.upcCandidates('036000291452'), ['036000291452']);
  assert.deepStrictEqual(K.upcCandidates('03600029145'), ['036000291452']);          // check digit missing
  assert.deepStrictEqual(K.upcCandidates('36000291452'), ['036000291452', '360002914522']); // leading zero missing
  assert.deepStrictEqual(K.upcCandidates('4011'), []);                                // a PLU is not a barcode
  assert.deepStrictEqual(K.upcCandidates(''), []);
});

test('productKey: barcodes stand alone, short store numbers are tied to the shop', () => {
  assert.strictEqual(K.productKey('Maxi', '06038312345'), '06038312345');
  assert.strictEqual(K.productKey('Costco', '1234567'), 'costco:1234567');
  assert.strictEqual(K.productKey('Marché Jean-Talon', '4011'), 'marche-jean-talon:4011');
  assert.strictEqual(K.productKey('Maxi', ''), '');
  assert.strictEqual(K.productKey('Maxi', '??'), '');
});

test('packFromOff prefers the structured quantity and falls back to the text', () => {
  assert.deepStrictEqual(K.packFromOff({ product_quantity: '540', product_quantity_unit: 'ml', quantity: '540 mL' }), { size: 540, unit: 'ml' });
  assert.deepStrictEqual(K.packFromOff({ product_quantity: 4260, quantity: '12 x 355 ml' }), { size: 4260, unit: 'ml' });
  assert.deepStrictEqual(K.packFromOff({ quantity: '1 kg' }), { size: 1000, unit: 'g' });
  assert.strictEqual(K.packFromOff({ product_name: 'x' }), null);
  assert.strictEqual(K.packFromOff(null), null);
});

test('extractJson tolerates code fences and chatter, and fails clearly on nonsense', () => {
  assert.deepStrictEqual(K.extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepStrictEqual(K.extractJson('Here you go: {"a":{"b":2}} hope it helps'), { a: { b: 2 } });
  assert.throws(() => K.extractJson('sorry, I cannot'), /could not be read/);
  assert.throws(() => K.extractJson('{"a": [1, 2'), /could not be read/);
});

test('normalizeReceipt cleans a normal receipt', () => {
  const rec = K.normalizeReceipt(sampleReceipt(), '2026-10-03');
  assert.strictEqual(rec.shop, 'Maxi');
  assert.strictEqual(rec.date, '2026-10-02');
  assert.strictEqual(rec.time, '18:07');
  assert.strictEqual(rec.lines.length, 8);
  assert.deepStrictEqual(rec.lines[0].pack, { size: 750, unit: 'g' });
  assert.strictEqual(rec.lines[2].unit, 'kg');
  assert.strictEqual(rec.lines[6].total, -2, 'a discount is always negative');
  assert.deepStrictEqual(rec.flags, []);
});

test('normalizeReceipt survives a sloppy answer', () => {
  const rec = K.normalizeReceipt({
    shop: '', date: 'hier', time: 'soir', shop_type: 'bakery', total: '12,00',
    lines: [{ name: 'Pain', total: '4,50', qty: 'deux' }, { raw: 'XX??', total: null }, null, 'junk'],
    taxes: 'none'
  }, '2026-10-03');
  assert.strictEqual(rec.shop, 'Unknown');
  assert.strictEqual(rec.shopType, 'other');
  assert.strictEqual(rec.date, '2026-10-03');
  assert.deepStrictEqual(rec.flags, ['date_guessed']);
  assert.strictEqual(rec.lines.length, 2);
  assert.strictEqual(rec.lines[0].qty, 1);
  assert.strictEqual(rec.lines[0].total, 4.5);
  assert.strictEqual(rec.lines[1].unreadable, true);
  assert.strictEqual(rec.lines[1].name, 'XX??');
  assert.strictEqual(rec.total, 12);
  assert.throws(() => K.normalizeReceipt({ lines: [] }, '2026-10-03'), /No purchase lines/);
  assert.throws(() => K.normalizeReceipt(null, '2026-10-03'), /No purchase lines/);
});

test('resolvePacks: Products tab first, then Open Food Facts, then the receipt text', async () => {
  const rec = K.normalizeReceipt(sampleReceipt(), '2026-10-03');
  const products = new Map([['06038300001', { size: 18, unit: 'unit' }]]); // eggs corrected by hand to 18
  const asked = [];
  const lookup = async cands => {
    asked.push(cands[0]);
    if (cands[0] === '060383664145') return { size: 540, unit: 'ml', name: 'Pois chiches', brand: 'Sans Nom' };
    return null;
  };
  const fresh = await K.resolvePacks(rec, products, lookup, '2026-10-03T10:00:00');
  const by = name => rec.lines.find(l => l.raw.startsWith(name));
  assert.strictEqual(by('PC YOG').packSource, 'receipt');
  assert.deepStrictEqual(by('SN POIS').pack, { size: 540, unit: 'ml' });
  assert.strictEqual(by('SN POIS').packSource, 'openfoodfacts');
  assert.deepStrictEqual(by('OEUFS').pack, { size: 18, unit: 'unit' }, 'a hand correction wins over the receipt text');
  assert.strictEqual(by('ESSUIE').pack, null);
  assert.ok(!asked.includes('4011'), 'weighed items are never looked up');
  assert.ok(!asked.some(a => a.startsWith('060383000')), 'known products are never looked up');
  assert.deepStrictEqual(fresh.map(p => [p.code, p.pack_size, p.pack_unit, p.source]), [
    ['06038312345', 750, 'g', 'receipt'],
    ['06038366414', 540, 'ml', 'openfoodfacts']
  ]);
  assert.strictEqual(fresh[1].name, 'Pois chiches');
});

test('resolvePacks keeps going when every lookup fails', async () => {
  const rec = K.normalizeReceipt(sampleReceipt(), '2026-10-03');
  const fresh = await K.resolvePacks(rec, new Map(), async () => { throw new Error('offline'); }, 'now');
  assert.strictEqual(fresh.length, 2); // yogurt and eggs, from the receipt text
});

test('buildRows: the rows of a receipt add up to what was paid', async () => {
  const rec = K.normalizeReceipt(sampleReceipt(), '2026-10-03');
  await K.resolvePacks(rec, new Map(), async () => null, 'now');
  const b = K.buildRows(rec, '2026-10-03T10:00:00');
  assert.strictEqual(b.rows.length, 10); // 8 lines + 2 taxes
  assert.strictEqual(b.sum, 36.44);
  assert.strictEqual(b.printed, 36.44);
  assert.strictEqual(b.mismatch, false);
  assert.strictEqual(b.items, 6);
  assert.strictEqual(b.receiptId, '20261002-1807-maxi-3644');
  assert.deepStrictEqual(Object.keys(b.rows[0]), K.RECEIPT_COLS);
  const row = n => b.rows.find(r => r.item_raw.startsWith(n));
  assert.strictEqual(row('PC YOG').pack_size, 750);
  assert.strictEqual(row('PC YOG').flag, '');
  assert.strictEqual(row('BANANES').pack_size, '', 'a weighed item has no pack size');
  assert.strictEqual(row('BANANES').flag, '', 'and is not flagged for it');
  assert.strictEqual(row('ESSUIE').flag, 'no_pack_size');
  assert.strictEqual(row('CONSIGNE').type, 'fee');
  assert.strictEqual(row('CONSIGNE').flag, '');
  assert.deepStrictEqual(b.rows.slice(-2).map(r => [r.type, r.item, r.total]), [['tax', 'TPS', 0.35], ['tax', 'TVQ', 0.7]]);
  assert.ok(b.rows.every(r => r.date === '2026-10-02' && r.shop === 'Maxi' && r.added_at === '2026-10-03T10:00:00'));
});

test('buildRows flags a receipt whose lines do not add up, on every row', () => {
  const p = sampleReceipt(); p.total = 40;
  const b = K.buildRows(K.normalizeReceipt(p, '2026-10-03'), 'now');
  assert.strictEqual(b.mismatch, true);
  assert.ok(b.rows.every(r => r.flag.split(',').includes('total_mismatch')));
  assert.strictEqual(b.receiptId, '20261002-1807-maxi-4000');
});

test('buildRows without a printed total or a date still produces a stable id', () => {
  const p = sampleReceipt(); p.total = null; p.date = ''; p.time = '';
  const a = K.buildRows(K.normalizeReceipt(p, '2026-10-03'), 'now');
  const b = K.buildRows(K.normalizeReceipt(p, '2026-10-03'), 'later');
  assert.strictEqual(a.receiptId, '20261003-0000-maxi-3644');
  assert.strictEqual(a.receiptId, b.receiptId);
  assert.ok(a.rows[0].flag.includes('date_guessed') && a.rows[0].flag.includes('no_total'));
});

test('a restaurant bill is not nagged about pack sizes', () => {
  const b = K.buildRows(K.normalizeReceipt({
    shop: 'Chez Lévêque', shop_type: 'restaurant', date: '2026-10-01', time: '20:15', total: 57.49,
    lines: [{ type: 'item', name: 'Steak frites', total: 42 }, { type: 'tip', name: 'Pourboire', total: 9.2 }],
    taxes: [{ name: 'TPS', amount: 2.1 }, { name: 'TVQ', amount: 4.19 }]
  }, '2026-10-03'), 'now');
  assert.ok(b.rows.every(r => r.flag === ''));
  assert.strictEqual(b.receiptId, '20261001-2015-chez-leveque-5749');
});

test('groupReceipts and productsMap read back what the sheet returns', () => {
  const headers = ['receipt_id', 'date', 'time', 'shop', 'type', 'item', 'qty', 'unit', 'total', 'pack_size', 'pack_unit', 'flag'];
  const rows = [
    ['a', '2026-10-01', '09:00', 'Maxi', 'item', 'Lait', 1, 'unit', 4.5, 2000, 'ml', ''],
    ['a', '2026-10-01', '09:00', 'Maxi', 'tax', 'TPS', 1, 'unit', 0.1, '', '', ''],
    ['b', '2026-10-02T00:00:00', '10:00', 'Costco', 'item', 'Riz', 1, 'unit', 20, '', '', 'no_pack_size,total_mismatch']
  ];
  const g = K.groupReceipts(headers, rows);
  assert.deepStrictEqual(g.map(x => [x.id, x.date, x.total, x.items, x.flagged]), [['b', '2026-10-02', 20, 1, true], ['a', '2026-10-01', 4.6, 1, false]]);
  assert.deepStrictEqual(K.groupReceipts([], []), []);
  const m = K.productsMap(['code', 'name', 'pack_size', 'pack_unit'], [['1', 'x', 500, 'g'], ['1', 'x', 1, 'kg'], ['2', 'y', '', 'g']]);
  assert.deepStrictEqual(Array.from(m), [['1', { size: 1000, unit: 'g' }]]);
});

Promise.all(pending).then(() => console.log(passed + ' passed' + (process.exitCode ? ', with failures' : '')));
