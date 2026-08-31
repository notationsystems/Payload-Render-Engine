/**
 * FLOW MODE — GPU particle advection along route polylines.
 *
 * Route paths are baked into a float DataTexture (one row per route,
 * 128 arc-length samples). Each particle is (row, phase, speed): the
 * vertex shader advances phase with time and reads its position from
 * the texture with manual lerp — thousands of moving loads for one
 * draw call and zero per-frame CPU geometry work.
 *
 * Particles are representational (density ∝ flow intensity); they are
 * NOT real shipments — the corpus is provenance-labeled synthetic.
 */

import * as THREE from 'three';
import type { EntityId, Flow, Route } from '../data/contracts';
import type { RoutesLayer } from './routesLayer';
import { MODE_COLORS } from '../app/palette';

const SAMPLES = 128;

const VERT = /* glsl */ `
  in float aRow;
  in float aPhase;
  in float aSpeed;
  in vec3 aColor;
  in float aSize;
  in float aFlow;
  uniform sampler2D uPos;
  uniform float uTime;
  uniform float uRows;
  uniform float uSelectedFlow; // -1 = none
  uniform float uDpr;
  out vec3 vColor;
  out float vBoost;
  out float vAngle;  // screen-space heading (radians, +y up)
  out float vShape;  // 0 = round dot, 1 = heading dart

  void main() {
    float t = fract(aPhase + uTime * aSpeed);
    float x = t * float(${SAMPLES - 1});
    int x0 = int(floor(x));
    int x1 = min(x0 + 1, ${SAMPLES - 1});
    float f = x - float(x0);
    int row = int(aRow);
    vec3 p0 = texelFetch(uPos, ivec2(x0, row), 0).xyz;
    vec3 p1 = texelFetch(uPos, ivec2(x1, row), 0).xyz;
    vec3 p = mix(p0, p1, f);

    // world-stable heading: central-difference direction along the route,
    // flipped for reverse traversal
    int xa = max(x0 - 2, 0);
    int xb = min(x0 + 2, ${SAMPLES - 1});
    vec3 dirW = (texelFetch(uPos, ivec2(xb, row), 0).xyz -
                 texelFetch(uPos, ivec2(xa, row), 0).xyz) * sign(aSpeed);

    float boost = 1.0;
    if (uSelectedFlow >= 0.0) {
      boost = abs(aFlow - uSelectedFlow) < 0.5 ? 2.4 : 0.25;
    }
    vBoost = boost;
    vColor = aColor;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip0 = projectionMatrix * mv;
    // project the heading into screen space each frame: a second point a
    // hair down-route, through the same transform
    vec4 clip1 = projectionMatrix * modelViewMatrix * vec4(p + normalize(dirW) * 0.01, 1.0);
    vec2 sd = clip1.xy / clip1.w - clip0.xy / clip0.w;
    float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    vec2 dirPx = vec2(sd.x * aspect, sd.y);

    float px = clamp(aSize * 11.0 / -mv.z, 2.0, 13.0) * (boost > 1.5 ? 1.5 : 1.0);
    gl_PointSize = px * uDpr;
    // hold the dot when direction degenerates (limb-parallel motion) or
    // the sprite is too small for a dart to read
    float dirOk = step(1e-7, length(dirPx));
    vAngle = atan(dirPx.y, dirPx.x + (1.0 - dirOk));
    vShape = dirOk * smoothstep(4.5, 7.0, px);
    gl_Position = clip0;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  in vec3 vColor;
  in float vBoost;
  in float vAngle;
  in float vShape;
  out vec4 fragColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    // round dot (fallback + small sizes)
    float dot_ = exp(-r * 3.0) * 1.6;

    // heading dart: rotate into route frame (+x = direction of travel;
    // gl_PointCoord has +y down, screen angle has +y up)
    float c = cos(vAngle), s = sin(vAngle);
    vec2 q = mat2(c, -s, s, c) * vec2(p.x, -p.y);
    float hw = (0.72 - q.x) * 0.34;                     // taper to the tip
    float inX = step(-0.92, q.x) * step(q.x, 0.72);
    float body = smoothstep(0.10, -0.08, abs(q.y) - hw) * inX;
    float notch = smoothstep(-0.10, 0.14, q.x + 0.92 - abs(q.y) * 0.9); // swallow tail
    float dart = body * notch * 1.5 + exp(-length(q - vec2(0.35, 0.0)) * 2.6) * 0.6;

    float k = mix(dot_, dart, vShape) * vBoost;
    fragColor = vec4(vColor * k, 1.0);
  }
`;

const MODE_TRAVERSAL = { road: 9, rail: 12, maritime: 30, air: 7 } as const;

