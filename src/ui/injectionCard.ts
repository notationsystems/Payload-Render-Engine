/**
 * What-if injection card — the readout of an UPSTREAM counterfactual
 * while its affected set wears the violet scenario roles on the globe.
 *
 * Everything here is framed hypothetical: the kicker, the violet
 * frame, and the disclaimer in words. The card shows structural
 * propagation only — the perturbed entity, disrupted volume, the
 * affected set by hop depth, spare-capacity alternatives, and the
 * engine's own reasoning trace. No state delta appears because none
 * was computed against an observed baseline.
 */

import type { AppApi } from '../app/api';
import type { InjectionImpact, InjectionResult } from '../data/injection';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createInjectionCard(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-inject-card';
  el.hidden = true;

  const render = (result: InjectionResult, disclaimer: string): void => {
    const impact: InjectionImpact | undefined = result.scenarioImpacts[0];
    if (!impact) {
      el.innerHTML = `<div class="pe-query-basis">the engine returned no impact — nothing propagated</div>`;
      return;
    }
    const byDepth = new Map<number, string[]>();
    for (const a of impact.affected) {
      byDepth.set(a.depth, [...(byDepth.get(a.depth) ?? []), a.name]);
    }
    const depthRows = [...byDepth.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(
        ([d, names]) =>
          `<div class="pe-inject-depth"><span class="pe-inject-hop">HOP ${d}</span>${names.map(esc).join(' · ')}</div>`
      )
      .join('');
    // state the baselines: how many of the frame's entities have an
    // OBSERVED state at sim time. On this corpus the answer is usually
    // zero — and that absence is worn, not implied: the propagation is
    // structural, never a delta against a guess.
    const frameIds = [impact.entityId, ...impact.affected.map((a) => a.entityId)].filter((id) =>
      api.store.node(id)
    );
    const observedCount = frameIds.filter(
      (id) => api.store.stateAt(id, api.clock.simTime).observed !== false
    ).length;
    const stateBasis =
      frameIds.length === 0
        ? 'STATE BASIS — none of the frame’s entities are in the loaded corpus'
        : `STATE BASIS — ${observedCount} of ${frameIds.length} entity states OBSERVED at sim time${
            observedCount === 0 ? ' (all UNOBSERVED)' : ''
          }; the propagation runs over DECLARED structure (graph + stated capacity), never a delta against a guess`;
    const alts = impact.alternatives.length
      ? impact.alternatives
          .map(
            (a) =>
              `${esc(a.name)}${a.spareKtPerYear !== null ? ` (~${a.spareKtPerYear} kt/y spare, STATED)` : ''}`
          )
          .join(' · ')
      : 'none identified in the modeled graph';
    el.innerHTML = `
      <div class="pe-query-line">
        <span class="pe-inject-kicker">HYPOTHETICAL</span>
        <span class="pe-query-label">${esc(impact.eventTitle.toUpperCase())}</span>
        <span class="pe-query-count">${impact.disruptedKtPerYear !== null ? `~${impact.disruptedKtPerYear} KT/Y DISRUPTED` : 'VOLUME UNMODELED'}</span>
      </div>
      <div class="pe-query-basis">${esc(disclaimer)}</div>
      <div class="pe-query-basis pe-inject-statebasis">${esc(stateBasis)}</div>
      <div class="pe-inject-body">
        <div class="pe-inject-sec">AFFECTED DOWNSTREAM · ${impact.affected.length} (violet on the globe)</div>
        ${depthRows || '<div class="pe-inject-depth">none — the perturbation does not propagate in the modeled graph</div>'}
        <div class="pe-inject-sec">SPARE-CAPACITY ALTERNATIVES</div>
        <div class="pe-inject-depth">${alts}</div>
        <div class="pe-inject-sec">ENGINE REASONING — VERBATIM</div>
        ${impact.explanation.map((line) => `<div class="pe-inject-line">${esc(line)}</div>`).join('')}
      </div>
      <div class="pe-query-basis">FRAME ${esc(result.counterfactualFrame.kind)} · KNOWLEDGE ${esc(result.counterfactualFrame.knowledge)}${result.counterfactualFrame.knowledge === 'as_known_then' ? ' — BACKTEST: only what was knowable then' : ''} · SCENARIO ${esc(result.counterfactualFrame.scenarioId)} · COMMODITY ${esc(result.commodity)}</div>
      <div class="pe-inject-wears"></div>
      <div class="pe-query-chips"></div>`;
    const chips = el.querySelector('.pe-query-chips')!;
    const wears = el.querySelector('.pe-inject-wears')!;
    const renderChips = (): void => {
      const frame = api.getInjectionFrame();
      wears.textContent =
        frame === 'counterfactual'
          ? 'GLOBE WEARS: COUNTERFACTUAL — violet hypothetical roles applied'
          : 'GLOBE WEARS: BASELINE — the mirror; no hypothetical roles drawn';
      chips.replaceChildren();
      const chip = (label: string, title: string, on: boolean, fn: () => void): void => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `pe-query-chip ${on ? 'on' : ''}`;
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', fn);
        chips.appendChild(b);
      };
      chip('COUNTERFACTUAL', 'Wear the hypothetical frame on the globe', frame === 'counterfactual', () => {
        api.setInjectionFrame('counterfactual');
        renderChips();
      });
      chip('BASELINE', 'Flip back to the mirror — same corpus, no injected event', frame === 'baseline', () => {
        api.setInjectionFrame('baseline');
        renderChips();
      });
      chip('EXIT · ESC', 'Release the hypothetical entirely', false, () => api.clearInjection());
    };
    renderChips();
  };

  api.events.on('injection', (ev) => {
    el.hidden = !ev.active;
    if (ev.active && ev.result) render(ev.result, ev.disclaimer ?? '');
  });

  return { el };
}
