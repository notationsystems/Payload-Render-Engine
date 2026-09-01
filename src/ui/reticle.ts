/**
 * Tracking reticle — the maritime-HUD ring around the tracked live
 * contact: a fixed ring, two counter-rotating arc segments, four tick
 * marks, colored by contact kind. Pure attention furniture anchored to
 * the SAME rendered position the dart/dot draws from — it decorates a
 * real tracked object and nothing else. Hides while the contact is
 * behind the globe (the track card stays, stating the track persists).
 */

import type { AppApi } from '../app/api';

export function createReticle(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-reticle';
  el.hidden = true;
  el.innerHTML = `
    <div class="pe-reticle-ring"></div>
    <div class="pe-reticle-arc"></div>
    <div class="pe-reticle-arc pe-reticle-arc2"></div>
    <div class="pe-reticle-ticks"></div>
    <div class="pe-reticle-ticks pe-reticle-ticks2"></div>`;

  api.events.on('liveTrack', (info) => {
    if (!info.active || info.sx === undefined || info.sy === undefined || info.behind) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.dataset.kind = info.kind ?? '';
    el.style.transform = `translate(${info.sx}px, ${info.sy}px)`;
  });

  return { el };
}
