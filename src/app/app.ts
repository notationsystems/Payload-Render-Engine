/**
 * The App: composition root of the digital twin client. Owns the
 * engine, layers, interaction, clock and selection state; implements
 * the AppApi facade that the UI instrument layer and demo controllers
 * consume. Rendering here is a projection of provider state — nothing
 * in this file (or below it) writes back into the data layer.
 */

import * as THREE from 'three';
import type {
  EntityId,
  Facility,
  Flow,
  LonLat,
  Route,
  TemporalState,
} from '../data/contracts';
import { WorldStore, type SearchResult } from '../data/store';
import { sourceRegistry } from '../data/sources';
import {
  buildScenarioCatalog,
  computeScenarioImpact,
  rankScenarioImpacts,
  type ScenarioEntityDelta,
  type ScenarioImpact,
  type ScenarioRankingRow,
  type ScenarioSpec,
} from '../data/scenario';
import { EventBus } from '../core/events';
import { SimClock } from '../core/time';
import { Engine } from '../core/engine';
import { CameraController } from '../core/cameraController';
import { Countries, type Country } from '../geo/countries';
import { generateEarthTextures } from '../geo/texture';
import { latLonToVec3, slerpSurface, vec3ToLatLon } from '../geo/projection';
import { Globe, sunDirectionAt } from '../earth/globe';
import { Atmosphere } from '../earth/atmosphere';
import { createStars } from '../earth/stars';
import { createGraticule } from '../earth/graticule';
import { LayerManager } from '../layers/layerManager';
import { RoutesLayer } from '../layers/routesLayer';
import { NodesLayer } from '../layers/nodesLayer';
import { FlowsLayer } from '../layers/flowsLayer';
import { OpsArcLayer } from '../layers/opsArcLayer';
import { LabelsLayer } from '../layers/labelsLayer';
import { SelectionInput, type Pick } from '../interaction/selection';
import { FollowTheLoad } from '../interaction/followTheLoad';
import { executeCommand, suggestCommands } from './commands';
import type {
  AppApi,
  AppEvents,
  CameraFacade,
  CommandResult,
  CountryInfo,
  LayerDef,
  LayerId,
  Suggestion,
  ViewPreset,
} from './api';

export class App implements AppApi {
  readonly events = new EventBus<AppEvents>();
  readonly store = new WorldStore();
  readonly clock = new SimClock();
  camera!: CameraFacade;

  private engine!: Engine;
  private cameraCtl!: CameraController;
  private countries!: Countries;
  private globe!: Globe;
  private atmosphere!: Atmosphere;
  private graticule!: THREE.LineSegments;
  private borders!: THREE.LineSegments;
  private layerMgr = new LayerManager();
  private routesLayer!: RoutesLayer;
  private nodesLayer!: NodesLayer;
  private flowsLayer!: FlowsLayer;
  private opsArc = new OpsArcLayer();
  private labelsLayer!: LabelsLayer;
  private anomalies!: THREE.Points;
  private anomaliesMat!: THREE.PointsMaterial;
  private depOverlay = new THREE.Group();
  private demo!: FollowTheLoad;

  private preset: ViewPreset = 'world';
  private selection: EntityId | null = null;
  /** Routes highlighted by the current selection (a route, or a flow's legs). */
  private selectedRouteIds = new Set<EntityId>();
  private hoverId: EntityId | null = null;
  private selectedCountry: Country | null = null;
  private countryOutline: THREE.Object3D | null = null;
  private activeEventIds = new Set<EntityId>();
  private anomaliesSig = '';
  private scenarioCatalog: ScenarioSpec[] = [];
  /** Why the catalog is empty, when it is empty for a REASON (typed absence). */
  scenariosUnavailableReason: string | null = null;
  private activeScenario: ScenarioImpact | null = null;
  private scenarioDeltaIx = new Map<EntityId, ScenarioEntityDelta>();
  private lastTemporalRefresh = 0;
  private lastSimMs = 0;
  private dataSourceId = 'synthetic-demo';
  /** Set when the Spatial API was requested but unreachable. */
  sourceFallbackNote: string | null = null;

  // ------------------------------------------------------------------ boot

