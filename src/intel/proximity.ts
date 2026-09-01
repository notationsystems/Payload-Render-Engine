/**
 * Proximity intelligence — correlating LIVE hazards with CORPUS assets.
 *
 * Every row this module emits is COMPUTED: a great-circle distance
 * between a REPORTED epicenter (USGS, report time attached) and a
 * corpus facility. It claims proximity and nothing else — no impact,
 * no damage, no delay. The thresholds are stated on the surface that
 * renders the rows, so an empty rail means "nothing within the stated
 * criteria", never "nothing happened".
 */

import type { EntityId, Facility } from '../data/contracts';
import type { LiveQuake } from '../live/feeds';

export interface HazardAlert {
  id: string;
  severity: 'alert' | 'warn';
  quakeId: string;
  mag: number;
  place: string;
  reportedAt: string;
  reportAgeHours: number;
  nodeId: EntityId;
  nodeName: string;
  nodeCategory: string;
  /** COMPUTED — great-circle, WGS-84 mean radius. */
  distanceKm: number;
}

/** Magnitude → correlation radius (km). Stated wherever rows render. */
export const PROXIMITY_THRESHOLDS: { minMag: number; radiusKm: number; severity: 'alert' | 'warn' }[] = [
  { minMag: 6.0, radiusKm: 500, severity: 'alert' },
  { minMag: 5.0, radiusKm: 300, severity: 'warn' },
  { minMag: 4.5, radiusKm: 150, severity: 'warn' },
];

const R_KM = 6371;

export function greatCircleKm(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la = (aLat * Math.PI) / 180;
  const lb = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Correlate reported epicenters with corpus facilities. Each quake
 * contributes at most its 3 nearest in-threshold assets — a cluster of
 * berths beside one epicenter is one story, not twelve rows.
 */
export function correlateQuakes(quakes: LiveQuake[], nodes: Facility[], nowMs: number): HazardAlert[] {
  const out: HazardAlert[] = [];
  for (const q of quakes) {
    const rule = PROXIMITY_THRESHOLDS.find((t) => q.mag >= t.minMag);
    if (!rule) continue;
    const hits: HazardAlert[] = [];
    for (const n of nodes) {
      const [nLon, nLat] = n.geometry.coordinates;
      const d = greatCircleKm(q.lonLat[0], q.lonLat[1], nLon, nLat);
      if (d > rule.radiusKm) continue;
      hits.push({
        id: `${q.id}:${n.id}`,
        severity: rule.severity,
        quakeId: q.id,
        mag: q.mag,
        place: q.place,
        reportedAt: q.time,
        reportAgeHours: Math.max(0, (nowMs - Date.parse(q.time)) / 3600_000),
        nodeId: n.id,
        nodeName: n.name,
        nodeCategory: n.kind,
        distanceKm: d,
      });
    }
    hits.sort((a, b) => a.distanceKm - b.distanceKm);
    out.push(...hits.slice(0, 3));
  }
  // strongest story first: severity, then magnitude, then closeness
  out.sort((a, b) =>
    a.severity !== b.severity
      ? a.severity === 'alert'
        ? -1
        : 1
      : b.mag !== a.mag
        ? b.mag - a.mag
        : a.distanceKm - b.distanceKm
  );
  return out;
}
