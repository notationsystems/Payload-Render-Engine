/**
 * Status bar — bottom-left mono readout of renderer vitals plus the
 * synthetic-data disclaimer chip. Throttled to ~4Hz.
 *
 * Market pulse: two quiet segments (EUR/USD fix, BTC last) for the
 * trading desk's ambient awareness. Their basis rides in the title —
 * an ECB daily fix is named as one — and when the feed is unreachable
 * the segments are ABSENT, never zero.
 */

import type { AppApi, AppEvents } from '../app/api';
import { resolveApiBase } from '../data/sources';
import { fetchCrypto, fetchFx } from '../live/markets';
import { feedHealth, onFeedHealth, type FeedLedger } from '../core/health';

const THROTTLE_MS = 250;
const MARKET_PULSE_MS = 120_000;

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function createStatusBar(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-statusbar';

  const seg = (): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = 'pe-sb-seg';
    el.appendChild(s);
    return s;
  };

  const fpsSeg = seg();
  const altSeg = seg();
  const nodesSeg = seg();
  const routesSeg = seg();
  const particlesSeg = seg();
  // tiered shed on narrow viewports, before colliding with the timeline:
  // renderer detail yields first, renderer counts second — the market
  // pulse and the disclaimer chip are the last things this bar gives up
  altSeg.classList.add('pe-sb-opt');
  particlesSeg.classList.add('pe-sb-opt');
  nodesSeg.classList.add('pe-sb-opt2');
  routesSeg.classList.add('pe-sb-opt2');

  // ---- market pulse (absent until a feed answers)
  const fxSeg = seg();
  const btcSeg = seg();
  fxSeg.hidden = true;
  btcSeg.hidden = true;
  const pollMarkets = async (): Promise<void> => {
    const base = resolveApiBase();
    const [fx, cr] = await Promise.all([fetchFx(base), fetchCrypto(base)]);
    if (fx.kind === 'ok') {
      const raw = fx.data.rates[fx.data.latestDate]?.EUR;
      if (Number.isFinite(raw)) {
        fxSeg.innerHTML = `EUR/USD <b>${(1 / raw).toFixed(4)}</b>`;
        fxSeg.title = `ECB daily reference fix of ${fx.data.latestDate} — informational, not a tradeable quote (via frankfurter.dev)`;
        fxSeg.hidden = false;
      }
    } else {
      fxSeg.hidden = true;
    }
    if (cr.kind === 'ok') {
      const btc = cr.data.products.find((p) => p.id === 'BTC-USD');
      if (btc) {
        btcSeg.innerHTML = `BTC <b>${Math.round(btc.last).toLocaleString('en-US')}</b>`;
        btcSeg.title = 'Coinbase Exchange last trade — single-venue print, not an index';
        btcSeg.hidden = false;
      }
    } else {
      btcSeg.hidden = true;
    }
  };
  void pollMarkets();
  window.setInterval(() => void pollMarkets(), MARKET_PULSE_MS);

  // ---- feed health: the OS observing its own feeds over the session.
  // The chip aggregates; the card itemizes "refused 3 of last 20".
  const healthChip = document.createElement('button');
  healthChip.type = 'button';
  healthChip.className = 'pe-sb-chip pe-sb-health';
  healthChip.textContent = 'FEEDS UNTRIED';
  healthChip.title = 'Session feed-health ledger — click to expand';
  el.appendChild(healthChip);

  const healthCard = document.createElement('div');
  healthCard.className = 'pe-health-card';
  healthCard.hidden = true;
  el.appendChild(healthCard);

  const ledgerLine = (l: FeedLedger): string => {
    const okN = l.samples.filter((s) => s.outcome === 'ok').length;
    const n = l.samples.length;
    const last = l.samples[n - 1];
    const ageS = Math.max(0, Math.round((Date.now() - last.t) / 1000));
    const ageTxt = ageS < 90 ? `${ageS}s` : `${Math.round(ageS / 60)}m`;
    const tone = last.outcome === 'ok' ? (okN === n ? 'ok' : 'warn') : 'alert';
    const detail =
      okN === n
        ? `${okN}/${n} OK`
        : `${n - okN} ${l.samples.filter((s) => s.outcome === 'refused').length >= n - okN ? 'REFUSED' : 'FAILED'} OF LAST ${n}`;
    return `<div class="pe-health-row ${tone}"><span class="pe-health-feed">${l.feed.toUpperCase()}</span><span class="pe-health-detail">${detail}</span><span class="pe-health-last">LAST ${last.outcome.toUpperCase()} · ${ageTxt} AGO</span></div>`;
  };

  const renderHealth = (): void => {
    const ledgers = feedHealth();
    if (!ledgers.length) {
      healthChip.textContent = 'FEEDS UNTRIED';
      healthChip.classList.remove('warn', 'alert');
      healthCard.innerHTML = `<div class="pe-health-head">FEED HEALTH — SESSION LEDGER</div>
        <div class="pe-health-none">No feed attempted yet this session — untried, not OK.</div>`;
      return;
    }
    const degraded = ledgers.filter((l) => l.samples[l.samples.length - 1].outcome !== 'ok');
    healthChip.textContent = degraded.length ? `FEEDS ${degraded.length} DEGRADED` : `FEEDS ${ledgers.length} OK`;
    healthChip.classList.toggle('alert', degraded.length > 0);
    healthCard.innerHTML =
      `<div class="pe-health-head">FEED HEALTH — SESSION LEDGER · LAST ${20} ATTEMPTS PER FEED</div>` +
      ledgers.map(ledgerLine).join('') +
      `<div class="pe-health-note">Outcomes are the typed results (ok / refused / unreachable); a feed never attempted is absent from this list, not OK.</div>`;
  };
  renderHealth();
  onFeedHealth(renderHealth);
  healthChip.addEventListener('click', () => {
    healthCard.hidden = !healthCard.hidden;
    if (!healthCard.hidden) renderHealth();
  });

  const brushChip = document.createElement('span');
  brushChip.className = 'pe-sb-chip pe-sb-brush';
  brushChip.textContent = 'BRUSH · ROUTES WITHIN 900 KM OF CURSOR';
  brushChip.hidden = true;
  el.appendChild(brushChip);
  api.events.on('brush', ({ active }) => {
    brushChip.hidden = !active;
  });

  const chip = document.createElement('span');
  chip.className = 'pe-sb-chip';
  chip.textContent = 'SYNTHETIC / DEMO DATA';
  el.appendChild(chip);

  // The badge states what the LOADED corpus is — never a constant. A
  // Terminal-projection corpus is not "synthetic demo data", and saying
  // so would misstate provenance in the most visible pixel of the UI.
  const syncDisclaimer = (): void => {
    try {
      const meta = api.store.snapshot.meta;
      chip.textContent = meta.disclaimer.split('—')[0].trim();
      chip.title = meta.disclaimer;
    } catch {
      /* snapshot not loaded yet */
    }
  };
  syncDisclaimer();

  const render = (s: AppEvents['status']): void => {
    fpsSeg.innerHTML = `FPS <b>${fmt(s.fps)}</b>`;
    altSeg.innerHTML = `ALT <b>${fmt(s.altitudeKm)} KM</b>`;
    nodesSeg.innerHTML = `NODES <b>${fmt(s.visibleNodes)}</b>`;
    routesSeg.innerHTML = `ROUTES <b>${fmt(s.visibleRoutes)}</b>`;
    particlesSeg.innerHTML = `PARTICLES <b>${fmt(s.particles)}</b>`;
  };

  render({ fps: 0, altitudeKm: 0, visibleNodes: 0, visibleRoutes: 0, particles: 0 });

  let lastRender = 0;
  let pending: AppEvents['status'] | null = null;
  let timer = 0;

  api.events.on('status', (s) => {
    if (!chip.title) syncDisclaimer();
    const now = performance.now();
    if (now - lastRender >= THROTTLE_MS) {
      lastRender = now;
      render(s);
    } else {
      pending = s;
      if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          if (pending) {
            lastRender = performance.now();
            render(pending);
            pending = null;
          }
        }, THROTTLE_MS - (now - lastRender));
      }
    }
  });

  return { el };
}