export class FlowsLayer {
  readonly points: THREE.Points | null = null;
  readonly group = new THREE.Group();
  particleCount = 0;
  private material: THREE.ShaderMaterial | null = null;
  private flowIndex = new Map<EntityId, number>();
  private time = 0;

  constructor(flows: Flow[], routes: Map<EntityId, Route>, routesLayer: RoutesLayer) {
    // rows: unique routes traversed by any flow
    const rowOf = new Map<EntityId, number>();
    for (const f of flows) {
      for (const s of f.segments) {
        if (!rowOf.has(s.routeId) && routesLayer.visuals.has(s.routeId)) {
          rowOf.set(s.routeId, rowOf.size);
        }
      }
    }
    if (rowOf.size === 0) return;

    const rows = rowOf.size;
    const data = new Float32Array(rows * SAMPLES * 4);
    for (const [routeId, row] of rowOf) {
      const vis = routesLayer.visuals.get(routeId)!;
      const pts = vis.path.points;
      const lift = vis.route.mode === 'air' ? 1.0015 : 1.0035;
      for (let i = 0; i < SAMPLES; i++) {
        const x = (i / (SAMPLES - 1)) * (pts.length - 1);
        const i0 = Math.floor(x);
        const i1 = Math.min(i0 + 1, pts.length - 1);
        const f = x - i0;
        const o = (row * SAMPLES + i) * 4;
        data[o] = (pts[i0].x + (pts[i1].x - pts[i0].x) * f) * lift;
        data[o + 1] = (pts[i0].y + (pts[i1].y - pts[i0].y) * f) * lift;
        data[o + 2] = (pts[i0].z + (pts[i1].z - pts[i0].z) * f) * lift;
        data[o + 3] = 1;
      }
    }
    const posTex = new THREE.DataTexture(data, SAMPLES, rows, THREE.RGBAFormat, THREE.FloatType);
    posTex.needsUpdate = true;
    posTex.minFilter = THREE.NearestFilter;
    posTex.magFilter = THREE.NearestFilter;

    // particles
    const rowsArr: number[] = [];
    const phases: number[] = [];
    const speeds: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    const flowAttr: number[] = [];
    const color = new THREE.Color();
    let seed = 0x9e3779b9;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 100000) / 100000;
    };

    flows.forEach((flow, fi) => {
      this.flowIndex.set(flow.id, fi);
      for (const seg of flow.segments) {
        const row = rowOf.get(seg.routeId);
        const route = routes.get(seg.routeId);
        const vis = routesLayer.visuals.get(seg.routeId);
        if (row === undefined || !route || !vis) continue;
        const angle = vis.path.totalAngle;
        const count = Math.round(
          THREE.MathUtils.clamp(angle * 260 * (0.35 + flow.intensity), 6, 130)
        );
        // direction: does this flow traverse the route forward or reverse?
        const reversed = seg.fromNodeId === route.destinationId;
        const traversal =
          MODE_TRAVERSAL[route.mode] * THREE.MathUtils.clamp(angle / 0.5, 0.35, 2.6);
        const speed = (reversed ? -1 : 1) / traversal;
        color.set(MODE_COLORS[route.mode]);
        for (let i = 0; i < count; i++) {
          rowsArr.push(row);
          phases.push(rand());
          speeds.push(speed * (0.9 + rand() * 0.2));
          colors.push(color.r, color.g, color.b);
          sizes.push(route.mode === 'air' ? 0.8 : 0.6 + flow.intensity * 0.5);
          flowAttr.push(fi);
        }
      }
    });

    this.particleCount = rowsArr.length;
    const geo = new THREE.BufferGeometry();
    // position attribute is required by three even though the shader ignores it
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.particleCount * 3, 3));
    geo.setAttribute('aRow', new THREE.Float32BufferAttribute(rowsArr, 1));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    geo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speeds, 1));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flowAttr, 1));
    // huge static bounding sphere: positions live in the texture
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPos: { value: posTex },
        uTime: { value: 0 },
        uRows: { value: rows },
        uSelectedFlow: { value: -1 },
        uDpr: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, this.material);
    points.renderOrder = 7;
    points.frustumCulled = false;
    (this as { points: THREE.Points | null }).points = points;
    this.group.add(points);
    this.group.visible = false;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
  get visible(): boolean {
    return this.group.visible;
  }

  setSelectedFlow(id: EntityId | null): void {
    if (!this.material) return;
    this.material.uniforms.uSelectedFlow.value =
      id !== null && this.flowIndex.has(id) ? this.flowIndex.get(id)! : -1;
  }

  update(dt: number): void {
    if (!this.material || !this.group.visible) return;
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }
}
