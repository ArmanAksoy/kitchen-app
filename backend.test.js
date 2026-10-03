/**
 * Runs the real backend/Code.gs against fake Google services.
 *   node tests/backend.test.js
 */
const assert = require('assert');
const { loadBackend } = require('./fake-google');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

const geminiOk = text => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text }] }, finishReason: 'STOP' }] } });

function fresh(extra) {
  const b = loadBackend(Object.assign({ props: { GEMINI_API_KEY: 'g-key' }, fetch: () => geminiOk('OK') }, extra));
  b.gs.setup();
  b.token = b.props.TOKEN;
  b.book = b.books[b.props.SHEET_ID];
  return b;
}

console.log('backend');

test('setup creates a token and a sheet, and does not replace them on a second run', () => {
  const b = fresh();
  assert.strictEqual(b.token.length, 40);
  assert.strictEqual(b.book.getName(), 'Kitchen app');
  assert.strictEqual(b.book.getSheets()[0].getName(), 'Receipts');
  const { TOKEN, SHEET_ID } = b.props;
  b.gs.setup();
  assert.strictEqual(b.props.TOKEN, TOKEN);
  assert.strictEqual(b.props.SHEET_ID, SHEET_ID);
  assert.ok(b.logs.join('\n').includes('AI:     working (gemini'));
});

test('setup reports a broken AI key instead of crashing', () => {
  const b = loadBackend({ props: { GEMINI_API_KEY: 'bad' }, fetch: () => ({ code: 400, body: { error: { message: 'API key not valid' } } }) });
  b.gs.setup();
  assert.ok(b.logs.join('\n').includes('NOT working -> Gemini API error 400: API key not valid'));
});

test('SHEET_ID may be a full spreadsheet URL', () => {
  const b = fresh();
  b.props.SHEET_ID = 'https://docs.google.com/spreadsheets/d/' + b.book.getId() + '/edit#gid=0';
  assert.strictEqual(b.call({ token: b.token, action: 'ping' }).ok, true);
});

test('a wrong or missing token is refused, for every action', () => {
  const b = fresh();
  for (const action of ['ping', 'read', 'append', 'remove', 'ai']) {
    assert.deepStrictEqual(b.call({ token: 'nope', action }), { ok: false, error: 'Wrong token. Check Settings in the app.' });
    assert.strictEqual(b.call({ action }).ok, false);
  }
});

test('garbage in the request body gives a clean error, not a crash', () => {
  const b = fresh();
  const out = JSON.parse(b.gs.doPost({ postData: { contents: 'not json' } }).text);
  assert.strictEqual(out.ok, false);
});

test('append creates the tab and headers, and keeps text as text', () => {
  const b = fresh();
  const r = b.call({ token: b.token, action: 'append', tab: 'Receipts', rows: [
    { receipt_id: 'r1', date: '2026-10-02', time: '18:07', code: '06038312345', qty: 2, total: 9.98, pack_size: 750, flag: '' },
    { receipt_id: 'r1', date: '2026-10-02', time: '18:07', code: '4011', qty: 0.765, total: 1.16, pack_size: '', flag: 'no_pack_size' }
  ] });
  assert.deepStrictEqual(r, { appended: 2, ok: true });
  const rec = b.book.getSheetByName('Receipts').records();
  assert.strictEqual(rec[0].date, '2026-10-02', 'date must stay text');
  assert.strictEqual(rec[0].time, '18:07', 'time must stay text');
  assert.strictEqual(rec[0].code, '06038312345', 'leading zero must survive');
  assert.strictEqual(rec[1].code, '4011');
  assert.strictEqual(rec[0].total, 9.98);
  assert.strictEqual(rec[0].pack_size, 750);
  assert.strictEqual(rec[1].pack_size, '');
  assert.strictEqual(b.book.getSheetByName('Receipts').frozen, 1);
});

