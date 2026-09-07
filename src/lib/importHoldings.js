"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rowsToHoldings = rowsToHoldings;
exports.parseHoldingsCSV = parseHoldingsCSV;
exports.parsePastedHoldings = parsePastedHoldings;
exports.parseHoldings = parseHoldings;
exports.normalizeSheetUrl = normalizeSheetUrl;
exports.fetchHoldingsFromUrl = fetchHoldingsFromUrl;
exports.holdingsToPositions = holdingsToPositions;
const universe_1 = require("@/data/universe");
const format_1 = require("@/utils/format");
const PICK = {
    ticker: ['ticker', 'symbol', 'stock', 'asset', 'code'],
    name: ['name', 'company', 'description', 'title'],
    quantity: ['quantity', 'qty', 'shares', 'units', 'amount', 'holdings'],
    costBasis: ['costbasis', 'cost', 'cost basis', 'invested', 'book value', 'total cost', 'paid'],
};
function findKey(row, names) {
    const keys = Object.keys(row);
    for (const want of names) {
        const hit = keys.find((k) => k.trim().toLowerCase() === want);
        if (hit)
            return hit;
    }
    for (const want of names) {
        const hit = keys.find((k) => k.trim().toLowerCase().includes(want));
        if (hit)
            return hit;
    }
    return undefined;
}
function num(v) {
    if (!v)
        return 0;
    const cleaned = v.replace(/[^0-9.\-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
}
// RFC-4180-ish CSV row splitter — handles quoted fields containing commas and
// newlines, plus "" escapes. (Self-contained so it runs on native + web.)
function splitCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                }
                else
                    inQuotes = false;
            }
            else
                cell += ch;
        }
        else if (ch === '"')
            inQuotes = true;
        else if (ch === ',') {
            row.push(cell);
            cell = '';
        }
        else if (ch === '\r') {
            // ignore
        }
        else if (ch === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        }
        else
            cell += ch;
    }
    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
function csvToRecords(text) {
    const rows = splitCsvRows(text);
    if (rows.length === 0)
        return [];
    const headers = rows[0].map((h) => h.trim());
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const cells = rows[i];
        if (cells.length === 1 && cells[0].trim() === '')
            continue;
        const rec = {};
        headers.forEach((h, j) => (rec[h] = (cells[j] ?? '').trim()));
        out.push(rec);
    }
    return out;
}
function rowsToHoldings(rows) {
    if (rows.length === 0)
        return [];
    const sample = rows[0];
    const kTicker = findKey(sample, PICK.ticker);
    const kName = findKey(sample, PICK.name);
    const kQty = findKey(sample, PICK.quantity);
    const kCost = findKey(sample, PICK.costBasis);
    const out = [];
    for (const row of rows) {
        const ticker = (kTicker ? row[kTicker] : '')?.trim();
        if (!ticker)
            continue;
        out.push({
            ticker: ticker.toUpperCase(),
            name: kName ? row[kName]?.trim() || undefined : undefined,
            quantity: kQty ? num(row[kQty]) : 0,
            costBasis: kCost ? num(row[kCost]) || undefined : undefined,
        });
    }
    return out;
}
function parseHoldingsCSV(text) {
    return rowsToHoldings(csvToRecords(text));
}
// ---- Smart paste (ported from Momentum) --------------------------------
// A block pasted from a spreadsheet or broker export. No header needed;
// tolerates extra columns, $ signs and thousands separators.
function splitCells(line) {
    let parts;
    if (line.includes('\t'))
        parts = line.split('\t');
    else if (line.includes(','))
        parts = line.split(',');
    else
        parts = line.split(/\s+/);
    return parts.map((c) => c.trim());
}
function toNum(s) {
    if (s == null)
        return null;
    const cleaned = s.replace(/[^0-9.\-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.')
        return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}
function isNumericCell(s) {
    return /[0-9]/.test(s) && toNum(s) != null;
}
function isTickerCell(s) {
    return /^[A-Za-z][A-Za-z.\-]{0,9}$/.test(s);
}
function isCapWord(s) {
    return /^(mega|large|mid|small|micro|nano)(\s*cap)?$/i.test(s.trim());
}
const HEADER_FIRST = /^(ticker|symbol|stock|asset|code)$/i;
function parsePastedHoldings(text) {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    const out = [];
    for (const line of lines) {
        const cells = splitCells(line);
        const first = cells[0];
        if (!first || HEADER_FIRST.test(first) || !isTickerCell(first))
            continue;
        const ticker = first.toUpperCase();
        const second = cells[1];
        const name = second && !isNumericCell(second) && !isCapWord(second) ? second : undefined;
        const nums = [];
        for (const c of cells) {
            const n = toNum(c);
            if (n != null && /[0-9]/.test(c))
                nums.push(n);
        }
        // (quantity, pricePerShare, totalCost) consecutive triple where
        // quantity * pricePerShare ≈ totalCost — robust to leading noise columns.
        let quantity = 0;
        let costBasis;
        for (let k = 0; k + 2 < nums.length; k++) {
            const [a, b, c] = [nums[k], nums[k + 1], nums[k + 2]];
            if (a > 0 && b > 0 && c > 0 && Math.abs(a * b - c) <= Math.max(0.02 * c, 0.5)) {
                quantity = a;
                costBasis = c;
                break;
            }
        }
        // Exactly two numbers is the documented shape — ticker, shares, total
        // cost — and it is what this screen's own placeholder shows. Without this
        // the pair fell through to "first number is the quantity", the cost was
        // dropped, and every row imported at a zero cost basis.
        if (!quantity && nums.length === 2 && nums[0] > 0 && nums[1] > 0) {
            quantity = nums[0];
            costBasis = nums[1];
        }
        if (!quantity) {
            const q = nums.find((v) => v > 0 && v < 1e6);
            if (q != null)
                quantity = q;
        }
        out.push({ ticker, name, quantity, costBasis });
    }
    return out;
}
// Accepts either a header CSV or a smart-paste block — whichever yields more.
function parseHoldings(text) {
    const csv = parseHoldingsCSV(text);
    const pasted = parsePastedHoldings(text);
    return pasted.length > csv.length ? pasted : csv;
}
// ---- Google Sheet support (ported from Momentum) ------------------------
function normalizeSheetUrl(url) {
    const u = url.trim();
    const m = u.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m && !u.includes('output=csv') && !u.includes('/pub')) {
        const gid = u.match(/[#&?]gid=([0-9]+)/)?.[1] ?? '0';
        return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
    }
    return u;
}
async function fetchHoldingsFromUrl(url) {
    const res = await fetch(normalizeSheetUrl(url));
    if (!res.ok)
        throw new Error(`Fetch failed (${res.status})`);
    const text = await res.text();
    const holdings = parseHoldingsCSV(text);
    if (holdings.length === 0)
        throw new Error('No rows with a ticker column were found.');
    return holdings;
}
// ---- Map to Stockpile positions ----------------------------------------
function holdingsToPositions(holdings) {
    const today = (0, format_1.isoDate)(new Date());
    return holdings
        .filter((h) => h.ticker && h.quantity > 0)
        .map((h) => ({
        symbol: h.ticker,
        name: h.name || universe_1.UNIVERSE_BY_SYMBOL.get(h.ticker)?.fallbackName || h.ticker,
        shares: h.quantity,
        // Momentum stores total cost; Stockpile stores price per share.
        buyPrice: h.costBasis && h.quantity ? h.costBasis / h.quantity : 0,
        buyDate: today,
    }));
}
