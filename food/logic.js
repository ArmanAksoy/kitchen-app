/* Food log: pure logic. No DOM, no storage, no network.
   Loaded by index.html as a plain script (global F) and by the tests under Node. */
const F = (() => {
  'use strict';

  /* Every nutrient the app knows. `key` matches the keys in cnf.js.
     target = daily goal, max = daily ceiling (bar turns red above it). Defaults are
     general adult reference values; the owner edits them on the More screen. */
  const NUTRIENTS = [
    { key: 'kcal', name: 'Energy', unit: 'kcal', group: 'main', target: 2000 },
    { key: 'protein', name: 'Protein', unit: 'g', group: 'main', target: 120 },
    { key: 'carbs', name: 'Carbs', unit: 'g', group: 'main', target: 225 },
    { key: 'fat', name: 'Fat', unit: 'g', group: 'main', target: 70 },
    { key: 'fibre', name: 'Fibre', unit: 'g', group: 'detail', target: 38 },
    { key: 'sugars', name: 'Sugars', unit: 'g', group: 'detail' },
    { key: 'satfat', name: 'Saturated fat', unit: 'g', group: 'detail', max: 22 },
    { key: 'transfat', name: 'Trans fat', unit: 'g', group: 'detail' },
    { key: 'monofat', name: 'Monounsaturated fat', unit: 'g', group: 'detail' },
    { key: 'polyfat', name: 'Polyunsaturated fat', unit: 'g', group: 'detail' },
    { key: 'chol', name: 'Cholesterol', unit: 'mg', group: 'detail' },
    { key: 'sodium', name: 'Sodium', unit: 'mg', group: 'mineral', max: 2300 },
    { key: 'potassium', name: 'Potassium', unit: 'mg', group: 'mineral', target: 3400 },
    { key: 'calcium', name: 'Calcium', unit: 'mg', group: 'mineral', target: 1000 },
    { key: 'iron', name: 'Iron', unit: 'mg', group: 'mineral', target: 8 },
    { key: 'magnesium', name: 'Magnesium', unit: 'mg', group: 'mineral', target: 420 },
    { key: 'phosphorus', name: 'Phosphorus', unit: 'mg', group: 'mineral', target: 700 },
    { key: 'zinc', name: 'Zinc', unit: 'mg', group: 'mineral', target: 11 },
    { key: 'copper', name: 'Copper', unit: 'mg', group: 'mineral', target: 0.9 },
    { key: 'manganese', name: 'Manganese', unit: 'mg', group: 'mineral', target: 2.3 },
    { key: 'selenium', name: 'Selenium', unit: 'µg', group: 'mineral', target: 55 },
    { key: 'vita', name: 'Vitamin A', unit: 'µg', group: 'vitamin', target: 900 },
    { key: 'vitc', name: 'Vitamin C', unit: 'mg', group: 'vitamin', target: 90 },
    { key: 'vitd', name: 'Vitamin D', unit: 'µg', group: 'vitamin', target: 15 },
    { key: 'vite', name: 'Vitamin E', unit: 'mg', group: 'vitamin', target: 15 },
    { key: 'vitk', name: 'Vitamin K', unit: 'µg', group: 'vitamin', target: 120 },
    { key: 'thiamin', name: 'B1 Thiamine', unit: 'mg', group: 'vitamin', target: 1.2 },
    { key: 'riboflavin', name: 'B2 Riboflavin', unit: 'mg', group: 'vitamin', target: 1.3 },
    { key: 'niacin', name: 'B3 Niacin', unit: 'mg', group: 'vitamin', target: 16 },
    { key: 'pantothenic', name: 'B5 Pantothenic acid', unit: 'mg', group: 'vitamin', target: 5 },
    { key: 'b6', name: 'B6', unit: 'mg', group: 'vitamin', target: 1.3 },
    { key: 'folate', name: 'Folate', unit: 'µg', group: 'vitamin', target: 400 },
    { key: 'b12', name: 'B12', unit: 'µg', group: 'vitamin', target: 2.4 },
    { key: 'choline', name: 'Choline', unit: 'mg', group: 'vitamin', target: 550 },
    { key: 'caffeine', name: 'Caffeine', unit: 'mg', group: 'other' },
    { key: 'alcohol', name: 'Alcohol', unit: 'g', group: 'other' },
    { key: 'water', name: 'Water', unit: 'g', group: 'other' }
  ];
  const KEYS = NUTRIENTS.map(n => n.key);
  /* What a Canadian Nutrition Facts table can give us. */
  const LABEL_KEYS = ['kcal', 'fat', 'satfat', 'transfat', 'carbs', 'fibre', 'sugars', 'protein',
    'chol', 'sodium', 'potassium', 'calcium', 'iron'];
  /* Printed only on "Supplemented Food Facts" tables (energy drinks, fortified foods). */
  const EXTRA_LABEL_KEYS = ['niacin', 'pantothenic', 'b6', 'b12', 'caffeine'];

  /* ---------- text ---------- */
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/œ/g, 'oe').replace(/[^a-z0-9%]+/g, ' ').trim();
  }
  function stem(w) { return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w; }
  function num(s) { return parseFloat(String(s).replace(',', '.')); }

  const UNIT_TO = {
    g: ['g', 1], gr: ['g', 1], gram: ['g', 1], grams: ['g', 1], gramme: ['g', 1], grammes: ['g', 1],
    kg: ['g', 1000], oz: ['g', 28.35], lb: ['g', 453.6], lbs: ['g', 453.6],
    ml: ['ml', 1], cl: ['ml', 10], l: ['ml', 1000]
  };
  const UNIT_RE = '(g|gr|grams?|grammes?|kg|oz|lbs?|ml|cl|l)';

  /* "130 g banana", "130gr of banana", "banana 130g", "2 eggs", "banana"
     -> { query, amount, unit } (weight or volume given)
     or { query, count }        (bare number: a count of pieces or servings)
     or { query }               (nothing but a name) */
  function parseQuick(text) {
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    let m = t.match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*' + UNIT_RE + '\\b\\.?\\s*(?:of |de |d\')?(.*)$', 'i'));
    if (!m) {
      const x = t.match(new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*' + UNIT_RE + '\\.?$', 'i'));
      if (x) m = [x[0], x[2], x[3], x[1]];
    }
    if (m) {
      const u = UNIT_TO[m[2].toLowerCase()];
      return { query: m[3].trim(), amount: Math.round(num(m[1]) * u[1] * 10) / 10, unit: u[0] };
    }
    m = t.match(/^(\d+(?:[.,]\d+)?)\s+(?!%)(.+)$/);           // "2 eggs" but not "2% milk"
    if (m && !/^%/.test(m[2])) return { query: m[2].trim(), count: num(m[1]) };
    m = t.match(/^(.+?)\s+x?\s*(\d+(?:[.,]\d+)?)$/i);         // "eggs 2"
    if (m) return { query: m[1].trim(), count: num(m[2]) };
    return { query: t };
  }

  /* ---------- search ---------- */
  const STOP = new Set(['of', 'de', 'du', 'des', 'la', 'le', 'les', 'the', 'a', 'an', 'un', 'une', 'and', 'et', 'with', 'avec', 'd', 'l']);
  /* Everyday foods, by database code, with the words people actually type. The database files
     them under names like "Plant-based beverage, almond beverage..." or "Grains, rice, white...".
     These come first in a search, and the extra words make them findable. */
  const STAPLES = {
    125: 'egg eggs oeuf', 126: 'egg white blanc oeuf', 61: 'milk lait', 841: 'chicken breast poitrine poulet',
    7322: 'chicken breast grilled cooked poulet', 2683: 'ground beef boeuf hache', 2687: 'ground beef cooked',
    1704: 'banana banane', 1696: 'apple pomme', 2873: 'coffee cafe', 2909: 'tea the', 118: 'butter beurre',
    4066: 'white bread pain blanc', 4067: 'bread whole wheat pain ble', 2413: 'green bell pepper poivron vert',
    2460: 'tomato tomate', 2505: 'potato pomme de terre patate', 1511: 'avocado avocat',
    7802: 'almond milk lait amande', 6330: 'soy milk lait soya', 6979: 'greek yogurt yogourt grec',
    7229: 'whey protein powder proteine', 214: 'salt sel', 422: 'olive oil huile', 2401: 'onion oignon',
    119: 'cheddar cheese fromage', 1439: 'oats quick oatmeal gruau avoine', 1464: 'oats rolled large flake oatmeal avoine',
    4318: 'sugar sucre', 2394: 'garlic ail', 2380: 'carrot carotte', 2374: 'broccoli brocoli', 2213: 'spinach epinard',
    2363: 'cucumber concombre', 3393: 'lentils lentilles cooked', 4860: 'jalapeno', 2258: 'tomato paste pate tomate',
    1749: 'strawberry fraise', 1705: 'blueberry bleuet', 3081: 'tuna thon can', 4049: 'tortilla flour',
    4523: 'rice white cooked riz', 4466: 'pasta spaghetti macaroni cooked pates', 4489: 'bulgur cooked boulgour',
    4414: 'bulgur dry boulgour',
    6236: 'double whopper burger king hamburger', 6237: 'whopper burger king hamburger', 4664: 'fries french fries frites fast food',
    2926: 'diet coke coca cola zero pepsi soda', 5288: 'coke coca cola pepsi soda'
  };
  /* item: { ref:{t,id}, name, alt, group }  ->  adds the precomputed word lists */
  function indexItem(it) {
    const words = s => norm(s).split(' ').filter(Boolean).map(stem);
    const extra = it.ref.t === 'c' ? STAPLES[it.ref.id] : null;
    return Object.assign({}, it, { w1: words(it.name), w2: words(it.alt), w3: extra ? words(extra) : [], staple: !!extra });
  }
  /* uses: { "c:1704": 12, ... } how often each item was logged. Returns best matches first. */
  function search(index, query, uses, limit) {
    const toks = norm(query).split(' ').filter(w => w && !STOP.has(w)).map(stem);
    if (!toks.length) return [];
    const wantsCooked = /cook|cuit|boil|bouilli|fried|frit|roast|roti|bake|grill/.test(norm(query));
    const out = [];
    for (const it of index) {
      let best = Infinity;
      for (const words of [it.w1, it.w2, it.w3]) {
        if (!words.length) continue;
        let score = 0, ok = true;
        for (let i = 0; i < toks.length && ok; i++) {
          let pos = -1, exact = false;
          for (let j = 0; j < words.length; j++) {
            if (words[j] === toks[i]) { pos = j; exact = true; break; }
            if (pos < 0 && words[j].startsWith(toks[i])) pos = j;
          }
          if (pos < 0) ok = false;
          else score += pos * (i === 0 ? 6 : 2) + (exact ? 0 : 4);
        }
        if (ok) best = Math.min(best, words === it.w3 ? 0 : score + words.length * 1.5);
      }
      if (best === Infinity) continue;
      const own = it.ref.t !== 'c';
      let s = best + (own ? 0 : 60);
      s -= Math.min((uses && uses[it.ref.t + ':' + it.ref.id]) || 0, 20) * 8;
      const all = ' ' + it.w1.join(' ') + ' ';
      if (!own && !wantsCooked && / raw /.test(all)) s -= 4;
      if (it.staple) s -= 30;
      if (it.group === 3) s += 40;                             // baby foods last
      out.push({ item: it, score: s });
    }
    out.sort((a, b) => a.score - b.score || a.item.name.length - b.item.name.length);
    return out.slice(0, limit || 30).map(o => o.item);
  }

  /* ---------- nutrient arithmetic ---------- */
  /* per100: {key: number|null}. null means "unknown", which is not the same as 0. */
  function scale(per100, amount) {
    const out = {};
    for (const k of KEYS) {
      const v = per100[k];
      out[k] = (v === null || v === undefined || v === '') ? null : v * amount / 100;
    }
    return out;
  }
  /* Adds entries. missing[k] counts the entries that had no value for k. */
  function sum(list) {
    const total = {}, missing = {};
    for (const k of KEYS) { total[k] = 0; missing[k] = 0; }
    for (const n of list) for (const k of KEYS) {
      if (n[k] === null || n[k] === undefined) missing[k]++; else total[k] += n[k];
    }
    return { total, missing, count: list.length };
  }
  /* items: [{ per100, amount }], batch = cooked weight in g (0 or empty: the raw weights added up).
     Returns the recipe's values per 100 g of finished dish. */
  function recipePer100(items, batch) {
    const raw = items.reduce((a, it) => a + (Number(it.amount) || 0), 0);
    const weight = Number(batch) > 0 ? Number(batch) : raw;
    const s = sum(items.map(it => scale(it.per100, Number(it.amount) || 0)));
    const per100 = {};
    for (const k of KEYS) {
      per100[k] = (!weight || s.missing[k] === items.length) ? null : s.total[k] / weight * 100;
    }
    return { per100, weight, raw };
  }
  function round(v, unit) {
    if (v === null || v === undefined || isNaN(v)) return '';
    if (unit === 'kcal') return String(Math.round(v));
    const a = Math.abs(v);
    return String(a >= 100 ? Math.round(v) : a >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);
  }

  /* ---------- nutrition label reading ---------- */
  const LABEL_WORDS = [
    ['satfat', /satur\w*(?:\s+fat)?/g], ['transfat', /\btrans(?:\s+fat)?\b/g],
    ['fat', /\b(?:total\s+)?fat\b|\blipides?\b/g], ['carbs', /carbohydrates?|glucides?/g],
    ['fibre', /\bfib(?:re|er)s?\b/g], ['sugars', /\bsugars?\b|\bsucres?\b/g],
    ['protein', /protein\w*/g], ['chol', /cholest\w*/g], ['sodium', /\bsodium\b/g],
    ['potassium', /\bpotassium\b/g], ['calcium', /\bcalcium\b/g], ['iron', /\biron\b|\bfer\b/g],
    ['kcal', /\bcalories\b/g],
    ['niacin', /\bniacine?\b/g], ['pantothenic', /pantoth\w*/g], ['b6', /\bb\s?6\b/g], ['b12', /\bb\s?12\b/g],
    ['caffeine', /\bcaff?eine\b/g]
  ];
  const MG_KEYS = new Set(['chol', 'sodium', 'potassium', 'calcium', 'iron', 'niacin', 'pantothenic', 'b6', 'caffeine']);
  const UG_KEYS = new Set(['b12']);          /* printed in µg, which text readers render as ug, pg, vo... */

  /* One reading of the table -> { serving, unit, servingLabel, vals } (vals are per serving). */
  function readLabelText(text) {
    let t = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    t = t.replace(/\bo\s?(m?g)\b/g, '0 $1').replace(/(\d)\s?[,]\s?(\d)/g, '$1.$2').replace(/[|]/g, ' ');
    const res = { serving: null, unit: 'g', servingLabel: '', vals: {} };

    let m = t.match(/(?:per|pour|par)\s+([^\n(]{0,40}?)\(\s*(\d+(?:\.\d+)?)\s*(g|ml)\s*\)/);
    if (m) { res.servingLabel = m[1].trim(); res.serving = num(m[2]); res.unit = m[3]; }
    else {
      m = t.match(/(?:per|pour|par)\s+(\d+(?:\.\d+)?)\s*(g|ml)\b/) || t.match(/\(\s*(\d+(?:\.\d+)?)\s*(g|ml)\s*\)/);
      if (m) { res.serving = num(m[1]); res.unit = m[2]; }
    }

    const hits = [];
    for (const [key, re] of LABEL_WORDS) {
      re.lastIndex = 0; let h;
      while ((h = re.exec(t))) hits.push({ key, start: h.index, end: h.index + h[0].length });
    }
    hits.sort((a, b) => a.start - b.start);
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (res.vals[h.key] !== undefined) continue;
      let stop = Math.min(t.length, h.end + 45);
      for (let j = i + 1; j < hits.length; j++) if (hits[j].start >= h.end) { stop = Math.min(stop, hits[j].start); break; }
      const seg = t.slice(h.end, stop).split('\n')[0];
      const wantMg = MG_KEYS.has(h.key), wantUg = UG_KEYS.has(h.key);
      const re = /(\d+(?:\.\d+)?)\s*(mg|g|%)?/g; let n;
      while ((n = re.exec(seg))) {
        if (h.key === 'kcal') { res.vals.kcal = num(n[1]); break; }   // "Calories 130   % Daily Value" is one printed line
        if (n[2] === '%') continue;                                  // a % daily value, not an amount
        if (wantMg && n[2] !== 'mg') continue;                       // "Calcium 2 %" style: no amount
        if (!wantMg && n[2] === 'mg') continue;
        if (wantUg && n[2] === 'g') continue;
        if (!n[2] && /^\s*%/.test(seg.slice(re.lastIndex))) continue;
        res.vals[h.key] = num(n[1]); break;
      }
    }
    return res;
  }

  /* text: what the text reader saw on a Nutrition Facts table (English, French or both), or an
     array of several readings of the same photo. Readings are merged: the first one that has a
     value wins, and a value two readings disagree on is listed in `warnings` under its key.
     Returns { serving, unit, servingLabel, vals (per serving), per100 (null until a serving
     size is known), found, warnings }. Never throws: unread fields are simply absent. */
  function parseLabel(text) {
    const reads = (Array.isArray(text) ? text : [text]).map(readLabelText);
    const res = { serving: null, unit: 'g', servingLabel: '', vals: {}, per100: null, found: 0, warnings: [] };
    for (const r of reads) {
      if (!res.serving && r.serving) { res.serving = r.serving; res.unit = r.unit; res.servingLabel = r.servingLabel; }
      else if (res.serving && r.serving && r.serving !== res.serving && !res.warnings.includes('servingsize')) res.warnings.push('servingsize');
      for (const k of Object.keys(r.vals)) {
        if (res.vals[k] === undefined) res.vals[k] = r.vals[k];
        else if (res.vals[k] !== r.vals[k] && !res.warnings.includes(k)) res.warnings.push(k);
      }
    }
    res.found = Object.keys(res.vals).length;

    const v = res.vals;
    if (v.kcal !== undefined && v.protein !== undefined && v.carbs !== undefined && v.fat !== undefined) {
      const est = 4 * v.protein + 4 * v.carbs + 9 * v.fat;
      if (Math.abs(est - v.kcal) > Math.max(25, 0.25 * v.kcal)) res.warnings.push('energy');
    }
    if (v.satfat !== undefined && v.fat !== undefined && v.satfat > v.fat + 0.5 && !res.warnings.includes('satfat')) res.warnings.push('satfat');
    if (v.sugars !== undefined && v.carbs !== undefined && v.sugars > v.carbs + 0.5 && !res.warnings.includes('sugars')) res.warnings.push('sugars');
    if (!res.serving) res.warnings.push('serving');
    if (res.serving) res.per100 = servingToPer100(res.vals, res.serving);
    return res;
  }
  /* vals are per serving; result is per 100 g or ml, with null for everything a label does not carry. */
  function servingToPer100(vals, serving) {
    const out = {};
    for (const k of KEYS) {
      const v = vals[k];
      out[k] = (v === undefined || v === null || v === '' || isNaN(v) || !(serving > 0)) ? null : Number(v) * 100 / serving;
    }
    return out;
  }

  /* ---------- dates ---------- */
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); }

  /* ---------- export tables ---------- */
  function logTable(log) {
    const head = ['date', 'time', 'food', 'amount', 'unit', 'source'].concat(NUTRIENTS.map(n => n.key + '_' + n.unit));
    const rows = log.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(e =>
      [e.date, e.time || '', e.name, e.amount, e.unit, e.source || ''].concat(KEYS.map(k => cell(e.nut[k]))));
    return [head].concat(rows);
  }
  function dayTable(log) {
    const days = {};
    for (const e of log) (days[e.date] = days[e.date] || []).push(e.nut);
    const head = ['date', 'entries'].concat(NUTRIENTS.map(n => n.key + '_' + n.unit));
    return [head].concat(Object.keys(days).sort().map(d => {
      const s = sum(days[d]);
      return [d, s.count].concat(KEYS.map(k => cell(s.total[k])));
    }));
  }
  function cell(v) { return (v === null || v === undefined) ? '' : Math.round(v * 1000) / 1000; }

  /* ---------- .xlsx writer (no library) ----------
     sheets: [{ name, rows: [[cell,...],...] }]. Numbers are written as numbers, so the file
     opens correctly whatever the spreadsheet's language is (the old app broke on French commas). */
  function xlsx(sheets) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    const col = i => { let s = ''; i++; while (i) { s = String.fromCharCode(65 + (i - 1) % 26) + s; i = Math.floor((i - 1) / 26); } return s; };
    const sheetXml = rows => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
        const ref = col(ci) + (ri + 1);
        if (v === '' || v === null || v === undefined) return '';
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('') + '</row>').join('') + '</sheetData></worksheet>';
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => '<sheet name="' + esc(s.name).slice(0, 31) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>']
    ].concat(sheets.map((s, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s.rows)]));
    return zip(files);
  }
  let CRC = null;
  function crc32(b) {
    if (!CRC) { CRC = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /* Stored (uncompressed) zip: enough for a spreadsheet of a few thousand rows. */
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const [name, text] of files) {
      const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const common = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0));
      const local = Uint8Array.from([0x50, 0x4B, 3, 4].concat(common));
      parts.push(local, nb, data);
      central.push(Uint8Array.from([0x50, 0x4B, 1, 2].concat(u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), nb);
      offset += local.length + nb.length + data.length;
    }
    const csize = central.reduce((a, p) => a + p.length, 0);
    const end = Uint8Array.from([0x50, 0x4B, 5, 6].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(offset), u16(0)));
    const all = parts.concat(central, [end]);
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  return { NUTRIENTS, KEYS, LABEL_KEYS, EXTRA_LABEL_KEYS, norm, parseQuick, indexItem, search, scale, sum, recipePer100, round,
    parseLabel, servingToPer100, ymd, addDays, logTable, dayTable, xlsx };
})();
if (typeof module !== 'undefined') module.exports = F;
