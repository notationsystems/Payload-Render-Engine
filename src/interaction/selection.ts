/**
 * Picking + hover/selection input: screen-space node picking (precise
 * at planetary scale), raycast route picking, sphere-intersection
 * country picking. Reports picks; the App owns selection state.
 */

import * as THREE from 'three';
import type { EntityId } from '../data/contracts';
import { vec3ToLatLon } from '../geo/projection';
import type { NodesLayer } from '../layers/nodesLayer';
import type { RoutesLayer } from '../layers/routesLayer';
import type { Countries, Country } from '../geo/countries';

export type Pick =
  | { type: 'node'; id: EntityId }
  | { type: 'route'; id: EntityId }
  | { type: 'country'; country: Country }
  | null;

export class SelectionInput {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downAt: { x: number; y: number } | null = null;
  private lastHoverCheck = 0;

  onHover: ((pick: Pick) => void) | null = null;
  onClick: ((pick: Pick, clientX: number, clientY: number, shiftKey: boolean) => void) | null = null;
  onDoubleClick: ((pick: Pick) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    private nodesLayer: NodesLayer,
    private routesLayer: RoutesLayer,
    private globeMesh: THREE.Mesh,
    private countries: Countries
  ) {
    canvas.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - this.lastHoverCheck < 50) return;
      this.lastHoverCheck = now;
      if (this.downAt) return; // dragging
      this.onHover?.(this.pick(e.clientX, e.clientY, false));
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.downAt = { x: e.clientX, y: e.clientY };
    });
    // window, not canvas: a drag released outside the viewport must still
    // clear downAt or hover picking locks out until the next click
    window.addEventListener('pointerup', (e) => {
      if (!this.downAt || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      this.downAt = null;
      if (moved < 5 && e.target === canvas) {
        this.onClick?.(this.pick(e.clientX, e.clientY, true), e.clientX, e.clientY, e.shiftKey);
      }
    });
    canvas.addEventListener('dblclick', (e) => {
      this.onDoubleClick?.(this.pick(e.clientX, e.clientY, true));
    });
  }

  pick(clientX: number, clientY: number, includeCountry: boolean): Pick {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ndcX = (clientX / w) * 2 - 1;
    const ndcY = -(clientY / h) * 2 + 1;

    // 1. nodes (screen-space nearest)
    const node = this.nodesLayer.pick(ndcX, ndcY, this.camera, w, h, 14);
    if (node) return { type: 'node', id: node.node.id };

    // 2. routes (raycast against visible tubes; globe occlusion is an
    // analytic ray–sphere test — never a 49k-triangle mesh raycast)
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const globeDist = raySphereDistance(this.raycaster.ray);
    const hits = this.raycaster.intersectObjects(this.routesLayer.pickables(), false);
    if (hits.length) {
      const first = hits[0];
      if (globeDist === null || first.distance < globeDist + 0.004) {
        const id = first.object.userData.routeId as EntityId;
        if (id) return { type: 'route', id };
      }
    }

    // 3. country (analytic sphere intersection → point-in-polygon)
    if (includeCountry && globeDist !== null) {
      const point = this.raycaster.ray.at(globeDist, _hit);
      const ll = vec3ToLatLon(point);
      const country = this.countries.pickAt(ll.lat, ll.lon);
      if (country) return { type: 'country', country };
    }
    return null;
  }
}

const _hit = new THREE.Vector3();

/** Nearest intersection distance of a ray with the unit sphere at origin. */
function raySphereDistance(ray: THREE.Ray, radius = 1): number | null {
  // |o + t·d|² = r²  with |d| = 1
  const b = ray.origin.dot(ray.direction);
  const c = ray.origin.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}
