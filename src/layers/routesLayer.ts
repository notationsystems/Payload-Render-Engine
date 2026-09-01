/**
 * Route rendering: every route is a semantic object projected as a
 * glowing tube hugging the sphere (road/rail/maritime) or an elevated
 * arc (air). Direction and activity are communicated by traveling
 * pulses; utilization scales brightness; temporal state tints status.
 */

import * as THREE from 'three';
import type { EntityId, Route } from '../data/contracts';
import { airAltitudeProfile, samplePath, type SampledPath } from '../geo/projection';
import { MODE_COLORS } from '../app/palette';

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uState;      // 0 normal, 1 hover, 2 selected
  uniform float uUtil;       // 0..1
  uniform float uCong;       // 0..1 congestion
  uniform float uDim;        // 0..1 dim amount
  uniform float uMode;       // 0 road, 1 rail, 2 maritime, 3 air
  uniform float uPulses;     // pulse count along route
  uniform float uStatus;     // 0 ok, 1 degraded, 2 disrupted
  uniform float uRisk;       // risk layer on/off
  uniform float uHypo;       // hypothetical frame: 0 none, 1 perturbed, 2 spillover
  uniform float uHasLoad;    // 1 = utilization asserted/observed; 0 = absent → no pulse
  uniform float uAltFade;    // 1 far → glow full; approaches 0.35 up close
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;

  void main() {
    float u = vUv.x;

    // core+halo cross-section: bright along the tube's view-facing spine,
    // falling off toward the silhouette — reads as a slim luminous line
    // with a soft halo instead of a solid ribbon, at every zoom
    float face = max(dot(normalize(vN), normalize(vV)), 0.0);
    // sharper spine as the camera descends (uAltFade falls): the tube
    // reads as a line up close, a soft band from orbit
    float profile = pow(face, mix(4.5, 2.2, uAltFade));

    // traveling pulse: bright head, decaying tail, moving origin→destination
    float speed = uMode == 3.0 ? 0.55 : (uMode == 2.0 ? 0.10 : 0.22);
    float ph = fract(u * uPulses - uTime * speed * uPulses);
    // a route with no asserted/observed load does not pulse — the moving
    // head reads as traffic, and absence of a claim must not animate
    float pulse = pow(1.0 - ph, 7.0) * uHasLoad;

    // rail tie banding
    float pattern = 1.0;
    if (uMode == 1.0) pattern = 0.78 + 0.22 * step(0.5, fract(u * uPulses * 6.0));

    float base = 0.30 + 0.70 * uUtil;
    vec3 col = uColor;

    // status tint: degraded → amber, disrupted → red
    if (uStatus > 1.5) col = mix(col, vec3(1.0, 0.36, 0.43), 0.65);
    else if (uStatus > 0.5) col = mix(col, vec3(1.0, 0.71, 0.33), 0.45);

    // risk layer: congestion bleeds red into the line
    if (uRisk > 0.5) col = mix(col, vec3(1.0, 0.30, 0.38), clamp(uCong, 0.0, 1.0) * 0.8);

    float glow = base * pattern * (0.55 + 1.15 * pulse);

    if (uState > 1.5) {
      col = mix(col, vec3(1.0), 0.20);
      glow *= 1.75;
    } else if (uState > 0.5) {
      glow *= 1.45;
    }

    glow *= (1.0 - uDim * 0.88);
    glow *= profile * uAltFade;

    // hypothetical frame: violet DASHED treatment — deliberately unlike
    // any real-state look, so a simulated outcome cannot read as one
    if (uHypo > 0.5) {
      vec3 hypo = vec3(0.85, 0.55, 1.0);
      float dash = step(0.45, fract(u * uPulses * 5.0 + uTime * 0.15));
      if (uHypo > 1.5) {
        // spillover: tinted, lightly dashed
        col = mix(col, hypo, 0.45);
        glow *= 0.75 + 0.45 * dash;
      } else {
        // perturbed: fully violet, hard dashes
        col = hypo;
        glow = (0.9 + 1.1 * pulse) * dash * (1.0 - uDim * 0.88);
      }
    }

    // hue-preserving soft clip: additive stacking must saturate toward
    // the mode color, never wash to white
    vec3 c = col * glow;
    float peak = max(c.r, max(c.g, c.b));
    c /= (1.0 + peak * 0.45);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// 4+ get the neutral shader treatment (no rail dash, road-class speed);
// their color from MODE_COLORS is what distinguishes them
const MODE_INDEX = {
  road: 0,
  rail: 1,
  maritime: 2,
  air: 3,
  pipeline: 4,
  multimodal: 5,
  unspecified: 6,
} as const;

export interface RouteVisual {
  route: Route;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  path: SampledPath;
}

export class RoutesLayer {
  readonly group = new THREE.Group();
  readonly constraintMarkers: THREE.Points;
  readonly visuals = new Map<EntityId, RouteVisual>();
  private modeVisible: Record<string, boolean> = {
    road: true,
    rail: true,
    maritime: true,
    air: true,
    pipeline: true,
    multimodal: true,
    unspecified: true,
  };
  private dimUndisturbed = false;
  private riskOn = false;
  private altitude = 2;
  visibleCount = 0;

  constructor(routes: Route[]) {
    for (const route of routes) {
      const coords = route.geometry.coordinates;
      const isAir = route.mode === 'air';
      const isLand = route.mode === 'road' || route.mode === 'rail';
      const path = samplePath(coords, {
        samples: Math.min(256, Math.max(48, Math.round(coords.length * 12))),
        baseRadius: 1.0022,
        smooth: isLand,
        altitude: isAir ? airAltitudeProfile(pathAngle(coords)) : undefined,
      });
      const curve = new THREE.CatmullRomCurve3(path.points, false, 'catmullrom', 0.0);
      const radius = Math.min(
        0.0022,
        (isAir ? 0.0011 : 0.0015) + route.importance * (isAir ? 0.0009 : 0.0016)
      );
      const geo = new THREE.TubeGeometry(
        curve,
        Math.min(220, path.points.length),
        radius,
        6,
        false
      );
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(MODE_COLORS[route.mode]) },
          uTime: { value: 0 },
          uState: { value: 0 },
          // absent utilization = no claimed load → no pulse, not a fake one
          uUtil: { value: route.utilization ?? 0 },
          uHasLoad: { value: route.utilization !== undefined ? 1 : 0 },
          uAltFade: { value: 1 },
          uCong: { value: 0 },
          uDim: { value: 0 },
          uMode: { value: MODE_INDEX[route.mode] },
          uPulses: { value: Math.max(2, Math.round(path.lengthKm / 900)) },
          uStatus: { value: 0 },
          uRisk: { value: 0 },
          uHypo: { value: 0 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.renderOrder = 4;
      mesh.userData.routeId = route.id;
      this.group.add(mesh);
      this.visuals.set(route.id, { route, mesh, material, path });
    }
    this.constraintMarkers = this.buildConstraintMarkers(routes);
    this.group.add(this.constraintMarkers);
  }

  private buildConstraintMarkers(routes: Route[]): THREE.Points {
    const positions: number[] = [];
    const colors: number[] = [];
    const warn = new THREE.Color(0xffb454);
    const alert = new THREE.Color(0xff5d6e);
    for (const route of routes) {
      const vis = this.visuals.get(route.id);
      if (!vis) continue;
      for (const c of route.constraints) {
        if (c.atFraction === undefined) continue;
        const idx = Math.round(c.atFraction * (vis.path.points.length - 1));
        const p = vis.path.points[Math.max(0, Math.min(vis.path.points.length - 1, idx))];
        positions.push(p.x * 1.004, p.y * 1.004, p.z * 1.004);
        const col = c.severity > 0.6 ? alert : warn;
        colors.push(col.r, col.g, col.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(28, 16);
    ctx.lineTo(16, 28);
    ctx.lineTo(4, 16);
    ctx.closePath();
    ctx.stroke();
    const mat = new THREE.PointsMaterial({
      size: 8,
      map: new THREE.CanvasTexture(c),
      vertexColors: true,
      transparent: true,
      sizeAttenuation: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 5;
    pts.visible = false; // intel.constraints layer
    return pts;
  }

  setModeVisible(mode: string, visible: boolean): void {
    this.modeVisible[mode] = visible;
    this.applyVisibility();
  }

  setConstraintsVisible(v: boolean): void {
    this.constraintMarkers.visible = v;
  }

  setRiskMode(on: boolean): void {
    this.riskOn = on;
    for (const vis of this.visuals.values()) vis.material.uniforms.uRisk.value = on ? 1 : 0;
  }

  /** Exceptions preset: dim everything that is not degraded/disrupted. */
  setDimUndisturbed(on: boolean): void {
    this.dimUndisturbed = on;
    this.applyDim();
  }

  /**
   * Brush focus (kepler-style): routes in the lit set stay bright,
   * everything else dims. null restores the preset's own dim baseline.
   */
  applyBrush(lit: Set<EntityId> | null): void {
    if (lit === null) {
      this.applyDim();
      return;
    }
    for (const [id, vis] of this.visuals) {
      vis.material.uniforms.uDim.value = lit.has(id) ? 0 : 1;
    }
  }

  setAltitude(alt: number): void {
    this.altitude = alt;
    // close-range regime: attenuate glow so tubes read as lines, not
    // screen-flooding ribbons, as the camera descends
    const fade = Math.min(1, Math.max(0.22, alt / 0.9));
    for (const vis of this.visuals.values()) vis.material.uniforms.uAltFade.value = fade;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    // progressive disclosure: importance gate opens as the camera descends
    const minImportance =
      this.altitude > 2.6 ? 0.55 : this.altitude > 1.4 ? 0.3 : this.altitude > 0.6 ? 0.12 : 0;
    let n = 0;
    for (const vis of this.visuals.values()) {
      const v =
        this.modeVisible[vis.route.mode] && vis.route.importance >= minImportance;
      vis.mesh.visible = v;
      if (v) n++;
    }
    this.visibleCount = n;
  }

  private applyDim(): void {
    for (const vis of this.visuals.values()) {
      const status = vis.material.uniforms.uStatus.value as number;
      vis.material.uniforms.uDim.value = this.dimUndisturbed && status < 0.5 ? 1 : 0;
    }
  }

  setState(routeId: EntityId, state: 0 | 1 | 2): void {
    const vis = this.visuals.get(routeId);
    if (vis) vis.material.uniforms.uState.value = state;
  }

  clearStates(keepSelected?: Set<EntityId>): void {
    for (const [id, vis] of this.visuals) {
      vis.material.uniforms.uState.value = keepSelected?.has(id) ? 2 : 0;
    }
  }

  /** Hypothetical-frame role: 0 none, 1 perturbed, 2 spillover. */
  setScenarioRole(routeId: EntityId, role: 0 | 1 | 2): void {
    const vis = this.visuals.get(routeId);
    if (vis) vis.material.uniforms.uHypo.value = role;
  }

  clearScenarioRoles(): void {
    for (const vis of this.visuals.values()) vis.material.uniforms.uHypo.value = 0;
  }

  setTemporalState(
    routeId: EntityId,
    util: number,
    congestion: number,
    status: string,
    observed = true
  ): void {
    const vis = this.visuals.get(routeId);
    if (!vis) return;
    vis.material.uniforms.uUtil.value = util;
    vis.material.uniforms.uHasLoad.value = observed ? 1 : 0;
    vis.material.uniforms.uCong.value = congestion;
    vis.material.uniforms.uStatus.value =
      status === 'disrupted' ? 2 : status === 'degraded' ? 1 : 0;
    if (this.dimUndisturbed) this.applyDim();
  }

  update(dt: number): void {
    for (const vis of this.visuals.values()) {
      if (vis.mesh.visible) vis.material.uniforms.uTime.value += dt;
    }
  }

  pickables(): THREE.Object3D[] {
    return [...this.visuals.values()].filter((v) => v.mesh.visible).map((v) => v.mesh);
  }
}

function pathAngle(coords: [number, number][]): number {
  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const DEG = Math.PI / 180;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    a.set(
      Math.cos(lat1 * DEG) * Math.cos(lon1 * DEG),
      Math.sin(lat1 * DEG),
      -Math.cos(lat1 * DEG) * Math.sin(lon1 * DEG)
    );
    b.set(
      Math.cos(lat2 * DEG) * Math.cos(lon2 * DEG),
      Math.sin(lat2 * DEG),
      -Math.cos(lat2 * DEG) * Math.sin(lon2 * DEG)
    );
    total += a.angleTo(b);
  }
  return total;
}
