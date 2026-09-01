/**
 * Live satellites — the gods-eye-view signature layer under PayLoad OS
 * chrome. TRUE-SCALE orbits: LEO stations skim the globe, the GNSS
 * shells ride at ~3.2 earth radii — the point sizes, not the orbits,
 * are the visual concession.
 *
 * Every dot is a COMPUTED position (SGP4 from celestrak elements),
 * repropagated each second of wall time. A propagation that fails
 * renders nothing — a decayed satellite never ghosts at its last
 * known point.
 */

import * as THREE from 'three';
import { propagateSat, type LiveSat } from '../live/feeds';
import { latLonToVec3 } from '../geo/projection';

const EARTH_KM = 6371;

/** Constellation colors — distinct systems, decoded in the legend. */
const GROUP_COLORS: Record<string, number> = {
  stations: 0xffd9a0,
  'gps-ops': 0x7fb8ff,
  'glo-ops': 0xb48cff,
  galileo: 0x38d6c8,
};

export class SatsLayer {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private sats: LiveSat[] = [];
  private positions!: Float32Array;
  private colors!: Float32Array;
  private sizes!: Float32Array;
  private lastPropagate = 0;
  visible = false;

  constructor() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec3 aColor;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (240.0 / -mv.z), 1.5, 14.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;
          float k = exp(-r * 2.6);
          gl_FragColor = vec4(vColor * k, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.renderOrder = 6;
    this.points.visible = false;
    this.points.frustumCulled = false;
  }

  setSats(sats: LiveSat[]): void {
    this.sats = sats;
    this.positions = new Float32Array(sats.length * 3);
    this.colors = new Float32Array(sats.length * 3);
    this.sizes = new Float32Array(sats.length);
    const c = new THREE.Color();
    for (let i = 0; i < sats.length; i++) {
      c.set(GROUP_COLORS[sats[i].group] ?? 0x9aa7c7);
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
      this.sizes[i] = sats[i].name.startsWith('ISS') ? 0.1 : 0.045;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.lastPropagate = 0; // force immediate propagation
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.points.visible = v && this.sats.length > 0;
  }

  /** Repropagate at 1 Hz of wall time — SGP4 over ~700 sats is cheap. */
  update(): void {
    if (!this.points.visible || !this.sats.length) return;
    const now = performance.now();
    if (now - this.lastPropagate < 1000) return;
    this.lastPropagate = now;
    const at = new Date();
    for (let i = 0; i < this.sats.length; i++) {
      const p = propagateSat(this.sats[i], at);
      if (!p) {
        // failed propagation: park at origin with zero size — never ghosts
        this.positions[i * 3] = 0;
        this.positions[i * 3 + 1] = 0;
        this.positions[i * 3 + 2] = 0;
        this.sizes[i] = 0;
        continue;
      }
      const r = 1 + p.altitudeKm / EARTH_KM;
      const v = latLonToVec3(p.lonLat[1], p.lonLat[0], r);
      this.positions[i * 3] = v.x;
      this.positions[i * 3 + 1] = v.y;
      this.positions[i * 3 + 2] = v.z;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}
