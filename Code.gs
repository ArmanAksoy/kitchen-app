/**
 * Kitchen app backend (Google Apps Script, STANDALONE project, deployed as a web app).
 *
 * Source of truth: backend/Code.gs in github.com/ArmanAksoy/kitchen-app.
 * This file is pasted by hand into script.google.com. After every change here:
 * Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy.
 *
 * Design: this backend is deliberately THIN and GENERIC. It knows nothing about
 * receipts. It only (1) checks a token, (2) relays an image + prompt to an AI
 * model using a key that never leaves Script Properties, and (3) reads, appends
 * and removes rows in tabs of one Google Sheet. All app logic (prompt, parsing,
 * column list, pack sizes) lives in index.html, which goes live on every push.
 * Keep it that way so that this file almost never needs to be re-pasted.
 *
 * Script Properties (Project Settings > Script Properties):
 *   GEMINI_API_KEY     one of these two is required
 *   ANTHROPIC_API_KEY
 *   AI_PROVIDER        optional: "gemini" or "anthropic" (only needed if both keys are set)
 *   AI_MODEL           optional: force an exact model id instead of the automatic choice
 *   SHEET_ID           optional before setup(): id or full URL of an existing sheet.
 *                      If empty, setup() creates a new spreadsheet called "Kitchen app".
 *   TOKEN              created by setup(). The phone app must send it with every call.
 *
 * Rules that came out of the old app's bugs (do not undo them):
 *   - Write plain values only, never formulas (the sheet locale is French).
 *   - Strings are stored as text (so dates, times and barcodes are never reinterpreted).
 *   - One request writes all of its rows in a single setValues call: no partial saves.
 */

var VERSION = '1.0.1';
var MAX_ROWS_PER_CALL = 500;

/* ------------------------------------------------------------------ web app */

function doGet() {
  return ContentService.createTextOutput(
    'Kitchen app backend v' + VERSION + ' is running. This address is meant for the app, not for a browser.');
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    checkToken_(req.token);
    out = route_(req) || {};
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  switch (req.action) {
    case 'ping':   return ping_();
    case 'ai':     return ai_(req);
    case 'read':   return read_(req);
    case 'append': return withLock_(function () { return append_(req); });
    case 'remove': return withLock_(function () { return remove_(req); });
    default: throw new Error('Unknown action: ' + req.action);
  }
}

/* -------------------------------------------------------------------- setup */

/**
 * Run this once from the Apps Script editor (pick "setup" in the toolbar, press Run).
 * Safe to run again: it never overwrites an existing token or sheet.
 */
function setup() {
  var p = props_();
  if (!p.getProperty('TOKEN')) {
    p.setProperty('TOKEN', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40));
  }
  var ss;
  if (sheetId_()) {
    ss = SpreadsheetApp.openById(sheetId_());
  } else {
    ss = SpreadsheetApp.create('Kitchen app');
    ss.getSheets()[0].setName('Receipts');
    p.setProperty('SHEET_ID', ss.getId());
  }

  var lines = [
    '',
    'Kitchen app backend v' + VERSION,
    'Sheet:  ' + ss.getUrl(),
    'TOKEN:  ' + p.getProperty('TOKEN')
  ];
  try {
    var r = ai_({ images: [], prompt: 'Reply with the single word OK.' });
    lines.push('AI:     working (' + r.provider + ', model ' + r.model + ', answered "' + r.text.trim().slice(0, 20) + '")');
  } catch (err) {
    var why = String((err && err.message) || err);
    lines.push('AI:     NOT working -> ' + why);
    if (/error (429|500|502|503|504|529)/.test(why)) {
      lines.push('        (The key was accepted. The AI service itself was busy: run setup again in a minute.)');
    }
  }
  lines.push('');
  lines.push('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone),');
  lines.push('then paste the web app URL and the TOKEN above into the app Settings.');
  var msg = lines.join('\n');
  console.log(msg);
  return msg;
}

/* ------------------------------------------------------------------ helpers */

function props_() { return PropertiesService.getScriptProperties(); }

function checkToken_(token) {
  var expected = props_().getProperty('TOKEN');
  if (!expected) throw new Error('Backend is not set up yet: run setup() in the Apps Script editor.');
  if (!token || String(token) !== expected) throw new Error('Wrong token. Check Settings in the app.');
}

/** SHEET_ID may hold a bare id or a full spreadsheet URL. */
function sheetId_() {
  var raw = String(props_().getProperty('SHEET_ID') || '').trim();
  if (!raw) return '';
  var m = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : raw;
}

