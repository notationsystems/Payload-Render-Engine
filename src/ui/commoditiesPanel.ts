/**
 * COMMODITIES view — the market-intelligence workspace of the OS.
 *
 * Everything on this panel is an OBSERVATION with its standing attached:
 * price and inventory series render from real per-record evidence
 * (source, knownAt, valueKind, admissible), production ranks countries
 * from the latest observed period, and a commodity FOCUS dims every
 * route on the globe that carries nothing of the selected commodity —
 * emphasis only, nothing hidden, nothing mutated.
 *
 * Which kind of nothing, everywhere: a corpus with no price series for
 * a commodity says NO PRICE OBSERVATIONS — it never draws a flat line,
 * never borrows a number, never averages across commodities.
 */

import type { AppApi } from '../app/api';
import type { EntityId, Observation } from '../data/contracts';
import { drawSparkline } from './sparkline';
import { fetchFx, type FxSet } from '../live/markets';
import { resolveApiBase } from '../data/sources';
import './commodities.css';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ev = (o: Observation, prefix: string): string | null =>
  o.provenance.evidence?.find((e) => e.startsWith(prefix))?.slice(prefix.length) ?? null;

const fmtVal = (v: number): string =>
  Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v % 1 ? 2 : 0);

export function createCommoditiesPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'os-panel cm-panel';
  el.hidden = true;

  const header = document.createElement('div');
  header.className = 'os-panel-head';
  header.innerHTML = `
    <div>
      <div class="os-panel-kicker">MARKET INTELLIGENCE</div>
      <div class="os-panel-title">Commodities</div>
    </div>`;
  const close = document.createElement('button');
  close.className = 'os-panel-close';
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => api.setPreset('world'));
  header.appendChild(close);

  const chips = document.createElement('div');
  chips.className = 'cm-chips';

  const focusNote = document.createElement('div');
  focusNote.className = 'cm-focus-note';

  const body = document.createElement('div');
  body.className = 'cm-body';

  const peek = document.createElement('button');
  peek.type = 'button';
  peek.className = 'ops-peek-btn';
  peek.textContent = 'HOLD TO VIEW GLOBE';
  peek.addEventListener('pointerdown', () => {
    el.classList.add('ops-peek');
    window.addEventListener('pointerup', () => el.classList.remove('ops-peek'), { once: true });
  });

  el.append(header, chips, focusNote, body, peek);

  let selected: EntityId | null = null;
  let fx: FxSet | null = null;
  let fxState: 'idle' | 'pending' | 'unavailable' = 'idle';

  // ------------------------------------------------------------- helpers

  /** Observations tagged for this commodity, oldest → newest. */
  const obsFor = (commodityId: EntityId): Observation[] =>
    api.store.snapshot.observations
      .filter((o) => o.provenance.evidence?.includes(`commodity:${commodityId.split(':').pop()}`))
      .sort((a, b) => a.t.localeCompare(b.t));

  const series = (obs: Observation[], metric: string): Observation[] =>
    obs.filter((o) => o.metric === metric);

  const admissibleMix = (rows: Observation[]): string => {
    const admissible = rows.filter((o) => o.provenance.admissible === true).length;
    const inadmissible = rows.filter((o) => o.provenance.admissible === false).length;
    if (!admissible && !inadmissible) return 'ADMISSIBILITY NOT EVALUATED';
    if (!inadmissible) return `ALL ${admissible} ADMISSIBLE`;
    return `${admissible} ADMISSIBLE · ${inadmissible} REPRESENTATIVE`;
  };

  const sparkTile = (title: string, rows: Observation[], color: string): HTMLElement => {
    const tile = document.createElement('div');
    tile.className = 'cm-tile';
    if (!rows.length) {
      tile.innerHTML = `
        <div class="cm-tile-title">${esc(title)}</div>
        <div class="cm-none">NO ${esc(title)} OBSERVATIONS — this corpus records none</div>`;
      return tile;
    }
    const latest = rows[rows.length - 1];
    const values = rows.map((o) => o.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const src = ev(latest, 'source:') ?? 'unstated';
    tile.innerHTML = `
      <div class="cm-tile-title">${esc(title)}</div>
      <div class="cm-tile-latest">${esc(fmtVal(latest.value))}<span class="cm-unit">${esc(latest.unit ?? '')}</span></div>
      <div class="cm-tile-when">AS OF ${esc(latest.t.slice(0, 10))} · KNOWN ${esc(latest.provenance.knownAt.slice(0, 10))}</div>`;
    const canvas = document.createElement('canvas');
    canvas.className = 'cm-spark';
    tile.appendChild(canvas);
    const range = document.createElement('div');
    range.className = 'cm-tile-range';
    range.textContent = `${rows[0].t.slice(0, 7)} → ${latest.t.slice(0, 7)} · ${fmtVal(min)}–${fmtVal(max)} · n=${rows.length}`;
    tile.appendChild(range);
    const foot = document.createElement('div');
    foot.className = 'cm-tile-evidence';
    foot.textContent = `${src.toUpperCase()} · ${admissibleMix(rows)}`;
    tile.appendChild(foot);
    const pad = (max - min) * 0.08;
    requestAnimationFrame(() =>
      drawSparkline(
        canvas,
        rows.map((o) => ({ t: Date.parse(o.t), v: o.value })),
        { min: min - pad, max: max + pad, color }
      )
    );
    return tile;
  };

  const producersTile = (rows: Observation[]): HTMLElement => {
    const tile = document.createElement('div');
    tile.className = 'cm-tile cm-tile-wide';
    if (!rows.length) {
      tile.innerHTML = `
        <div class="cm-tile-title">PRODUCTION BY ORIGIN</div>
        <div class="cm-none">NO PRODUCTION OBSERVATIONS — this corpus records none</div>`;
      return tile;
    }
    // latest observed period per subject
    const latestBySubject = new Map<string, Observation>();
    for (const o of rows) {
      const cur = latestBySubject.get(o.entityId);
      if (!cur || o.t > cur.t) latestBySubject.set(o.entityId, o);
    }
    // Granularity split by a FIELD, never an id string: subjects that
    // resolve to corpus NODES are facilities; the rest are countries /
    // regions. Mixing the two in one ranked total would double-count
    // (Chile AND a Chilean mine), so each group ranks and sums alone.
    const countries: Observation[] = [];
    const facilities: Observation[] = [];
    for (const o of latestBySubject.values()) {
      (api.store.node(o.entityId) ? facilities : countries).push(o);
    }
    tile.innerHTML = `<div class="cm-tile-title">PRODUCTION — LATEST OBSERVED PERIOD PER SUBJECT</div>`;
    const group = (label: string, list: Observation[], focusable: boolean): void => {
      if (!list.length) return;
      const ranked = [...list].sort((a, b) => b.value - a.value).slice(0, 5);
      const peak = ranked[0]?.value ?? 1;
      const g = document.createElement('div');
      g.className = 'cm-prod-group';
      g.textContent = label;
      tile.appendChild(g);
      for (const o of ranked) {
        const name = ev(o, 'subject_label:') ?? o.entityId;
        const row = document.createElement('div');
        row.className = `cm-prod-row ${focusable ? 'cm-click' : ''}`;
        row.innerHTML = `
          <span class="cm-prod-name">${esc(name)}</span>
          <span class="cm-prod-bar"><i style="width:${Math.max(3, (o.value / peak) * 100)}%"></i></span>
          <span class="cm-prod-val">${esc(fmtVal(o.value))} ${esc(o.unit ?? '')}</span>
          <span class="cm-prod-vk ${o.provenance.admissible === false ? 'warn' : ''}">${esc((o.provenance.valueKind ?? '—').toUpperCase())}</span>`;
        if (focusable) row.addEventListener('click', () => api.focus(o.entityId));
        tile.appendChild(row);
      }
      const total = list.reduce((s, o) => s + o.value, 0);
      const foot = document.createElement('div');
      foot.className = 'cm-tile-evidence';
      foot.textContent = `${list.length} SUBJECTS · TOTAL ${fmtVal(total)} ${ranked[0]?.unit ?? ''} · ${admissibleMix(list)}`;
      tile.appendChild(foot);
    };
    group('BY COUNTRY / REGION', countries, false);
    group('BY FACILITY — CLICK TO FOCUS ON THE GLOBE', facilities, true);
    return tile;
  };

  /**
   * MARKET CONTEXT — the FX lens: the latest OBSERVED corpus price
   * restated through the ECB daily fix. Every restatement is COMPUTED
   * (obs USD price × fix), both instants are stated, and the tile says
   * plainly why there is no live metals quote: exchange metals data is
   * licensed — this desk never invents one.
   */
  const marketContextTile = (prices: Observation[]): HTMLElement => {
    const tile = document.createElement('div');
    tile.className = 'cm-tile cm-tile-wide';
    tile.innerHTML = `<div class="cm-tile-title">MARKET CONTEXT — FX LENS</div>`;
    if (!prices.length) {
      tile.innerHTML += `<div class="cm-none">NO PRICE OBSERVATIONS TO RESTATE</div>`;
      return tile;
    }
    const last = prices[prices.length - 1];
    const unit = last.unit ?? '';
    if (!unit.toUpperCase().startsWith('USD')) {
      tile.innerHTML += `<div class="cm-none">LATEST PRICE IS IN ${esc(unit || 'AN UNSTATED UNIT')} — the FX lens restates USD-quoted observations only</div>`;
      return tile;
    }
    if (fxState === 'unavailable' || (!fx && fxState !== 'pending')) {
      tile.innerHTML += `<div class="cm-none">FX DESK UNAVAILABLE — the lens needs the spatial API's markets proxy (ECB fix via frankfurter)</div>`;
      return tile;
    }
    if (!fx) {
      tile.innerHTML += `<div class="cm-none">FETCHING THE ECB FIX…</div>`;
      return tile;
    }
    const denom = unit.slice(3); // '/lb', '/t', …
    const rates = fx.rates[fx.latestDate] ?? {};
    const row = (sym: string): string => {
      const r = rates[sym];
      if (!Number.isFinite(r)) return '';
      return `<span class="cm-fx-cell"><b>${esc((last.value * r).toLocaleString('en-US', { maximumFractionDigits: 2 }))}</b> ${esc(sym + denom)}</span>`;
    };
    tile.innerHTML += `
      <div class="cm-fx-base">OBSERVED <b>${esc(last.value.toLocaleString('en-US'))} ${esc(unit)}</b> AS OF ${esc(last.t.slice(0, 10))}</div>
      <div class="cm-fx-row">${['EUR', 'CNY', 'JPY', 'BRL', 'INR'].map(row).join('')}</div>
      <div class="cm-tile-evidence">COMPUTED — obs USD price × ECB fix of ${esc(fx.latestDate)} (informational, not a tradeable quote)</div>
      <div class="cm-tile-evidence">NO LIVE METALS QUOTE — exchange metals data is licensed; this desk restates the corpus observation, it never invents a price</div>`;
    return tile;
  };

  const flowsSection = (commodityId: EntityId): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'cm-flows';
    const flows = api.store.snapshot.flows.filter((f) => f.commodityId === commodityId);
    const title = document.createElement('div');
    title.className = 'os-card-title';
    title.textContent = `FLOWS — ${flows.length} CARRYING THIS COMMODITY (LIT ON THE GLOBE)`;
    wrap.appendChild(title);
    if (!flows.length) {
      const none = document.createElement('div');
      none.className = 'cm-none';
      none.textContent = 'NO FLOWS OF THIS COMMODITY IN THE CORPUS';
      wrap.appendChild(none);
      return wrap;
    }
    for (const f of flows.slice(0, 10)) {
      const row = document.createElement('div');
      row.className = 'cm-flow-row';
      const qty = f.provenance.evidence?.find((e) => e.startsWith('quantity:'))?.slice(9);
      row.innerHTML = `
        <span class="cm-flow-name">${esc(f.name)}</span>
        <span class="cm-flow-meta">${esc(qty ?? '')} · ${esc(f.status.toUpperCase())}</span>`;
      row.addEventListener('click', () => api.focus(f.segments[0]?.routeId ?? f.id));
      wrap.appendChild(row);
    }
    if (flows.length > 10) {
      const more = document.createElement('div');
      more.className = 'cm-tile-evidence';
      more.textContent = `+${flows.length - 10} MORE — all lit on the globe`;
      wrap.appendChild(more);
    }
    return wrap;
  };

  // -------------------------------------------------------------- render

  const renderChips = (): void => {
    chips.replaceChildren();
    const snap = api.store.snapshot;
    const score = (id: EntityId): number =>
      snap.flows.filter((f) => f.commodityId === id).length * 10 +
      snap.observations.filter((o) =>
        o.provenance.evidence?.includes(`commodity:${id.split(':').pop()}`)
      ).length;
    const ranked = [...snap.commodities].sort((a, b) => score(b.id) - score(a.id)).slice(0, 8);
    for (const c of ranked) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cm-chip ${selected === c.id ? 'active' : ''}`;
      b.textContent = c.name.toUpperCase();
      b.addEventListener('click', () => {
        selected = c.id;
        api.setCommodityFocus(c.id);
        render();
      });
      chips.appendChild(b);
    }
    if (!selected && ranked.length) {
      selected = ranked[0].id;
      api.setCommodityFocus(selected);
    }
  };

  const render = (): void => {
    renderChips();
    body.replaceChildren();
    if (!selected) return;
    const obs = obsFor(selected);
    const name = api.store.snapshot.commodities.find((c) => c.id === selected)?.name ?? selected;
    focusNote.textContent = `FOCUS ACTIVE — routes carrying no ${name.toUpperCase()} are dimmed on the globe. Emphasis only: nothing is hidden.`;

    const grid = document.createElement('div');
    grid.className = 'cm-grid';
    grid.append(
      sparkTile('PRICE', series(obs, 'price'), '#4da6ff'),
      sparkTile('INVENTORY', series(obs, 'inventory'), '#38d6c8'),
      sparkTile('NET POSITIONING', series(obs, 'net_positioning'), '#b48cff')
    );
    body.appendChild(grid);
    body.appendChild(marketContextTile(series(obs, 'price')));
    body.appendChild(producersTile(series(obs, 'production')));
    body.appendChild(flowsSection(selected));
  };

  api.events.on('preset', ({ preset }) => {
    const open = preset === 'commodities';
    el.hidden = !open;
    if (open && fxState === 'idle') {
      fxState = 'pending';
      void fetchFx(resolveApiBase()).then((r) => {
        if (r.kind === 'ok') {
          fx = r.data;
          fxState = 'idle';
        } else {
          fxState = 'unavailable';
        }
        if (!el.hidden) render();
      });
    }
    if (open) render();
    else {
      api.setCommodityFocus(null);
      selected = null;
    }
  });

  return { el };
}
