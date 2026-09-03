/**
 * SITREP — the composed intelligence product of the OS. One overlay
 * that assembles what every loaded surface can vouch for RIGHT NOW:
 * operations exceptions, corpus disruptions, live hazard correlations,
 * market moves, latest commodity observations, network posture.
 *
 * Composition rules:
 *   - every block leads with its basis (journal projection, REPORTED
 *     feed, ECB fix, venue marks, corpus evidence) — a brief that
 *     mixes bases without labels is a rumor;
 *   - a surface that refuses appears AS ITS REFUSAL, compactly — the
 *     brief never papers over an unavailable desk;
 *   - every delta the brief derives is labeled COMPUTED with both
 *     input instants stated;
 *   - COPY AS TEXT exports the same content, labels included, for the
 *     desk channel — what leaves this surface carries its provenance
 *     with it.
 */

import { esc } from '../core/escape';
import type { AppApi } from '../app/api';
import { resolveApiBase } from '../data/sources';
import { fetchOperations, humanizeOpsCode } from '../data/operations';
import { fetchCrypto, fetchDerivatives, fetchFx } from '../live/markets';
import { correlateQuakes, PROXIMITY_THRESHOLDS } from '../intel/proximity';
import { recordFeed } from '../core/health';
import type { Observation } from '../data/contracts';


