/**
 * WATCHES — the standing instrument's surface and its controller.
 *
 * Conditions are evaluated in-browser (see src/intel/watches.ts for
 * what the client can honestly check); every trip toasts WITH ITS
 * BASIS and is logged here. The banner states the v0 scope plainly:
 * server-side standing queries over future builds are corpus-platform
 * work this panel does not pretend to do.
 */

import type { AppApi } from '../app/api';
import type { InjectionResult } from '../data/injection';
import { feedHealth, onFeedHealth } from '../core/health';
import {
  evalBuildWatch,
  evalEntityWatch,
  evalFeedWatch,
  loadWatches,
  saveWatches,
  watchId,
  type Trip,
  type Watch,
  type WatchState,
} from '../intel/watches';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createWatchesPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-corpus pe-watches';
  el.hidden = true;

  let state: WatchState = loadWatches();
  let activeInjection: InjectionResult | null = null;
  /** session dedup: the same reason for the same watch toasts once */
  const seen = new Set<string>();

  const recordTrips = (trips: Trip[]): void => {
    const fresh = trips.filter((t) => !seen.has(`${t.watchId}|${t.reason}`));
    if (!fresh.length) return;
    for (const t of fresh) {
      seen.add(`${t.watchId}|${t.reason}`);
      api.events.emit('toast', {
        title: `WATCH TRIPPED — ${t.watchLabel.toUpperCase()}`,
        body: `${t.reason} · BASIS: ${t.basis}`,
        tone: 'warn',
      });
    }
    state = { ...state, trips: [...fresh, ...state.trips].slice(0, 30) };
    saveWatches(state);
    if (!el.hidden) render();
  };

  const evaluate = async (): Promise<void> => {
    if (!state.watches.length) return;
    let patterns = null;
    try {
      patterns = (await api.getMinedPatterns()).patterns;
    } catch {
      patterns = null; // mining unavailable — entity/build checks degrade, stated in UI
    }
    const buildId = api.store.snapshot.meta.corpusBuild?.id;
    const trips: Trip[] = [];
    let changed = false;
    const nextWatches = state.watches.map((w) => {
      if (w.kind === 'entity') {
        trips.push(...evalEntityWatch(w, api.store.snapshot, api.clock.simTime, patterns, activeInjection));
        return w;
      }
      if (w.kind === 'build') {
        const r = evalBuildWatch(w, buildId, patterns);
        trips.push(...r.trips);
        if (r.baseline !== w.baseline) {
          changed = true;
          return { ...w, baseline: r.baseline };
        }
        return w;
      }
      const ledger = feedHealth().find((f) => f.feed === w.feed);
      const lastOk = ledger?.samples.length ? ledger.samples.at(-1)!.outcome === 'ok' : null;
      const r = evalFeedWatch(w, lastOk);
      trips.push(...r.trips);
      if (r.lastState !== w.lastState) {
        changed = true;
        return { ...w, lastState: r.lastState };
      }
      return w;
    });
    if (changed) {
      state = { ...state, watches: nextWatches };
      saveWatches(state);
    }
    recordTrips(trips);
  };

  const addWatch = (w: Watch): void => {
    state = { ...state, watches: [...state.watches, w] };
    saveWatches(state);
    render();
    void evaluate();
  };

  const removeWatch = (id: string): void => {
    state = { ...state, watches: state.watches.filter((w) => w.id !== id) };
    saveWatches(state);
    render();
  };

  const render = (): void => {
    const rows = state.watches
      .map((w) => {
        const desc =
          w.kind === 'entity'
            ? 'trips on: active corpus event · what-if blast radius · articulation candidacy'
            : w.kind === 'build'
              ? `trips on: a new corpus build (baseline ${esc(w.baseline.buildId || 'arming on first evaluation')})`
              : `trips on: feed '${esc(w.feed)}' failing or recovering`;
        return `
        <div class="pe-corpus-row">
          <span class="pe-corpus-k pe-vocab-k">${esc(w.label)}</span>
          <span class="pe-corpus-v">${desc} <button type="button" class="pe-watch-x" data-id="${esc(w.id)}" title="remove">×</button></span>
        </div>`;
      })
      .join('');
    const trips = state.trips
      .slice(0, 12)
      .map(
        (t) =>
          `<div class="pe-corpus-row"><span class="pe-corpus-k">${esc(t.at.slice(5, 16))}Z</span><span class="pe-corpus-v"><b>${esc(t.watchLabel)}</b> — ${esc(t.reason)}<br><span class="pe-watch-basis">BASIS: ${esc(t.basis)}</span></span></div>`
      )
      .join('');
    el.innerHTML = `
      <div class="pe-patterns-head">
        <span class="pe-corpus-kicker">WATCHES</span>
        <span class="pe-patterns-title">STANDING CONDITIONS</span>
        <span class="pe-patterns-count">${state.watches.length} ARMED · ${state.trips.length} TRIPS LOGGED</span>
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-corpus-banner">Stated conditions, evaluated in-browser against the loaded corpus, the served build's mined candidates, the active hypothetical, and the feed ledger. Every trip carries its basis. Client-side v0 — standing queries over FUTURE builds run when the corpus platform lands them server-side.</div>
      <div class="pe-corpus-body">
        <div class="pe-watch-chips">
          <button type="button" class="pe-query-chip" data-add="selected" title="Watch the currently selected facility">WATCH SELECTED</button>
          <button type="button" class="pe-query-chip" data-add="build" title="Trip when a new corpus build is served; report candidate churn">WATCH BUILD</button>
          <button type="button" class="pe-query-chip" data-add="feeds" title="Watch every feed the session has attempted">WATCH FEEDS</button>
        </div>
        <div class="pe-corpus-sec"><div class="pe-corpus-sectitle">ARMED</div>${rows || '<div class="pe-corpus-census">no watches — arm one above</div>'}</div>
        <div class="pe-corpus-sec"><div class="pe-corpus-sectitle">TRIP LOG</div>${trips || '<div class="pe-corpus-census">no trips this workspace — an observed zero, conditions evaluated</div>'}</div>
      </div>`;
    el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
    for (const b of el.querySelectorAll('.pe-watch-x')) {
      b.addEventListener('click', () => removeWatch((b as HTMLElement).dataset.id!));
    }
    el.querySelector('[data-add="selected"]')!.addEventListener('click', () => {
      const id = api.getSelection();
      const n = id ? api.store.node(id) : null;
      if (!n) {
        api.events.emit('toast', { title: 'NO FACILITY SELECTED', body: 'Select a facility on the globe, then WATCH SELECTED.', tone: 'info' });
        return;
      }
      if (state.watches.some((w) => w.kind === 'entity' && w.entityId === n.id)) return;
      addWatch({ kind: 'entity', id: watchId(), entityId: n.id, label: n.name, createdAt: new Date().toISOString() });
    });
    el.querySelector('[data-add="build"]')!.addEventListener('click', () => {
      if (state.watches.some((w) => w.kind === 'build')) return;
      addWatch({
        kind: 'build',
        id: watchId(),
        label: 'corpus build',
        createdAt: new Date().toISOString(),
        baseline: { buildId: '', articulationIds: [] },
      });
    });
    el.querySelector('[data-add="feeds"]')!.addEventListener('click', () => {
      const known = feedHealth().map((f) => f.feed);
      if (!known.length) {
        api.events.emit('toast', { title: 'NO FEEDS ATTEMPTED YET', body: 'The session ledger is empty — feeds appear here once something polls.', tone: 'info' });
        return;
      }
      let added = 0;
      for (const feed of known) {
        if (state.watches.some((w) => w.kind === 'feed' && w.feed === feed)) continue;
        state = {
          ...state,
          watches: [
            ...state.watches,
            { kind: 'feed', id: watchId(), feed, label: `feed:${feed}`, createdAt: new Date().toISOString() },
          ],
        };
        added++;
      }
      if (added) {
        saveWatches(state);
        render();
        void evaluate();
      }
    });
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) {
      render();
      void evaluate();
    }
  };

  window.addEventListener('pe:watches-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    e.stopImmediatePropagation();
  });

  // controller: evaluate on the signals the conditions read
  api.events.on('injection', (ev) => {
    activeInjection = ev.active && ev.result ? ev.result : null;
    void evaluate();
  });
  onFeedHealth(() => void evaluate());
  window.setTimeout(() => void evaluate(), 6000); // boot settle, then arm

  return { el };
}
