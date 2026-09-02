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
    const m = this.camera.matrixWorldInverse;

    for (let i = 0; i < this.aircraft.length; i++) {
      const a = this.aircraft[i];
      const ll = deadReckon(a, nowMs);
      if (!ll) {
        this.alive[i] = 0;
        continue;
      }
      this.alive[i] = 1;
      const r = 1 + Math.max(0, ((a.altFt ?? 0) * 0.0003048) / EARTH_KM) + 0.0015;
      latLonToVec3(ll[1], ll[0], r, _v);
      this.positions[i * 3] = _v.x;
      this.positions[i * 3 + 1] = _v.y;
      this.positions[i * 3 + 2] = _v.z;

      // world-stable heading: project local east/north into screen space
      // and rotate the dart by the SCREEN angle of the true course —
      // scratch vectors only, this runs per contact per frame
      if (a.track !== null) {
        _up.copy(_v).normalize();
        _east.set(-_up.z, 0, _up.x).normalize();
        _north.crossVectors(_up, _east);
        const brg = (a.track * Math.PI) / 180;
        _dir.copy(_north).multiplyScalar(Math.cos(brg)).addScaledVector(_east, Math.sin(brg));
        _pw.copy(_v).applyMatrix4(m);
        _pt.copy(_v).addScaledVector(_dir, 0.01).applyMatrix4(m);
        const dx = _pt.x / -_pt.z - _pw.x / -_pw.z;
        const dy = _pt.y / -_pt.z - _pw.y / -_pw.z;
        this.angles[i] = Math.atan2(dy, dx);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAngle.needsUpdate = true;
    this.geo.attributes.aAlive.needsUpdate = true;
  }
}

// scratch vectors — never allocated in the per-frame loop
const _v = new THREE.Vector3();
const _up = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pw = new THREE.Vector3();
const _pt = new THREE.Vector3();
