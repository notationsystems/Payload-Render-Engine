/**
 * Query card — the readout of Earth-as-visual-query-surface. While a
 * corpus query is lit it states WHAT is lit and ON WHAT BASIS (the
 * corpus field that matched — declared, never inferred), and offers
 * the chained refinements from the product vision: show the declared
 * route connections, show the commodity's flows, open the evidence.
 * CLEAR (or Esc) restores the quiet globe. Emphasis only throughout.
 */

import { esc } from '../core/escape';
import type { AppApi } from '../app/api';


export function createQueryCard(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-query';
  el.hidden = true;

  api.events.on('query', (q) => {
    el.hidden = !q.active;
    if (!q.active) return;
    el.innerHTML = `
      <div class="pe-query-line">
        <span class="pe-query-kicker">QUERY</span>
        <span class="pe-query-label">${esc(q.label ?? '')}</span>
        <span class="pe-query-count">${q.matched ?? 0} FACILITIES</span>
      </div>
      <div class="pe-query-basis">${esc(q.basis ?? '')} · the rest of the globe is quieted, not hidden</div>
      <div class="pe-query-chips"></div>`;
    const chips = el.querySelector('.pe-query-chips')!;
    const chip = (label: string, title: string, on: boolean, fn: () => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pe-query-chip ${on ? 'on' : ''}`;
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      chips.appendChild(b);
    };
    // three states: not tried, lit N, or tried-and-zero — the zero is
    // stated ('0 DECLARED'), never a silent button that seems broken
    const routesLabel =
      q.routesLit === null || q.routesLit === undefined
        ? '+ ROUTES'
        : q.routesLit > 0
          ? `ROUTES · ${q.routesLit}`
          : 'ROUTES · 0 DECLARED';
    chip(
      routesLabel,
      'Light the routes the matched facilities DECLARE connections to (corpus field, not proximity)',
      (q.routesLit ?? 0) > 0,
      () => api.addQueryRoutes()
    );
    chip(
      q.flowsOn ? 'FLOWS ON' : '+ FLOWS',
      'Light this commodity’s flows and enable flow particles',
      q.flowsOn ?? false,
      () => api.addQueryFlows()
    );
    chip(
      `EVIDENCE · ${q.evidenceCount ?? 0}`,
      'Observations carrying this commodity’s evidence tag — opens the COMMODITIES workspace',
      false,
      () => api.setPreset('commodities')
    );
    chip('CLEAR · ESC', 'Release the query — the globe returns to its quiet state', false, () =>
      api.clearQuery()
    );
  });

  return { el };
}
