/**
 * A small in-memory stand-in for the Google Apps Script services that
 * backend/Code.gs uses, so the real backend file can run under Node.
 *
 * The fake sheet copies the one Sheets behaviour that matters here: a string
 * written into a cell that is NOT formatted as plain text gets reinterpreted
 * (an ISO date becomes a Date, digits become a number and lose leading zeros).
 * That is exactly the bug class the backend must prevent.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const DEFAULT_FORMAT = '0.###############';

function autoParse(v) {
  if (typeof v !== 'string') return v;
  if (v.startsWith('=')) return '#FORMULA';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T00:00:00');
  if (/^\d{1,2}:\d{2}$/.test(v)) return new Date('1899-12-30T' + v.padStart(5, '0') + ':00');
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

class FakeSheet {
  constructor(name) { this.name = name; this.cells = []; this.formats = []; this.maxRows = 1000; this.maxCols = 26; this.frozen = 0; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  insertColumnsAfter(_after, n) { this.maxCols += n; }
  setFrozenRows(n) { this.frozen = n; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) {
      if ((this.cells[r] || []).some(v => v !== '' && v !== undefined)) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.cells.forEach(row => (row || []).forEach((v, c) => { if (v !== '' && v !== undefined && c + 1 > max) max = c + 1; }));
    return max;
  }
  deleteRows(start, n) { this.cells.splice(start - 1, n); this.formats.splice(start - 1, n); }
  getRange(row, col, nRows, nCols) {
    nRows = nRows || 1; nCols = nCols || 1;
    if (row < 1 || col < 1 || row + nRows - 1 > this.maxRows || col + nCols - 1 > this.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
    const sheet = this;
    const each = fn => { for (let r = 0; r < nRows; r++) for (let c = 0; c < nCols; c++) fn(r, c, row - 1 + r, col - 1 + c); };
    const ensure = (R) => { while (sheet.cells.length <= R) { sheet.cells.push([]); sheet.formats.push([]); } };
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < nRows; r++) {
          out.push([]);
          for (let c = 0; c < nCols; c++) { const v = (sheet.cells[row - 1 + r] || [])[col - 1 + c]; out[r].push(v === undefined ? '' : v); }
        }
        return out;
      },
      setValues(matrix) {
        if (matrix.length !== nRows || matrix.some(m => m.length !== nCols)) throw new Error('setValues: size mismatch');
        each((r, c, R, C) => {
          ensure(R);
          const fmt = (sheet.formats[R] || [])[C] || DEFAULT_FORMAT;
          sheet.cells[R][C] = fmt === '@' ? matrix[r][c] : autoParse(matrix[r][c]);
        });
        return this;
      },
      getNumberFormats() {
        const out = [];
        for (let r = 0; r < nRows; r++) {
          out.push([]);
          for (let c = 0; c < nCols; c++) out[r].push((sheet.formats[row - 1 + r] || [])[col - 1 + c] || DEFAULT_FORMAT);
        }
        return out;
      },
      setNumberFormats(m) { each((r, c, R, C) => { ensure(R); sheet.formats[R][C] = m[r][c]; }); return this; },
      setNumberFormat(f) { each((r, c, R, C) => { ensure(R); sheet.formats[R][C] = f; }); return this; },
      setFontWeight() { return this; }
    };
  }
  /** Test helper: the sheet as an array of objects keyed by header. */
  records() {
    const headers = this.cells[0] || [];
    return this.cells.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] === undefined ? '' : row[i]])));
  }
}

class FakeBook {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = [new FakeSheet('Sheet1')]; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSpreadsheetTimeZone() { return 'America/Toronto'; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
}

/**
 * Loads backend/Code.gs into a sandbox.
 * options.fetch(url, params) must return { code, body } and stands in for UrlFetchApp.
 * options.props seeds the Script Properties.
 */
function loadBackend(options) {
  options = options || {};
  const props = Object.assign({}, options.props);
  const cache = {};
  const books = {};
  const requests = [];
  const logs = [];

  const sandbox = {
    console: { log: m => logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); }
    }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: d => d.toISOString().slice(0, 19)
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ text, mime: 'text/plain', setMimeType(m) { this.mime = m; return this; } })
    },
    SpreadsheetApp: {
      create: name => { const id = 'book' + (Object.keys(books).length + 1); books[id] = new FakeBook(id, name); return books[id]; },
      openById: id => { if (!books[id]) throw new Error('No spreadsheet with id ' + id); return books[id]; }
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        requests.push({ url, params });
        const r = options.fetch ? options.fetch(url, params || {}) : { code: 500, body: '{"error":{"message":"no fake fetch"}}' };
        return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

  /** Sends one request the way the app does and returns the parsed answer. */
  const call = body => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text);

  return { gs: sandbox, props, books, requests, logs, call, FakeBook };
}

module.exports = { loadBackend, FakeSheet, FakeBook };
