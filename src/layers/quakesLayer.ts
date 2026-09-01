/**
 * Live seismic layer — USGS-reported epicenters as expanding rings,
 * sized by magnitude, fading with report age. Supply-chain relevance
 * is the point: a M6 near a port belongs on an operations globe.
 * Every ring is a REPORTED event with its report time; nothing here
 * is interpolated or predicted.
 */

import * as THREE from 'three';
import type { LiveQuake } from '../live/feeds';
import { latLonToVec3 } from '../geo/projection';

export class QuakesLayer {
  readonly group = new THREE.Group();
  private rings: { mesh: THREE.Mesh; mag: number; ageHours: number }[] = [];
  private t = 0;

  constructor() {
    this.group.visible = false;
  }

  setQuakes(quakes: LiveQuake[]): void {
    for (const r of this.rings) {
      this.group.remove(r.mesh);
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
    }
    this.rings = [];
    const nowMs = Date.now();
    for (const q of quakes) {
      const ageHours = (nowMs - Date.parse(q.time)) / 3600_000;
      // magnitude → ring radius (visual scale, decoded in the legend)
      const rad = 0.006 + Math.max(0, q.mag - 2.5) * 0.005;
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(rad * 0.72, rad, 36),
        new THREE.MeshBasicMaterial({
          color: q.mag >= 5.5 ? 0xff5d6e : q.mag >= 4 ? 0xffb454 : 0xc9a86a,
          transparent: true,
          // recent events glow, day-old ones recede — age is visible
          opacity: Math.max(0.15, 0.85 - (ageHours / 24) * 0.6),
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      const p = latLonToVec3(q.lonLat[1], q.lonLat[0], 1.003);
      mesh.position.copy(p);
      mesh.lookAt(p.clone().multiplyScalar(2));
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.rings.push({ mesh, mag: q.mag, ageHours });
    }
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    // strong events pulse gently; small ones stay still (restraint)
    const s = 1 + 0.1 * Math.sin(this.t * 2.0);
    for (const r of this.rings) {
      if (r.mag >= 5.5 && r.ageHours < 12) r.mesh.scale.setScalar(s);
    }
  }
}
