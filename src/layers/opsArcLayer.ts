/**
 * Operational lane arc — the globe's tie-in to the control tower.
 *
 * Selecting a load in the operations panel draws its LANE as a single
 * luminous arc between the two DECLARED endpoints. Position honesty is
 * absolute here: the tower serves tracking timestamps, never
 * coordinates, so no vehicle marker is ever drawn — the arc's own
 * treatment states the tracking evidence:
 *
 *   tracked   → solid arc, calm pulse at the endpoints
 *   untracked → DASHED arc — the lane is declared, the movement is not
 *               observed, and the pixels say so
 *
 * White-hot neutral treatment: deliberately outside the mode palette
 * (this is an operation overlay, not a transport network claim) and
 * far from the scenario violet (it is not a hypothesis either).
 */

import * as THREE from 'three';
import type { LonLat } from '../data/contracts';
import { samplePath } from '../geo/projection';

const ARC_COLOR = 0xe8f1fb;
const RING_COLOR = 0xdbe7f4;

export class OpsArcLayer {
  readonly group = new THREE.Group();
  private line: THREE.Line | null = null;
  private rings: THREE.Mesh[] = [];
  private t = 0;

  constructor() {
    this.group.visible = false;
  }

  /** Draw the lane arc. `tracked` states whether tracking evidence exists. */
  show(origin: LonLat, destination: LonLat, tracked: boolean): void {
    this.clear();
    const path = samplePath([origin, destination], { samples: 96, baseRadius: 1.028 });
    const geo = new THREE.BufferGeometry().setFromPoints(path.points);
    const material = tracked
      ? new THREE.LineBasicMaterial({
          color: ARC_COLOR,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        })
      : new THREE.LineDashedMaterial({
          color: ARC_COLOR,
          transparent: true,
          opacity: 0.75,
          dashSize: 0.012,
          gapSize: 0.011,
          depthWrite: false,
        });
    this.line = new THREE.Line(geo, material);
    if (!tracked) this.line.computeLineDistances();
    this.line.renderOrder = 7;
    this.group.add(this.line);

    for (const ll of [origin, destination]) {
      const p = samplePath([ll], { samples: 2, baseRadius: 1.004 }).points[0];
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.0075, 0.0095, 40),
        new THREE.MeshBasicMaterial({
          color: RING_COLOR,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      ring.position.copy(p);
      ring.lookAt(p.clone().multiplyScalar(2));
      ring.renderOrder = 7;
      this.rings.push(ring);
      this.group.add(ring);
    }
    this.group.visible = true;
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
    this.line = null;
    this.rings = [];
    this.group.visible = false;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    const s = 1 + 0.14 * Math.sin(this.t * 2.4);
    for (const ring of this.rings) ring.scale.setScalar(s);
  }
}
