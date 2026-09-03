/**
 * Vocabulary overlay — the OS learnable in thirty seconds.
 *
 * `?` (or the `keys` command) lists the command and keyboard
 * vocabulary grouped by what it DOES — query, mine & verify,
 * hypothesize, operate, time, view, interact — instead of one long
 * help string. Every row is a real capability that exists today;
 * nothing aspirational is listed.
 */

import { esc } from '../core/escape';
import type { AppApi } from '../app/api';


const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'QUERY THE CORPUS',
    rows: [
      ['find <name> · goto <name>', 'search entities, countries, routes; focus the best hit'],
      ['producers of <material>', 'light facilities that DECLARE the material in outputs — field-based, never name inference'],
      ['consumers of <material>', 'same, on the declared inputs field'],
      ['show <commodity> flows', 'light a commodity’s flows and particles'],
      ['compare <a> vs <b>', 'two routes side by side, promises and observed state'],
    ],
  },
  {
    title: 'MINE & VERIFY',
    rows: [
      ['patterns · mine', 'the Pattern Registry — mined candidates with algorithm · run · build lineage'],
      ['warrant · why', 'the Warrant Graph: claim → computation → records → sources → build. No score, a chain'],
      ['corpus', 'the CorpusDefinition — declared rules, derived censuses, stated absences'],
      ['compiler · build', 'the build + its conservation report and commitment manifest'],
      ['refusals', 'the refused:* work queue — one mechanism per group, one shared remedy'],
      ['watches', 'standing conditions with stated bases; every trip logged'],
      ['system · control', 'the control plane: live topology, capability ladder (observed → proposed → approved → dispatched), session journal'],
    ],
  },
  {
    title: 'HYPOTHESIZE',
    rows: [
      ['what if <chokepoint> closes', 'enter an in-process counterfactual frame (violet, never state)'],
      ['rank chokepoints', 'every frame computed and ranked by simulated network damage'],
      ['scenarios → WHAT-IF INJECTION', 'inject an event through the upstream engine; backtest with AS KNOWN THEN'],
      ['exit frame', 'leave the hypothetical; Esc also releases it'],
    ],
  },
  {
    title: 'OPERATE',
    rows: [
      ['operations', 'the brokerage control tower mirror — exception-first, read-only'],
      ['brief · sitrep', 'the composed situation report, basis labeled'],
      ['markets', 'FX · crypto · derivatives desks'],
      ['agents', 'the structured tool surface'],
    ],
  },
  {
    title: 'TIME',
    rows: [
      ['play · pause · now', 'run or hold the sim clock; jump to the knowledge boundary'],
      ['speed 1h · 6h · 24h', 'sim seconds per real second'],
      ['timeline scrub', 'left of NOW reconstructs; right of NOW projects — and says so'],
    ],
  },
  {
    title: 'VIEW',
    rows: [
      ['world · freight · trade · commodities · network · intelligence', 'layer presets'],
      ['show / hide <layer> · flows on / off', 'individual layer control'],
      ['keys 1–5', 'sensor styles (normal · nvg · flir · crt · noir) — style, never data'],
      ['D', 'detection overlay for live contacts'],
    ],
  },
  {
    title: 'INTERACT',
    rows: [
      ['click', 'select and inspect; the inspector shows evidence and basis'],
      ['shift-click', 'pin for A/B compare (two pins → delta strip)'],
      ['hold B', 'route brush — emphasis, nothing hidden'],
      ['click a live contact', 'track it (camera chase + trail); Esc releases'],
      ['Esc', 'release ladder: demo → live track → what-if → pattern → query → panel → selection'],
      ['/ · ?', 'focus the command bar · this overlay'],
    ],
  },
];

export function createVocabPanel(_api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-corpus pe-vocab';
  el.hidden = true;

  const render = (): void => {
    el.innerHTML = `
      <div class="pe-patterns-head">
        <span class="pe-corpus-kicker">VOCABULARY</span>
        <span class="pe-patterns-title">HOW TO DRIVE PAYLOAD OS</span>
        <span class="pe-patterns-count">? TOGGLES · ESC CLOSES</span>
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-corpus-body">
        ${GROUPS.map(
          (g) => `
        <div class="pe-corpus-sec">
          <div class="pe-corpus-sectitle">${esc(g.title)}</div>
          ${g.rows
            .map(
              ([k, v]) =>
                `<div class="pe-corpus-row"><span class="pe-corpus-k pe-vocab-k">${esc(k)}</span><span class="pe-corpus-v">${esc(v)}</span></div>`
            )
            .join('')}
        </div>`
        ).join('')}
      </div>`;
    el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) render();
  };

  window.addEventListener('pe:vocab-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    e.stopImmediatePropagation();
  });

  return { el };
}