function book_() {
  var id = sheetId_();
  if (!id) throw new Error('No sheet yet: run setup() in the Apps Script editor.');
  return SpreadsheetApp.openById(id);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function tabName_(req) {
  var name = String(req.tab || '').trim();
  if (!name) throw new Error('Missing tab name.');
  return name;
}

/* --------------------------------------------------------------------- ping */

function ping_() {
  var ss = book_();
  var p = props_();
  return {
    version: VERSION,
    sheetUrl: ss.getUrl(),
    sheetName: ss.getName(),
    tabs: ss.getSheets().map(function (s) { return s.getName(); }),
    provider: providerName_(),
    model: p.getProperty('AI_MODEL') || 'automatic'
  };
}

/* --------------------------------------------------------------------- read */

/**
 * { tab, tail? } -> { headers: [...], rows: [[...], ...] }
 * tail = only the last N data rows. A missing tab is not an error: it reads as empty.
 */
function read_(req) {
  var ss = book_();
  var sheet = ss.getSheetByName(tabName_(req));
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return { headers: [], rows: [] };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var count = lastRow - 1;
  if (count < 1) return { headers: headers, rows: [] };

  var first = 2;
  var tail = Number(req.tail) || 0;
  if (tail > 0 && tail < count) { first = lastRow - tail + 1; count = tail; }

  var tz = ss.getSpreadsheetTimeZone();
  var rows = sheet.getRange(first, 1, count, lastCol).getValues().map(function (row) {
    return row.map(function (v) {
      // Cells typed by hand may come back as Date objects. Send text, never a Date.
      if (Object.prototype.toString.call(v) === '[object Date]') {
        return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss");
      }
      return v;
    });
  });
  return { headers: headers, rows: rows };
}

/* ------------------------------------------------------------------- append */

/**
 * { tab, rows: [ {column: value, ...}, ... ], ifAbsent?: {column, value} }
 *
 * - Creates the tab if it does not exist.
 * - Columns are matched by header name. A key with no matching header gets a new
 *   column at the right, so the app can add columns without touching this file.
 * - ifAbsent: if any existing row already has `value` in `column`, nothing is
 *   written and { skipped: true } is returned (used to refuse duplicate receipts).
 * - All rows go in with one setValues call.
 */
function append_(req) {
  var rows = req.rows;
  if (!rows || !rows.length) return { appended: 0 };
  if (rows.length > MAX_ROWS_PER_CALL) throw new Error('Too many rows in one call (' + rows.length + ').');

  var ss = book_();
  var name = tabName_(req);
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);

  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var known = Object.create(null);
  headers.forEach(function (h, i) { if (h !== '') known[h] = i; });

  // New columns, in the order the app sent them.
  var added = false;
  rows.forEach(function (r) {
    Object.keys(r).forEach(function (k) {
      if (!(k in known)) { known[k] = headers.length; headers.push(k); added = true; }
    });
  });
  if (headers.length > sheet.getMaxColumns()) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  if (added) {
    var head = sheet.getRange(1, 1, 1, headers.length);
    head.setNumberFormat('@');
    head.setValues([headers]);
    head.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  if (req.ifAbsent && req.ifAbsent.column in known && sheet.getLastRow() > 1) {
    var col = known[req.ifAbsent.column] + 1;
    var wanted = String(req.ifAbsent.value);
    var existing = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]) === wanted) return { appended: 0, skipped: true };
    }
  }

  var width = headers.length;
  var matrix = rows.map(function (r) {
    var line = [];
    for (var c = 0; c < width; c++) line.push('');
    Object.keys(r).forEach(function (k) { line[known[k]] = cell_(r[k]); });
    return line;
  });

  var start = Math.max(sheet.getLastRow(), 1) + 1;
  var lastNeeded = start + matrix.length - 1;
  if (lastNeeded > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), lastNeeded - sheet.getMaxRows());
  }
  var range = sheet.getRange(start, 1, matrix.length, width);

  // A column that holds text in this batch is formatted as plain text BEFORE the
  // values go in, so "2026-10-03", "14:32" and "0603831234" stay exactly as sent.
  var formats = range.getNumberFormats();
  for (var c2 = 0; c2 < width; c2++) {
    var hasText = false, hasNumber = false;
    for (var r2 = 0; r2 < matrix.length; r2++) {
      var v = matrix[r2][c2];
      if (typeof v === 'number') hasNumber = true;
      else if (typeof v === 'string' && v !== '') hasText = true;
    }
    if (hasText && !hasNumber) {
      for (var r3 = 0; r3 < matrix.length; r3++) formats[r3][c2] = '@';
    }
  }
  range.setNumberFormats(formats);
  range.setValues(matrix);
  return { appended: matrix.length };
}