test('append adds unknown columns at the right and leaves old rows alone', () => {
  const b = fresh();
  b.call({ token: b.token, action: 'append', tab: 'T', rows: [{ a: 'x', b: 1 }] });
  b.call({ token: b.token, action: 'append', tab: 'T', rows: [{ b: 2, c: 'new' }] });
  assert.deepStrictEqual(b.book.getSheetByName('T').records(), [{ a: 'x', b: 1, c: '' }, { a: '', b: 2, c: 'new' }]);
});

test('append never writes a formula', () => {
  const b = fresh();
  b.call({ token: b.token, action: 'append', tab: 'T', rows: [{ a: '=IMPORTXML("http://x")' }] });
  assert.strictEqual(b.book.getSheetByName('T').records()[0].a, 'IMPORTXML("http://x")');
});

test('append with ifAbsent refuses a duplicate and writes nothing', () => {
  const b = fresh();
  const rows = [{ receipt_id: 'r1', total: 5 }, { receipt_id: 'r1', total: 6 }];
  const once = b.call({ token: b.token, action: 'append', tab: 'Receipts', rows, ifAbsent: { column: 'receipt_id', value: 'r1' } });
  const twice = b.call({ token: b.token, action: 'append', tab: 'Receipts', rows, ifAbsent: { column: 'receipt_id', value: 'r1' } });
  assert.strictEqual(once.appended, 2);
  assert.deepStrictEqual(twice, { appended: 0, skipped: true, ok: true });
  assert.strictEqual(b.book.getSheetByName('Receipts').records().length, 2);
});

test('append grows the sheet when it is full', () => {
  const b = fresh();
  const sheet = b.book.getSheetByName('Receipts');
  sheet.maxRows = 3; sheet.maxCols = 2;
  const rows = [1, 2, 3, 4, 5].map(n => ({ a: 'x' + n, b: n, c: n, d: n }));
  assert.strictEqual(b.call({ token: b.token, action: 'append', tab: 'Receipts', rows }).appended, 5);
  assert.strictEqual(sheet.records().length, 5);
});

test('append refuses an oversized batch before writing anything', () => {
  const b = fresh();
  const rows = Array.from({ length: 501 }, (_, i) => ({ a: i }));
  assert.strictEqual(b.call({ token: b.token, action: 'append', tab: 'T', rows }).ok, false);
  assert.strictEqual(b.book.getSheetByName('T'), null);
});

test('read returns headers and rows, supports tail, and treats a missing tab as empty', () => {
  const b = fresh();
  b.call({ token: b.token, action: 'append', tab: 'T', rows: [1, 2, 3, 4].map(n => ({ n, s: 'v' + n })) });
  const all = b.call({ token: b.token, action: 'read', tab: 'T' });
  assert.deepStrictEqual(all.headers, ['n', 's']);
  assert.strictEqual(all.rows.length, 4);
  const tail = b.call({ token: b.token, action: 'read', tab: 'T', tail: 2 });
  assert.deepStrictEqual(tail.rows, [[3, 'v3'], [4, 'v4']]);
  assert.deepStrictEqual(b.call({ token: b.token, action: 'read', tab: 'Nope' }), { headers: [], rows: [], ok: true });
});

test('remove deletes every row of one receipt and nothing else', () => {
  const b = fresh();
  const rows = ['a', 'b', 'b', 'c', 'b', 'd'].map((id, i) => ({ receipt_id: id, n: i }));
  b.call({ token: b.token, action: 'append', tab: 'Receipts', rows });
  assert.strictEqual(b.call({ token: b.token, action: 'remove', tab: 'Receipts', column: 'receipt_id', value: 'b' }).removed, 3);
  assert.deepStrictEqual(b.book.getSheetByName('Receipts').records().map(r => r.receipt_id), ['a', 'c', 'd']);
  assert.strictEqual(b.call({ token: b.token, action: 'remove', tab: 'Receipts', column: 'receipt_id', value: '' }).ok, false);
  assert.strictEqual(b.call({ token: b.token, action: 'remove', tab: 'Receipts', column: 'receipt_id', value: 'zzz' }).removed, 0);
});