  async boot(canvas: HTMLCanvasElement, hud: HTMLElement): Promise<void> {
    const progress = (pct: number, msg: string) => {
      const fill = document.getElementById('boot-fill');
      const status = document.getElementById('boot-status');
      if (fill) fill.style.width = `${pct}%`;
      if (status) status.textContent = msg;
    };

    progress(8, 'LOADING CORPUS');
    const wantRemote =
      typeof location !== 'undefined' && new URLSearchParams(location.search).has('api');
    let sourceId = wantRemote ? 'payload-spatial-api' : 'synthetic-demo';
    let snapshot;
    try {
      const source = sourceRegistry.get(sourceId);
      if (!source?.makeProvider) throw new Error(`source '${sourceId}' not implemented`);
      progress(10, sourceId === 'payload-spatial-api' ? 'CONNECTING · SPATIAL API' : 'LOADING SYNTHETIC CORPUS');
      snapshot = await this.store.init(source.makeProvider());
    } catch (err) {
      if (sourceId !== 'payload-spatial-api') throw err;
      // honest fallback: note WHY, switch to the in-browser corpus
      this.sourceFallbackNote = err instanceof Error ? err.message : String(err);
      sourceId = 'synthetic-demo';
      progress(10, 'SPATIAL API UNREACHABLE — LOCAL CORPUS');
      snapshot = await this.store.init(sourceRegistry.get('synthetic-demo')!.makeProvider!());
    }
    this.dataSourceId = sourceId;
    // Counterfactuals need a resolvable baseline. A corpus whose states
    // are unobserved (a projected corpus with no dynamics) gets NO
    // catalog — computing "impact" over placeholder zeros would present
    // fabricated numbers as intelligence. Same rule the server enforces
    // with COUNTERFACTUALS_UNSUPPORTED_FOR_CORPUS.
    const probe = snapshot.routes[0] ?? snapshot.nodes[0];
    const dynamicsObserved =
      !!probe && this.store.stateAt(probe.id, snapshot.timeRange.now).observed !== false;
    this.scenarioCatalog = dynamicsObserved ? buildScenarioCatalog(snapshot) : [];
    this.scenariosUnavailableReason = dynamicsObserved
      ? null
      : 'THIS CORPUS HAS NO OBSERVED DYNAMICS — A COUNTERFACTUAL NEEDS A BASELINE';

    progress(24, 'LOADING WORLD TOPOLOGY');
    const [countries, textures] = await Promise.all([
      Countries.load('data/countries-110m.json'),
      generateEarthTextures('data/land-50m.json', snapshot.cityLights),
    ]);
    this.countries = countries;

    progress(52, 'BUILDING PLANET');
    this.engine = new Engine(canvas);
    const scene = this.engine.scene;
    this.globe = new Globe(textures);
    this.atmosphere = new Atmosphere();
    scene.add(this.globe.mesh, this.atmosphere.mesh, createStars());
    this.graticule = createGraticule();
    this.graticule.visible = false;
    scene.add(this.graticule);
    this.borders = countries.buildBorders();
    scene.add(this.borders);

    progress(70, 'PROJECTING NETWORK');
    this.routesLayer = new RoutesLayer(snapshot.routes);
    scene.add(this.routesLayer.group);
    this.nodesLayer = new NodesLayer(snapshot.nodes);
    scene.add(this.nodesLayer.points);
    const routeIx = new Map(snapshot.routes.map((r) => [r.id, r]));
    this.flowsLayer = new FlowsLayer(snapshot.flows, routeIx, this.routesLayer);
    scene.add(this.flowsLayer.group);
    scene.add(this.opsArc.group);
    this.labelsLayer = new LabelsLayer(hud);
    scene.add(this.depOverlay);
    this.buildAnomalies();
    scene.add(this.anomalies);

    progress(84, 'CALIBRATING INSTRUMENTS');
    this.cameraCtl = new CameraController(this.engine.camera, canvas);
    this.camera = this.buildCameraFacade();
    this.registerLayers();
    this.wireSelection(canvas);
    this.demo = new FollowTheLoad(this);
    // a drag or wheel during the demo hands control back to the user
    // instead of letting the script fight them for the camera
    this.cameraCtl.onInteract = () => {
      if (this.demo.active) {
        this.demo.stop();
        this.events.emit('toast', {
          title: 'DEMO EXITED',
          body: 'Camera control returned.',
          tone: 'info',
        });
      }
    };

    // temporal spine
    this.clock.configure(
      snapshot.timeRange.start,
      snapshot.timeRange.end,
      snapshot.timeRange.now
    );
    this.lastSimMs = this.clock.simMillis;
    this.clock.events.on('change', (t) => this.onTimeChange(t));
    this.updateSun(this.clock.simMillis);
    this.refreshTemporalStates(true);

    // frame loop
    this.engine.onFrame((dt) => {
      this.clock.tick(dt);
      this.cameraCtl.update(dt);
      const alt = this.cameraCtl.altitudeRadii();
      this.routesLayer.setAltitude(alt);
      this.nodesLayer.setAltitude(alt);
      this.routesLayer.update(dt);
      this.nodesLayer.update(dt);
      this.flowsLayer.update(dt);
      this.opsArc.update(dt);
      this.labelsLayer.update(this.engine.camera, this.nodesLayer, alt);
      this.pulseAnomalies(dt);
    });
    this.engine.start();

    // status heartbeat
    setInterval(() => {
      this.events.emit('status', {
        fps: Math.round(this.engine.fps),
        altitudeKm: this.cameraCtl.altitudeRadii() * 6371,
        visibleNodes: this.nodesLayer.visibleCount,
        visibleRoutes: this.routesLayer.visibleCount,
        particles: this.flowsLayer.visible ? this.flowsLayer.particleCount : 0,
      });
    }, 500);

    progress(100, 'ONLINE');
    // cinematic arrival: pull in from deep space toward the Atlantic seam
    setTimeout(() => {
      const boot = document.getElementById('boot');
      boot?.classList.add('done');
      // hard-remove after the fade so nothing depends on CSS transitions
      setTimeout(() => boot?.remove(), 900);
      this.cameraCtl.flyToLatLon(28, -42, { distance: 2.75, durationMs: 3200 });
      this.cameraCtl.setAutoRotate(true);
    }, 250);
  }