/** Only plain values reach the sheet: finite numbers, booleans, text. Never a formula. */
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v;
  var s = (typeof v === 'string') ? v : JSON.stringify(v);
  return s.replace(/^=+/, '');
}

/* ------------------------------------------------------------------- remove */

/** { tab, column, value } -> deletes every row whose `column` equals `value`. */
function remove_(req) {
  var sheet = book_().getSheetByName(tabName_(req));
  if (!sheet || sheet.getLastRow() < 2) return { removed: 0 };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var col = headers.indexOf(String(req.column));
  if (col < 0) throw new Error('No column named ' + req.column + ' in ' + sheet.getName() + '.');
  if (req.value === undefined || req.value === null || String(req.value) === '') {
    throw new Error('Refusing to remove rows with an empty value.');
  }

  var wanted = String(req.value);
  var values = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues();
  var removed = 0;
  // Bottom up, one contiguous block at a time.
  var i = values.length - 1;
  while (i >= 0) {
    if (String(values[i][0]) !== wanted) { i--; continue; }
    var end = i;
    while (i >= 0 && String(values[i][0]) === wanted) i--;
    var n = end - i;
    sheet.deleteRows(i + 3, n); // values[0] is sheet row 2
    removed += n;
  }
  return { removed: removed };
}

/* ----------------------------------------------------------------------- ai */

/**
 * { images: [{mimeType, data(base64)}], prompt, json? } -> { text, provider, model }
 * The app owns the prompt. This function only knows how to talk to each provider.
 */
function ai_(req) {
  var images = req.images || [];
  var prompt = String(req.prompt || '');
  if (!prompt) throw new Error('Missing prompt.');
  var provider = providerName_();
  if (provider === 'anthropic') return anthropic_(images, prompt);
  if (provider === 'gemini') return gemini_(images, prompt, !!req.json);
  throw new Error('No AI key found. Add GEMINI_API_KEY or ANTHROPIC_API_KEY in Script Properties.');
}

function providerName_() {
  var p = props_();
  var forced = String(p.getProperty('AI_PROVIDER') || '').toLowerCase().trim();
  var hasA = !!p.getProperty('ANTHROPIC_API_KEY');
  var hasG = !!p.getProperty('GEMINI_API_KEY');
  if (forced === 'anthropic' && hasA) return 'anthropic';
  if (forced === 'gemini' && hasG) return 'gemini';
  if (hasA) return 'anthropic';
  if (hasG) return 'gemini';
  return '';
}

/**
 * AI services are sometimes overloaded for a few seconds. These answers mean
 * "try again", not "you did something wrong".
 */
function isBusy_(code) { return [429, 500, 502, 503, 504, 529].indexOf(code) >= 0; }

/** Runs the request, and again after 1.5 s and 4 s if the service says it is busy. */
function busyRetry_(request) {
  var waits = [1500, 4000];
  var res = request();
  for (var i = 0; i < waits.length && isBusy_(res.getResponseCode()); i++) {
    Utilities.sleep(waits[i]);
    res = request();
  }
  return res;
}

/* Anthropic (Claude) */

function anthropicHeaders_() {
  return { 'x-api-key': props_().getProperty('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' };
}

function anthropic_(images, prompt) {
  var model = props_().getProperty('AI_MODEL') || anthropicNewest_();
  var content = images.map(function (im) {
    return { type: 'image', source: { type: 'base64', media_type: im.mimeType || 'image/jpeg', data: im.data } };
  });
  content.push({ type: 'text', text: prompt });

  var res = busyRetry_(function () {
    return UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: anthropicHeaders_(),
      payload: JSON.stringify({ model: model, max_tokens: 16000, messages: [{ role: 'user', content: content }] })
    });
  });
  var body = parseJson_(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('Claude API error ' + res.getResponseCode() + ': ' + apiMessage_(body));
  }
  var text = (body.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('');
  if (!text) throw new Error('Claude returned no text (stop reason: ' + body.stop_reason + ').');
  return { text: text, provider: 'anthropic', model: model };
}

