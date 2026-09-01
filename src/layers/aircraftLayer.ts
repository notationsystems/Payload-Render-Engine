/**
 * Live aircraft — ADS-B observed contacts as world-stable heading
 * darts (the same screen-space course projection the flow layer uses:
 * true course over ground, projected per-frame, correct at every
 * camera angle — no spinning, no viewport-locking).
 *
 * Motion honesty: fixes arrive every ~30s; between fixes the dart is
 * DEAD-RECKONED along the observed track at observed ground speed.
 * The readout states the observed fix age; a contact whose fix goes
 * stale past the reckoning limit disappears rather than ghosting.
 * Adapted from bilawalsidhu/gods-eye-view (MIT).
 */

import * as THREE from 'three';
import { deadReckon, type LiveAircraft } from '../live/feeds';
import { latLonToVec3 } from '../geo/projection';

const EARTH_KM = 6371;
const CIVIL = new THREE.Color(0xbfe0ff);
const LOW = new THREE.Color(0x9aa7c7); // below 10k ft — approach/departure

export class AircraftLayer {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private aircraft: LiveAircraft[] = [];
  private positions = new Float32Array(0);
  private angles = new Float32Array(0);
  private colors = new Float32Array(0);
  private alive = new Float32Array(0);
  visible = false;

  constructor(private camera: THREE.PerspectiveCamera) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aAngle;
        attribute vec3 aColor;
        attribute float aAlive;
        varying vec3 vColor;
        varying float vAngle;
        varying float vAlive;
        void main() {
          vColor = aColor;
          vAngle = aAngle;
          vAlive = aAlive;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(150.0 / -mv.z, 5.0, 15.0) * step(0.5, aAlive);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAngle;
        varying float vAlive;
        void main() {
          if (vAlive < 0.5) discard;
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          if (length(p) > 1.0) discard;
          float c = cos(vAngle), s = sin(vAngle);
          vec2 q = mat2(c, -s, s, c) * vec2(p.x, -p.y) * 1.15;
          float hw = (0.70 - q.x) * 0.36;
          float inX = step(-0.9, q.x) * step(q.x, 0.70);
          float body = smoothstep(0.10, -0.06, abs(q.y) - hw) * inX;
          float notch = smoothstep(-0.1, 0.16, q.x + 0.9 - abs(q.y) * 0.9);
          gl_FragColor = vec4(vColor, body * notch * 0.95);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.renderOrder = 6;
    this.points.visible = false;
    this.points.frustumCulled = false;
  }

  setAircraft(aircraft: LiveAircraft[]): void {
    this.aircraft = aircraft;
    this.positions = new Float32Array(aircraft.length * 3);
    this.angles = new Float32Array(aircraft.length);
    this.colors = new Float32Array(aircraft.length * 3);
    this.alive = new Float32Array(aircraft.length);
    for (let i = 0; i < aircraft.length; i++) {
      const c = (aircraft[i].altFt ?? 0) < 10_000 ? LOW : CIVIL;
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('aAngle', new THREE.BufferAttribute(this.angles, 1));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('aAlive', new THREE.BufferAttribute(this.alive, 1));
    this.points.visible = this.visible && aircraft.length > 0;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.points.visible = v && this.aircraft.length > 0;
  }

  /** Current reckoned position of one contact (for tracking/picking). */
  reckonedLonLat(i: number, nowMs: number) {
    return deadReckon(this.aircraft[i], nowMs);
  }

  get contacts(): LiveAircraft[] {
    return this.aircraft;
  }

  update(): void {
    if (!this.points.visible || !this.aircraft.length) return;
    const nowMs = Date.now();
    const camPos = this.camera.position;
    const up = new THREE.Vector3();
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const screenE = new THREE.Vector2();
    const screenN = new THREE.Vector2();

    for (let i = 0; i < this.aircraft.length; i++) {
      const a = this.aircraft[i];
      const ll = deadReckon(a, nowMs);
      if (!ll) {
        this.alive[i] = 0;
        continue;
      }
      this.alive[i] = 1;
      const r = 1 + Math.max(0, ((a.altFt ?? 0) * 0.0003048) / EARTH_KM) + 0.0015;
      const v = latLonToVec3(ll[1], ll[0], r);
      this.positions[i * 3] = v.x;
      this.positions[i * 3 + 1] = v.y;
      this.positions[i * 3 + 2] = v.z;

      // world-stable heading: project local east/north into screen space
      // and rotate the dart by the SCREEN angle of the true course
      if (a.track !== null) {
        up.copy(v).normalize();
        east.set(-up.z, 0, up.x).normalize();
        north.crossVectors(up, east);
        toCam.copy(camPos).sub(v);
        const brg = (a.track * Math.PI) / 180;
        const dir = north
          .clone()
          .multiplyScalar(Math.cos(brg))
          .addScaledVector(east, Math.sin(brg));
        // project dir into camera space (approx: use camera matrix basis)
        const m = this.camera.matrixWorldInverse;
        const pWorld = v.clone();
        const pTip = v.clone().addScaledVector(dir, 0.01);
        const s0 = pWorld.applyMatrix4(m);
        const s1 = pTip.applyMatrix4(m);
        screenE.set(s1.x / -s1.z - s0.x / -s0.z, s1.y / -s1.z - s0.y / -s0.z);
        this.angles[i] = Math.atan2(screenE.y, screenE.x);
      }
      void screenN;
      void toCam;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAngle.needsUpdate = true;
    this.geo.attributes.aAlive.needsUpdate = true;
  }
}
