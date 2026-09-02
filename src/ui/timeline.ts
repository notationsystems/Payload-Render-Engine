/**
 * Timeline — bottom-center temporal control strip: play/pause, speed,
 * UTC readout, regime chip, NOW jump, and a scrubber with the played
 * range, the dataset-now tick, world-event markers, and a draggable
 * playhead. Reads the clock lazily — the app configures it.
 */

import type { AppApi } from '../app/api';
import type { TemporalRegime, WorldEvent } from '../data/contracts';

const SPEEDS: [label: string, simSecondsPerSecond: number][] = [
  ['1H/S', 3600],
  ['6H/S', 21600],
  ['24H/S', 86400],
];

export function createTimeline(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pi-timeline';

  // ---------------------------------------------------------------- row 1

  const row1 = document.createElement('div');
  row1.className = 'pi-tl-row1';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'pi-tl-play';
  playBtn.title = 'Play / pause (space)';

  const setPlayGlyph = (playing: boolean): void => {
    playBtn.textContent = playing ? '❚❚' : '▸';
  };
  setPlayGlyph(false);

  playBtn.addEventListener('click', () => {
    api.clock.setPlaying(!api.clock.playing);
  });

  const speeds = document.createElement('div');
  speeds.className = 'pi-tl-speeds';
  const speedBtns: [HTMLButtonElement, number][] = [];
  for (const [label, v] of SPEEDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pi-tl-speed';
    b.textContent = label;
    b.title = `${label.toLowerCase()} sim speed`;
    b.addEventListener('click', () => api.clock.setSpeed(v));
    speeds.append(b);
    speedBtns.push([b, v]);
  }
  const setActiveSpeed = (speed: number): void => {
    for (const [b, v] of speedBtns) b.classList.toggle('active', v === speed);
  };
  setActiveSpeed(api.clock.speed);

  const readout = document.createElement('div');
  readout.className = 'pi-tl-readout';
  readout.textContent = 'UTC ——';

  const regimeChip = document.createElement('div');
  regimeChip.className = 'pi-tl-regime regime-current';
  regimeChip.textContent = 'CURRENT';

  const setRegime = (regime: TemporalRegime): void => {
    // every regime keeps its own identity — scenario is violet-dashed
    // here too, or the solid/dashed semantic collapses
    regimeChip.dataset.regime = regime;
    regimeChip.classList.remove('regime-historical', 'regime-current', 'regime-forecast', 'regime-scenario');
    regimeChip.classList.add(`regime-${regime === 'scenario' ? 'scenario' : regime}`);
    regimeChip.textContent = regime.toUpperCase();
  };

  const nowBtn = document.createElement('button');
  nowBtn.type = 'button';
  nowBtn.className = 'pi-tl-nowbtn';
  nowBtn.textContent = 'NOW';
  nowBtn.title = 'Jump to dataset now';
  nowBtn.addEventListener('click', () => api.clock.jumpToNow());

  row1.append(playBtn, speeds, readout, regimeChip, nowBtn);

  // ---------------------------------------------------------------- row 2 — scrubber

  const scrub = document.createElement('div');
  scrub.className = 'pi-tl-scrub';

  const track = document.createElement('div');
  track.className = 'pi-tl-track';

  const played = document.createElement('div');
  played.className = 'pi-tl-played';

  const nowTick = document.createElement('div');
  nowTick.className = 'pi-tl-nowtick';

  // forecast zone reads as provisional: striped from NOW to range end
  const future = document.createElement('div');
  future.className = 'pi-tl-future';

  const markers = document.createElement('div');

  // kepler-style density strip: how much EVIDENCE the corpus holds per
  // time bucket (observation knownAt + event starts) — faint bars behind
  // the track, so the scrubber shows where knowledge actually lives
  const density = document.createElement('canvas');
  density.className = 'pi-tl-density';

  const playhead = document.createElement('div');
  playhead.className = 'pi-tl-playhead';

  // density hover readout: which slice of time, how much evidence
  const denseTip = document.createElement('div');
  denseTip.className = 'pi-tl-densetip';
  denseTip.hidden = true;

  track.append(density, future, played, nowTick, markers, playhead, denseTip);
  scrub.append(track);

  track.addEventListener('pointermove', (e) => {
    if (!densObs.length || densRange.endMs <= densRange.startMs) return;
    const rect = track.getBoundingClientRect();
    const f = Math.min(0.999, Math.max(0, (e.clientX - rect.left) / rect.width));
    const i = Math.floor(f * densObs.length);
    const span = densRange.endMs - densRange.startMs;
    const a = new Date(densRange.startMs + (i / densObs.length) * span).toISOString().slice(0, 10);
    const b = new Date(densRange.startMs + ((i + 1) / densObs.length) * span).toISOString().slice(0, 10);
    const obs = densObs[i];
    const evt = densEvt[i];
    denseTip.textContent =
      obs + evt === 0
        ? `${a} → ${b} · NO EVIDENCE KNOWN IN THIS WINDOW`
        : `${a} → ${b} · ${obs} OBSERVATION${obs === 1 ? '' : 'S'} KNOWN${evt ? ` · ${evt} EVENT START${evt === 1 ? '' : 'S'}` : ''}`;
    denseTip.style.left = `${Math.min(96, Math.max(4, f * 100)).toFixed(1)}%`;
    denseTip.hidden = false;
  });
  track.addEventListener('pointerleave', () => {
    denseTip.hidden = true;
  });

  el.append(row1, scrub);

  // ---------------------------------------------------------------- markers

  let markersRangeKey = '';
  // per-bucket evidence retained for the density hover readout
  let densObs: number[] = [];
  let densEvt: number[] = [];
  let densRange = { startMs: 0, endMs: 0 };

  const frac = (ms: number, startMs: number, endMs: number): number =>
    endMs === startMs ? 0 : Math.min(1, Math.max(0, (ms - startMs) / (endMs - startMs)));

  const ensureMarkers = (): void => {
    const { startMs, endMs, nowMs } = api.clock.range;
    if (!(endMs > startMs)) return;
    const key = `${startMs}:${endMs}:${nowMs}`;
    if (key === markersRangeKey) return;
    markersRangeKey = key;

    const nowFrac = frac(nowMs, startMs, endMs);
    nowTick.style.left = `${nowFrac * 100}%`;
    future.style.left = `${nowFrac * 100}%`;

    // density strip — obs and events counted separately so the hover
    // readout can name what the bar is made of
    try {
      const snap = api.store.snapshot;
      const BUCKETS = 72;
      densObs = new Array(BUCKETS).fill(0);
      densEvt = new Array(BUCKETS).fill(0);
      densRange = { startMs, endMs };
      for (const o of snap.observations) {
        const ms = Date.parse(o.provenance.knownAt);
        if (Number.isFinite(ms) && ms >= startMs && ms <= endMs)
          densObs[Math.min(BUCKETS - 1, Math.floor(frac(ms, startMs, endMs) * BUCKETS))]++;
      }
      for (const e of snap.events) {
        const ms = Date.parse(e.start);
        if (Number.isFinite(ms) && ms >= startMs && ms <= endMs)
          densEvt[Math.min(BUCKETS - 1, Math.floor(frac(ms, startMs, endMs) * BUCKETS))]++;
      }
      const counts = densObs.map((v, i) => v + densEvt[i]);
      const peak = Math.max(...counts, 1);
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = density.clientWidth || 600;
      const h = density.clientHeight || 14;
      density.width = Math.round(w * dpr);
      density.height = Math.round(h * dpr);
      const ctx = density.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(120, 160, 200, 0.28)';
        const bw = w / BUCKETS;
        for (let i = 0; i < BUCKETS; i++) {
          if (!counts[i]) continue;
          const bh = Math.max(1, (counts[i] / peak) * (h - 2));
          ctx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
        }
      }
    } catch {
      /* corpus not ready */
    }

    markers.replaceChildren();
    let events: WorldEvent[] = [];
    try {
      events = api.store.snapshot?.events ?? [];
    } catch {
      events = [];
    }
    for (const evt of events) {
      const startFrac = frac(Date.parse(evt.start), startMs, endMs);
      const m = document.createElement('div');
      m.className = 'pi-tl-evt';
      if (evt.severity > 0.6) m.classList.add('pi-evt-alert');
      m.style.left = `${startFrac * 100}%`;
      const endLabel = evt.end ? ` → ${evt.end.slice(0, 10)}` : '';
      m.title = `${evt.name}\n${evt.start.slice(0, 10)}${endLabel}`;
      m.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        api.clock.setFraction(startFrac);
      });
      markers.append(m);
    }
  };

  // attempt once at mount (store/clock may already be configured)
  try {
    ensureMarkers();
  } catch {
    /* provider not ready yet — retried on first 'time' event */
  }

  // ---------------------------------------------------------------- scrubbing

  let dragging = false;
  const scrubTo = (e: PointerEvent): void => {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    api.clock.setFraction((e.clientX - rect.left) / rect.width);
  };
  scrub.addEventListener('pointerdown', (e) => {
    dragging = true;
    scrub.setPointerCapture(e.pointerId);
    scrubTo(e);
  });
  scrub.addEventListener('pointermove', (e) => {
    if (dragging) scrubTo(e);
  });
  const endDrag = (): void => {
    dragging = false;
  };
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- clock wiring

  const renderTime = (ts: { t: string; regime: 'historical' | 'current' | 'forecast' | 'scenario' }) => {
    ensureMarkers();
    const f = api.clock.fraction;
    playhead.style.left = `${f * 100}%`;
    played.style.width = `${f * 100}%`;
    readout.textContent = `UTC ${ts.t.slice(0, 16).replace('T', ' ')}`;
    setRegime(ts.regime);
  };
  api.events.on('time', renderTime);
  // the clock is configured before the HUD mounts — render current state now
  renderTime(api.clock.state());

  api.clock.events.on('playstate', ({ playing, speed }) => {
    setPlayGlyph(playing);
    setActiveSpeed(speed);
  });

  // space toggles play unless typing in an input
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const ae = document.activeElement as HTMLElement | null;
    if (
      ae &&
      (ae.tagName === 'INPUT' ||
        ae.tagName === 'TEXTAREA' ||
        ae.tagName === 'SELECT' ||
        ae.isContentEditable)
    )
      return;
    e.preventDefault();
    api.clock.setPlaying(!api.clock.playing);
  });

  return { el };
}
