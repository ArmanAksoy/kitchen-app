// Run: node food/tests/logic.test.js
const assert = require('assert');
const path = require('path'), fs = require('fs');
const F = require('../logic.js');
const window = {}; eval(fs.readFileSync(path.join(__dirname, '../cnf.js'), 'utf8'));
const CNF = window.CNF;
let n = 0; const t = (name, fn) => { fn(); n++; };
const per100 = code => { const f = CNF.foods.find(x => x[0] === code); const o = {}; CNF.keys.forEach((k, i) => o[k] = f[4][i]); return o; };
const index = CNF.foods.map(f => F.indexItem({ ref: { t: 'c', id: f[0] }, name: f[1], alt: f[2], group: f[3] }));
const top = (q, uses) => F.search(index, q, uses || {}, 5).map(i => i.name);

t('database keys match the nutrient list', () => assert.deepStrictEqual(CNF.keys.slice().sort(), F.KEYS.slice().sort()));
t('quick entry forms', () => {
  assert.deepStrictEqual(F.parseQuick('130 g banana'), { query: 'banana', amount: 130, unit: 'g' });
  assert.deepStrictEqual(F.parseQuick('130gr of banana'), { query: 'banana', amount: 130, unit: 'g' });
  assert.deepStrictEqual(F.parseQuick('banana 130g'), { query: 'banana', amount: 130, unit: 'g' });
  assert.deepStrictEqual(F.parseQuick('1,5 kg poulet'), { query: 'poulet', amount: 1500, unit: 'g' });
  assert.deepStrictEqual(F.parseQuick('250 ml milk'), { query: 'milk', amount: 250, unit: 'ml' });
  assert.deepStrictEqual(F.parseQuick('2 eggs'), { query: 'eggs', count: 2 });
  assert.deepStrictEqual(F.parseQuick('2% milk'), { query: '2% milk' });
  assert.deepStrictEqual(F.parseQuick('shawarma'), { query: 'shawarma' });
});
t('search finds the plain food first', () => {
  assert.strictEqual(top('banana')[0], 'Banana, raw');
  assert.ok(top('banane')[0].startsWith('Banana'));
  assert.ok(top('bananas')[0].startsWith('Banana'));
  for (const q of ['egg', 'chicken breast', 'rice', 'olive oil', 'oats', 'lentils', 'ground beef', 'poulet', 'pizza', 'poutine', 'hamburger', 'almond milk', 'greek yogurt', 'cheddar'])
    assert.ok(top(q).length > 0, 'no result for ' + q);
});
t('often-used items come first', () => {
  const second = top('rice')[3]; const it = index.find(i => i.name === second);
  assert.strictEqual(top('rice', { ['c:' + it.ref.id]: 9 })[0], second);
});
t('130 g of banana', () => {
  const b = F.scale(per100(1704), 130);
  assert.strictEqual(Math.round(b.kcal), 116); assert.ok(b.potassium > 400 && b.potassium < 500); assert.ok(b.vitc > 5);
});
t('unknown is not zero', () => {
  const s = F.sum([F.scale({ kcal: 100, protein: 5 }, 100), F.scale(per100(1704), 100)]);
  assert.strictEqual(Math.round(s.total.kcal), 189); assert.strictEqual(s.missing.kcal, 0); assert.strictEqual(s.missing.vitc, 1);
});
t('recipe by cooked weight (mercimek case: 3617 g batch, 390 g portions)', () => {
  const items = [{ per100: { kcal: 250, protein: 20 }, amount: 1300 }, { per100: { kcal: 100, protein: 7 }, amount: 2000 }];
  const r = F.recipePer100(items, 3617);
  const portion = F.scale(r.per100, 390);
  assert.strictEqual(Math.round(portion.kcal), Math.round((3250 + 2000) / 3617 * 390));
  assert.strictEqual(r.per100.vitc, null);
  assert.strictEqual(F.recipePer100(items, 0).weight, 3300);
  // logging the whole batch gives back exactly what went in, never more
  assert.strictEqual(Math.round(F.scale(r.per100, 3617).kcal), 5250);
});
const LABEL = `Nutrition Facts
Valeur nutritive
Per 2 cookies (30 g) / pour 2 biscuits (30 g)
Amount % Daily Value
Teneur % valeur quotidienne
Calories 140 % Daily Value* / % valeur quotidienne*
Fat / Lipides 6 g 9 %
Saturated / saturés 2,5 g
+ Trans / trans 0 g 13 %
Cholesterol / Cholestérol 5 mg
Sodium / Sodium 95 mg 4 %
Carbohydrate / Glucides 20 g 7 %
Fibre / Fibres 1 g 4 %
Sugars / Sucres 9 g
Protein / Protéines 2 g
Potassium 50 mg 1 %
Calcium 20 mg 2 %
Iron / Fer 0.75 mg 4 %`;
t('bilingual label', () => {
  const r = F.parseLabel(LABEL);
  assert.deepStrictEqual(r.vals, { kcal: 140, fat: 6, satfat: 2.5, transfat: 0, chol: 5, sodium: 95, carbs: 20, fibre: 1, sugars: 9, protein: 2, potassium: 50, calcium: 20, iron: 0.75 });
  assert.strictEqual(r.serving, 30); assert.strictEqual(r.unit, 'g'); assert.strictEqual(r.servingLabel, '2 cookies');
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(Math.round(r.per100.kcal), 467); assert.strictEqual(r.per100.vitc, null);
});
t('french label in ml, old style minerals in % only, O read for 0', () => {
  const r = F.parseLabel('Valeur nutritive\npour 1 tasse (250 mL)\nCalories 130\nLipides 5 g 8 %\nsaturés 3 g\n+ trans O g\nGlucides 12 g\nSucres 12 g\nProtéines 9 g\nSodium 120 mg\nCalcium 30 %\nFer 0 %');
  assert.strictEqual(r.unit, 'ml'); assert.strictEqual(r.serving, 250);
  assert.strictEqual(r.vals.fat, 5); assert.strictEqual(r.vals.transfat, 0); assert.strictEqual(r.vals.calcium, undefined);
  assert.strictEqual(r.per100.kcal, 52);
});
t('US style and warnings', () => {
  const r = F.parseLabel('Calories 500\nTotal Fat 2 g\nSaturated Fat 1 g\nTotal Carbohydrate 10 g\nProtein 3 g');
  assert.strictEqual(r.vals.fat, 2); assert.strictEqual(r.vals.satfat, 1);
  assert.ok(r.warnings.includes('energy') && r.warnings.includes('serving')); assert.strictEqual(r.per100, null);
  assert.strictEqual(F.parseLabel('').found, 0);
});
t('spreadsheet file', () => {
  const log = [{ date: '2026-11-11', time: '08:10', name: 'Banana, raw', amount: 130, unit: 'g', source: 'cnf', nut: F.scale(per100(1704), 130) },
               { date: '2026-11-11', time: '12:00', name: 'Biscuits "é" <x>', amount: 30, unit: 'g', source: 'label', nut: F.scale({ kcal: 467 }, 30) }];
  const day = F.dayTable(log);
  assert.strictEqual(day.length, 2); assert.strictEqual(Math.round(day[1][2]), 256);
  const bytes = F.xlsx([{ name: 'Log', rows: F.logTable(log) }, { name: 'Days', rows: day }]);
  assert.ok(bytes.length > 1000 && bytes[0] === 0x50 && bytes[1] === 0x4B);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], bytes);
});
t('dates', () => { assert.strictEqual(F.addDays('2026-11-01', -1), '2026-10-31'); assert.strictEqual(F.addDays('2026-12-31', 1), '2027-01-01'); });
console.log(n + ' logic tests passed');
for (const q of (process.env.SHOW || '').split(';').filter(Boolean)) console.log(q, '->', top(q));
