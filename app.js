/* app.js — the dashboard UI. All holdings live in this browser (localStorage); only prices come from the site. */
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/Toronto';

  /* ---------- state ---------- */
  const S = {
    accounts: [],
    prefs: { period: '1D', unit: 'pct', hide: false, sel: 'all', sort: 'value', dir: -1, cmp: ['^GSPTSE', '^GSPC'] },
    prices: null, mkt: Core.makeMarket(null), error: null,
  };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  function load() {
    const a = store.get('pd.accounts'); if (Array.isArray(a)) S.accounts = a;
    const p = store.get('pd.prefs'); if (p) Object.assign(S.prefs, p);
  }
  const saveAccounts = () => store.set('pd.accounts', S.accounts);
  const savePrefs = () => store.set('pd.prefs', S.prefs);

  /* ---------- formatting ---------- */
  const group = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
  const group2 = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qtyFmt = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 4 });
  function money(n, o) {
    o = o || {};
    const dec = o.dec || 0;
    const a = Math.abs(n);
    const body = '$' + (dec ? group2 : group).format(a);
    const zero = (dec ? Math.round(a * 100) : Math.round(a)) === 0;
    const sign = zero ? '' : n < 0 ? '−' : (o.sign ? '+' : '');
    return sign + body;
  }
  function pct(p, signed) {
    if (p == null || !isFinite(p)) return '—';
    const v = Math.round(p * 10000) / 100;
    return (v > 0 && signed !== false ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
  }
  const dFmt = (o) => new Intl.DateTimeFormat('en-CA', Object.assign({ timeZone: TZ }, o));
  const fmtDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso + 'T12:00:00Z'));
  const fmtShort = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso + 'T12:00:00Z'));
  function ago(iso) {
    if (!iso) return '';
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (m < 2) return 'just now';
    if (m < 90) return m + ' min ago';
    if (m < 60 * 36) return Math.round(m / 60) + ' h ago';
    return Math.round(m / 1440) + ' days ago';
  }

  // change as "▲ +0.58%  +$14,555" (primary follows the % / $ toggle)
  function chg(change, p, o) {
    o = o || {};
    const flat = Math.abs(change) < 0.005;
    const cls = flat ? 'flat' : change > 0 ? 'pos' : 'neg';
    const arrow = flat ? '▬' : change > 0 ? '▲' : '▼';
    const dollars = `<span class="amt">${money(change, { sign: true, dec: o.dec })}</span>`;
    const percent = pct(p);
    const first = S.prefs.unit === 'pct' ? percent : dollars;
    const second = S.prefs.unit === 'pct' ? dollars : percent;
    return `<span class="chg ${cls}"><span aria-hidden="true">${arrow}</span> <b>${first}</b></span> <span class="chg2">${second}</span>`;
  }

  /* ---------- derived data ---------- */
  function scopes() {
    const all = Core.flatten(S.accounts);
    const list = [{ id: 'all', name: 'All accounts', sub: S.accounts.length + (S.accounts.length === 1 ? ' account' : ' accounts'), positions: all }];
    S.accounts.forEach((a) => list.push({
      id: a.id, name: a.name, sub: '••' + String(a.id).slice(-4) + (a.asOf ? ' · RBC data ' + fmtShort(a.asOf) : ''),
      positions: Core.flatten([a]),
    }));
    return list;
  }
  const periodInfo = () => Core.PERIODS.find((p) => p.id === S.prefs.period) || Core.PERIODS[0];

  /* ---------- rendering ---------- */
  function render() {
    // controls
    $('#periods').innerHTML = Core.PERIODS.map((p) => `<button type="button" role="radio" data-period="${p.id}" aria-checked="${p.id === S.prefs.period}" title="${esc(p.long)}">${esc(p.label)}</button>`).join('');
    document.querySelectorAll('#unit button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === S.prefs.unit)));
    $('#hide').setAttribute('aria-pressed', String(S.prefs.hide));
    document.body.classList.toggle('hide-amounts', S.prefs.hide);
    $('#status').innerHTML = statusText();

    const app = $('#app');
    if (!S.accounts.length) { app.innerHTML = emptyHtml(); return; }

    const sc = scopes();
    let sel = sc.find((s) => s.id === S.prefs.sel);
    if (!sel) { sel = sc[0]; S.prefs.sel = 'all'; }
    const pid = S.prefs.period;

    // cards
    const cards = sc.map((s) => {
      const fin = Core.finalize(Core.summarize(s.positions, S.mkt, pid));
      const t = fin.total;
      const ser = Core.buildSeries(s.positions, S.mkt, pid, 60);
      return `<button type="button" class="card${s.id === 'all' ? ' all' : ''}" data-sel="${esc(s.id)}" aria-pressed="${s.id === sel.id}">
        <div class="c-head"><span class="c-name">${esc(s.name)}</span><span class="c-sub">${esc(s.sub)}</span></div>
        <div class="c-val amt">${money(t.value)}</div>
        <div class="c-chg">${chg(t.change, t.pct)}</div>
        ${spark(ser, t.start)}
      </button>`;
    }).join('');

    // detail
    const fin = Core.finalize(Core.groupRows(Core.summarize(sel.positions, S.mkt, pid)));
    const t = fin.total;
    const series = Core.buildSeries(sel.positions, S.mkt, pid);
    const info = periodInfo();

    // index comparison: tiles double as chart toggles; with any selected the chart switches to % change
    const ixList = Core.indexSummary(S.mkt, pid);
    const cmp = (S.prefs.cmp || []).filter((sym) => ixList.some((x) => x.sym === sym && !x.missing));
    let spec;
    if (cmp.length) {
      const pBase = pid === 'ALL' ? Core.finalize(Core.summarize(sel.positions, S.mkt, Core.indexPeriod(pid))).total.start : t.start;
      const ls = [];
      Core.INDEXES.forEach((ix) => {
        if (!cmp.includes(ix.sym)) return;
        const L = Core.indexLine(ix.sym, S.mkt, pid, series.t);
        if (L) ls.push({ key: ix.sym, label: ix.label, color: ix.color, v: L.v, base: L.base });
      });
      ls.push({ key: 'portfolio', label: sel.name, color: 1, v: series.v, base: pBase });
      spec = { t: series.t, series: ls, mode: 'pct', pid };
    } else {
      spec = { t: series.t, series: [{ key: 'portfolio', label: sel.name, color: 1, v: series.v, base: t.start }], mode: 'value', base: t.start, pid };
    }
    const legend = cmp.length
      ? `<div class="legend" aria-label="Chart legend">${spec.series.slice().reverse().map((l) => `<span class="lg"><i class="sw" style="background:var(--s${l.color})"></i>${esc(l.label)} <b>${pct(l.v[l.v.length - 1] / l.base - 1)}</b></span>`).join('')}</div>`
      : '';
    const note = cmp.length
      ? `Percent change from the start of the period${pid === 'ALL' ? ' (past year in this view)' : ''}; your line uses today’s holdings.`
      : `${pid === 'ALL' ? 'Chart shows the past year; dashed line = total book cost.' : 'Dashed line = value at the start of the period.'} Current holdings valued over time.`;
    const gainLine = pid === 'ALL' ? '' : `<span class="p-sub">Since cost: <span class="${t.gain >= 0 ? 'pos' : 'neg'}"><span class="amt">${money(t.gain, { sign: true })}</span> (${pct(t.gainPct)})</span></span>`;

    app.innerHTML = `
      ${bannerHtml()}
      <div class="cards">${cards}</div>
      ${marketsHtml(ixList, pid, cmp)}
      <section class="panel" aria-label="${esc(sel.name)} detail">
        <div class="p-head">
          <div>
            <div class="p-title"><strong>${esc(sel.name)}</strong> · ${esc(info.long)}</div>
            <div class="p-val amt">${money(t.value)}</div>
          </div>
          <div style="text-align:right">
            <div class="p-chg" style="justify-content:flex-end">${chg(t.change, t.pct)}</div>
            ${gainLine}
          </div>
        </div>
        ${legend}
        <div class="chart" id="chart"></div>
        <div class="legend-note">${note}</div>
        <div class="tbl-wrap">${tableHtml(fin.rows)}</div>
      </section>
      <div class="foot">
        <p>Changes are price-only (distributions aren’t included) and assume you held today’s positions for the whole period, so they aren’t your personal time-weighted return. GICs accrue at their stated rate; savings accounts and manual funds are held flat.</p>
        <p>Your holdings are stored only in this browser — never on the server. Prices: Yahoo Finance, refreshed every ~30 minutes on market days (may be delayed; thinly traded ETFs can differ slightly from RBC).</p>
      </div>`;
    drawChart($('#chart'), spec);
  }

  function marketsHtml(ixList, pid, cmp) {
    if (ixList.every((x) => x.missing)) return '';
    const tiles = ixList.map((x) => {
      if (x.missing) return `<div class="tile off"><div class="t-name"><i class="sw" style="background:var(--s${x.color})"></i>${esc(x.label)}</div><div class="t-sub">no data yet</div></div>`;
      const flat = Math.abs(x.change) < 0.005, cls = flat ? 'flat' : x.change > 0 ? 'pos' : 'neg', arrow = flat ? '▬' : x.change > 0 ? '▲' : '▼';
      const pts = (x.change > 0 ? '+' : x.change < 0 ? '−' : '') + group2.format(Math.abs(x.change)) + ' pts';
      const first = S.prefs.unit === 'pct' ? pct(x.pct) : pts, second = S.prefs.unit === 'pct' ? pts : pct(x.pct);
      const on = cmp.includes(x.sym);
      return `<button type="button" class="tile${on ? ' on' : ''}" data-ix="${esc(x.sym)}" aria-pressed="${on}" title="${on ? 'Hide from' : 'Compare on'} chart">
        <div class="t-name"><i class="sw" style="background:var(--s${x.color})"></i>${esc(x.label)}</div>
        <div class="t-val">${group2.format(x.level)}</div>
        <div class="t-chg"><span class="chg ${cls}"><span aria-hidden="true">${arrow}</span> <b>${first}</b></span> <span class="chg2">${second}</span></div>
      </button>`;
    }).join('');
    return `<section class="markets" aria-label="Market indexes">
      <div class="m-head"><strong>Markets</strong> · ${esc(pid === 'ALL' ? 'past year' : periodInfo().long.toLowerCase())} <span class="m-hint">Tap an index to compare it with the selected portfolio on the chart</span></div>
      <div class="tiles">${tiles}</div></section>`;
  }

  /* ---------- freshness (tells the truth about how old the prices are) ---------- */
  // latest quote time across the holdings/index feed (ignores FX, which trades around the clock)
  function latestQuote() {
    if (!S.prices) return null;
    let m = 0;
    Object.entries(S.prices.symbols || {}).forEach(([k, s]) => { if (!/=X$/.test(k) && s.time > m) m = s.time; });
    return m ? m * 1000 : null;
  }
  // TSX/NYSE regular session, Mon–Fri 9:30–16:00 Toronto time (holidays not known)
  function marketOpen(now) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(now || new Date()).map((x) => [x.type, x.value]));
    const mins = +p.hour * 60 + +p.minute;
    return !/Sat|Sun/.test(p.weekday) && mins >= 570 && mins < 960;
  }
  function freshness() {
    const q = latestQuote();
    if (!q) return null;
    const age = Date.now() - q, open = marketOpen();
    return { q, age, open, stale: open && age > 45 * 60000 };
  }
  const quoteFmt = dFmt({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function statusText() {
    if (!S.accounts.length) return 'Add your holdings to get started';
    if (S.prices) {
      const f = freshness();
      if (!f) return `Market data as of ${esc(fmtDay(S.mkt.ref))}`;
      const when = esc(quoteFmt.format(new Date(f.q))) + ' ET';
      if (f.stale) return `<span class="stale">⚠ Prices from ${when} — the scheduled update is behind</span>`;
      return `Prices as of ${when}${f.open ? ' (market open, ~15 min delay)' : ' · market closed'}`;
    }
    return S.error ? 'Price feed unavailable — showing last RBC prices (no history)' : 'Loading prices…';
  }

  /* ---------- manual refresh with cooldown ---------- */
  const COOLDOWN = 60 * 1000;
  let lastManual = 0, cdTimer = null;
  async function manualRefresh() {
    const btn = $('#refresh');
    const wait = COOLDOWN - (Date.now() - lastManual);
    if (wait > 0) { toast(`Just checked — try again in ${Math.ceil(wait / 1000)} s`, 2000); return; }
    lastManual = Date.now();
    const before = latestQuote();
    btn.disabled = true; btn.classList.add('spin');
    await loadPrices();
    btn.classList.remove('spin');
    const f = freshness();
    if (S.error) toast('Couldn’t reach the price feed — check your connection and try again.');
    else if (!f) toast('No prices available yet.');
    else {
      const when = quoteFmt.format(new Date(f.q)) + ' ET';
      if (before && f.q > before) toast(`Updated — prices as of ${when}`);
      else if (!f.open) toast(`Market is closed. These are the latest prices (${when}).`, 5000);
      else toast(`No newer prices published yet. Latest is ${when} (${ago(new Date(f.q).toISOString())}). Updates are published about every 15 minutes.`, 6500);
    }
    clearTimeout(cdTimer);
    cdTimer = setTimeout(() => { btn.disabled = false; }, COOLDOWN);
  }

  function repoEditUrl() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    const seg = location.pathname.split('/')[1];
    return m && seg ? `https://github.com/${m[1]}/${seg}/edit/main/symbols.txt` : null;
  }
  function bannerHtml() {
    if (!S.accounts.length) return '';
    if (!S.prices) {
      return S.error ? `<div class="banner">Couldn’t load <code>data/prices.json</code> (${esc(S.error)}). Showing last RBC prices, so changes read as zero until the price feed loads.</div>` : '';
    }
    const miss = Core.missingSymbols(S.accounts, S.mkt);
    if (!miss.length) return '';
    const url = repoEditUrl();
    const list = miss.map((m) => `<b>${esc(m.yahoo)}</b>`).join(', ');
    return `<div class="banner">No price history yet for ${list}. Add ${miss.length > 1 ? 'them' : 'it'} to <code>symbols.txt</code>${url ? ` (<a href="${esc(url)}" target="_blank" rel="noopener">edit on GitHub</a>)` : ''} — the next update picks ${miss.length > 1 ? 'them' : 'it'} up. Until then ${miss.length > 1 ? 'they use' : 'it uses'} the last RBC price.</div>`;
  }

  function emptyHtml() {
    return `<div class="empty">
      <h2>Let’s load your holdings</h2>
      <p>Drop your RBC Direct Investing <b>Holdings</b> CSV exports here — one file per account — or choose them below.</p>
      <p style="margin-bottom:16px">Everything stays in this browser. Nothing about your accounts is uploaded anywhere.</p>
      <button type="button" class="btn primary" data-act="import">Choose CSV files</button>
      <p style="margin-top:18px"><button type="button" class="btn" data-act="pastelink">Load from private link…</button> <button type="button" class="btn" data-act="restore">Restore from backup file</button></p>
    </div>`;
  }

  function spark(ser, base) {
    const v = ser.v, n = v.length;
    if (n < 2) return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg>';
    const all = v.concat([base]);
    let min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    const span = max - min || 1;
    const y = (x) => (28 - ((x - min) / span) * 26 + 1).toFixed(2);
    const d = v.map((x, i) => (i ? 'L' : 'M') + ((i / (n - 1)) * 100).toFixed(2) + ' ' + y(x)).join('');
    return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="100" y1="${y(base)}" y2="${y(base)}"/><path d="${d}"/></svg>`;
  }

  function tableHtml(rows) {
    const key = S.prefs.sort, dir = S.prefs.dir;
    const val = { value: (r) => r.value, weight: (r) => r.weight, change: (r) => r.change, pct: (r) => (r.pct == null ? -Infinity : r.pct), gain: (r) => r.gain, symbol: (r) => r.symbol };
    const sorted = rows.slice().sort((a, b) => {
      const x = val[key](a), y = val[key](b);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || a.symbol.localeCompare(b.symbol);
    });
    const arrow = (k) => (S.prefs.sort === k ? (S.prefs.dir < 0 ? ' ▼' : ' ▲') : '');
    const maxW = Math.max.apply(null, rows.map((r) => r.weight).concat([0.0001]));
    const price = (r) => {
      if (r.kind === 'cash') return '—';
      if (r.kind === 'fixed') return (r.price * 100).toFixed(2) + '<span class="sub"> /100</span>';
      const p = r.price;
      return (p < 1 ? p.toFixed(4) : group2.format(p)) + (r.currency !== 'CAD' ? `<span class="tag">${esc(r.currency)}</span>` : '');
    };
    const body = sorted.map((r) => {
      const tag = r.kind === 'fixed' ? '<span class="tag">GIC / bond</span>' : r.kind === 'manual' ? '<span class="tag">flat</span>' : r.missing ? '<span class="tag warn" title="No price feed for this symbol yet — using the last RBC price">RBC price</span>' : '';
      const part = r.partial ? `<span class="tag" title="This fund is newer than the selected period; change is measured from its first available price">since ${esc(fmtShort(r.partial).replace(/, \d{4}$/, ''))}</span>` : '';
      return `<tr>
        <td><div class="sym">${esc(r.kind === 'cash' ? 'Cash' : r.symbol)}${tag}${part}</div><div class="nm" title="${esc(r.name)}">${esc(r.kind === 'cash' ? r.currency : r.name)}</div></td>
        <td class="r hide-sm amt">${r.kind === 'cash' ? '' : qtyFmt.format(r.qty)}</td>
        <td class="r">${price(r)}</td>
        <td class="r"><span class="amt">${money(r.value)}</span></td>
        <td class="r hide-sm">${(r.weight * 100).toFixed(1)}%<div class="wbar"><i style="width:${((r.weight / maxW) * 100).toFixed(1)}%"></i></div></td>
        <td class="r">${chg(r.change, r.pct, { dec: 0 })}</td>
        <td class="r hide-sm ${r.gain >= 0.5 ? 'pos' : r.gain <= -0.5 ? 'neg' : 'flat'}">${r.kind === 'cash' ? '' : `<span class="amt">${money(r.gain, { sign: true })}</span><div class="sub">${pct(r.gainPct)}</div>`}</td>
      </tr>`;
    }).join('');
    return `<table class="tbl"><thead><tr>
      <th data-sort="symbol">Holding${arrow('symbol')}</th><th class="r hide-sm">Qty</th><th class="r">Price</th>
      <th class="r" data-sort="value">Value${arrow('value')}</th><th class="r hide-sm" data-sort="weight">Weight${arrow('weight')}</th>
      <th class="r" data-sort="pct">Change${arrow('pct')}</th><th class="r hide-sm" data-sort="gain">Gain vs cost${arrow('gain')}</th>
    </tr></thead><tbody>${body}</tbody></table>`;
  }

  /* ---------- chart ---------- */
  function niceTicks(min, max, n) {
    const span = max - min || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
    return { ticks: out, step };
  }

  // spec: { t:[ms], series:[{key,label,color(1-5),v:[],base}], mode:'value'|'pct', base (value mode), pid }
  function drawChart(host, spec) {
    if (!host) return;
    const { t, series, mode, pid } = spec;
    const n = t.length, hide = S.prefs.hide, pctMode = mode === 'pct';
    const lines = series.map((s) => Object.assign({}, s, { y: pctMode ? s.v.map((x) => (s.base ? x / s.base - 1 : 0)) : s.v }));
    const baseY = pctMode ? 0 : spec.base;
    const W = Math.max(280, host.clientWidth || 600), H = W < 520 ? 210 : 280;
    const showYLabels = pctMode || !hide;
    const padL = !showYLabels ? 12 : (pctMode ? 54 : (W < 520 ? 66 : 80)), padR = 12, padT = 10, padB = 24;
    let min = baseY, max = baseY;
    lines.forEach((l) => l.y.forEach((v) => { if (v < min) min = v; if (v > max) max = v; }));
    const span = (max - min) || Math.abs(max) * 0.01 || 1;
    min -= span * 0.12; max += span * 0.12;
    const X = (i) => padL + (n === 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
    const Y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const { ticks, step } = niceTicks(min, max, 4);

    const tf = pid === '1D' ? dFmt({ hour: 'numeric', minute: '2-digit' })
      : (pid === '1Y' || pid === '3Y' || pid === 'ALL') ? dFmt({ month: 'short', year: 'numeric' }) : dFmt({ month: 'short', day: 'numeric' });
    const tipFmt = (pid === '1D' || pid === '1W') ? dFmt({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : dFmt({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const nx = W < 520 ? 4 : 6;
    const xs = [];
    for (let k = 0; k < nx; k++) xs.push(Math.round((k * (n - 1)) / (nx - 1)));
    const ylab = (v) => {
      if (pctMode) { const d = step >= 0.01 ? 0 : step >= 0.001 ? 1 : 2; const a = Math.abs(v * 100).toFixed(d); return (Math.abs(v) < 1e-9 ? '' : v > 0 ? '+' : '−') + a + '%'; }
      return '$' + (step >= 1 ? group.format(Math.round(v)) : group2.format(v));
    };

    const port = lines[lines.length - 1];
    const label = pctMode
      ? 'Percent change over the period: ' + lines.map((l) => `${l.label} ${pct(l.y[n - 1])}`).join(', ') + '.'
      : `Value moved from ${money(port.v[0])} to ${money(port.v[n - 1])} over the period.`;
    const paths = lines.map((l) => `<path class="line" style="stroke:var(--s${l.color})" d="${l.y.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('')}"/>`).join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${(hide && !pctMode) ? 'Portfolio value chart' : esc(label)}">
      ${ticks.map((v) => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>${showYLabels ? `<text x="${padL - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${ylab(v)}</text>` : ''}`).join('')}
      <line class="base" x1="${padL}" x2="${W - padR}" y1="${Y(baseY).toFixed(1)}" y2="${Y(baseY).toFixed(1)}"/>
      ${xs.map((i, k) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === nx - 1 ? 'end' : 'middle'}">${esc(tf.format(new Date(t[i])))}</text>`).join('')}
      ${paths}
      <g id="hv" style="display:none"><line class="cross" y1="${padT}" y2="${H - padB}"/>${lines.map((l) => `<circle class="dot" r="5" style="fill:var(--s${l.color})"/>`).join('')}</g>
      <rect id="hit" x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent"/>
    </svg><div class="tip" id="tip"></div>`;

    const svg = host.querySelector('svg'), hv = svg.querySelector('#hv'), tip = host.querySelector('#tip');
    const cross = hv.querySelector('line'), dots = hv.querySelectorAll('circle');
    function show(ev) {
      const r = svg.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(n - 1, Math.round(((x - padL) / (W - padL - padR)) * (n - 1))));
      const px = X(i);
      hv.style.display = '';
      cross.setAttribute('x1', px); cross.setAttribute('x2', px);
      lines.forEach((l, k) => { dots[k].setAttribute('cx', px); dots[k].setAttribute('cy', Y(l.y[i])); });
      let body;
      if (pctMode) {
        body = lines.slice().reverse().map((l) => `<div class="trow"><i class="sw" style="background:var(--s${l.color})"></i>${esc(l.label)} <b>${pct(l.y[i])}</b>${l.key === 'portfolio' && !hide ? ` <span class="chg2 amt">${money(l.v[i] - l.base, { sign: true })}</span>` : ''}</div>`).join('');
      } else {
        const d = port.v[i] - spec.base, p = spec.base ? d / spec.base : null;
        body = `${hide ? '' : `<div class="t2">${money(port.v[i])}</div>`}<div>${chg(d, p)}</div>`;
      }
      tip.innerHTML = `<div class="t1">${esc(tipFmt.format(new Date(t[i])))}</div>${body}`;
      tip.style.display = 'block';
      const tw = tip.offsetWidth, scale = r.width / W;
      let left = px * scale + 12;
      if (left + tw > r.width) left = px * scale - tw - 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = Math.max(0, Y(port.y[i]) * scale - 54) + 'px';
    }
    const hide2 = () => { hv.style.display = 'none'; tip.style.display = 'none'; };
    const hit = svg.querySelector('#hit');
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide2);
  }

  /* ---------- toasts ---------- */
  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, ms || 4500);
  }

  /* ---------- import / export ---------- */
  async function importFiles(files) {
    const done = [], errs = [];
    for (const f of Array.from(files)) {
      try {
        const text = await f.text();
        const acct = Core.parseRbcHoldings(text);
        const r = Core.upsertAccount(S.accounts, acct);
        S.accounts = r.accounts;
        done.push(`${acct.name} ${r.replaced ? '(updated)' : '(added)'}`);
      } catch (e) { errs.push(`${f.name}: ${e.message}`); }
    }
    if (done.length) { saveAccounts(); render(); }
    if (errs.length) alert('Some files could not be read:\n\n' + errs.join('\n'));
    if (done.length) toast('Imported: ' + done.join(', '));
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function pickFile(accept, cb) {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => { if (i.files[0]) cb(i.files[0]); };
    i.click();
  }

  const b64u = (bytes) => btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  async function encodeShare(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (window.CompressionStream) {
      const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      return 'z.' + b64u(new Uint8Array(buf));
    }
    return 'j.' + b64u(bytes);
  }
  async function decodeShare(code) {
    const kind = code.slice(0, 2), raw = unb64u(code.slice(2));
    let bytes = raw;
    if (kind === 'z.') bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function loadFromHash() {
    const m = location.hash.match(/^#d=(.+)$/);
    if (!m) return;
    try {
      const data = await decodeShare(m[1]);
      if (!data || !Array.isArray(data.accounts)) throw new Error('bad link');
      if (!S.accounts.length || confirm(`Replace the holdings saved on this device with the ${data.accounts.length} account(s) in this link?`)) {
        S.accounts = data.accounts; saveAccounts();
        toast('Holdings loaded from link');
      }
    } catch (e) { alert('That private link could not be read.'); }
    history.replaceState(null, '', location.pathname + location.search);
  }

  // for an installed phone app, where you can't open a link inside it: paste the link text instead
  async function loadFromLink(text) {
    const m = String(text || '').trim().match(/#d=([^\s#]+)$/);
    if (!m) { alert('That doesn’t look like a private link — it should contain “#d=”.'); return; }
    try {
      const data = await decodeShare(m[1]);
      if (!data || !Array.isArray(data.accounts)) throw new Error('bad link');
      if (!S.accounts.length || confirm(`Replace the holdings on this device with the ${data.accounts.length} account(s) in that link?`)) {
        S.accounts = data.accounts; saveAccounts(); closeDlg(); render(); toast('Holdings loaded from link');
      }
    } catch (e) { alert('That private link could not be read.'); }
  }

  /* ---------- dialogs ---------- */
  const dlg = () => $('#dlg');
  function openDlg(html) { const d = dlg(); d.innerHTML = `<div class="dlg">${html}</div>`; if (!d.open) d.showModal(); }
  const closeDlg = () => { const d = dlg(); if (d.open) d.close(); };

  function manageDlg() {
    const rows = S.accounts.map((a) => `<div class="acct-row"><div class="grow"><b>${esc(a.name)}</b> <span class="c-sub">••${esc(String(a.id).slice(-4))}${a.asOf ? ' · RBC data ' + esc(fmtShort(a.asOf)) : ''} · ${a.positions.length} holdings</span></div>
      <button type="button" class="btn" data-act="edit" data-id="${esc(a.id)}">Edit</button>
      <button type="button" class="btn danger" data-act="remove" data-id="${esc(a.id)}">Remove</button></div>`).join('');
    openDlg(`<h2>Manage holdings</h2>
      <h3>Update from RBC</h3>
      <p>After you trade, export each account’s <b>Holdings</b> CSV from RBC Direct Investing and import it here — an account with the same number is replaced with the new holdings. (You can also drag the files onto the page.)</p>
      <div class="row"><button type="button" class="btn primary" data-act="import">Import CSV files…</button></div>
      <h3>Accounts</h3>${rows || '<p>No accounts yet.</p>'}
      <div class="row" style="margin-top:8px"><button type="button" class="btn" data-act="add">+ Add account manually</button></div>
      <h3>Backup &amp; other devices</h3>
      <p>Holdings are kept in this browser only. To use the dashboard on your phone, copy the private link and open it there — it carries your holdings in the part of the URL after “#”, which is never sent to any server. Treat the link like a password.</p>
      <div class="row">
        <button type="button" class="btn" data-act="link">Copy private link</button>
        <button type="button" class="btn" data-act="export">Download backup</button>
        <button type="button" class="btn" data-act="restore">Restore backup…</button>
        <button type="button" class="btn" data-act="pastelink">Load from private link…</button>
      </div>
      <div class="dlg-actions"><button type="button" class="btn danger" data-act="clear">Erase everything on this device</button><button type="button" class="btn primary" data-act="close">Done</button></div>`);
  }

  let ED = null;
  function editDlg(id) {
    const a = S.accounts.find((x) => x.id === id);
    ED = a ? JSON.parse(JSON.stringify(a)) : { id: '', name: '', asOf: null, cash: {}, positions: [], isNew: true };
    renderEdit();
  }
  function renderEdit() {
    const a = ED;
    const row = (p, i) => `<tr>
      <td><input data-i="${i}" data-f="symbol" value="${esc(p.symbol)}" placeholder="XEQT" aria-label="Symbol"></td>
      <td><select data-i="${i}" data-f="kind" aria-label="Type"><option value="market"${p.kind === 'market' ? ' selected' : ''}>Stock / ETF</option><option value="manual"${p.kind === 'manual' ? ' selected' : ''}>Fund (flat)</option><option value="fixed"${p.kind === 'fixed' ? ' selected' : ''}>GIC / bond</option></select></td>
      <td><select data-i="${i}" data-f="currency" aria-label="Currency"><option${p.currency === 'CAD' ? ' selected' : ''}>CAD</option><option${p.currency === 'USD' ? ' selected' : ''}>USD</option></select></td>
      <td><input data-i="${i}" data-f="qty" type="number" step="any" value="${esc(p.qty)}" aria-label="Quantity"></td>
      <td><input data-i="${i}" data-f="book" type="number" step="any" value="${p.book == null ? '' : esc(p.book)}" aria-label="Total book cost"></td>
      <td><input data-i="${i}" data-f="unit" type="number" step="any" value="${esc(p.unit)}" aria-label="Last price or value per unit"></td>
      <td><button type="button" class="btn" data-act="delrow" data-i="${i}" aria-label="Remove row">✕</button></td></tr>`;
    openDlg(`<h2>${a.isNew ? 'Add account' : 'Edit account'}</h2>
      <p>Made a trade? Change the quantity and total book cost here, or re-import the RBC CSV instead. “Price / unit” is only used when there is no price feed for the symbol (and as the value of flat funds and GICs).</p>
      <div class="row" style="margin:10px 0">
        <label style="flex:2;min-width:180px">Account name<input id="e-name" value="${esc(a.name)}"></label>
        <label style="flex:1;min-width:140px">Account number<input id="e-id" value="${esc(a.id)}" ${a.isNew ? '' : 'disabled'} placeholder="e.g. 12345678"></label>
        <label style="flex:1;min-width:120px">Cash (CAD)<input id="e-cad" type="number" step="any" value="${esc((a.cash || {}).CAD || 0)}"></label>
        <label style="flex:1;min-width:120px">Cash (USD)<input id="e-usd" type="number" step="any" value="${esc((a.cash || {}).USD || 0)}"></label>
      </div>
      <div class="edit-wrap"><table class="edit-tbl"><thead><tr><th>Symbol</th><th>Type</th><th>Cur.</th><th>Quantity</th><th>Book cost</th><th>Price / unit</th><th></th></tr></thead>
      <tbody>${a.positions.map(row).join('')}</tbody></table></div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn" data-act="addrow">+ Add holding</button></div>
      <div class="dlg-actions"><button type="button" class="btn" data-act="manage">Cancel</button><button type="button" class="btn primary" data-act="saveedit">Save</button></div>`);
  }
  function saveEdit() {
    const a = ED;
    const name = $('#e-name').value.trim(), id = ($('#e-id').value || a.id).trim();
    if (!name || !id) { alert('Give the account a name and number.'); return; }
    if (a.isNew && S.accounts.some((x) => x.id === id)) { alert('An account with that number already exists.'); return; }
    const cash = {};
    const cad = parseFloat($('#e-cad').value), usd = parseFloat($('#e-usd').value);
    if (cad) cash.CAD = cad; if (usd) cash.USD = usd;
    const positions = a.positions.filter((p) => p.symbol && Number(p.qty)).map((p) => {
      const q = { symbol: String(p.symbol).trim().toUpperCase(), name: p.name || '', kind: p.kind, currency: p.currency || 'CAD', qty: Number(p.qty), book: p.book === '' || p.book == null ? null : Number(p.book), unit: Number(p.unit) || 0 };
      if (p.coupon) q.coupon = p.coupon; if (p.maturity) q.maturity = p.maturity; if (p.yahoo) q.yahoo = p.yahoo;
      return q;
    });
    const old = S.accounts.find((x) => x.id === id);
    const out = { id, name, asOf: a.asOf, cash, positions, customName: (old && old.customName) || (old && old.name !== name) || undefined };
    if (!out.asOf) out.asOf = new Date().toISOString().slice(0, 10);
    S.accounts = old ? S.accounts.map((x) => (x.id === id ? out : x)) : S.accounts.concat([out]);
    saveAccounts(); closeDlg(); render(); toast('Saved ' + name);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, th[data-sort]');
    if (!t) return;
    if (t.dataset.period) { S.prefs.period = t.dataset.period; savePrefs(); return render(); }
    if (t.dataset.ix) {
      const cur = S.prefs.cmp || [];
      S.prefs.cmp = cur.includes(t.dataset.ix) ? cur.filter((x) => x !== t.dataset.ix) : cur.concat([t.dataset.ix]);
      savePrefs(); return render();
    }
    if (t.dataset.unit) { S.prefs.unit = t.dataset.unit; savePrefs(); return render(); }
    if (t.dataset.sel) { S.prefs.sel = t.dataset.sel; savePrefs(); render(); const p = $('.panel'); if (p && window.innerWidth < 900) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (t.dataset.sort) {
      const k = t.dataset.sort;
      if (S.prefs.sort === k) S.prefs.dir *= -1; else { S.prefs.sort = k; S.prefs.dir = k === 'symbol' ? 1 : -1; }
      savePrefs(); return render();
    }
    if (t.id === 'hide') { S.prefs.hide = !S.prefs.hide; savePrefs(); return render(); }
    if (t.id === 'theme') return cycleTheme();
    if (t.id === 'refresh') return manualRefresh();
    if (t.id === 'manage') return manageDlg();
    const act = t.dataset.act;
    if (!act) return;
    const id = t.dataset.id;
    switch (act) {
      case 'import': $('#file').click(); break;
      case 'close': closeDlg(); break;
      case 'manage': manageDlg(); break;
      case 'edit': editDlg(id); break;
      case 'add': editDlg(null); break;
      case 'remove': {
        const a = S.accounts.find((x) => x.id === id);
        if (a && confirm(`Remove “${a.name}” from this dashboard? (This does not touch your RBC account.)`)) {
          S.accounts = S.accounts.filter((x) => x.id !== id); if (S.prefs.sel === id) S.prefs.sel = 'all';
          saveAccounts(); savePrefs(); render(); manageDlg();
        }
        break;
      }
      case 'addrow': ED.positions.push({ symbol: '', kind: 'market', currency: 'CAD', qty: 0, book: null, unit: 0 }); renderEdit(); break;
      case 'delrow': ED.positions.splice(+t.dataset.i, 1); renderEdit(); break;
      case 'saveedit': saveEdit(); break;
      case 'export': download(`portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, accounts: S.accounts }, null, 1)); break;
      case 'restore': pickFile('.json,application/json', async (f) => {
        try {
          const d = JSON.parse(await f.text());
          if (!Array.isArray(d.accounts)) throw new Error('no accounts in file');
          if (!S.accounts.length || confirm('Replace the holdings on this device with the backup?')) { S.accounts = d.accounts; saveAccounts(); closeDlg(); render(); toast('Backup restored'); }
        } catch (err) { alert('Could not read that backup: ' + err.message); }
      }); break;
      case 'pastelink': loadFromLink(prompt('Paste your private link here:')); break;
      case 'link': {
        const url = location.origin + location.pathname + '#d=' + await encodeShare({ version: 1, accounts: S.accounts });
        try { await navigator.clipboard.writeText(url); toast('Private link copied — open it on your other device'); }
        catch (err) { prompt('Copy this private link:', url); }
        break;
      }
      case 'clear':
        if (confirm('Erase all holdings stored in this browser? Make a backup first if you want to keep them.')) {
          S.accounts = []; S.prefs.sel = 'all'; saveAccounts(); savePrefs(); closeDlg(); render();
        }
        break;
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target, f = el.dataset && el.dataset.f;
    if (!f || !ED) return;
    const p = ED.positions[+el.dataset.i];
    if (!p) return;
    p[f] = (f === 'qty' || f === 'unit') ? el.value : f === 'book' ? (el.value === '' ? null : el.value) : el.value;
  });

  $('#file').addEventListener('change', async (e) => { await importFiles(e.target.files); e.target.value = ''; if (dlg().open) manageDlg(); });
  ['dragover', 'dragenter'].forEach((ev) => document.addEventListener(ev, (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); document.body.classList.add('drop-on'); } }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { if (ev === 'dragleave' && e.relatedTarget) return; document.body.classList.remove('drop-on'); }));
  document.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); importFiles(e.dataTransfer.files); } });

  function cycleTheme() {
    const cur = document.documentElement.dataset.theme || 'auto';
    const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    if (next === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    try { localStorage.setItem('pd.theme', next); } catch (e) { /* ignore */ }
    toast('Theme: ' + next, 1500);
  }

  window.addEventListener('hashchange', async () => { await loadFromHash(); render(); });

  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });

  /* ---------- prices ---------- */
  async function loadPrices() {
    try {
      const r = await fetch('data/prices.json?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      S.prices = await r.json(); S.error = null;
    } catch (e) { S.error = e.message; }
    S.mkt = Core.makeMarket(S.prices);
    render();
  }

  /* ---------- boot ---------- */
  async function boot() {
    load();
    await loadFromHash();
    render();
    await loadPrices();
    setInterval(loadPrices, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadPrices(); });
  }
  window.App = { S, render, importFiles, loadPrices, loadFromLink }; // handy for debugging
  boot();
})();
