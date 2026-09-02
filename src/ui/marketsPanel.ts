/**
 * MARKETS view — the trading-desk workspace of the OS: FX, crypto,
 * crypto derivatives, and the broker seam, over the spatial API's
 * markets proxy.
 *
 * Basis discipline on every desk:
 *   - each desk leads with its source line and disclaimer — an ECB
 *     daily fix is never dressed up as a live quote, a single venue's
 *     prints are never called "the market";
 *   - every number this panel DERIVES (a % change, an annualized
 *     basis, a funding APR, a P/C ratio) is labeled COMPUTED with the
 *     inputs named;
 *   - a desk whose feed refuses renders the typed refusal WITH ITS
 *     REMEDY — never an empty desk, never yesterday's numbers unmarked
 *     (a stale cache is served with its age stated);
 *   - the BROKER desk is a READ-ONLY adapter seam: no order capability
 *     exists on this surface by design. Execution belongs to the
 *     Terminal backend under its own authority model.
 */

import type { AppApi } from '../app/api';
import { resolveApiBase } from '../data/sources';
import {
  annualizedBasis,
  fetchBroker,
  fetchCrypto,
  fetchDerivatives,
  fetchFx,
  type BrokerStatus,
  type CryptoSet,
  type DerivCurrency,
  type DerivSet,
  type FxSet,
  type MarketResult,
} from '../live/markets';
import { drawSparkline } from './sparkline';
import './markets.css';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Desk = 'fx' | 'crypto' | 'derivatives' | 'broker';

const DESKS: { id: Desk; label: string }[] = [
  { id: 'fx', label: 'FX' },
  { id: 'crypto', label: 'CRYPTO' },
  { id: 'derivatives', label: 'DERIVATIVES' },
  { id: 'broker', label: 'BROKER' },
];

/** Market-convention pairs from the USD-based fix (exact arithmetic). */
const FX_PAIRS: { sym: string; label: string; invert: boolean; dp: number }[] = [
  { sym: 'EUR', label: 'EUR/USD', invert: true, dp: 4 },
  { sym: 'GBP', label: 'GBP/USD', invert: true, dp: 4 },
  { sym: 'AUD', label: 'AUD/USD', invert: true, dp: 4 },
  { sym: 'JPY', label: 'USD/JPY', invert: false, dp: 2 },
  { sym: 'CHF', label: 'USD/CHF', invert: false, dp: 4 },
  { sym: 'CAD', label: 'USD/CAD', invert: false, dp: 4 },
  { sym: 'CNY', label: 'USD/CNY', invert: false, dp: 4 },
  { sym: 'INR', label: 'USD/INR', invert: false, dp: 2 },
  { sym: 'BRL', label: 'USD/BRL', invert: false, dp: 4 },
  { sym: 'MXN', label: 'USD/MXN', invert: false, dp: 3 },
  { sym: 'KRW', label: 'USD/KRW', invert: false, dp: 1 },
  { sym: 'SGD', label: 'USD/SGD', invert: false, dp: 4 },
];

const fmtN = (v: number, dp = 0): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

