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
// What the reader really returned for a photo of a Red Bull can (curved, glossy, held in a hand), two passes.
const RB1 = `| ; supplemented Food Fag:\ninfo-aliment supplémen;, 4\n| per 1 can (250 mL)\n\npour | canette (250 mL) i\n\ncalories 110 % DV Av M\n\n,|rat/Lipides 0 9 by\neR. ml\n\ncarbohydrate / Glucides 27 g =|\n\nSugars / Sucres 27 g 2 lin)\n\nProtein / Protéines 0 5 —| 8\n\n= | Sodium 105 mg TT em\nCalc 208 2% | kes\n\nÀ de pante ctl 5mg 100% "\nmin B127 Vitamine B12 5 vo "°° ;`;
const RB2 = `Per 1 can (250 mL)\nCalories 110\n% DV* / % VQ*\nFat / Lipides 0 g\n0 %\nCarbohydrate / Glucides 27 g\nSugars / Sucres 27 g\n27 %\nProtein / Protéines 0 g\nSodium 105 mg\n4 %\nCalcium 30 mg\n2 %\nNiacin / Niacine 20 mg\n125 %\nPantothenic acid /\nAcide pantothénique 5 mg\n100 %\nVitamin B6 / Vitamine B6 5 mg\n294 %\nVitamin B12 / Vitamine B12 5 pg\n208 %\nCaffeine / Caféine 80 mg\nTaurine 1000 mg`;
t('real can photo: two readings are merged, supplemented vitamins and caffeine are read', () => {
  const one = F.parseLabel(RB1);
  assert.deepStrictEqual(one.vals, { kcal: 110, fat: 0, carbs: 27, sugars: 27, protein: 0, sodium: 105, b12: 5 });
  const r = F.parseLabel([RB1, RB2]);
  assert.deepStrictEqual(r.vals, { kcal: 110, fat: 0, carbs: 27, sugars: 27, protein: 0, sodium: 105, b12: 5, calcium: 30, niacin: 20, pantothenic: 5, b6: 5, caffeine: 80 });
  assert.strictEqual(r.serving, 250); assert.strictEqual(r.unit, 'ml'); assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.per100.caffeine, 32);
  const clash = F.parseLabel(['Calories 110\nSodium 105 mg', 'Calories 110\nSodium 185 mg']);
  assert.strictEqual(clash.vals.sodium, 105); assert.ok(clash.warnings.includes('sodium'));
});
t('pasted block with a name, and a table copied from a web page', () => {
  const r = F.parseLabel('Name: Croissant aux amandes Première Moisson\nPer 1 croissant (175 g)\nCalories 760\nFat 49 g\nSaturated 19 g\nTrans 1.5 g\nCarbohydrate 68 g\nFibre 5 g\nSugars 37 g\nProtein 17 g\nCholesterol 160 mg\nSodium 310 mg');
  assert.strictEqual(r.name, 'Croissant aux amandes Première Moisson'); assert.strictEqual(r.serving, 175); assert.strictEqual(r.servingLabel, '1 croissant');
  assert.deepStrictEqual(r.vals, { kcal: 760, fat: 49, satfat: 19, transfat: 1.5, carbs: 68, fibre: 5, sugars: 37, protein: 17, chol: 160, sodium: 310 });
  assert.deepStrictEqual(r.warnings, []);
  const web = F.parseLabel('Serving size 1 croissant (175 g)\nCalories\t760\nFat\t49 g\t75 %\nCarbohydrate\t68 g\nProtein\t17 g\nSodium\t310 mg\t13 %\nCalcium\t0 mg\t10 %');
  assert.strictEqual(web.vals.kcal, 760); assert.strictEqual(web.vals.fat, 49); assert.strictEqual(web.vals.sodium, 310); assert.strictEqual(web.serving, 175);
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
t('kitchen measures, fractions and piece words', () => {
  assert.deepStrictEqual(F.parseQuick('2 tbsp peanut butter'), { query: 'peanut butter', amount: 30, unit: 'ml' });
  assert.deepStrictEqual(F.parseQuick('½ cup oats'), { query: 'oats', amount: 125, unit: 'ml' });
  assert.deepStrictEqual(F.parseQuick('1 1/2 cups rice'), { query: 'rice', amount: 375, unit: 'ml' });
  assert.deepStrictEqual(F.parseQuick('1 tsp sugar'), { query: 'sugar', amount: 5, unit: 'ml' });
  assert.deepStrictEqual(F.parseQuick('1/2 avocado'), { query: 'avocado', count: 0.5 });
  assert.deepStrictEqual(F.parseQuick('½ avocado'), { query: 'avocado', count: 0.5 });
  assert.deepStrictEqual(F.parseQuick('2 slices bread'), { query: 'bread', count: 2, word: 'slice' });
  assert.deepStrictEqual(F.parseQuick('2 tranches de pain'), { query: 'pain', count: 2, word: 'slice' });
  assert.deepStrictEqual(F.parseQuick('3 large eggs'), { query: 'eggs', count: 3, word: 'large' });
  assert.deepStrictEqual(F.parseQuick('2 large'), { query: 'large', count: 2 });
  assert.strictEqual(F.num('1 1/2'), 1.5); assert.strictEqual(F.num('2,5'), 2.5); assert.strictEqual(F.num('1½'), 1.5);
});
t('a volume typed for a food kept in grams goes through its density', () => {
  const ms = code => CNF.foods.find(x => x[0] === code)[5];
  const oil = F.amountFor({ unit: 'g', measures: ms(422) }, F.parseQuick('2 tbsp olive oil'));
  assert.strictEqual(oil.mi, -1); assert.strictEqual(oil.qty, 27.4); assert.match(oil.note, /30 ml is about 27.4 g/);
  const pb = F.amountFor({ unit: 'g', measures: ms(3309) }, F.parseQuick('2 tbsp peanut butter'));
  assert.strictEqual(pb.qty, 32.7);
  const oats = F.amountFor({ unit: 'g', measures: ms(1464) }, F.parseQuick('1 cup oats'));       // no volume measure: said so, not hidden
  assert.strictEqual(oats.qty, 250); assert.match(oats.note, /no volume measure/);
  const bread = F.amountFor({ unit: 'g', measures: ms(4066) }, F.parseQuick('2 slices bread'));
  assert.strictEqual(ms(4066)[bread.mi][0], '1 slice'); assert.strictEqual(bread.qty, 2);
  const egg = F.amountFor({ unit: 'g', measures: ms(125) }, F.parseQuick('3 small eggs'));
  assert.strictEqual(ms(125)[egg.mi][0], '1 small egg');
  const plain = F.amountFor({ unit: 'g', measures: ms(125) }, F.parseQuick('2 eggs'));
  assert.strictEqual(ms(125)[plain.mi][0], '1 large egg');
  const own = F.amountFor({ unit: 'g', measures: [['1 portion', 390]] }, {}, true);
  assert.deepStrictEqual([own.mi, own.qty], [0, 1]);
  assert.deepStrictEqual(F.amountFor({ unit: 'g', measures: ms(1704) }, {}), { mi: -1, qty: 100, note: '' });
});
t('a recipe with a label food says its vitamins are a minimum, it does not hide it', () => {
  const label = F.servingToPer100({ kcal: 760, protein: 17, fat: 49, carbs: 68 }, 175);     // no vitamin C on a label
  const r = F.recipePer100([{ per100: per100(1704), amount: 500 }, { per100: label, amount: 175 }], 0);
  assert.ok(r.per100.vitc > 0); assert.ok(r.per100._p.includes('vitc')); assert.ok(!r.per100._p.includes('kcal'));
  const portion = F.scale(r.per100, 200); assert.ok(portion._p.includes('vitc'));
  const s = F.sum([portion, F.scale(per100(1704), 100)]);
  assert.strictEqual(s.partial.vitc, 1); assert.strictEqual(s.missing.vitc, 0); assert.strictEqual(s.partial.kcal, 0);
  const nested = F.recipePer100([{ per100: r.per100, amount: 300 }, { per100: per100(125), amount: 100 }], 0);
  assert.ok(nested.per100._p.includes('vitc'));                                             // and it carries into a recipe that uses it
  assert.strictEqual(F.recipePer100([{ per100: per100(1704), amount: 100 }], 0).per100._p, undefined);
});
t('week average counts logged days only; copying a day keeps the values', () => {
  const e = (date, kcal) => ({ id: date + kcal, date, time: '08:00', name: 'x', amount: 100, unit: 'g', nut: F.scale({ kcal, protein: 10 }, 100) });
  const log = [e('2026-11-10', 2000), e('2026-11-10', 500), e('2026-11-12', 1500), e('2026-11-02', 9999)];
  const w = F.weekAverage(log, '2026-11-12');
  assert.strictEqual(w.days, 2); assert.strictEqual(w.avg.kcal, 2000); assert.strictEqual(w.avg.protein, 15);
  let i = 0; const c = F.copyEntries(log.slice(0, 2), '2026-11-13', p => p + (i++));
  assert.deepStrictEqual(c.map(x => [x.id, x.date, x.nut.kcal]), [['e0', '2026-11-13', 2000], ['e1', '2026-11-13', 500]]);
  assert.strictEqual(log[0].date, '2026-11-10');                                            // the originals are untouched
});
t('barcodes match with or without leading zeros', () => {
  assert.strictEqual(F.normCode('0 60383 03552 7'), '60383035527');
  assert.strictEqual(F.normCode('060383035527'), F.normCode('0060383035527'));
  assert.strictEqual(F.normCode('123'), '');
});
console.log(n + ' logic tests passed');
for (const q of (process.env.SHOW || '').split(';').filter(Boolean)) console.log(q, '->', top(q));
