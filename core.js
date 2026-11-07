/* core.js — pure logic (no DOM): RBC CSV import, price lookup, period returns, chart series.
 * Works in the browser (window.Core) and in tests (tests/index.html). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- small helpers ---------- */
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');

  function parseDateText(s) {
    if (!s) return null;
    const m = String(s).match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (!m) return null;
    const mo = MON[m[1].toLowerCase()];
    return mo ? `${m[3]}-${pad(mo)}-${pad(+m[2])}` : null;
  }

  function num(s) {
    if (s == null) return null;
    const t = String(s).trim().replace(/[%,$\s]/g, '');
    if (t === '' || t === 'N/A' || t === '--') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function addMonths(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
  }
  // index of the last element <= x (arrays sorted ascending; works for numbers and ISO date strings)
  function lastLE(arr, x) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  const localDate = (sec, off) => new Date((sec + (off || 0)) * 1000).toISOString().slice(0, 10);
  const dailyTs = (d) => Date.parse(d + 'T20:30:00Z'); // ~market close, good enough for charting

  /* ---------- RBC Direct Investing "Holdings" CSV import ---------- */
  function parseCsv(text) {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  function parseRbcHoldings(text) {
    const rows = parseCsv(String(text).replace(/^﻿/, ''));
    let id = null, name = null, asOf = null, hi = -1;
    const cash = {};
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const c0 = (r[0] || '').trim();
      if (/^Account:/i.test(c0)) {
        const rest = c0.replace(/^Account:\s*/i, '');
        const m = rest.match(/^(\S+)\s*-\s*(.*)$/);
        if (m) { id = m[1]; name = m[2].trim() || m[1]; } else { id = rest.trim(); name = id; }
      } else if (/^Balances as of/i.test(c0)) {
        asOf = parseDateText(c0);
      } else if (c0 === 'Currency' && (r[1] || '').trim() === 'Cash') {
        for (let j = i + 1; j < rows.length; j++) {
          const q = rows[j];
          if (!q[0] || !/^[A-Z]{3}$/.test(q[0].trim())) break;
          const v = num(q[1]);
          if (v) cash[q[0].trim()] = v;
        }
      } else if ((r[1] || '').trim() === 'Product' && (r[2] || '').trim() === 'Symbol') {
        hi = i; break;
      }
    }
    if (hi < 0 || !id) throw new Error('This does not look like an RBC Direct Investing holdings export (no account / Product-Symbol header found).');

    const H = {};
    rows[hi].forEach((h, i) => { H[h.trim()] = i; });
    const positions = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      const g = (k) => (H[k] == null ? undefined : r[H[k]]);
      if (r.length < 5 || !(g('Symbol') || '').trim()) break;
      const qty = num(g('Quantity'));
      if (!qty) continue;
      const product = (g('Product') || '').toLowerCase();
      const kind = /fixed income|gic|bond/.test(product) ? 'fixed' : /mutual/.test(product) ? 'manual' : 'market';
      const last = num(g('Last Price'));
      const mv = num(g('Total Market Value'));
      const unit = kind === 'market' ? last : (mv != null ? mv / qty : last);
      positions.push({
        symbol: g('Symbol').trim(),
        name: (g('Name') || '').trim(),
        kind,
        currency: (g('Currency') || 'CAD').trim() || 'CAD',
        qty,
        book: num(g('Total Book Cost')),
        unit: unit == null ? 0 : Math.round(unit * 1e8) / 1e8,
        coupon: num(g('Coupon Rate')) || undefined,
        maturity: parseDateText(g('Maturity Date')) || undefined,
      });
    }
    return { id, name, asOf, cash, positions };
  }

  // Add or replace an account (matched by account number). Keeps a custom name / ticker overrides.
  function upsertAccount(accounts, acct) {
    const i = accounts.findIndex((a) => a.id === acct.id);
    if (i < 0) return { accounts: accounts.concat([acct]), replaced: false };
    const old = accounts[i];
    const yahoo = {};
    old.positions.forEach((p) => { if (p.yahoo) yahoo[p.symbol] = p.yahoo; });
    const merged = { ...acct, name: old.customName ? old.name : acct.name, customName: old.customName };
    merged.positions = acct.positions.map((p) => (yahoo[p.symbol] ? { ...p, yahoo: yahoo[p.symbol] } : p));
    const out = accounts.slice();
    out[i] = merged;
    return { accounts: out, replaced: true };
  }

  /* ---------- prices ---------- */
  function yahooSymbol(p) {
    if (p.yahoo) return p.yahoo;
    const s = String(p.symbol).toUpperCase().trim().replace(/\./g, '-');
    return (p.currency || 'CAD') === 'USD' ? s : s + '.TO';
  }

  function makeMarket(prices, todayISO) {
    return {
      syms: (prices && prices.symbols) || {},
      ref: (prices && prices.marketDate) || todayISO || new Date().toISOString().slice(0, 10),
      generated: (prices && prices.generated) || null,
      loaded: !!prices,
    };
  }

  // Symbols the holdings need that the price feed does not have (so the user can add them to symbols.txt)
  function missingSymbols(accounts, mkt) {
    const out = new Map();
    for (const a of accounts) {
      for (const p of a.positions) {
        if (p.kind !== 'market') continue;
        const y = yahooSymbol(p);
        const s = mkt.syms[y];
        if (!s || s.price == null) out.set(y, p.symbol);
      }
      const cur = new Set(a.positions.map((p) => p.currency).concat(Object.keys(a.cash || {})));
      cur.forEach((c) => { if (c && c !== 'CAD' && !mkt.syms[c + 'CAD=X']) out.set(c + 'CAD=X', c + ' exchange rate'); });
    }
    return [...out.entries()].map(([yahoo, symbol]) => ({ yahoo, symbol }));
  }

  function priceAt(s, when) {
    if (when.kind === 'now') return s.price;
    if (when.kind === 'prev') return s.c.length ? s.c[s.c.length - 1] : s.price;
    const i = lastLE(s.d, when.date);
    return i >= 0 ? s.c[i] : (s.c.length ? s.c[0] : s.price);
  }
  // first date of history when the fund is younger than the requested period (else null)
  function partialFrom(p, mkt, when) {
    if (when.kind !== 'date' || p.kind !== 'market') return null;
    const s = mkt.syms[yahooSymbol(p)];
    return s && s.d && s.d.length && lastLE(s.d, when.date) < 0 ? s.d[0] : null;
  }

  // GIC-style growth: compounding at the coupon rate from the statement date, stopping at maturity.
  function accrual(p, date) {
    const r = (p.coupon || 0) / 100;
    if (!r || !p.asOf) return 1;
    let end = date;
    if (p.maturity && end > p.maturity) end = p.maturity;
    const days = (Date.parse(end + 'T00:00:00Z') - Date.parse(p.asOf + 'T00:00:00Z')) / 864e5;
    return Math.pow(1 + r, days / 365);
  }

  function unitParts(p, mkt, when) {
    let u, missing = false;
    if (p.kind === 'market') {
      const s = mkt.syms[yahooSymbol(p)];
      if (s && s.price != null) u = priceAt(s, when); else { u = p.unit; missing = true; }
    } else if (p.kind === 'fixed') {
      const date = when.kind === 'date' ? when.date : when.kind === 'prev' ? addDays(mkt.ref, -1) : mkt.ref;
      u = p.unit * accrual(p, date);
    } else u = p.unit;
    let fx = 1;
    const cur = p.currency || 'CAD';
    if (cur !== 'CAD') {
      const f = mkt.syms[cur + 'CAD=X'];
      fx = f ? priceAt(f, when) : (p.fx || 1);
    }
    return { u, fx, missing };
  }

  /* ---------- periods ---------- */
  const PERIODS = [
    { id: '1D', label: '1D', long: 'Since previous close' },
    { id: '1W', label: '1W', long: 'Past week' },
    { id: '1M', label: '1M', long: 'Past month' },
    { id: '3M', label: '3M', long: 'Past 3 months' },
    { id: '6M', label: '6M', long: 'Past 6 months' },
    { id: 'YTD', label: 'YTD', long: 'Year to date' },
    { id: '1Y', label: '1Y', long: 'Past year' },
    { id: '3Y', label: '3Y', long: 'Past 3 years' },
    { id: 'ALL', label: 'Since cost', long: 'Since purchase (vs. book cost)' },
  ];

  function periodWindow(pid, mkt) {
    const ref = mkt.ref;
    switch (pid) {
      case '1D': return { kind: 'prev' };
      case 'ALL': return { kind: 'cost' };
      case '1W': return { kind: 'date', date: addDays(ref, -7) };
      case '1M': return { kind: 'date', date: addMonths(ref, -1) };
      case '3M': return { kind: 'date', date: addMonths(ref, -3) };
      case '6M': return { kind: 'date', date: addMonths(ref, -6) };
      case 'YTD': return { kind: 'date', date: `${+ref.slice(0, 4) - 1}-12-31` };
      case '1Y': return { kind: 'date', date: addMonths(ref, -12) };
      case '3Y': return { kind: 'date', date: addMonths(ref, -36) };
      default: return { kind: 'prev' };
    }
  }

  /* ---------- summaries ---------- */
  function flatten(accounts) {
    const out = [];
    for (const a of accounts) {
      for (const p of a.positions) out.push({ ...p, acct: a.id, asOf: a.asOf });
      for (const [cur, amt] of Object.entries(a.cash || {})) {
        if (amt) out.push({ symbol: 'CASH', name: cur + ' cash', kind: 'cash', currency: cur, qty: amt, unit: 1, book: amt, acct: a.id, asOf: a.asOf });
      }
    }
    return out;
  }

  function summarize(positions, mkt, pid) {
    const w = periodWindow(pid, mkt);
    return positions.map((p) => {
      const n = unitParts(p, mkt, { kind: 'now' });
      const value = p.qty * n.u * n.fx;
      const book = p.book != null ? p.book * n.fx : value;
      let start;
      if (w.kind === 'cost') start = book;
      else { const s = unitParts(p, mkt, w); start = p.qty * s.u * s.fx; }
      return {
        key: p.symbol + '|' + (p.currency || 'CAD'), symbol: p.symbol, name: p.name, kind: p.kind,
        currency: p.currency || 'CAD', qty: p.qty, price: n.u, fx: n.fx, value, start, book, missing: n.missing,
        partial: partialFrom(p, mkt, w),
      };
    });
  }

  function groupRows(rows) {
    const m = new Map();
    for (const r of rows) {
      const g = m.get(r.key);
      if (!g) m.set(r.key, { ...r });
      else { g.qty += r.qty; g.value += r.value; g.start += r.start; g.book += r.book; g.missing = g.missing || r.missing; g.partial = g.partial || r.partial; }
    }
    return [...m.values()];
  }

  function finalize(rows) {
    const T = { value: 0, start: 0, book: 0 };
    rows.forEach((r) => { T.value += r.value; T.start += r.start; T.book += r.book; });
    rows.forEach((r) => {
      r.change = r.value - r.start; r.pct = r.start ? r.change / r.start : null;
      r.gain = r.value - r.book; r.gainPct = r.book ? r.gain / r.book : null;
      r.weight = T.value ? r.value / T.value : 0;
    });
    const total = {
      ...T, change: T.value - T.start, pct: T.start ? (T.value - T.start) / T.start : null,
      gain: T.value - T.book, gainPct: T.book ? (T.value - T.book) / T.book : null,
    };
    return { rows, total };
  }

  /* ---------- chart series (current holdings, valued over time) ---------- */
  function seriesPts(s, pid, mkt) {
    const p2 = pid === 'ALL' ? '1Y' : pid;
    const ref = mkt.ref;
    const t = [], v = [];
    const it = s.it || [];
    const itDates = it.map((x) => localDate(x, s.off));
    if (p2 === '1D') {
      for (let i = 0; i < it.length; i++) if (itDates[i] === ref) { t.push(it[i] * 1000); v.push(s.ic[i]); }
    } else {
      const w = periodWindow(p2, mkt);
      let i0 = lastLE(s.d, w.date); if (i0 < 0) i0 = 0;
      const firstIt = p2 === '1W' ? (itDates.find((d) => d > w.date) || null) : null;
      for (let i = i0; i < s.d.length; i++) {
        if (firstIt && s.d[i] >= firstIt) break;
        t.push(dailyTs(s.d[i])); v.push(s.c[i]);
      }
      if (firstIt) for (let i = 0; i < it.length; i++) if (itDates[i] > w.date) { t.push(it[i] * 1000); v.push(s.ic[i]); }
    }
    // Add the live price. Quantised to 15-min buckets so symbols whose last trade differs by a few
    // seconds share one chart point; if it falls in the last intraday bar, update that bar instead.
    if (s.price != null) {
      const liveQ = Math.floor(((s.time || 0) * 1000 || Date.now()) / 900000) * 900000;
      if (t.length && liveQ <= t[t.length - 1]) v[v.length - 1] = s.price;
      else { t.push(liveQ); v.push(s.price); }
    }
    return { t, v };
  }
  const ffill = (pts, ts) => { const i = lastLE(pts.t, ts); return i >= 0 ? pts.v[i] : pts.v[0]; };

  function buildSeries(positions, mkt, pid, maxPoints) {
    maxPoints = maxPoints || 320;
    const cache = {};
    const ptsFor = (key, s) => cache[key] || (cache[key] = seriesPts(s, pid, mkt));
    const grid = new Set();
    const used = [];
    for (const p of positions) {
      const e = { p };
      if (p.kind === 'market') {
        const y = yahooSymbol(p), s = mkt.syms[y];
        if (s && s.price != null) { e.pts = ptsFor('s:' + y, s); e.pts.t.forEach((x) => grid.add(x)); }
      }
      const cur = p.currency || 'CAD';
      if (cur !== 'CAD') { const f = mkt.syms[cur + 'CAD=X']; if (f) e.fx = ptsFor('s:' + cur, f); }
      used.push(e);
    }
    let ts = [...grid].sort((a, b) => a - b);
    if (ts.length < 2) { const end = ts[0] || Date.now(); ts = [end - 864e5, end]; }
    if (ts.length > maxPoints) {
      const out = [];
      for (let i = 0; i < maxPoints; i++) out.push(ts[Math.round((i * (ts.length - 1)) / (maxPoints - 1))]);
      ts = out;
    }
    const v = ts.map((t) => {
      let tot = 0;
      for (const e of used) {
        const p = e.p;
        let u;
        if (e.pts && e.pts.t.length) u = ffill(e.pts, t);
        else if (p.kind === 'fixed') u = p.unit * accrual(p, new Date(t).toISOString().slice(0, 10));
        else u = p.unit;
        let fx = 1;
        if (e.fx) fx = ffill(e.fx, t); else if (p.currency && p.currency !== 'CAD') fx = p.fx || 1;
        tot += p.qty * u * fx;
      }
      return tot;
    });
    return { t: ts, v };
  }

  return {
    PERIODS, parseCsv, parseRbcHoldings, parseDateText, upsertAccount, yahooSymbol, makeMarket, missingSymbols,
    periodWindow, flatten, summarize, groupRows, finalize, buildSeries, addDays, addMonths, accrual, num,
  };
});
