/**
 * Pattern Registry — the Payload Miner's browsing surface, plus the
 * active-pattern card shown while one candidate's subgraph is lit.
 *
 * The epistemic ladder is enforced at this surface: every row is a
 * MINED CANDIDATE — a structure computed by a named, versioned
 * algorithm over DECLARED corpus fields. It is never styled as an
 * observed fact, and the banner says so in words. Every candidate
 * carries its lineage (algorithm@version · mining run · corpus build
 * · supporting record count) so "which version of the corpus produced
 * this answer?" is always answerable.
 *
 * Interaction: browse the registry → click a row → the registry tucks
 * away and the subgraph lights (emphasis, not filter) with the MINED
 * card up top. Esc or CLEAR releases; REGISTRY reopens the list.
 */

import { esc } from '../core/escape';
import type { AppApi } from '../app/api';
import type { MinedPattern, PatternType } from '../intel/miner';


const TYPE_ORDER: PatternType[] = [
  'SUPPLY_CONCENTRATION',
  'STRUCTURAL_ARTICULATION',
  'SHARED_CORRIDOR',
];

const TYPE_META: Record<PatternType, { title: string; note: string }> = {
  SUPPLY_CONCENTRATION: {
    title: 'SUPPLY CONCENTRATION',
    note: 'declared flows of one commodity dominated by a single origin',
  },
  STRUCTURAL_ARTICULATION: {
    title: 'STRUCTURAL ARTICULATION',
    note: 'cut vertices — removal disconnects part of the declared route network',
  },
  SHARED_CORRIDOR: {
    title: 'SHARED CORRIDORS',
    note: 'single routes that many declared flows traverse',
  },
};

