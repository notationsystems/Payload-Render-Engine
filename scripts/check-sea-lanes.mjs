#!/usr/bin/env node
/**
 * Sea-lane check — maritime route geometry must stay at sea.
 *
 * Samples every maritime route's great-circle chords (~10 km steps)
 * against Natural Earth 50m land polygons and fails on any on-land run
 * of ≥ 20 km outside the harbor-approach grace radius around route
 * endpoints (ports are on coasts; estuary approaches like the Elbe sit
 * below the 50m data's resolution). Mechanical enforcement of the
 * "a lane over land is not where the ship goes" discipline.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const STEP_KM = 10;
const FLAG_RUN_KM = 20;
const ENDPOINT_GRACE_KM = 60;
const R = 6371;

/**
 * Real navigable water below the 50m data's resolution — canal transits
 * and estuary approaches. [south, north, west, east].
 */
const ALLOWED_CORRIDORS = [
  [8.6, 9.6, -80.2, -79.3], // Panama Canal
  [29.7, 31.6, 32.1, 32.7], // Suez Canal
  [53.4, 54.2, 8.4, 10.2], // Elbe estuary → Hamburg
  [51.15, 51.6, 3.2, 4.6], // Westerschelde → Antwerp
];
const inCorridor = (lon, lat) =>
  ALLOWED_CORRIDORS.some(([s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e);

// ---------------------------------------------------------------- land
// (minimal inline topojson→polygons: world-atlas land-50m)
const topo = JSON.parse(readFileSync(resolve(ROOT, 'public/data/land-50m.json'), 'utf8'));
function decodeArcs(topo) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
}
const arcs = decodeArcs(topo);
function ringFromArcIds(ids) {
  const pts = [];
  for (const id of ids) {
    const a = id >= 0 ? arcs[id] : [...arcs[~id]].reverse();
    for (let i = pts.length ? 1 : 0; i < a.length; i++) pts.push(a[i]);
  }
  return pts;
}
const polygons = []; // {outer, holes, bbox}
const geoms = topo.objects.land.geometries ?? [topo.objects.land];
for (const g of geoms) {
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  for (const rings of polys) {
    const outer = ringFromArcIds(rings[0]);
    const holes = rings.slice(1).map(ringFromArcIds);
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of outer) {
      if (x < w) w = x; if (x > e) e = x;
      if (y < s) s = y; if (y > n) n = y;
    }
    polygons.push({ outer, holes, bbox: [w, s, e, n] });
  }
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function onLand(lon, lat) {
  for (const p of polygons) {
    const [w, s, e, n] = p.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (!inRing(lon, lat, p.outer)) continue;
    let hole = false;
    for (const h of p.holes) if (inRing(lon, lat, h)) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

// ---------------------------------------------------------------- geo
const D = Math.PI / 180;
const toV = ([lon, lat]) => {
  const c = Math.cos(lat * D);
  return [c * Math.cos(lon * D), Math.sin(lat * D), -c * Math.sin(lon * D)];
};
const toLL = ([x, y, z]) => [Math.atan2(-z, x) / D, Math.asin(Math.max(-1, Math.min(1, y))) / D];
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
function slerp(a, b, t) {
  const o = ang(a, b);
  if (o < 1e-9) return a;
  const so = Math.sin(o);
  const f0 = Math.sin((1 - t) * o) / so, f1 = Math.sin(t * o) / so;
  const v = [a[0] * f0 + b[0] * f1, a[1] * f0 + b[1] * f1, a[2] * f0 + b[2] * f1];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------- routes
const mod = await import(pathToFileURL(resolve(ROOT, 'src/data/synthetic/world.ts')).href);
const snap = mod.buildWorldSnapshot();

const violations = [];
for (const route of snap.routes) {
  if (route.mode !== 'maritime') continue;
  const coords = route.geometry.coordinates;
  // arc-length position of every sample + total length for the grace test
  const vs = coords.map(toV);
  let total = 0;
  const cum = [0];
  for (let i = 1; i < vs.length; i++) {
    total += ang(vs[i - 1], vs[i]) * R;
    cum.push(total);
  }
  let run = null;
  const closeRun = (atKm) => {
    if (!run) return;
    const runLen = atKm - run.startKm;
    const inGrace = run.startKm < ENDPOINT_GRACE_KM || atKm > total - ENDPOINT_GRACE_KM;
    if (runLen >= FLAG_RUN_KM && !inGrace) {
      violations.push(
        `${route.id}: ~${Math.round(runLen)} km on land from (${run.startLL[1].toFixed(2)},${run.startLL[0].toFixed(2)}) to (${run.endLL[1].toFixed(2)},${run.endLL[0].toFixed(2)})`
      );
    }
    run = null;
  };
  for (let i = 0; i < vs.length - 1; i++) {
    const segKm = ang(vs[i], vs[i + 1]) * R;
    const steps = Math.max(1, Math.ceil(segKm / STEP_KM));
    for (let s2 = 0; s2 <= steps; s2++) {
      const t = s2 / steps;
      const km = cum[i] + segKm * t;
      const ll = toLL(slerp(vs[i], vs[i + 1], t));
      if (!inCorridor(ll[0], ll[1]) && onLand(ll[0], ll[1])) {
        if (!run) run = { startKm: km, startLL: ll, endLL: ll };
        run.endLL = ll;
        run.endKm = km;
      } else {
        closeRun(km);
      }
    }
  }
  closeRun(total);
}

if (violations.length) {
  console.error(`SEA-LANE CHECK FAILED — ${violations.length} maritime segment(s) run over land:\n`);
  for (const v of violations) console.error('  ✗ ' + v);
  process.exit(1);
}
console.log(`sea-lane check ok — all maritime routes stay at sea (${STEP_KM} km sampling, ${FLAG_RUN_KM} km threshold)`);