test('ai (Gemini): sends key in a header, images before the prompt, and skips thought parts', () => {
  const b = fresh({ fetch: () => geminiOk('{"x":1}') });
  const r = b.call({ token: b.token, action: 'ai', prompt: 'read this', json: true, images: [{ mimeType: 'image/jpeg', data: 'AAAA' }] });
  assert.strictEqual(r.text, '{"x":1}');
  assert.strictEqual(r.provider, 'gemini');
  const req = b.requests[b.requests.length - 1];
  assert.ok(req.url.endsWith('models/gemini-flash-latest:generateContent'));
  assert.strictEqual(req.params.headers['x-goog-api-key'], 'g-key');
  assert.ok(!req.url.includes('g-key'), 'the key must not be in the URL');
  const sent = JSON.parse(req.params.payload);
  assert.strictEqual(sent.contents[0].parts[0].inline_data.data, 'AAAA');
  assert.strictEqual(sent.contents[0].parts[1].text, 'read this');
  assert.strictEqual(sent.generationConfig.responseMimeType, 'application/json');
});

test('ai (Gemini): when the default model name is retired, it finds the newest Flash by itself', () => {
  const b = fresh({ fetch: (url) => {
    if (url.includes('models?pageSize')) return { code: 200, body: { models: [
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.9-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-4.0-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-9-flash', supportedGenerationMethods: ['embedContent'] }
    ] } };
    if (url.includes('gemini-flash-latest')) return { code: 404, body: { error: { message: 'model not found' } } };
    return geminiOk('fine');
  } });
  const r = b.call({ token: b.token, action: 'ai', prompt: 'p' });
  assert.strictEqual(r.model, 'gemini-3.8-flash');
  assert.strictEqual(r.text, 'fine');
});

test('ai (Claude): picks the newest Sonnet from the models list and reads text blocks only', () => {
  const b = fresh({ props: { ANTHROPIC_API_KEY: 'a-key' }, fetch: (url) => {
    if (url.includes('/v1/models')) return { code: 200, body: { data: [
      { id: 'claude-opus-9', created_at: '2026-09-01T00:00:00Z' },
      { id: 'claude-sonnet-old', created_at: '2025-01-01T00:00:00Z' },
      { id: 'claude-sonnet-new', created_at: '2026-06-01T00:00:00Z' }
    ] } };
    return { code: 200, body: { content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'hello' }], stop_reason: 'end_turn' } };
  } });
  const r = b.call({ token: b.token, action: 'ai', prompt: 'p', images: [{ data: 'BBBB' }] });
  assert.deepStrictEqual(r, { text: 'hello', provider: 'anthropic', model: 'claude-sonnet-new', ok: true });
  const req = b.requests[b.requests.length - 1];
  assert.strictEqual(req.params.headers['x-api-key'], 'a-key');
  const sent = JSON.parse(req.params.payload);
  assert.strictEqual(sent.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.strictEqual(sent.messages[0].content[1].text, 'p');
});

test('ai: AI_MODEL forces a model, AI_PROVIDER picks between two keys, no key is a clear error', () => {
  const both = fresh({ props: { GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'gemini', AI_MODEL: 'my-model' }, fetch: () => geminiOk('x') });
  assert.strictEqual(both.call({ token: both.token, action: 'ai', prompt: 'p' }).model, 'my-model');
  const none = loadBackend({ props: {} });
  none.gs.setup();
  const r = none.call({ token: none.props.TOKEN, action: 'ai', prompt: 'p' });
  assert.ok(r.error.includes('No AI key found'));
});

test('ai: a provider error reaches the app as a readable message', () => {
  const b = fresh({ fetch: () => ({ code: 429, body: { error: { message: 'quota exceeded' } } }) });
  assert.strictEqual(b.call({ token: b.token, action: 'ai', prompt: 'p' }).error, 'Gemini API error 429: quota exceeded');
});

console.log(passed + ' passed' + (process.exitCode ? ', with failures' : ''));
