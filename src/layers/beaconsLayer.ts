/**
 * Attention beams — the war-room vertical light pillar, disciplined.
 * A beam marks a corpus asset the intelligence layer has FLAGGED:
 * hazard-correlated (COMPUTED PROXIMITY rows in the alerts rail) or
 * affected by a high-severity active disruption. The beam is a marker
 * of an alert that exists elsewhere with its basis — it adds attention,
 * never information. Decoded in the legend; alert red / warn amber.
 */

import * as THREE from 'three';
import type { LonLat } from '../data/contracts';
import { latLonToVec3 } from '../geo/projection';

const HEIGHT = 0.055;
const HALF_W = 0.0035;
const ALERT = new THREE.Color(0xff5d6e);
const WARN = new THREE.Color(0xffb454);

export interface Beacon {
  lonLat: LonLat;
  tone: 'alert' | 'warn';
}

export class BeaconsLayer {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aPhase;
        attribute float aPad;
        varying vec3 vColor;
        varying float vPhase;
        varying float vPad;
        varying vec2 vUvv;
        void main() {
          vColor = aColor;
          vPhase = aPhase;
          vPad = aPad;
          vUvv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vColor;
        varying float vPhase;
        varying float vPad;
        varying vec2 vUvv;
        void main() {
          float pulse = 0.72 + 0.28 * sin(uTime * 1.6 + vPhase);
          float a;
          if (vPad > 0.5) {
            // surface pad: radial glow — reads even when the pillar is
            // foreshortened by a top-down camera
            float d = length(vUvv - 0.5) * 2.0;
            float k = max(0.0, 1.0 - d);
            a = k * k * pulse * 0.55;
          } else {
            // pillar: fade with height, soft edges, slow breathing pulse
            float h = 1.0 - vUvv.y;
            float edge = 1.0 - abs(vUvv.x * 2.0 - 1.0);
            a = h * h * edge * pulse * 0.5;
          }
          gl_FragColor = vec4(vColor, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  set(beacons: Beacon[]): void {
    const n = beacons.length;
    if (!n) {
      this.mesh.visible = false;
      return;
    }
    // two crossed vertical quads + one surface pad per beacon
    const VPB = 12;
    const positions = new Float32Array(n * VPB * 3);
    const uvs = new Float32Array(n * VPB * 2);
    const colors = new Float32Array(n * VPB * 3);
    const phases = new Float32Array(n * VPB);
    const pads = new Float32Array(n * VPB);
    const index: number[] = [];
    const up = new THREE.Vector3();
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    let v = 0;
    for (let i = 0; i < n; i++) {
      const b = beacons[i];
      const base = latLonToVec3(b.lonLat[1], b.lonLat[0], 1.001);
      up.copy(base).normalize();
      east.set(-up.z, 0, up.x).normalize();
      north.crossVectors(up, east);
      const c = b.tone === 'alert' ? ALERT : WARN;
      const phase = (i * 2.39996) % 6.283; // golden-angle stagger
      for (const dir of [east, north]) {
        const corners = [
          base.clone().addScaledVector(dir, -HALF_W),
          base.clone().addScaledVector(dir, HALF_W),
          base.clone().addScaledVector(dir, HALF_W).addScaledVector(up, HEIGHT),
          base.clone().addScaledVector(dir, -HALF_W).addScaledVector(up, HEIGHT),
        ];
        const uvq = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ];
        for (let k = 0; k < 4; k++) {
          positions[(v + k) * 3] = corners[k].x;
          positions[(v + k) * 3 + 1] = corners[k].y;
          positions[(v + k) * 3 + 2] = corners[k].z;
          uvs[(v + k) * 2] = uvq[k][0];
          uvs[(v + k) * 2 + 1] = uvq[k][1];
          colors[(v + k) * 3] = c.r;
          colors[(v + k) * 3 + 1] = c.g;
          colors[(v + k) * 3 + 2] = c.b;
          phases[v + k] = phase;
        }
        index.push(v, v + 1, v + 2, v, v + 2, v + 3);
        v += 4;
      }
      // surface pad (tangent plane) — the any-angle footprint
      const s = 0.014;
      const padCorners = [
        base.clone().addScaledVector(east, -s).addScaledVector(north, -s),
        base.clone().addScaledVector(east, s).addScaledVector(north, -s),
        base.clone().addScaledVector(east, s).addScaledVector(north, s),
        base.clone().addScaledVector(east, -s).addScaledVector(north, s),
      ];
      const uvq = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      for (let k = 0; k < 4; k++) {
        positions[(v + k) * 3] = padCorners[k].x;
        positions[(v + k) * 3 + 1] = padCorners[k].y;
        positions[(v + k) * 3 + 2] = padCorners[k].z;
        uvs[(v + k) * 2] = uvq[k][0];
        uvs[(v + k) * 2 + 1] = uvq[k][1];
        colors[(v + k) * 3] = c.r;
        colors[(v + k) * 3 + 1] = c.g;
        colors[(v + k) * 3 + 2] = c.b;
        phases[v + k] = phase;
        pads[v + k] = 1;
      }
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
    this.geo.dispose();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.geo.setAttribute('aPad', new THREE.BufferAttribute(pads, 1));
    this.geo.setIndex(index);
    this.mesh.geometry = this.geo;
    this.mesh.visible = true;
  }

  update(elapsed: number): void {
    if (this.mesh.visible) this.mat.uniforms.uTime.value = elapsed;
  }
}