/**
 * No model id is hard-coded: ids get retired. Ask the API which models exist and
 * take the newest Sonnet (best accuracy for the price on receipts). Cached 6 hours.
 */
function anthropicNewest_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('anthropic_model');
  if (hit) return hit;

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/models?limit=100', {
    muteHttpExceptions: true, headers: anthropicHeaders_()
  });
  var body = parseJson_(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('Claude API error ' + res.getResponseCode() + ' while listing models: ' + apiMessage_(body));
  }
  var models = (body.data || []).slice().sort(function (a, b) {
    return String(b.created_at).localeCompare(String(a.created_at));
  });
  var sonnets = models.filter(function (m) { return /sonnet/i.test(m.id); });
  var pick = (sonnets[0] || models[0] || {}).id;
  if (!pick) throw new Error('Claude API listed no models. Set AI_MODEL in Script Properties.');
  cache.put('anthropic_model', pick, 21600);
  return pick;
}

/* Google Gemini */

var GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/';

function geminiHeaders_() { return { 'x-goog-api-key': props_().getProperty('GEMINI_API_KEY') }; }

function gemini_(images, prompt, wantJson) {
  var cache = CacheService.getScriptCache();
  var forced = props_().getProperty('AI_MODEL');
  var model = forced || cache.get('gemini_model') || 'gemini-flash-latest';

  var parts = images.map(function (im) {
    return { inline_data: { mime_type: im.mimeType || 'image/jpeg', data: im.data } };
  });
  parts.push({ text: prompt });
  var payload = { contents: [{ role: 'user', parts: parts }] };
  if (wantJson) payload.generationConfig = { responseMimeType: 'application/json' };

  var res = busyRetry_(function () { return geminiCall_(model, payload); });
  var code = res.getResponseCode();
  if (!forced && (code === 404 || isBusy_(code))) {
    // 404: that model name was retired. Busy: that model is overloaded right now.
    // Either way, try the other plain Flash models, newest first, and remember the
    // one that answers (6 hours if the name is gone, 10 minutes if it was only busy).
    var others = [];
    try { others = geminiFlashModels_().filter(function (m) { return m !== model; }).slice(0, 2); }
    catch (err) { /* keep the first answer as the error to report */ }
    for (var i = 0; i < others.length; i++) {
      var attempt = geminiCall_(others[i], payload);
      if (attempt.getResponseCode() === 200) {
        model = others[i];
        res = attempt;
        cache.put('gemini_model', model, code === 404 ? 21600 : 600);
        break;
      }
    }
  }
  var body = parseJson_(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini API error ' + res.getResponseCode() + ': ' + apiMessage_(body));
  }
  var cand = (body.candidates || [])[0] || {};
  var text = ((cand.content || {}).parts || [])
    .filter(function (p) { return typeof p.text === 'string' && !p.thought; })
    .map(function (p) { return p.text; })
    .join('');
  if (!text) throw new Error('Gemini returned no text (finish reason: ' + cand.finishReason + ').');
  return { text: text, provider: 'gemini', model: model };
}

function geminiCall_(model, payload) {
  return UrlFetchApp.fetch(GEMINI_BASE + 'models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: geminiHeaders_(),
    payload: JSON.stringify(payload)
  });
}

/** Plain Flash models (no -lite, -image, -preview suffix) that can read images, newest version first. */
function geminiFlashModels_() {
  var res = UrlFetchApp.fetch(GEMINI_BASE + 'models?pageSize=1000', {
    muteHttpExceptions: true, headers: geminiHeaders_()
  });
  var body = parseJson_(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini API error ' + res.getResponseCode() + ' while listing models: ' + apiMessage_(body));
  }
  var found = [];
  (body.models || []).forEach(function (m) {
    var match = String(m.name).match(/^models\/(gemini-(\d+(?:\.\d+)?)-flash)$/);
    if (!match) return;
    if ((m.supportedGenerationMethods || []).indexOf('generateContent') < 0) return;
    found.push({ id: match[1], version: parseFloat(match[2]) });
  });
  found.sort(function (x, y) { return y.version - x.version; });
  return found.map(function (f) { return f.id; });
}

/* shared */

function parseJson_(text) {
  try { return JSON.parse(text); } catch (err) { return { raw: String(text).slice(0, 300) }; }
}

function apiMessage_(body) {
  if (body && body.error && body.error.message) return body.error.message;
  if (body && body.raw) return body.raw;
  return JSON.stringify(body).slice(0, 300);
}
