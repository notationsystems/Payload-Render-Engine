/**
 * Tracked-contact readout — gods-eye-view's click-to-track, in
 * instrument form. While a live contact is tracked the camera chases
 * it, a fading trail draws behind it, and this card carries its
 * telemetry WITH ITS BASIS: an aircraft is an OBSERVED ADS-B fix plus
 * stated dead-reckoning age; a satellite is a COMPUTED SGP4 position
 * with its TLE age. NEXT CONTACT steps through nearby live aircraft;
 * ESC or RELEASE lets go.
 */

import type { AppApi } from '../app/api';

export interface LiveTrackInfo {
  active: boolean;
  kind?: 'aircraft' | 'satellite';
  name?: string;
  altKm?: number | null;
  gsKt?: number | null;
  track?: number | null;
  basis?: string;
  age?: string;
  contactsNearby?: number;
  lat?: number;
  lon?: number;
  sx?: number;
  sy?: number;
  behind?: boolean;
}

export function createTrackCard(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-track';
  el.hidden = true;

  const head = document.createElement('div');
  head.className = 'pe-track-head';
  const kind = document.createElement('span');
  kind.className = 'pe-track-kind';
  const name = document.createElement('span');
  name.className = 'pe-track-name';
  head.append(kind, name);

  const tele = document.createElement('div');
  tele.className = 'pe-track-tele';

  const basis = document.createElement('div');
  basis.className = 'pe-track-basis';

  const row = document.createElement('div');
  row.className = 'pe-track-actions';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'pe-track-btn';
  next.textContent = 'NEXT CONTACT';
  next.addEventListener('click', () => api.nextLiveContact());
  const release = document.createElement('button');
  release.type = 'button';
  release.className = 'pe-track-btn pe-track-release';
  release.textContent = 'RELEASE · ESC';
  release.addEventListener('click', () => api.releaseLiveTrack());
  row.append(next, release);

  el.append(head, tele, basis, row);

  api.events.on('liveTrack', (info: LiveTrackInfo) => {
    el.hidden = !info.active;
    if (!info.active) return;
    kind.textContent = info.kind === 'satellite' ? 'SATELLITE' : 'AIRCRAFT';
    kind.dataset.kind = info.kind ?? '';
    name.textContent = info.name ?? '—';
    const parts: string[] = [];
    if (info.altKm !== null && info.altKm !== undefined)
      parts.push(`ALT <b>${info.altKm >= 100 ? Math.round(info.altKm) : info.altKm.toFixed(1)} KM</b>`);
    if (info.gsKt !== null && info.gsKt !== undefined) parts.push(`GS <b>${Math.round(info.gsKt)} KT</b>`);
    if (info.track !== null && info.track !== undefined) parts.push(`TRK <b>${Math.round(info.track)}°</b>`);
    if (info.lat !== undefined && info.lon !== undefined)
      parts.push(
        `${info.lat >= 0 ? 'N' : 'S'} <b>${Math.abs(info.lat).toFixed(2)}°</b> ${info.lon >= 0 ? 'E' : 'W'} <b>${Math.abs(info.lon).toFixed(2)}°</b>`
      );
    tele.innerHTML = parts.join(' · ') || '—';
    basis.textContent = `${info.basis ?? ''}${info.age ? ` · ${info.age}` : ''}`;
    next.hidden = info.kind !== 'aircraft' || !(info.contactsNearby && info.contactsNearby > 1);
    if (!next.hidden) next.textContent = `NEXT CONTACT (${info.contactsNearby})`;
  });

  return { el };
}
