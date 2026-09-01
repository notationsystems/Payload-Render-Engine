/**
 * Detection overlay — gods-eye-view's boxed-contacts view, honestly
 * labeled. Press D: every live contact currently in view gets a
 * corner-bracket box and its identifier, colored by kind. The header
 * states the basis split — aircraft are OBSERVED (ADS-B), satellites
 * are COMPUTED (SGP4) — and when the frame caps the boxes it says how
 * many it is showing of how many. Nothing here detects anything: these
 * are the same live contacts the layers already carry, restated in
 * screen space.
 */

import type { AppApi, LiveScreenContact } from '../app/api';

const MAX_BOXES = 160;
const COLOR: Record<LiveScreenContact['kind'], string> = {
  aircraft: 'rgba(191, 224, 255, 0.9)',
  satellite: 'rgba(255, 217, 160, 0.9)',
};

export function createDetectionOverlay(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('canvas');
  el.className = 'pe-detect';
  el.hidden = true;
  const ctx = el.getContext('2d')!;
  let active = false;
  let raf = 0;

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(window.innerWidth * dpr);
    el.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener('resize', () => {
    if (active) resize();
  });

  const bracket = (x: number, y: number, half: number, arm: number): void => {
    const l = x - half;
    const r = x + half;
    const t = y - half;
    const b = y + half;
    ctx.beginPath();
    ctx.moveTo(l, t + arm); ctx.lineTo(l, t); ctx.lineTo(l + arm, t);
    ctx.moveTo(r - arm, t); ctx.lineTo(r, t); ctx.lineTo(r, t + arm);
    ctx.moveTo(r, b - arm); ctx.lineTo(r, b); ctx.lineTo(r - arm, b);
    ctx.moveTo(l + arm, b); ctx.lineTo(l, b); ctx.lineTo(l, b - arm);
    ctx.stroke();
  };

  const draw = (): void => {
    if (!active) return;
    raf = requestAnimationFrame(draw);
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    const contacts = api.liveScreenContacts();
    let aircraft = 0;
    let sats = 0;
    for (const c of contacts) c.kind === 'aircraft' ? aircraft++ : sats++;

    // cap for legibility, nearest to screen center first — and SAY so
    let shown = contacts;
    if (contacts.length > MAX_BOXES) {
      const cx = w / 2;
      const cy = h / 2;
      shown = [...contacts]
        .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
        .slice(0, MAX_BOXES);
    }

    ctx.lineWidth = 1;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'bottom';
    for (const c of shown) {
      ctx.strokeStyle = COLOR[c.kind];
      ctx.fillStyle = COLOR[c.kind];
      bracket(c.x, c.y, 9, 4);
      ctx.fillText(c.name, c.x + 12, c.y - 4);
    }

    // header: what is boxed, on what basis, and any cap applied
    const capNote = shown.length < contacts.length ? ` · SHOWING ${shown.length} OF ${contacts.length}` : '';
    const line = contacts.length
      ? `DETECTIONS · ${aircraft} AIRCRAFT (OBSERVED · ADS-B) · ${sats} SATELLITES (COMPUTED · SGP4)${capNote} · D TO HIDE`
      : 'DETECTIONS · NO LIVE CONTACTS IN VIEW — ENABLE LIVE LAYERS OR MOVE THE CAMERA · D TO HIDE';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(line).width;
    const tx = (w - tw) / 2;
    // below the command bar AND the tabs ribbon — never under chrome
    ctx.fillStyle = 'rgba(4, 8, 14, 0.72)';
    ctx.fillRect(tx - 10, 100, tw + 20, 20);
    ctx.fillStyle = 'rgba(210, 226, 240, 0.92)';
    ctx.fillText(line, tx, 106);
  };

  const setActive = (v: boolean): void => {
    if (v === active) return;
    active = v;
    el.hidden = !v;
    if (v) {
      resize();
      draw();
    } else {
      cancelAnimationFrame(raf);
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'd' && e.key !== 'D') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    setActive(!active);
  });

  return { el };
}
