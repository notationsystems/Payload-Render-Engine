/**
 * Sensor styles — gods-eye-view's feed treatments as a PayLoad OS
 * instrument. Keys 1–5 (or the chips) switch the rendered feed between
 * NORMAL / NVG / FLIR / CRT / NOIR. The style is a GLSL post-pass over
 * the WebGL canvas only: a styled feed is the SAME data — every HUD
 * instrument, label and readout stays untouched and legible.
 */

import type { AppApi } from '../app/api';

const MODES: { mode: 0 | 1 | 2 | 3 | 4; label: string; hint: string }[] = [
  { mode: 0, label: 'NORMAL', hint: 'unstyled feed' },
  { mode: 1, label: 'NVG', hint: 'green phosphor, gained luminance' },
  { mode: 2, label: 'FLIR', hint: 'ironbow pseudo-thermal (styled, not measured)' },
  { mode: 3, label: 'CRT', hint: 'scanlines, phosphor, fringe' },
  { mode: 4, label: 'NOIR', hint: 'hard monochrome' },
];

export function createSensorStyles(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-sensor';

  const head = document.createElement('span');
  head.className = 'pe-sensor-head';
  head.textContent = 'SENSOR';
  el.appendChild(head);

  const btns = new Map<number, HTMLButtonElement>();
  for (const m of MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pe-sensor-btn';
    b.textContent = m.label;
    b.title = `${m.mode + 1} · ${m.hint}`;
    b.addEventListener('click', () => api.setSensorMode(m.mode));
    btns.set(m.mode, b);
    el.appendChild(b);
  }
  btns.get(0)?.classList.add('on');

  api.events.on('sensor', ({ mode, label }) => {
    for (const [k, b] of btns) b.classList.toggle('on', k === mode);
    if (mode !== 0) {
      api.events.emit('toast', {
        title: `SENSOR · ${label}`,
        body: `${MODES[mode].hint} — a styled feed is the same data; instruments unaffected. Key 1 returns to NORMAL.`,
        tone: 'info',
      });
    }
  });

  // keys 1–5 switch styles anywhere outside editable elements
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > 5) return;
    api.setSensorMode((n - 1) as 0 | 1 | 2 | 3 | 4);
  });

  return { el };
}