  // ------------------------------------------------------------- rendering aux

  private buildAnomalies(): void {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = 'rgba(255,93,110,0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(24, 24, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,93,110,0.35)';
    ctx.beginPath();
    ctx.arc(24, 24, 20, 0, Math.PI * 2);
    ctx.stroke();
    this.anomaliesMat = new THREE.PointsMaterial({
      size: 22,
      map: new THREE.CanvasTexture(c),
      transparent: true,
      sizeAttenuation: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.anomalies = new THREE.Points(new THREE.BufferGeometry(), this.anomaliesMat);
    this.anomalies.renderOrder = 8;
    this.anomalies.visible = false;
  }

  /** Rebuild anomaly markers only when the active event set changed —
   *  not on every 150 ms temporal refresh during playback. */
  private refreshAnomaliesIfChanged(): void {
    const sig = this.store
      .activeEvents(this.clock.simTime)
      .map((e) => e.id)
      .sort()
      .join('|');
    if (sig === this.anomaliesSig) return;
    this.anomaliesSig = sig;
    this.rebuildAnomalies();
  }

  private rebuildAnomalies(): void {
    const positions: number[] = [];
    for (const ev of this.store.activeEvents(this.clock.simTime)) {
      for (const id of ev.affects) {
        const node = this.store.node(id);
        if (node) {
          const [lon, lat] = node.geometry.coordinates;
          const p = latLonToVec3(lat, lon, 1.01);
          positions.push(p.x, p.y, p.z);
          continue;
        }
        const vis = this.routesLayer.visuals.get(id);
        if (vis) {
          const mid = vis.path.points[Math.floor(vis.path.points.length / 2)];
          positions.push(mid.x * 1.008, mid.y * 1.008, mid.z * 1.008);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.anomalies.geometry.dispose();
    this.anomalies.geometry = geo;
  }

  private anomalyPulse = 0;
  private pulseAnomalies(dt: number): void {
    if (!this.anomalies.visible) return;
    this.anomalyPulse += dt;
    this.anomaliesMat.opacity = 0.55 + 0.45 * Math.sin(this.anomalyPulse * 3.5);
  }

  private rebuildDependencyOverlay(): void {
    for (const child of this.depOverlay.children) {
      const line = child as THREE.LineSegments;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.depOverlay.clear();
    if (!this.layerMgr.isVisible('intel.dependencies') || !this.selection) return;
    const node = this.store.node(this.selection);
    if (!node) return;
    const [lon0, lat0] = node.geometry.coordinates;
    const from = latLonToVec3(lat0, lon0, 1);
    const addArcs = (ids: EntityId[] | undefined, color: number) => {
      if (!ids?.length) return;
      const positions: number[] = [];
      for (const id of ids) {
        const other = this.store.node(id);
        if (!other) continue;
        const [lon1, lat1] = other.geometry.coordinates;
        const to = latLonToVec3(lat1, lon1, 1);
        const steps = 36;
        const v = new THREE.Vector3();
        const prev = new THREE.Vector3();
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          slerpSurface(from, to, t, 1.012 + Math.sin(t * Math.PI) * 0.02, v);
          if (i > 0) positions.push(prev.x, prev.y, prev.z, v.x, v.y, v.z);
          prev.copy(v);
        }
      }
      if (!positions.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const lines = new THREE.LineSegments(geo, mat);
      lines.renderOrder = 8;
      this.depOverlay.add(lines);
    };
    addArcs(node.connectedSupplierIds, 0x8fa3b8);
    addArcs(node.connectedCustomerIds, 0x4da6ff);
  }

  // ------------------------------------------------------------------ layers

  private registerLayers(): void {
    const m = this.layerMgr;
    m.onChange = (layers) => this.events.emit('layersChange', { layers });

    m.register('world.countries', (v) => (this.borders.visible = v));
    m.register('world.terrain', (v) => (this.graticule.visible = v));
    m.register('world.nightlights', (v) => this.globe.setNightLights(v ? 1 : 0));
    m.register('world.cities', (v) => {
      this.labelsLayer.setEnabled(v);
      this.nodesLayer.setBucketVisible('world.cities', v);
    });
    for (const mode of [
      'road',
      'rail',
      'maritime',
      'air',
      'pipeline',
      'multimodal',
      'unspecified',
    ] as const) {
      m.register(`transport.${mode}` as LayerId, (v) =>
        this.routesLayer.setModeVisible(mode, v)
      );
    }
    for (const bucket of [
      'infra.ports',
      'infra.airports',
      'infra.rail_terminals',
      'infra.warehouses',
      'infra.industrial',
      'intel.bottlenecks',
    ] as const) {
      m.register(bucket as LayerId, (v) => this.nodesLayer.setBucketVisible(bucket, v));
    }
    m.register('economy.production', (v) => this.nodesLayer.setEmphasis('production', v));
    m.register('economy.demand', (v) => this.nodesLayer.setEmphasis('demand', v));
    m.register('economy.inventory', (v) => this.nodesLayer.setEmphasis('inventory', v));
    m.register('economy.flows', (v) => {
      this.flowsLayer.setVisible(v);
      this.events.emit('flowMode', { enabled: v });
    });
    m.register('intel.constraints', (v) => this.routesLayer.setConstraintsVisible(v));
    m.register('intel.anomalies', (v) => {
      this.anomalies.visible = v;
      if (v) {
        this.anomaliesSig = '';
        this.refreshAnomaliesIfChanged();
      }
    });
    m.register('intel.dependencies', () => this.rebuildDependencyOverlay());
    m.register('intel.risk', (v) => this.routesLayer.setRiskMode(v));
  }

  // ------------------------------------------------------------------ time

  private trailingRefresh: number | undefined;

  private onTimeChange(t: TemporalState): void {
    this.events.emit('time', t);
    this.updateSun(this.clock.simMillis);
    const now = performance.now();
    if (now - this.lastTemporalRefresh > 150) {
      this.lastTemporalRefresh = now;
      this.refreshTemporalStates(false);
    } else if (this.trailingRefresh === undefined) {
      // a drag's final event usually lands inside the throttle window —
      // schedule a trailing refresh so the globe never stays stale
      this.trailingRefresh = window.setTimeout(() => {
        this.trailingRefresh = undefined;
        this.lastTemporalRefresh = performance.now();
        this.refreshTemporalStates(false);
      }, 170);
    }
  }

  private updateSun(simMillis: number): void {
    const dir = sunDirectionAt(simMillis);
    this.globe.setSunDirection(dir);
    this.atmosphere.setSunDirection(dir);
  }

  private refreshTemporalStates(initial: boolean): void {
    const t = this.clock.simTime;
    for (const route of this.store.snapshot.routes) {
      // in a hypothetical frame, affected routes hold the frame's computed
      // values (pinned at entry time) instead of live provider state
      const delta = this.scenarioDeltaIx.get(route.id);
      if (delta) {
        this.routesLayer.setTemporalState(
          route.id,
          delta.scenario.utilization,
          delta.scenario.congestion,
          delta.scenario.status
        );
        continue;
      }
      const s = this.store.stateAt(route.id, t);
      this.routesLayer.setTemporalState(
        route.id,
        s.utilization,
        s.congestion,
        s.status,
        s.observed !== false
      );
    }
    if (this.anomalies.visible) this.refreshAnomaliesIfChanged();

    // event toasts: only on smooth advance (playback), not on scrub jumps.
    // Measured refresh-to-refresh (lastSimMs updates HERE, not per clock
    // event) — otherwise a drag reads as many small per-pointermove steps
    // and toasts fire for every event the playhead sweeps across.
    const jump = Math.abs(this.clock.simMillis - this.lastSimMs);
    const smooth = jump < this.clock.speed * 3000;
    this.lastSimMs = this.clock.simMillis;
    const current = new Set(this.store.activeEvents(t).map((e) => e.id));
    if (!initial && smooth) {
      for (const ev of this.store.activeEvents(t)) {
        if (!this.activeEventIds.has(ev.id)) {
          this.events.emit('toast', {
            title: ev.name.toUpperCase(),
            body: ev.description,
            tone: ev.severity > 0.6 ? 'alert' : 'warn',
          });
        }
      }
    }
    this.activeEventIds = current;
  }

  // ------------------------------------------------------------------ camera

  private buildCameraFacade(): CameraFacade {
    const ctl = this.cameraCtl;
    const routes = () => this.routesLayer;
    return {
      flyToLatLon: (lat, lon, opts) => ctl.flyToLatLon(lat, lon, opts),
      frameRoute: async (routeId, opts) => {
        const vis = routes().visuals.get(routeId);
        if (!vis) return;
        const pts = vis.path.points;
        const mid = pts[Math.floor(pts.length / 2)];
        const ll = vec3ToLatLon(mid);
        const extent = vis.path.totalAngle;
        const distance = THREE.MathUtils.clamp(1 + extent * 1.35, 1.14, 3.6);
        await ctl.flyToLatLon(ll.lat, ll.lon, {
          distance,
          durationMs: opts?.durationMs ?? 1900,
        });
      },
      followPath: (coords, opts) => ctl.followPath(coords, opts),
      cancel: () => ctl.cancel(),
      altitudeRadii: () => ctl.altitudeRadii(),
      setAutoRotate: (v) => ctl.setAutoRotate(v),
    };
  }

  // ------------------------------------------------------------- interaction

  private wireSelection(canvas: HTMLCanvasElement): void {
    const input = new SelectionInput(
      canvas,
      this.engine.camera,
      this.nodesLayer,
      this.routesLayer,
      this.globe.mesh,
      this.countries
    );
    input.onHover = (pick) => this.applyHover(pick);
    this.wireBrush(canvas);
    input.onClick = (pick) => {
      if (this.demo.active) return;
      if (!pick) {
        this.select(null, 'pick');
        this.selectCountry(null);
        return;
      }
      if (pick.type === 'country') {
        this.select(null, 'pick');
        this.selectCountryObj(pick.country);
      } else {
        this.selectCountry(null);
        this.select(pick.id, 'pick');
      }
    };
    input.onDoubleClick = (pick) => {
      if (this.demo.active || !pick || pick.type === 'country') return;
      this.focus(pick.id);
    };
  }

  /**
   * Route brush (kepler arc-brush adapted to the sphere): hold B and
   * sweep — routes passing within the brush radius of the cursor's
   * globe point stay lit, the rest dim. Release restores the preset's
   * own dim baseline. Focus, not filter: nothing is hidden, nothing
   * is mutated.
   */
  private brushHeld = false;
  private brushRay = new THREE.Raycaster();
  private brushLastAt = 0;

  private wireBrush(canvas: HTMLCanvasElement): void {
    const BRUSH_KM = 900;
    const cosLimit = Math.cos(BRUSH_KM / 6371);
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key !== 'b' && e.key !== 'B') return;
      if (!this.brushHeld) {
        this.brushHeld = true;
        this.events.emit('brush', { active: true });
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key !== 'b' && e.key !== 'B') return;
      this.brushHeld = false;
      this.routesLayer.applyBrush(null);
      this.events.emit('brush', { active: false });
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.brushHeld) return;
      const now = performance.now();
      if (now - this.brushLastAt < 40) return;
      this.brushLastAt = now;
      const ndc = new THREE.Vector2(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      this.brushRay.setFromCamera(ndc, this.engine.camera);
      const hit = this.brushRay.intersectObject(this.globe.mesh, false)[0];
      if (!hit) {
        this.routesLayer.applyBrush(new Set());
        return;
      }
      const p = hit.point.clone().normalize();
      const lit = new Set<EntityId>();
      for (const [id, vis] of this.routesLayer.visuals) {
        const pts = vis.path.points;
        const stride = Math.max(1, Math.floor(pts.length / 24));
        for (let i = 0; i < pts.length; i += stride) {
          const q = pts[i];
          const dot =
            (p.x * q.x + p.y * q.y + p.z * q.z) /
            Math.hypot(q.x, q.y, q.z);
          if (dot > cosLimit) {
            lit.add(id);
            break;
          }
        }
      }
      this.routesLayer.applyBrush(lit);
    });
  }

  private applyHover(pick: Pick): void {
    const id = pick && pick.type !== 'country' ? pick.id : null;
    if (id === this.hoverId) return;
    // restore old hover to its selection-aware baseline, never to bare 0
    if (this.hoverId && this.hoverId !== this.selection) {
      if (this.store.node(this.hoverId)) this.nodesLayer.setState(this.hoverId, 0);
      if (this.store.route(this.hoverId)) {
        this.routesLayer.setState(this.hoverId, this.selectedRouteIds.has(this.hoverId) ? 2 : 0);
      }
    }
    this.hoverId = id;
    if (id && id !== this.selection && !this.selectedRouteIds.has(id)) {
      if (this.store.node(id)) this.nodesLayer.setState(id, 1);
      if (this.store.route(id)) this.routesLayer.setState(id, 1);
    }
    document.body.style.cursor = id ? 'pointer' : 'default';
    this.events.emit('hover', { id });
  }

  // ------------------------------------------------------------------ AppApi

  getLayers(): LayerDef[] {
    return this.layerMgr.list();
  }

  setLayerVisible(id: LayerId, visible: boolean): void {
    // the registered applier handles intel.dependencies — no double rebuild
    this.layerMgr.setVisible(id, visible);
  }

  /** Last preset that actually changed layers — panel views return here. */
  private lastLayerPreset: ViewPreset = 'world';

  setPreset(preset: ViewPreset): void {
    // legacy alias from the original brief
    if ((preset as string) === 'exceptions') preset = 'intelligence';
    this.preset = preset;
    if (preset !== 'agents' && preset !== 'scenarios' && preset !== 'operations') {
      this.lastLayerPreset = preset;
      this.layerMgr.applyPreset(preset);
      this.routesLayer.setDimUndisturbed(this.layerMgr.presetDimsHealthy(preset));
    }
    this.events.emit('preset', { preset });
    this.events.emit('flowMode', { enabled: this.getFlowMode() });
  }

  /** Where a closing panel view should land. */
  getLastLayerPreset(): ViewPreset {
    return this.lastLayerPreset;
  }

  /**
   * Draw a control-tower lane on the globe (read-only overlay). The
   * arc's treatment carries tracking honesty: solid when tracking
   * evidence exists, dashed when the lane is declared but movement is
   * unobserved. No vehicle marker is ever drawn — the tower serves
   * timestamps, not positions.
   */
  showOperationsLane(origin: LonLat, destination: LonLat, tracked: boolean): void {
    this.opsArc.show(origin, destination, tracked);
    const a = latLonToVec3(origin[1], origin[0], 1);
    const b = latLonToVec3(destination[1], destination[0], 1);
    const mid = vec3ToLatLon(slerpSurface(a, b, 0.5, 1));
    this.cameraCtl.flyToLatLon(mid.lat, mid.lon, { distance: 1.35, durationMs: 1600 });
  }

  clearOperationsLane(): void {
    this.opsArc.clear();
  }

  getPreset(): ViewPreset {
    return this.preset;
  }

  setFlowMode(enabled: boolean): void {
    this.layerMgr.setVisible('economy.flows', enabled);
  }

  getFlowMode(): boolean {
    return this.layerMgr.isVisible('economy.flows');
  }

  select(id: EntityId | null, source: AppEvents['select']['source'] = 'ui'): void {
    if (id && !this.store.entity(id)) id = null;
    this.selection = id;

    // reset highlight states
    const selectedRoutes = new Set<EntityId>();
    let selectedNode: EntityId | undefined;
    let selectedFlow: EntityId | null = null;
    if (id) {
      const flow = this.store.flow(id);
      if (flow) {
        selectedFlow = flow.id;
        for (const seg of flow.segments) selectedRoutes.add(seg.routeId);
      }
      if (this.store.route(id)) selectedRoutes.add(id);
      if (this.store.node(id)) selectedNode = id;
    }
    this.selectedRouteIds = selectedRoutes;
    this.routesLayer.clearStates(selectedRoutes);
    this.nodesLayer.clearStates(selectedNode);
    this.flowsLayer.setSelectedFlow(selectedFlow);
    this.labelsLayer.setSelected(selectedNode ?? null);
    // clearStates wiped the hover glow; re-apply it (applyHover would
    // early-return because hoverId is unchanged)
    if (this.hoverId && this.hoverId !== id && !this.selectedRouteIds.has(this.hoverId)) {
      if (this.store.node(this.hoverId)) this.nodesLayer.setState(this.hoverId, 1);
      if (this.store.route(this.hoverId)) this.routesLayer.setState(this.hoverId, 1);
    }
    this.rebuildDependencyOverlay();
    this.events.emit('select', { id, source });
  }

  getSelection(): EntityId | null {
    return this.selection;
  }

  /**
   * Countries outside the ISO alpha-2 table still get a stable code of
   * the form '#<numeric-id>' so selection, the inspector, and lookups
   * work for every polygon on the globe, not just corpus countries.
   */
  private countryCode(c: Country): string {
    return c.iso2 ?? `#${c.id}`;
  }

  private resolveCountry(code: string): Country | undefined {
    if (code.startsWith('#')) {
      const id = Number(code.slice(1));
      return this.countries.countries.find((c) => c.id === id);
    }
    return this.countries.byIso2(code);
  }

  getSelectedCountry(): { code: string; name: string } | null {
    if (!this.selectedCountry) return null;
    return { code: this.countryCode(this.selectedCountry), name: this.selectedCountry.name };
  }

  selectCountry(code: string | null): void {
    if (code === null) {
      this.selectCountryObj(null);
      return;
    }
    const c = this.resolveCountry(code);
    if (c) this.selectCountryObj(c, true);
  }

  private selectCountryObj(country: Country | null, fly = false): void {
    if (this.countryOutline) {
      this.engine.scene.remove(this.countryOutline);
      // outline group shares one material across its ring geometries
      let materialDisposed = false;
      this.countryOutline.traverse((obj) => {
        const line = obj as THREE.Line;
        if (line.geometry) line.geometry.dispose();
        if (!materialDisposed && line.material) {
          (line.material as THREE.Material).dispose();
          materialDisposed = true;
        }
      });
      this.countryOutline = null;
    }
    this.selectedCountry = country;
    if (country) {
      this.countryOutline = this.countries.buildOutline(country);
      this.engine.scene.add(this.countryOutline);
      if (fly) {
        const c = this.countries.centroidOf(country);
        this.cameraCtl.flyToLatLon(c.lat, c.lon, { distance: 2.1, durationMs: 1600 });
      }
    }
    this.events.emit('countrySelect', {
      code: country ? this.countryCode(country) : null,
      name: country?.name ?? null,
    });
  }

  focus(id: EntityId): void {
    if (id.startsWith('country:')) {
      this.selectCountry(id.slice('country:'.length));
      return;
    }
    const node = this.store.node(id);
    if (node) {
      this.select(id, 'search');
      const [lon, lat] = node.geometry.coordinates;
      this.cameraCtl.flyToLatLon(lat, lon, {
        distance: 1.45 - node.importance * 0.18,
        durationMs: 1900,
      });
      return;
    }
    const route = this.store.route(id);
    if (route) {
      this.select(id, 'search');
      void this.camera.frameRoute(id);
      return;
    }
    const flow = this.store.flow(id);
    if (flow) {
      this.select(id, 'search');
      // frame the whole chain: vector-mean center + max angular extent
      const center = new THREE.Vector3();
      const pts: THREE.Vector3[] = [];
      for (const seg of flow.segments) {
        const vis = this.routesLayer.visuals.get(seg.routeId);
        if (!vis) continue;
        for (let i = 0; i < vis.path.points.length; i += 8) pts.push(vis.path.points[i]);
      }
      if (!pts.length) return;
      for (const p of pts) center.add(p);
      center.normalize();
      let extent = 0;
      for (const p of pts) extent = Math.max(extent, center.angleTo(p.clone().normalize()));
      const ll = vec3ToLatLon(center);
      this.cameraCtl.flyToLatLon(ll.lat, ll.lon, {
        distance: THREE.MathUtils.clamp(1 + extent * 2.4, 1.2, 4.2),
        durationMs: 2100,
      });
    }
  }

  countryInfo(code: string): CountryInfo | null {
    const country = this.resolveCountry(code);
    if (!country) return null;
    // corpus aggregates key off ISO-2; unmapped countries report empty
    // inventories rather than failing to open at all
    const iso2 = country.iso2 ?? '~none';
    const nodes = this.store.nodesInCountry(iso2);
    const routes = this.store.routesTouchingCountry(iso2);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const flows = this.store.snapshot.flows.filter(
      (f) => nodeIds.has(f.originId) || nodeIds.has(f.destinationId)
    );
    const byMode: Record<string, number> = {};
    for (const r of routes) byMode[r.mode] = (byMode[r.mode] ?? 0) + 1;
    return { code, name: country.name, nodes, routes, flows, byMode };
  }

  runCommand(input: string): CommandResult {
    return executeCommand(this, input);
  }

  suggest(input: string): Suggestion[] {
    return suggestCommands(this, input);
  }

  search(q: string): SearchResult[] {
    // countries are first-class selectable objects, so they are
    // first-class findable objects too — merged with corpus results
    const results = this.store.search(q);
    const ql = q.trim().toLowerCase();
    if (ql.length >= 2) {
      for (const c of this.countries.countries) {
        const name = c.name.toLowerCase();
        let score = 0;
        if (name === ql) score = 95;
        else if (name.startsWith(ql)) score = 70;
        else if (name.includes(ql)) score = 45;
        if (score) {
          results.push({
            id: `country:${this.countryCode(c)}`,
            name: c.name,
            kind: 'country',
            score,
            detail: c.iso2 ?? '',
          });
        }
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 8);
  }

  startFollowTheLoad(): void {
    void this.demo.start();
  }

  // ------------------------------------------------- counterfactual frames

  listScenarios(): ScenarioSpec[] {
    return this.scenarioCatalog;
  }

  private rankingCache: { hourKey: number; rows: ScenarioRankingRow[] } | null = null;

  rankScenarios(): ScenarioRankingRow[] {
    // deterministic per sim-hour — cache on the hour bucket
    const hourKey = Math.floor(this.clock.simMillis / 3_600_000);
    if (this.rankingCache?.hourKey === hourKey) return this.rankingCache.rows;
    const rows = rankScenarioImpacts(
      this.store.snapshot,
      (eid, t) => this.store.stateAt(eid, t),
      this.scenarioCatalog,
      this.clock.simTime
    );
    this.rankingCache = { hourKey, rows };
    return rows;
  }

  runScenario(id: EntityId): ScenarioImpact | null {
    const spec = this.scenarioCatalog.find((sp) => sp.id === id);
    if (!spec) return null;
    if (this.activeScenario) this.clearScenario();

    const impact = computeScenarioImpact(
      this.store.snapshot,
      (eid, t) => this.store.stateAt(eid, t),
      spec,
      this.clock.simTime
    );
    this.activeScenario = impact;
    this.scenarioDeltaIx = new Map(impact.deltas.map((d) => [d.entityId, d]));

    // renderer: violet dashed hypothetical treatment
    for (const d of impact.deltas) {
      if (this.store.route(d.entityId)) {
        this.routesLayer.setScenarioRole(d.entityId, d.role === 'perturbed' ? 1 : 2);
      } else if (this.store.node(d.entityId)) {
        this.nodesLayer.setScenarioRole(d.entityId, d.role === 'perturbed' ? 1 : 2);
      }
    }
    this.clock.setScenario(spec.id); // regime → 'scenario'; time event fans out
    this.refreshTemporalStates(true);
    this.events.emit('scenario', { active: true, impact });
    this.events.emit('toast', {
      title: 'HYPOTHETICAL FRAME ENTERED',
      body: `${spec.name} — simulated outcome, not an outcome.`,
      tone: 'warn',
    });
    return impact;
  }

  clearScenario(): void {
    if (!this.activeScenario) return;
    this.activeScenario = null;
    this.scenarioDeltaIx = new Map();
    this.routesLayer.clearScenarioRoles();
    this.nodesLayer.clearScenarioRoles();
    this.clock.setScenario(null);
    this.refreshTemporalStates(true);
    this.events.emit('scenario', { active: false });
    this.events.emit('toast', { title: 'FRAME EXITED', body: 'Back to the mirror.', tone: 'info' });
  }

  getActiveScenario(): ScenarioImpact | null {
    return this.activeScenario;
  }

  getDataSourceId(): string {
    return this.dataSourceId;
  }

  stopFollowTheLoad(): void {
    this.demo.stop();
  }

  isDemoActive(): boolean {
    return this.demo.active;
  }
}

export type { Facility, Flow, Route };