export function createPatternsPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-patterns-root';

  // ---- registry overlay --------------------------------------------
  const panel = document.createElement('div');
  panel.className = 'pe-patterns';
  panel.hidden = true;
  el.appendChild(panel);

  // ---- active-pattern card (query-card slot; mutually exclusive) ---
  const card = document.createElement('div');
  card.className = 'pe-pattern-card';
  card.hidden = true;
  el.appendChild(card);

  let activeId: string | null = null;

  const render = async (): Promise<void> => {
    // the run may come over the wire (the served capability) — say so
    // while it does rather than flashing an empty frame
    if (!panel.querySelector('.pe-patterns-head')) {
      panel.innerHTML = '<div class="pe-patterns-lineage">MINING RUN IN PROGRESS…</div>';
    }
    const { run, patterns, minedAt } = await api.getMinedPatterns();
    if (panel.hidden) return; // closed while mining — keep it closed
    panel.replaceChildren();

    const head = document.createElement('div');
    head.className = 'pe-patterns-head';
    head.innerHTML = `
      <span class="pe-patterns-kicker">MINED</span>
      <span class="pe-patterns-title">PATTERN REGISTRY</span>
      <span class="pe-patterns-count">${run.patternCount} CANDIDATES</span>
      <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>`;
    head.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
    panel.appendChild(head);

    const banner = document.createElement('div');
    banner.className = 'pe-patterns-banner';
    banner.textContent =
      'Every row is a MINED CANDIDATE — computed by a named algorithm over DECLARED corpus fields. A pattern is not an observed fact; nothing here is promoted without validation.';
    panel.appendChild(banner);

    const lineage = document.createElement('div');
    lineage.className = 'pe-patterns-lineage';
    lineage.textContent =
      `RUN ${run.miningRunId} · BUILD ${run.corpusBuildId} · ` +
      `INPUTS ${run.inputCounts.nodes} NODES / ${run.inputCounts.routes} ROUTES / ${run.inputCounts.flows} FLOWS · ` +
      `MINED AT ${minedAt.toUpperCase()}`;
    panel.appendChild(lineage);

    if (!patterns.length) {
      // absence with a stated reason — thresholds named, never a blank
      const empty = document.createElement('div');
      empty.className = 'pe-patterns-empty';
      empty.textContent =
        '0 candidates over this corpus at the current thresholds — not proof the structures are absent, only that none cleared the bar: ' +
        run.algorithms
          .map(
            (a) =>
              `${a.name}@${a.version}` +
              (Object.keys(a.parameters).length
                ? ` (${Object.entries(a.parameters)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')})`
                : '')
          )
          .join(' · ');
      panel.appendChild(empty);
      return;
    }

    const body = document.createElement('div');
    body.className = 'pe-patterns-body';
    panel.appendChild(body);

    for (const t of TYPE_ORDER) {
      const group = patterns
        .filter((p) => p.patternType === t)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      if (!group.length) continue;
      const g = document.createElement('div');
      g.className = 'pe-patterns-group';
      g.innerHTML = `
        <div class="pe-patterns-gtitle">${TYPE_META[t].title} · ${group.length}</div>
        <div class="pe-patterns-gnote">${esc(TYPE_META[t].note)}</div>`;
      for (const p of group) g.appendChild(row(p));
      body.appendChild(g);
    }
  };

  const row = (p: MinedPattern): HTMLElement => {
    const r = document.createElement('button');
    r.type = 'button';
    r.className = `pe-pattern-row${p.id === activeId ? ' on' : ''}`;
    r.innerHTML = `
      <span class="pe-pattern-statement">${esc(p.statement)}</span>
      <span class="pe-pattern-meta"><span class="pe-pattern-bar"><i style="width:${Math.round(p.score * 100)}%"></i></span>SCORE ${p.score.toFixed(2)} · ${esc(p.algorithm)}@${esc(p.algorithmVersion)} · ${p.supportingRecords.length} RECORDS</span>`;
    r.addEventListener('click', () => {
      setOpen(false); // the globe is the point — get out of its way
      void api.showMinedPattern(p.id);
    });
    return r;
  };

  const renderCard = (p: MinedPattern): void => {
    card.innerHTML = `
      <div class="pe-query-line">
        <span class="pe-pattern-kicker">MINED</span>
        <span class="pe-query-label">${esc(TYPE_META[p.patternType].title)}</span>
        <span class="pe-query-count">SCORE ${p.score.toFixed(2)}</span>
      </div>
      <div class="pe-pattern-cardstmt">${esc(p.statement)}</div>
      <div class="pe-query-basis">CANDIDATE — mined by ${esc(p.algorithm)}@${esc(p.algorithmVersion)}, not an observed fact · ${esc(p.scoreBasis)}</div>
      <div class="pe-query-basis">RUN ${esc(p.miningRunId)} · BUILD ${esc(p.corpusBuildId)} · ${p.supportingRecords.length} SUPPORTING RECORDS</div>
      <div class="pe-query-chips"></div>`;
    const chips = card.querySelector('.pe-query-chips')!;
    const chip = (label: string, title: string, fn: () => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pe-query-chip';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      chips.appendChild(b);
    };
    chip('REGISTRY', 'Back to the full candidate list', () => setOpen(true));
    chip('CLEAR · ESC', 'Release the pattern — the globe returns to its quiet state', () =>
      api.clearMinedPattern()
    );
  };

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    if (open) void render();
  };

  window.addEventListener('pe:patterns-toggle' as keyof WindowEventMap, () =>
    setOpen(panel.hidden)
  );
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    setOpen(false);
    // this Escape is consumed — the ladder in main.ts must not also
    // fire (it runs after this handler and would clear the selection)
    e.stopImmediatePropagation();
  });

  api.events.on('pattern', (ev) => {
    activeId = ev.active && ev.pattern ? ev.pattern.id : null;
    card.hidden = !ev.active;
    if (ev.active && ev.pattern) renderCard(ev.pattern);
    if (!panel.hidden) void render(); // keep the row highlight honest
  });

  return { el };
}