const fmtUsdCompact = (v: number): string =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${fmtN(v)}`;

const fmtExpiry = (iso: string | null): string =>
  iso
    ? new Date(iso).toUTCString().slice(5, 16).toUpperCase() // '26 MAR 2027' → trimmed below
    : '—';

const pctClass = (v: number): string => (v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : '');
const signedPct = (v: number, dp = 2): string => `${v > 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

export function createMarketsPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'os-panel mk-panel';
  el.hidden = true;

  const header = document.createElement('div');
  header.className = 'os-panel-head';
  header.innerHTML = `
    <div>
      <div class="os-panel-kicker">TRADING DESK</div>
      <div class="os-panel-title">Markets</div>
    </div>`;
  const close = document.createElement('button');
  close.className = 'os-panel-close';
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => api.setPreset(api.getLastLayerPreset()));
  header.appendChild(close);

  const chips = document.createElement('div');
  chips.className = 'mk-chips';

  const statusLine = document.createElement('div');
  statusLine.className = 'mk-status';

  const body = document.createElement('div');
  body.className = 'mk-body';

  const peek = document.createElement('button');
  peek.type = 'button';
  peek.className = 'ops-peek-btn';
  peek.textContent = 'HOLD TO VIEW GLOBE';
  peek.addEventListener('pointerdown', () => {
    el.classList.add('ops-peek');
    window.addEventListener('pointerup', () => el.classList.remove('ops-peek'), { once: true });
  });

  el.append(header, chips, statusLine, body, peek);

  // ---------------------------------------------------------------- state

  let desk: Desk = 'fx';
  let open = false;
  let timer: number | undefined;
  const results: {
    fx?: MarketResult<FxSet>;
    crypto?: MarketResult<CryptoSet>;
    derivatives?: MarketResult<DerivSet>;
    broker?: MarketResult<BrokerStatus>;
  } = {};

  const refusalBox = (kind: string, message: string, remedy: string): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'ops-refusal';
    box.innerHTML = `
      <div class="ops-refusal-kind">${esc(kind.replace(/_/g, ' '))}</div>
      <div class="ops-refusal-detail">${esc(message)}</div>
      <div class="ops-refusal-remedy-label">REMEDY</div>
      <div class="ops-refusal-remedy">${esc(remedy)}</div>
      <div class="ops-refusal-note">The desk refuses rather than showing numbers it cannot vouch for.</div>`;
    return box;
  };

  const unreachableBox = (note: string): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'ops-refusal';
    box.innerHTML = `
      <div class="ops-refusal-kind">SPATIAL API UNREACHABLE</div>
      <div class="ops-refusal-detail">${esc(note)}</div>
      <div class="ops-refusal-remedy-label">REMEDY</div>
      <div class="ops-refusal-remedy">start the spatial API (npm run server) — market desks are served through its proxy, never fetched from venues directly</div>`;
    return box;
  };

  const basisLine = (text: string): HTMLElement => {
    const d = document.createElement('div');
    d.className = 'mk-basis';
    d.textContent = text;
    return d;
  };

  const setStatus = (fetchedAt?: string, cacheState?: string, upstream?: string): void => {
    if (!fetchedAt) {
      statusLine.innerHTML = `<span class="ops-live-dot ops-dot-down"></span><span class="ops-src">DESK UNAVAILABLE — see refusal below</span>`;
      return;
    }
    const age = Math.max(0, Math.round((Date.now() - Date.parse(fetchedAt)) / 1000));
    statusLine.innerHTML =
      `<span class="ops-live-dot"></span>FETCHED <b>${esc(fetchedAt.slice(11, 19))}Z</b> · ${age}s ago` +
      `${cacheState && cacheState !== 'live' ? ` · CACHE ${esc(cacheState.toUpperCase())}` : ''}` +
      ` · <span class="ops-src">${esc(upstream ?? '')}</span>`;
  };

  // ------------------------------------------------------------- FX desk

  const renderFx = (r: MarketResult<FxSet>): void => {
    if (r.kind === 'refused') {
      setStatus();
      body.appendChild(refusalBox(r.refusal.kind, r.refusal.message, r.refusal.remedy));
      return;
    }
    if (r.kind === 'unreachable') {
      setStatus();
      body.appendChild(unreachableBox(r.note));
      return;
    }
    const fx = r.data;
    setStatus(fx.fetchedAt, fx.cacheState, fx.upstream);
    body.appendChild(
      basisLine(
        `REPORTED · ECB DAILY REFERENCE FIX OF ${fx.latestDate} — an informational rate, not a tradeable quote. ` +
          `Pairs shown in market convention, derived from the USD-based fix by exact arithmetic.`
      )
    );
    const grid = document.createElement('div');
    grid.className = 'mk-grid';
    const prevDate = fx.dates.length > 1 ? fx.dates[fx.dates.length - 2] : null;
    for (const p of FX_PAIRS) {
      const raw = fx.rates[fx.latestDate]?.[p.sym];
      if (!Number.isFinite(raw)) continue;
      const rate = p.invert ? 1 / raw : raw;
      const tile = document.createElement('div');
      tile.className = 'mk-tile';
      let deltaHtml = `<span class="mk-delta">NO PRIOR FIX IN WINDOW</span>`;
      if (prevDate) {
        const rawPrev = fx.rates[prevDate]?.[p.sym];
        if (Number.isFinite(rawPrev)) {
          const prev = p.invert ? 1 / rawPrev : rawPrev;
          const d = rate / prev - 1;
          deltaHtml = `<span class="mk-delta ${pctClass(d)}">${esc(signedPct(d))} VS ${esc(prevDate.slice(5))} FIX · COMPUTED</span>`;
        }
      }
      tile.innerHTML = `
        <div class="mk-tile-head"><span class="mk-pair">${esc(p.label)}</span></div>
        <div class="mk-tile-value">${esc(fmtN(rate, p.dp))}</div>
        ${deltaHtml}`;
      const canvas = document.createElement('canvas');
      canvas.className = 'mk-spark';
      tile.appendChild(canvas);
      const pts = fx.dates
        .filter((d) => Number.isFinite(fx.rates[d]?.[p.sym]))
        .map((d) => ({ t: Date.parse(d), v: p.invert ? 1 / fx.rates[d][p.sym] : fx.rates[d][p.sym] }));
      const vals = pts.map((q) => q.v);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const pad = (hi - lo) * 0.1 || lo * 0.001;
      requestAnimationFrame(() => drawSparkline(canvas, pts, { min: lo - pad, max: hi + pad, color: '#4da6ff' }));
      const foot = document.createElement('div');
      foot.className = 'mk-tile-foot';
      foot.textContent = `${fx.dates[0]} → ${fx.latestDate} · ${pts.length} FIXES`;
      tile.appendChild(foot);
      grid.appendChild(tile);
    }
    body.appendChild(grid);
  };

  // --------------------------------------------------------- crypto desk

  const renderCrypto = (r: MarketResult<CryptoSet>): void => {
    if (r.kind === 'refused') {
      setStatus();
      body.appendChild(refusalBox(r.refusal.kind, r.refusal.message, r.refusal.remedy));
      return;
    }
    if (r.kind === 'unreachable') {
      setStatus();
      body.appendChild(unreachableBox(r.note));
      return;
    }
    const c = r.data;
    setStatus(c.fetchedAt, c.cacheState, c.upstream);
    body.appendChild(
      basisLine(
        'OBSERVED · SINGLE-VENUE SPOT PRINTS (Coinbase Exchange) — last trade, 24h stats, daily closes. Venue truth, not a composite index.'
      )
    );
    const grid = document.createElement('div');
    grid.className = 'mk-grid';
    for (const p of c.products) {
      const d24 = p.open24h > 0 ? p.last / p.open24h - 1 : null;
      const tile = document.createElement('div');
      tile.className = 'mk-tile';
      tile.innerHTML = `
        <div class="mk-tile-head"><span class="mk-pair">${esc(p.id.replace('-', '/'))}</span><span class="mk-kind">SPOT</span></div>
        <div class="mk-tile-value">${esc(fmtN(p.last, p.last >= 100 ? 2 : 4))}</div>
        ${
          d24 === null
            ? '<span class="mk-delta">24H OPEN UNAVAILABLE</span>'
            : `<span class="mk-delta ${pctClass(d24)}">${esc(signedPct(d24))} VS 24H OPEN · COMPUTED</span>`
        }`;
      const canvas = document.createElement('canvas');
      canvas.className = 'mk-spark';
      tile.appendChild(canvas);
      const pts = p.daily.map((q) => ({ t: q.t * 1000, v: q.close }));
      if (pts.length >= 2) {
        const vals = pts.map((q) => q.v);
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        const pad = (hi - lo) * 0.1 || lo * 0.001;
        requestAnimationFrame(() => drawSparkline(canvas, pts, { min: lo - pad, max: hi + pad, color: '#ffb454' }));
      }
      const foot = document.createElement('div');
      foot.className = 'mk-tile-foot';
      foot.textContent = `24H ${fmtN(p.low24h, 0)}–${fmtN(p.high24h, 0)} · VOL ${fmtN(p.volume24h, 0)} ${p.id.split('-')[0]} · ${pts.length}D CLOSES`;
      tile.appendChild(foot);
      grid.appendChild(tile);
    }
    body.appendChild(grid);
    if (c.failures.length) {
      body.appendChild(
        basisLine(
          `PARTIAL DELIVERY — ${c.failures.map((f) => `${f.product}: ${f.error}`).join('; ')}`
        )
      );
    }
  };

  // ---------------------------------------------------- derivatives desk

  const derivCurrencyBlock = (cur: DerivCurrency): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'mk-deriv';
    const nowMs = Date.now();
    const perp = cur.futures.find((f) => f.kind === 'perpetual');
    const dated = cur.futures.filter((f) => f.kind === 'future' && f.expiryIso);

    const head = document.createElement('div');
    head.className = 'mk-deriv-head';
    head.innerHTML = `<span class="mk-deriv-ccy">${esc(cur.currency)}</span>${
      perp?.indexPrice ? `<span class="mk-deriv-index">INDEX ${esc(fmtN(perp.indexPrice, 2))}</span>` : ''
    }`;
    wrap.appendChild(head);

    if (perp) {
      const apr = perp.funding8h !== null ? perp.funding8h * 3 * 365 : null;
      const card = document.createElement('div');
      card.className = 'mk-perp';
      card.innerHTML = `
        <span class="mk-perp-name">PERPETUAL</span>
        <span>MARK <b>${esc(fmtN(perp.markPrice, 2))}</b></span>
        <span>FUNDING 8H <b class="${perp.funding8h !== null ? pctClass(perp.funding8h) : ''}">${
          perp.funding8h !== null ? esc(signedPct(perp.funding8h, 4)) : '—'
        }</b>${apr !== null ? ` <i class="mk-computed">≈ ${esc(signedPct(apr, 1))} APR · COMPUTED</i>` : ''}</span>
        <span>OI <b>${esc(fmtUsdCompact(perp.openInterest))}</b></span>`;
      wrap.appendChild(card);
    }

    if (dated.length) {
      const t = document.createElement('div');
      t.className = 'mk-term';
      t.innerHTML = `<div class="mk-sect">TERM STRUCTURE — ${dated.length} DATED FUTURES · BASIS ANNUALIZED VS VENUE INDEX (COMPUTED)</div>`;
      const peakOi = Math.max(...dated.map((f) => f.openInterest), 1);
      for (const f of dated) {
        const basis = annualizedBasis(f, nowMs);
        // a null basis has two distinct causes — say which one
        const nearExpiry =
          f.expiryIso !== null &&
          Number.isFinite(Date.parse(f.expiryIso)) &&
          Date.parse(f.expiryIso) - nowMs < 86_400_000;
        const row = document.createElement('div');
        row.className = 'mk-term-row';
        row.innerHTML = `
          <span class="mk-term-exp">${esc(fmtExpiry(f.expiryIso))}</span>
          <span class="mk-term-mark">${esc(fmtN(f.markPrice, 1))}</span>
          <span class="mk-term-basis ${basis !== null ? pctClass(basis) : ''}" ${basis === null && !nearExpiry ? 'title="no venue index served for this future"' : ''}>${basis !== null ? esc(signedPct(basis, 2)) : nearExpiry ? '<1D' : 'NO IDX'}</span>
          <span class="mk-oi-bar"><i style="width:${Math.max(2, (f.openInterest / peakOi) * 100)}%"></i></span>
          <span class="mk-term-oi">${esc(fmtUsdCompact(f.openInterest))}</span>`;
        t.appendChild(row);
      }
      wrap.appendChild(t);
    }

    if (cur.options.length) {
      const callOi = cur.options.filter((o) => o.optionType === 'call').reduce((s, o) => s + o.openInterest, 0);
      const putOi = cur.options.filter((o) => o.optionType === 'put').reduce((s, o) => s + o.openInterest, 0);
      const o = document.createElement('div');
      o.className = 'mk-opts';
      o.innerHTML = `<div class="mk-sect">OPTIONS — TOP ${cur.options.length} OF ${cur.optionsTotal} LISTED, BY OPEN INTEREST · P/C OI ${
        callOi > 0 ? (putOi / callOi).toFixed(2) : '—'
      } ACROSS THIS SET (COMPUTED) · MARK IV IS THE VENUE'S MODEL</div>`;
      const top = [...cur.options].slice(0, 8);
      const peakOi = Math.max(...top.map((x) => x.openInterest), 1);
      for (const opt of top) {
        const row = document.createElement('div');
        row.className = 'mk-opt-row';
        row.innerHTML = `
          <span class="mk-term-exp">${esc(fmtExpiry(opt.expiryIso))}</span>
          <span class="mk-opt-strike">${esc(fmtN(opt.strike ?? 0))} <i class="${opt.optionType === 'call' ? 'mk-call' : 'mk-put'}">${opt.optionType === 'call' ? 'C' : 'P'}</i></span>
          <span class="mk-opt-iv">${opt.markIv !== null ? esc(opt.markIv.toFixed(1)) + '% IV' : '—'}</span>
          <span class="mk-oi-bar"><i style="width:${Math.max(2, (opt.openInterest / peakOi) * 100)}%"></i></span>
          <span class="mk-term-oi">${esc(fmtN(opt.openInterest, 1))} ${esc(cur.currency)}</span>`;
        o.appendChild(row);
      }
      wrap.appendChild(o);
    }
    return wrap;
  };

  const renderDerivatives = (r: MarketResult<DerivSet>): void => {
    if (r.kind === 'refused') {
      setStatus();
      body.appendChild(refusalBox(r.refusal.kind, r.refusal.message, r.refusal.remedy));
      return;
    }
    if (r.kind === 'unreachable') {
      setStatus();
      body.appendChild(unreachableBox(r.note));
      return;
    }
    const d = r.data;
    setStatus(d.fetchedAt, d.cacheState, d.upstream);
    body.appendChild(
      basisLine(
        'REPORTED · DERIBIT VENUE MARKS — mark price and mark IV are the venue’s model values; funding and open interest are venue-reported. One venue, not the whole market.'
      )
    );
    for (const cur of d.currencies) body.appendChild(derivCurrencyBlock(cur));
    if (d.failures.length) {
      body.appendChild(
        basisLine(`PARTIAL DELIVERY — ${d.failures.map((f) => `${f.currency}: ${f.error}`).join('; ')}`)
      );
    }
  };

  // --------------------------------------------------------- broker desk

  const renderBroker = (r: MarketResult<BrokerStatus>): void => {
    // execution posture is stated in EVERY state of this desk
    const posture = document.createElement('div');
    posture.className = 'mk-posture';
    posture.innerHTML = `
      <div class="mk-posture-title">EXECUTION POSTURE</div>
      <div class="mk-posture-body">READ-ONLY NAVIGATION — no order capability exists on this surface, by design.
      Order execution belongs to the Terminal backend under its own authority model; this desk mirrors
      broker session state the way the operations desk mirrors the control tower.</div>`;
    body.appendChild(posture);

    if (r.kind === 'refused') {
      setStatus();
      body.appendChild(refusalBox(r.refusal.kind, r.refusal.message, r.refusal.remedy));
      return;
    }
    if (r.kind === 'unreachable') {
      setStatus();
      body.appendChild(unreachableBox(r.note));
      return;
    }
    const b = r.data;
    setStatus(b.fetchedAt, 'live', 'Interactive Brokers Client Portal Gateway (local)');
    const card = document.createElement('div');
    card.className = 'mk-broker';
    card.innerHTML = `
      <div class="mk-sect">GATEWAY SESSION</div>
      <div class="mk-broker-row">CONNECTED <b class="${b.connected ? 'up' : 'down'}">${b.connected ? 'YES' : 'NO'}</b>
      · AUTHENTICATED <b class="${b.authenticated ? 'up' : 'down'}">${b.authenticated ? 'YES' : 'NO'}</b></div>
      ${
        b.accounts?.length
          ? b.accounts
              .map(
                (a) =>
                  `<div class="mk-broker-row">ACCOUNT <b>${esc(a.id ?? '—')}</b>${a.alias ? ` · ${esc(a.alias)}` : ''}${a.currency ? ` · ${esc(a.currency)}` : ''}</div>`
              )
              .join('')
          : '<div class="mk-broker-row">NO ACCOUNTS LISTED — authenticate in the gateway login page</div>'
      }`;
    body.appendChild(card);
  };

  // -------------------------------------------------------------- engine

  const renderDesk = (): void => {
    body.replaceChildren();
    const r = results[desk];
    if (!r) {
      statusLine.innerHTML = `<span class="ops-live-dot"></span>FETCHING…`;
      return;
    }
    if (desk === 'fx') renderFx(r as MarketResult<FxSet>);
    else if (desk === 'crypto') renderCrypto(r as MarketResult<CryptoSet>);
    else if (desk === 'derivatives') renderDerivatives(r as MarketResult<DerivSet>);
    else renderBroker(r as MarketResult<BrokerStatus>);
  };

  const renderChips = (): void => {
    chips.replaceChildren();
    for (const d of DESKS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mk-chip ${desk === d.id ? 'active' : ''}`;
      b.textContent = d.label;
      b.addEventListener('click', () => {
        desk = d.id;
        renderChips();
        renderDesk();
        void load(desk);
      });
      chips.appendChild(b);
    }
  };

  // per-desk request sequencing: only the NEWEST in-flight request may
  // store and render — a stalled older response must never overwrite
  // fresher data already on screen
  const loadSeq: Record<Desk, number> = { fx: 0, crypto: 0, derivatives: 0, broker: 0 };

  const load = async (d: Desk): Promise<void> => {
    const seq = ++loadSeq[d];
    const base = resolveApiBase();
    const r =
      d === 'fx'
        ? await fetchFx(base)
        : d === 'crypto'
          ? await fetchCrypto(base)
          : d === 'derivatives'
            ? await fetchDerivatives(base)
            : await fetchBroker(base);
    if (seq !== loadSeq[d]) return; // superseded while in flight
    (results as Record<Desk, unknown>)[d] = r;
    if (open && desk === d) renderDesk();
  };

  api.events.on('preset', ({ preset }) => {
    open = preset === 'markets';
    el.hidden = !open;
    // the preset event has no same-value dedupe: re-clicking the open
    // tab re-emits, so the old interval must be cleared BEFORE a new
    // one is stored — an overwritten id is a permanent 60s fetch leak
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
    if (open) {
      renderChips();
      renderDesk();
      void load(desk);
      timer = window.setInterval(() => void load(desk), 60_000);
    }
  });

  return { el };
}