const fmtT = (t: string): string => `${t.slice(0, 10)} ${t.slice(11, 16)}Z`;
const signed = (v: number, dp = 2): string => `${v > 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

/** One brief block: rendered lines + the same content as plain text. */
interface Block {
  title: string;
  basis: string;
  lines: { html: string; text: string; tone?: 'alert' | 'warn' }[];
}

export function createSitrep(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'os-arch pe-sitrep';
  el.hidden = true;

  const sheet = document.createElement('div');
  sheet.className = 'os-arch-sheet pe-sitrep-sheet';
  el.appendChild(sheet);

  let lastText = '';
  /** compose generation — a stale in-flight compose must never
   *  overwrite a newer one's rendered body or exported text */
  let composeGen = 0;

  // ------------------------------------------------------------ collectors

  const opsBlock = async (): Promise<Block> => {
    const r = await fetchOperations(resolveApiBase());
    recordFeed('operations', r.kind === 'ok' ? 'ok' : r.kind);
    if (r.kind === 'refused') {
      return {
        title: 'OPERATIONS',
        basis: 'Terminal control tower · journal projection',
        lines: [
          {
            html: `DESK REFUSES: ${esc(humanizeOpsCode(r.refusal.kind))} — ${esc(r.refusal.message)}`,
            text: `desk refuses: ${r.refusal.kind} — ${r.refusal.message}`,
            tone: 'warn',
          },
        ],
      };
    }
    if (r.kind === 'unreachable') {
      return {
        title: 'OPERATIONS',
        basis: 'Terminal control tower · journal projection',
        lines: [{ html: `DESK UNREACHABLE — ${esc(r.note)}`, text: `desk unreachable — ${r.note}`, tone: 'warn' }],
      };
    }
    const p = r.snapshot.portfolio;
    const lines: Block['lines'] = [
      {
        html: `<b>${p.totalLoads}</b> loads · <b>${p.activeLoads}</b> active · <b>${p.inMotion}</b> in motion · <b>${p.awaitingSettlement}</b> awaiting settlement`,
        text: `${p.totalLoads} loads · ${p.activeLoads} active · ${p.inMotion} in motion · ${p.awaitingSettlement} awaiting settlement`,
      },
      {
        html: `<b>${p.needingAttention}</b> needing attention (${p.critical} critical · ${p.high} high)`,
        text: `${p.needingAttention} needing attention (${p.critical} critical · ${p.high} high)`,
        tone: p.critical > 0 ? 'alert' : p.needingAttention > 0 ? 'warn' : undefined,
      },
    ];
    const top = r.snapshot.loads.find((l) => l.nextAction);
    if (top?.nextAction) {
      const line = `top action: ${top.operationId} — ${humanizeOpsCode(top.nextAction.code)}${top.nextAction.deadlineAt ? ` · deadline ${fmtT(top.nextAction.deadlineAt)}` : ''}`;
      lines.push({ html: esc(line.toUpperCase()), text: line, tone: 'warn' });
    }
    return {
      title: 'OPERATIONS',
      basis: `Terminal control tower · journal projection · as of ${fmtT(r.snapshot.asOf)}`,
      lines,
    };
  };

  const disruptionsBlock = (): Block => {
    const t = Date.parse(api.clock.simTime);
    const active = api.store.snapshot.events
      .filter((e) => Date.parse(e.start) <= t && (!e.end || Date.parse(e.end) >= t))
      .sort((a, b) => b.severity - a.severity);
    return {
      title: 'DISRUPTIONS',
      basis: `corpus events active at sim time ${fmtT(api.clock.simTime)}`,
      lines: active.length
        ? active.slice(0, 5).map((e) => ({
            html: `${esc(e.name.toUpperCase())} · ${esc(e.category)} · sev ${Math.round(e.severity * 100)}% · affects ${e.affects.length}`,
            text: `${e.name} · ${e.category} · sev ${Math.round(e.severity * 100)}% · affects ${e.affects.length}`,
            tone: e.severity >= 0.7 ? 'alert' : 'warn',
          }))
        : [{ html: 'no events active at the current sim instant', text: 'no events active at the current sim instant' }],
    };
  };

  const hazardsBlock = (): Block => {
    const thresholds = PROXIMITY_THRESHOLDS.map((x) => `M${x.minMag}+≤${x.radiusKm}km`).join(' · ');
    const quakes = api.getLiveQuakes();
    if (quakes === null) {
      return {
        title: 'LIVE HAZARDS',
        basis: `USGS × corpus assets · COMPUTED PROXIMITY · ${thresholds}`,
        lines: [
          {
            html: 'seismic feed not loaded — no correlation run (enable the LIVE SEISMIC layer)',
            text: 'seismic feed not loaded — no correlation run',
          },
        ],
      };
    }
    const alerts = correlateQuakes(quakes, api.store.snapshot.nodes, Date.now());
    return {
      title: 'LIVE HAZARDS',
      basis: `USGS (${quakes.length} reported, 24h) × corpus assets · COMPUTED PROXIMITY · ${thresholds}`,
      lines: alerts.length
        ? alerts.slice(0, 5).map((a) => ({
            html: `M${a.mag.toFixed(1)} · ${Math.round(a.distanceKm)} km from ${esc(a.nodeName.toUpperCase())} · reported ${a.reportAgeHours.toFixed(1)}h ago`,
            text: `M${a.mag.toFixed(1)} · ${Math.round(a.distanceKm)} km from ${a.nodeName} · reported ${a.reportAgeHours.toFixed(1)}h ago`,
            tone: a.severity,
          }))
        : [
            {
              html: 'no reported epicenter within the stated radii of a corpus asset',
              text: 'no reported epicenter within the stated radii of a corpus asset',
            },
          ],
    };
  };

  const marketsBlock = async (): Promise<Block> => {
    const base = resolveApiBase();
    const [fx, cr, dv] = await Promise.all([fetchFx(base), fetchCrypto(base), fetchDerivatives(base)]);
    const lines: Block['lines'] = [];
    if (fx.kind === 'ok') {
      const d = fx.data;
      const prev = d.dates.length > 1 ? d.dates[d.dates.length - 2] : null;
      const eur = d.rates[d.latestDate]?.EUR;
      let fxLine = `FX: EUR/USD ${eur ? (1 / eur).toFixed(4) : '—'}`;
      if (prev) {
        // biggest fix-over-fix move across the watchlist (COMPUTED)
        let bestSym = '';
        let bestMove = 0;
        for (const [sym, v] of Object.entries(d.rates[d.latestDate] ?? {})) {
          const pv = d.rates[prev]?.[sym];
          if (!pv) continue;
          const m = v / pv - 1;
          if (Math.abs(m) > Math.abs(bestMove)) {
            bestMove = m;
            bestSym = sym;
          }
        }
        if (eur && d.rates[prev]?.EUR) fxLine += ` (${signed(1 / eur / (1 / d.rates[prev].EUR) - 1)} vs ${prev} fix)`;
        if (bestSym) fxLine += ` · biggest fix move USD/${bestSym} ${signed(bestMove)} · COMPUTED`;
      }
      lines.push({ html: esc(fxLine) + ` — <i>ECB fix ${esc(d.latestDate)}, informational</i>`, text: `${fxLine} — ECB fix ${d.latestDate}, informational` });
    } else {
      lines.push({ html: 'FX: desk unavailable', text: 'FX: desk unavailable', tone: 'warn' });
    }
    if (cr.kind === 'ok') {
      const parts = cr.data.products.slice(0, 2).map((p) => {
        const d24 = p.open24h > 0 ? p.last / p.open24h - 1 : null;
        return `${p.id.split('-')[0]} ${Math.round(p.last).toLocaleString('en-US')}${d24 !== null ? ` (${signed(d24)} vs 24h open)` : ''}`;
      });
      lines.push({
        html: esc(`CRYPTO: ${parts.join(' · ')}`) + ' — <i>Coinbase last trades, single venue</i>',
        text: `CRYPTO: ${parts.join(' · ')} — Coinbase last trades, single venue`,
      });
    } else {
      lines.push({ html: 'CRYPTO: desk unavailable', text: 'CRYPTO: desk unavailable', tone: 'warn' });
    }
    if (dv.kind === 'ok') {
      const parts: string[] = [];
      for (const c of dv.data.currencies) {
        const perp = c.futures.find((f) => f.kind === 'perpetual');
        if (perp?.funding8h !== null && perp?.funding8h !== undefined) {
          parts.push(`${c.currency} perp funding ${signed(perp.funding8h, 4)}/8h (≈${signed(perp.funding8h * 3 * 365, 1)} APR COMPUTED)`);
        }
      }
      lines.push({
        html: esc(`DERIVS: ${parts.join(' · ') || 'no perpetual funding served'}`) + ' — <i>Deribit venue marks</i>',
        text: `DERIVS: ${parts.join(' · ') || 'no perpetual funding served'} — Deribit venue marks`,
      });
    } else {
      lines.push({ html: 'DERIVS: desk unavailable', text: 'DERIVS: desk unavailable', tone: 'warn' });
    }
    return { title: 'MARKETS', basis: 'per-line bases — a fix is not a quote, a venue is not the market', lines };
  };

  const commoditiesBlock = (): Block => {
    const snap = api.store.snapshot;
    const lines: Block['lines'] = [];
    for (const c of snap.commodities.slice(0, 4)) {
      const key = c.id.split(':').pop();
      const prices = snap.observations
        .filter((o) => o.metric === 'price' && o.provenance.evidence?.includes(`commodity:${key}`))
        .sort((a, b) => a.t.localeCompare(b.t));
      if (!prices.length) {
        lines.push({
          html: `${esc(c.name.toUpperCase())}: no price observations in this corpus`,
          text: `${c.name}: no price observations in this corpus`,
        });
        continue;
      }
      const last: Observation = prices[prices.length - 1];
      const prev = prices.length > 1 ? prices[prices.length - 2] : null;
      let line = `${c.name.toUpperCase()}: ${last.value.toLocaleString('en-US')} ${last.unit ?? ''} as of ${last.t.slice(0, 10)}`;
      if (prev) line += ` (${signed(last.value / prev.value - 1)} vs ${prev.t.slice(0, 10)} obs · COMPUTED)`;
      line += ` · n=${prices.length}`;
      lines.push({ html: esc(line), text: line });
    }
    if (!lines.length) lines.push({ html: 'no commodities in the loaded corpus', text: 'no commodities in the loaded corpus' });
    return { title: 'COMMODITIES', basis: 'latest observed price per commodity · corpus evidence, observation dates stated', lines };
  };

  const networkBlock = (): Block => {
    const snap = api.store.snapshot;
    const t = api.clock.simTime;
    let disrupted = 0;
    let unobserved = 0;
    for (const r of snap.routes) {
      const s = api.store.stateAt(r.id, t);
      if (s.observed === false) unobserved++;
      else if (s.status === 'disrupted') disrupted++;
    }
    const chokepoints = snap.nodes.filter((n) => n.kind === 'chokepoint');
    const lines: Block['lines'] = [
      {
        html: `<b>${snap.flows.length}</b> flows · <b>${snap.routes.length}</b> routes (<b>${disrupted}</b> disrupted · ${unobserved} state-unobserved) · ${chokepoints.length} chokepoints watched`,
        text: `${snap.flows.length} flows · ${snap.routes.length} routes (${disrupted} disrupted · ${unobserved} state-unobserved) · ${chokepoints.length} chokepoints watched`,
        tone: disrupted > 0 ? 'warn' : undefined,
      },
    ];
    return { title: 'NETWORK', basis: `corpus state at sim time ${fmtT(t)} · unobserved counted, never zeroed`, lines };
  };

  // -------------------------------------------------------------- compose

  const compose = async (): Promise<void> => {
    const gen = ++composeGen;
    const composedAt = new Date().toISOString();
    const meta = api.store.snapshot.meta;
    sheet.innerHTML = `
      <div class="os-arch-head">
        <span class="os-panel-kicker">SITUATION REPORT</span>
        <span class="pe-sitrep-actions">
          <button type="button" class="pe-sitrep-copy">COPY AS TEXT</button>
          <button type="button" class="os-panel-close">×</button>
        </span>
      </div>
      <div class="pe-sitrep-meta">
        COMPOSED ${esc(fmtT(composedAt))} FROM LOADED SURFACES ONLY — absence stated, nothing imputed.<br>
        SIM ${esc(fmtT(api.clock.simTime))} · CORPUS: ${esc(meta.label)} · ${esc(meta.disclaimer.split('—')[0].trim())}${meta.corpusBuild ? ` · ${esc(meta.corpusBuild.id)}` : ''}
      </div>
      <div class="pe-sitrep-body">COMPOSING — CONTACTING DESKS…</div>`;
    sheet.querySelector('.os-panel-close')!.addEventListener('click', () => setOpen(false));
    const copyBtn = sheet.querySelector('.pe-sitrep-copy') as HTMLButtonElement;
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(lastText).then(
        () => {
          copyBtn.textContent = 'COPIED';
          window.setTimeout(() => (copyBtn.textContent = 'COPY AS TEXT'), 1500);
        },
        () => {
          copyBtn.textContent = 'CLIPBOARD BLOCKED';
        }
      );
    });

    const blocks: Block[] = [];
    blocks.push(disruptionsBlock(), hazardsBlock(), commoditiesBlock(), networkBlock());
    const [ops, mkts] = await Promise.all([opsBlock(), marketsBlock()]);
    if (gen !== composeGen) return; // a newer compose owns the sheet now
    const ordered = [ops, blocks[0], blocks[1], mkts, blocks[2], blocks[3]];

    const body = sheet.querySelector('.pe-sitrep-body')!;
    body.innerHTML = ordered
      .map(
        (b) => `
      <div class="pe-sitrep-block">
        <div class="pe-sitrep-title">${esc(b.title)}</div>
        <div class="pe-sitrep-basis">${esc(b.basis)}</div>
        ${b.lines.map((l) => `<div class="pe-sitrep-line ${l.tone ?? ''}">${l.html}</div>`).join('')}
      </div>`
      )
      .join('');

    lastText = [
      `PAYLOAD OS — SITUATION REPORT`,
      `composed ${fmtT(composedAt)} from loaded surfaces only — absence stated, nothing imputed`,
      `sim ${fmtT(api.clock.simTime)} · corpus: ${meta.label}${meta.corpusBuild ? ` · ${meta.corpusBuild.id}` : ''}`,
      '',
      ...ordered.flatMap((b) => [
        `— ${b.title} (${b.basis})`,
        ...b.lines.map((l) => `  ${l.tone === 'alert' ? '!! ' : l.tone === 'warn' ? ' ! ' : '   '}${l.text}`),
        '',
      ]),
    ].join('\n');
  };

  // --------------------------------------------------------------- toggle

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) void compose();
  };
  el.addEventListener('click', (e) => {
    if (e.target === el) setOpen(false);
  });
  window.addEventListener('pe:sitrep-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    e.stopImmediatePropagation();
  });

  return { el };
}
