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
import { SatsLayer } from '../layers/satsLayer';
import { AircraftLayer } from '../layers/aircraftLayer';
import { QuakesLayer } from '../layers/quakesLayer';
import { BeaconsLayer } from '../layers/beaconsLayer';
import { correlateQuakes, greatCircleKm } from '../intel/proximity';
import { runMiner, type MinedPattern, type MiningRun } from '../intel/miner';
import { fetchInjection, type InjectionOutcome, type InjectionParams } from '../data/injection';
import { deadReckon, fetchLiveAircraft, fetchLiveQuakes, fetchLiveSatellites } from '../live/feeds';
import { resolveApiBase } from '../data/sources';
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
  LiveScreenContact,
  MinerResult,
  Suggestion,
  ViewPreset,
} from './api';

const SENSOR_LABELS = ['NORMAL', 'NVG', 'FLIR', 'CRT', 'NOIR'] as const;

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
  private satsLayer = new SatsLayer();
  private quakesLayer = new QuakesLayer();
  private beacons = new BeaconsLayer();
  private liveLoaded = { sats: false, quakes: false };
  private aircraftLayer!: AircraftLayer;
  private aircraftTimer: number | undefined;
  private aircraftBucket = '';
  private quakesTimer: number | undefined;
  private liveTracked: { kind: 'aircraft' | 'satellite'; i: number } | null = null;
  /** identity anchor for a tracked aircraft — polls replace the array */
  private liveTrackedHex: string | null = null;
  private sensorMode: 0 | 1 | 2 | 3 | 4 = 0;
  /** Reported quakes once the seismic feed loads — null = not loaded. */
  private liveQuakesList: import('../live/feeds').LiveQuake[] | null = null;
  private trail: THREE.Line | null = null;
  private trailPts: THREE.Vector3[] = [];
  private trailLastPush = 0;
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
    scene.add(this.beacons.mesh);
    scene.add(this.satsLayer.points);
    this.aircraftLayer = new AircraftLayer(this.engine.camera);
    scene.add(this.aircraftLayer.points);
    scene.add(this.quakesLayer.group);
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
      // a drag while tracking hands the camera back — the chase must
      // never rubber-band against the operator's own hand
      if (this.liveTracked) this.releaseLiveTrack();
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
    this.engine.onFrame((dt, elapsed) => {
      this.clock.tick(dt);
      this.cameraCtl.update(dt);
      const alt = this.cameraCtl.altitudeRadii();
      this.routesLayer.setAltitude(alt);
      this.nodesLayer.setAltitude(alt);
      this.routesLayer.update(dt);
      this.nodesLayer.update(dt);
      this.flowsLayer.update(dt);
      this.opsArc.update(dt);
      this.satsLayer.update();
      this.aircraftLayer.update();
      this.updateLiveTrack(false, dt);
      this.quakesLayer.update(dt);
      this.beacons.update(elapsed);
      this.labelsLayer.update(this.engine.camera, this.nodesLayer, alt);
      this.pulseAnomalies(dt);
    });
    this.engine.start();

    // attention beams: corpus disruptions flag assets from boot; live
    // hazard correlations join when the seismic feed loads. Re-evaluated
    // on a quiet cadence so sim-time jumps and report ages stay honest.
    this.refreshBeacons();
    setInterval(() => this.refreshBeacons(), 60_000);

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
    m.register('live.satellites', (v) => {
      this.satsLayer.setVisible(v);
      if (v && !this.liveLoaded.sats) void this.loadLiveSatellites();
    });
    m.register('live.aircraft', (v) => {
      this.aircraftLayer.setVisible(v);
      if (v) this.startAircraftPolling();
      else this.stopAircraftPolling();
    });
    m.register('live.seismic', (v) => {
      this.quakesLayer.setVisible(v);
      if (v && !this.liveLoaded.quakes) void this.loadLiveQuakes();
      // report ages drift and new events happen: refresh the 24h feed
      // every 5 minutes while the layer is on (server caches 5 min too)
      if (v && this.quakesTimer === undefined) {
        this.quakesTimer = window.setInterval(() => void this.loadLiveQuakes(), 5 * 60_000);
      } else if (!v && this.quakesTimer !== undefined) {
        window.clearInterval(this.quakesTimer);
        this.quakesTimer = undefined;
      }
    });
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
    // live-contact hover: identify a dart/dot before the click. Corpus
    // hover wins — a live chip only shows over empty sky/sea.
    let liveHoverAt = 0;
    let liveHoverKey = '';
    canvas.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - liveHoverAt < 120) return;
      liveHoverAt = now;
      let live = this.hoverId || this.demo.active ? null : this.pickLive(e.clientX, e.clientY);
      // the tracked contact is already identified by reticle + card
      if (live && this.liveTracked && live.kind === this.liveTracked.kind && live.i === this.liveTracked.i) {
        live = null;
      }
      if (!live) {
        if (liveHoverKey) {
          liveHoverKey = '';
          this.events.emit('liveHover', { active: false });
          document.body.style.cursor = this.hoverId ? 'pointer' : 'default';
        }
        return;
      }
      const key = `${live.kind}:${live.i}`;
      if (key === liveHoverKey) return;
      liveHoverKey = key;
      if (live.kind === 'aircraft') {
        const a = this.aircraftLayer.contacts[live.i];
        this.events.emit('liveHover', {
          active: true,
          kind: 'aircraft',
          name: a.flight ?? a.hex.toUpperCase(),
          basis: 'OBSERVED · ADS-B',
        });
      } else {
        const s = this.satsLayer.contacts[live.i];
        this.events.emit('liveHover', {
          active: true,
          kind: 'satellite',
          name: s.name,
          basis: 'COMPUTED · SGP4',
        });
      }
      document.body.style.cursor = 'pointer';
    });
    input.onClick = (pick, x, y, shiftKey) => {
      if (this.demo.active) return;
      // shift-click pins for comparison — selection is untouched
      if (shiftKey && pick && pick.type !== 'country') {
        this.events.emit('pin', { id: pick.id });
        return;
      }
      // live contacts outrank empty space AND the country pick — an
      // aircraft dart hugs the globe, so the sphere hit would otherwise
      // always swallow the click. Corpus nodes/routes still win.
      if (!pick || pick.type === 'country') {
        const live = this.pickLive(x, y);
        if (live) {
          this.select(null, 'pick');
          this.selectCountry(null);
          this.startLiveTrack(live);
          return;
        }
      }
      // any click that lands elsewhere lets the tracked contact go —
      // the chase camera must never fight a fly-to or country focus
      if (this.liveTracked) this.releaseLiveTrack();
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
      // release restores the standing commodity focus, if one is active
      this.routesLayer.applyBrush(this.commodityFocusSet);
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
    if (preset !== 'agents' && preset !== 'scenarios' && preset !== 'operations' && preset !== 'markets') {
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

  /**
   * Live feeds (gods-eye-view substrate): fetched lazily on first
   * toggle, THROUGH the spatial API proxy. A failure is a toast with
   * the refusal's remedy — the layer stays empty, never fabricated.
   */
  private async loadLiveSatellites(): Promise<void> {
    const r = await fetchLiveSatellites(resolveApiBase());
    if (r.kind !== 'ok') {
      this.events.emit('toast', {
        title: 'LIVE SATELLITES UNAVAILABLE',
        body: r.kind === 'refused' ? `${r.refusal.message} — ${r.refusal.remedy}` : r.note,
        tone: 'warn',
      });
      return;
    }
    this.liveLoaded.sats = true;
    this.satsLayer.setSats(r.data.sats);
    this.satsLayer.setVisible(this.layerMgr.list().find((l) => l.id === 'live.satellites')?.visible ?? false);
    this.events.emit('toast', {
      title: 'LIVE SATELLITES',
      body: `${r.data.sats.length} objects · ${r.data.upstream} · positions COMPUTED by SGP4, repropagated 1/s`,
      tone: 'info',
    });
  }

  private async loadLiveQuakes(): Promise<void> {
    const r = await fetchLiveQuakes(resolveApiBase());
    if (r.kind !== 'ok') {
      this.events.emit('toast', {
        title: 'LIVE SEISMIC UNAVAILABLE',
        body: r.kind === 'refused' ? `${r.refusal.message} — ${r.refusal.remedy}` : r.note,
        tone: 'warn',
      });
      return;
    }
    this.liveLoaded.quakes = true;
    this.liveQuakesList = r.data.quakes;
    this.quakesLayer.setQuakes(r.data.quakes);
    this.refreshBeacons();
    this.events.emit('liveQuakes', { count: r.data.quakes.length });
    this.events.emit('toast', {
      title: 'LIVE SEISMIC',
      body: `${r.data.quakes.length} reported events (M2.5+, 24h) · ${r.data.upstream}`,
      tone: 'info',
    });
  }

  // ---------------------------------------------------- live tracking

  /** Poll observed air traffic around the camera subpoint: every 30s,
   *  or within 5s of the subpoint moving to a new degree bucket. */
  private aircraftLastPollMs = 0;
  private aircraftToastBucket = '';

  private startAircraftPolling(): void {
    if (this.aircraftTimer !== undefined) return;
    const poll = async (): Promise<void> => {
      const sub = vec3ToLatLon(this.engine.camera.position.clone().normalize());
      const bucket = `${Math.round(sub.lat)}:${Math.round(sub.lon)}`;
      this.aircraftBucket = bucket;
      this.aircraftLastPollMs = Date.now();
      const r = await fetchLiveAircraft(resolveApiBase(), [sub.lon, sub.lat]);
      if (r.kind !== 'ok') {
        this.events.emit('toast', {
          title: 'LIVE AIRCRAFT UNAVAILABLE',
          body: r.kind === 'refused' ? `${r.refusal.message} — ${r.refusal.remedy}` : r.note,
          tone: 'warn',
        });
        return;
      }
      this.aircraftLayer.setAircraft(r.data.aircraft);
      // a poll replaces the contacts array — a tracked aircraft is
      // re-anchored BY IDENTITY (hex), never left to whatever contact
      // now occupies its old index; a contact gone from the snapshot
      // releases the track rather than silently swapping planes
      if (this.liveTracked?.kind === 'aircraft') {
        const j = r.data.aircraft.findIndex((a) => a.hex === this.liveTrackedHex);
        if (j >= 0) this.liveTracked.i = j;
        else this.releaseLiveTrack();
      }
      // the toast announces a REGION, not every refresh of the same one
      if (bucket !== this.aircraftToastBucket) {
        this.aircraftToastBucket = bucket;
        this.events.emit('toast', {
          title: 'LIVE AIRCRAFT',
          body: `${r.data.aircraft.length} ADS-B contacts within 250 NM of ${r.data.center.lat}°, ${r.data.center.lon}° · OBSERVED, dead-reckoned between fixes`,
          tone: 'info',
        });
      }
    };
    void poll();
    this.aircraftTimer = window.setInterval(() => {
      const sub = vec3ToLatLon(this.engine.camera.position.clone().normalize());
      const bucket = `${Math.round(sub.lat)}:${Math.round(sub.lon)}`;
      const due = Date.now() - this.aircraftLastPollMs >= 30_000;
      if (bucket !== this.aircraftBucket || due) void poll();
    }, 5_000);
  }

  private stopAircraftPolling(): void {
    if (this.aircraftTimer !== undefined) {
      window.clearInterval(this.aircraftTimer);
      this.aircraftTimer = undefined;
    }
  }

  /** Nearest live object (aircraft or satellite) within px of a screen point. */
  private pickLive(clientX: number, clientY: number): { kind: 'aircraft' | 'satellite'; i: number } | null {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const proj = new THREE.Vector3();
    let best: { kind: 'aircraft' | 'satellite'; i: number; d: number } | null = null;
    const consider = (kind: 'aircraft' | 'satellite', i: number, x: number, y: number, z: number): void => {
      if (this.occludedByGlobe(x, y, z)) return; // never pick behind the planet
      proj.set(x, y, z).project(this.engine.camera);
      if (proj.z > 1) return;
      const sx = ((proj.x + 1) / 2) * w;
      const sy = ((1 - proj.y) / 2) * h;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < 16 && (!best || d < best.d)) best = { kind, i, d };
    };
    if (this.aircraftLayer.points.visible) {
      const pos = this.aircraftLayer.points.geometry.getAttribute('position');
      const alive = this.aircraftLayer.points.geometry.getAttribute('aAlive');
      for (let i = 0; i < pos.count; i++) {
        if (alive.getX(i) < 0.5) continue;
        consider('aircraft', i, pos.getX(i), pos.getY(i), pos.getZ(i));
      }
    }
    if (this.satsLayer.points.visible) {
      const pos = this.satsLayer.points.geometry.getAttribute('position');
      if (pos) {
        for (let i = 0; i < pos.count; i++) {
          if (this.satsLayer.lastProp[i]) consider('satellite', i, pos.getX(i), pos.getY(i), pos.getZ(i));
        }
      }
    }
    return best ? { kind: (best as { kind: 'aircraft' | 'satellite' }).kind, i: (best as { i: number }).i } : null;
  }

  private startLiveTrack(t: { kind: 'aircraft' | 'satellite'; i: number }): void {
    this.liveTracked = t;
    this.liveTrackedHex = t.kind === 'aircraft' ? (this.aircraftLayer.contacts[t.i]?.hex ?? null) : null;
    this.trailPts = [];
    if (this.trail) {
      this.engine.scene.remove(this.trail);
      this.trail.geometry.dispose();
      (this.trail.material as THREE.Material).dispose();
      this.trail = null;
    }
    this.updateLiveTrack(true);
  }

  isLiveTracking(): boolean {
    return this.liveTracked !== null;
  }

  getLiveQuakes(): import('../live/feeds').LiveQuake[] | null {
    return this.liveQuakesList;
  }

  /**
   * Attention beams mark assets the intelligence layer flags: hazard
   * correlations (COMPUTED PROXIMITY) and high-severity disruptions
   * active at sim time. A beam is a marker of an alert that exists
   * elsewhere with its basis — it adds attention, never information.
   */
  private refreshBeacons(): void {
    const flagged = new Map<EntityId, 'alert' | 'warn'>();
    if (this.liveQuakesList) {
      for (const a of correlateQuakes(this.liveQuakesList, this.store.snapshot.nodes, Date.now())) {
        if (flagged.get(a.nodeId) !== 'alert') flagged.set(a.nodeId, a.severity);
      }
    }
    const t = Date.parse(this.clock.simTime);
    for (const e of this.store.snapshot.events) {
      if (e.severity < 0.7) continue;
      if (Date.parse(e.start) > t || (e.end && Date.parse(e.end) < t)) continue;
      for (const id of e.affects) {
        if (this.store.node(id)) flagged.set(id, 'alert');
      }
    }
    this.beacons.set(
      [...flagged].map(([id, tone]) => ({
        lonLat: this.store.node(id)!.geometry.coordinates,
        tone,
      }))
    );
  }

  releaseLiveTrack(): void {
    this.liveTracked = null;
    this.liveTrackedHex = null;
    if (this.trail) {
      this.engine.scene.remove(this.trail);
      this.trail.geometry.dispose();
      (this.trail.material as THREE.Material).dispose();
      this.trail = null;
    }
    this.events.emit('liveTrack', { active: false });
  }

  nextLiveContact(): void {
    if (!this.liveTracked || this.liveTracked.kind !== 'aircraft') return;
    const contacts = this.aircraftLayer.contacts;
    if (contacts.length < 2) return;
    const cur = contacts[this.liveTracked.i];
    const nowMs = Date.now();
    const here = deadReckon(cur, nowMs) ?? cur.lonLat;
    // nearest other alive contact by TRUE great-circle distance —
    // flat degree math lies near the poles and across the antimeridian
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < contacts.length; i++) {
      if (i === this.liveTracked.i) continue;
      const ll = deadReckon(contacts[i], nowMs);
      if (!ll) continue;
      const d = greatCircleKm(here[0], here[1], ll[0], ll[1]);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI >= 0) this.startLiveTrack({ kind: 'aircraft', i: bestI });
  }

  // ---------------------------------------------- sensor styles / detection

  setSensorMode(mode: 0 | 1 | 2 | 3 | 4): void {
    if (mode === this.sensorMode) return;
    this.sensorMode = mode;
    this.engine.setSensorMode(mode);
    this.events.emit('sensor', { mode, label: SENSOR_LABELS[mode] });
  }

  getSensorMode(): 0 | 1 | 2 | 3 | 4 {
    return this.sensorMode;
  }

  /** True when the straight line camera→point passes through the globe. */
  private occludedByGlobe(x: number, y: number, z: number): boolean {
    const c = this.engine.camera.position;
    const dx = x - c.x;
    const dy = y - c.y;
    const dz = z - c.z;
    const dist = Math.hypot(dx, dy, dz);
    const inv = 1 / dist;
    const b = c.x * dx * inv + c.y * dy * inv + c.z * dz * inv;
    const q = c.x * c.x + c.y * c.y + c.z * c.z - 1;
    const disc = b * b - q;
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    return t >= 0 && t < dist - 0.002;
  }

  liveScreenContacts(): LiveScreenContact[] {
    const out: LiveScreenContact[] = [];
    const w = window.innerWidth;
    const h = window.innerHeight;
    const proj = new THREE.Vector3();
    const push = (kind: 'aircraft' | 'satellite', name: string, x: number, y: number, z: number): void => {
      if (this.occludedByGlobe(x, y, z)) return;
      proj.set(x, y, z).project(this.engine.camera);
      if (proj.z > 1) return;
      const sx = ((proj.x + 1) / 2) * w;
      const sy = ((1 - proj.y) / 2) * h;
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) return;
      out.push({ kind, name, x: sx, y: sy });
    };
    if (this.aircraftLayer?.points.visible) {
      const pos = this.aircraftLayer.points.geometry.getAttribute('position');
      const alive = this.aircraftLayer.points.geometry.getAttribute('aAlive');
      const contacts = this.aircraftLayer.contacts;
      for (let i = 0; i < pos.count; i++) {
        if (alive.getX(i) < 0.5) continue;
        const a = contacts[i];
        push('aircraft', a.flight ?? a.hex.toUpperCase(), pos.getX(i), pos.getY(i), pos.getZ(i));
      }
    }
    if (this.satsLayer.points.visible) {
      const pos = this.satsLayer.points.geometry.getAttribute('position');
      if (pos) {
        for (let i = 0; i < pos.count; i++) {
          if (!this.satsLayer.lastProp[i]) continue;
          push('satellite', this.satsLayer.contacts[i].name, pos.getX(i), pos.getY(i), pos.getZ(i));
        }
      }
    }
    return out;
  }

  /** Per-frame: chase the tracked contact, extend its trail, refresh
   *  the readout. Basis honesty rides in every readout emit. */
  private updateLiveTrack(force = false, dt = 1 / 60): void {
    if (!this.liveTracked) return;
    const nowMs = Date.now();
    let lat: number;
    let lon: number;
    let info: AppEvents['liveTrack'];
    if (this.liveTracked.kind === 'aircraft') {
      const a = this.aircraftLayer.contacts[this.liveTracked.i];
      if (!a) return this.releaseLiveTrack();
      const ll = deadReckon(a, nowMs);
      if (!ll) return this.releaseLiveTrack();
      [lon, lat] = ll;
      const fixAge = Math.round((nowMs - a.fetchedAtMs) / 1000 + (a.seenPosSec ?? 0));
      info = {
        active: true,
        kind: 'aircraft',
        name: a.flight ?? a.hex.toUpperCase(),
        altKm: a.altFt !== null ? (a.altFt * 0.0003048) : null,
        gsKt: a.gsKt,
        track: a.track,
        basis: 'OBSERVED · ADS-B (adsb.lol, ODbL)',
        age: `FIX ${fixAge}S AGO · DEAD-RECKONED SINCE`,
        contactsNearby: this.aircraftLayer.contacts.length,
      };
    } else {
      const p = this.satsLayer.lastProp[this.liveTracked.i];
      const s = this.satsLayer.contacts[this.liveTracked.i];
      if (!p || !s) return this.releaseLiveTrack();
      [lon, lat] = p.lonLat;
      info = {
        active: true,
        kind: 'satellite',
        name: s.name,
        altKm: p.altitudeKm,
        gsKt: null,
        track: null,
        basis: 'COMPUTED · SGP4 (celestrak elements)',
        age: `TLE ${p.tleAgeHours.toFixed(1)}H OLD`,
      };
    }
    // screen-space anchor for the tracking reticle, from the SAME buffer
    // the dart/dot renders from — the ring sits on the rendered object
    const attr =
      this.liveTracked.kind === 'aircraft'
        ? this.aircraftLayer.points.geometry.getAttribute('position')
        : this.satsLayer.points.geometry.getAttribute('position');
    if (attr) {
      const i = this.liveTracked.i;
      const wx = attr.getX(i);
      const wy = attr.getY(i);
      const wz = attr.getZ(i);
      const proj = new THREE.Vector3(wx, wy, wz).project(this.engine.camera);
      info.sx = ((proj.x + 1) / 2) * window.innerWidth;
      info.sy = ((1 - proj.y) / 2) * window.innerHeight;
      info.behind = proj.z > 1 || this.occludedByGlobe(wx, wy, wz);
    }
    info.lat = lat;
    info.lon = lon;
    // frame-rate-independent chase: the same stiffness at 60Hz and 144Hz
    const ease = force ? 1 : 1 - Math.pow(1 - 0.06, dt * 60);
    this.cameraCtl.followLatLon(lat, lon, ease);
    this.events.emit('liveTrack', info);

    // fading trail: one vertex per second, capped
    if (nowMs - this.trailLastPush > 1000) {
      this.trailLastPush = nowMs;
      const r = this.liveTracked.kind === 'satellite'
        ? 1 + (this.satsLayer.lastProp[this.liveTracked.i]?.altitudeKm ?? 400) / 6371
        : 1.0035;
      this.trailPts.push(latLonToVec3(lat, lon, r));
      if (this.trailPts.length > 240) this.trailPts.shift();
      if (this.trail) {
        this.engine.scene.remove(this.trail);
        this.trail.geometry.dispose();
        (this.trail.material as THREE.Material).dispose();
      }
      this.trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(this.trailPts),
        new THREE.LineBasicMaterial({ color: 0xe8f1fb, transparent: true, opacity: 0.55, depthWrite: false })
      );
      this.trail.renderOrder = 7;
      this.engine.scene.add(this.trail);
    }
  }

  // ------------------------------------------------------- corpus query
  // Earth as the visual query surface: a query lights a RESULT SET and
  // quiets the rest. Matching is FIELD-BASED — a facility is a producer
  // of X because its corpus record DECLARES X in `outputs`, never
  // because a name looked right. Emphasis only; nothing is hidden.

  private queryIds: Set<EntityId> | null = null;
  private queryState: {
    role: 'producers' | 'consumers';
    commodityId: EntityId;
    label: string;
    /** null = refinement not tried; 0 = tried, zero DECLARED connections */
    routesLit: number | null;
    flowsOn: boolean;
  } | null = null;

  private queryEvidenceCount(commodityId: EntityId): number {
    const key = commodityId.split(':').pop();
    return this.store.snapshot.observations.filter((o) =>
      o.provenance.evidence?.includes(`commodity:${key}`)
    ).length;
  }

  private emitQuery(): void {
    if (!this.queryState || !this.queryIds) {
      this.events.emit('query', { active: false });
      return;
    }
    this.events.emit('query', {
      active: true,
      label: this.queryState.label,
      matched: this.queryIds.size,
      basis: `matched on the corpus ${this.queryState.role === 'producers' ? 'outputs' : 'inputs'} field — declared, not inferred`,
      role: this.queryState.role,
      commodityId: this.queryState.commodityId,
      routesLit: this.queryState.routesLit,
      flowsOn: this.queryState.flowsOn,
      evidenceCount: this.queryEvidenceCount(this.queryState.commodityId),
    });
  }

  runMaterialQuery(role: 'producers' | 'consumers', commodityId: EntityId): number {
    this.clearMinedPattern(); // one lit structure at a time
    const field = role === 'producers' ? 'outputs' : 'inputs';
    const ids = new Set<EntityId>();
    const pts: THREE.Vector3[] = [];
    for (const n of this.store.snapshot.nodes) {
      if ((n[field] ?? []).includes(commodityId)) {
        ids.add(n.id);
        pts.push(latLonToVec3(n.geometry.coordinates[1], n.geometry.coordinates[0], 1));
      }
    }
    if (!ids.size) {
      this.clearQuery();
      return 0;
    }
    const name = this.store.snapshot.commodities.find((c) => c.id === commodityId)?.name ?? commodityId;
    this.queryIds = ids;
    this.queryState = {
      role,
      commodityId,
      label: `${role.toUpperCase()} OF ${name.toUpperCase()}`,
      routesLit: null,
      flowsOn: false,
    };
    this.nodesLayer.applyQuerySet(ids);
    // frame the result set: fly to its centroid, distance by spread
    const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
    if (c.lengthSq() > 0.01) {
      const { lat, lon } = vec3ToLatLon(c.clone().normalize());
      const spread = Math.max(...pts.map((p) => p.angleTo(c)));
      this.cameraCtl.flyToLatLon(lat, lon, {
        distance: Math.min(3.4, Math.max(1.6, 1.2 + spread * 2.2)),
        durationMs: 1400,
      });
    }
    this.emitQuery();
    return ids.size;
  }

  addQueryRoutes(): number {
    if (!this.queryIds || !this.queryState) return 0;
    const lit = new Set<EntityId>();
    for (const id of this.queryIds) {
      const n = this.store.node(id);
      for (const rid of n?.connectedRouteIds ?? []) {
        if (this.store.route(rid)) lit.add(rid);
      }
    }
    this.routesLayer.applyBrush(lit.size ? lit : null);
    this.queryState.routesLit = lit.size;
    this.emitQuery();
    return lit.size;
  }

  addQueryFlows(): void {
    if (!this.queryState) return;
    this.setCommodityFocus(this.queryState.commodityId);
    this.setFlowMode(true);
    this.queryState.flowsOn = true;
    this.emitQuery();
  }

  clearQuery(): void {
    const had = this.queryState !== null;
    this.queryIds = null;
    this.queryState = null;
    this.nodesLayer.applyQuerySet(null);
    if (had) {
      // restore the standing commodity focus (or nothing) on routes
      this.routesLayer.applyBrush(this.commodityFocusSet);
      this.emitQuery();
    }
  }

  isQueryActive(): boolean {
    return this.queryState !== null;
  }

  // ------------------------------------------------------ payload miner
  // Deterministic pattern candidates over the served snapshot. The
  // ladder is enforced at the type level (validationStatus 'candidate')
  // and at the surface level (the banner names algorithm/run/build and
  // says CANDIDATE — never observed-fact styling).
  //
  // When the spatial API is the source, mining is ITS capability: the
  // renderer displays the run served at /api/mining/patterns rather
  // than re-deriving it — dogfooding the product boundary the locked
  // architecture demands. In-browser mining is the fallback for the
  // unstamped in-browser corpus (or a failed fetch), and minedAt
  // labels which path produced the run. The algorithms are shared and
  // deterministic, so both paths agree on the same build.

  private minerResult: MinerResult | null = null;
  private minerPromise: Promise<MinerResult> | null = null;
  private activePatternId: string | null = null;

  getMinedPatterns(): Promise<MinerResult> {
    if (this.minerResult) return Promise.resolve(this.minerResult);
    if (!this.minerPromise) {
      this.minerPromise = this.mine().then((r) => {
        this.minerResult = r;
        return r;
      });
    }
    return this.minerPromise;
  }

  private async mine(): Promise<MinerResult> {
    if (this.dataSourceId === 'payload-spatial-api') {
      try {
        const res = await fetch(`${resolveApiBase()}/api/mining/patterns`);
        const body = (await res.json()) as {
          status?: string;
          data?: { run: MiningRun; patterns: MinedPattern[] };
        };
        if (res.ok && body.status === 'ok' && body.data?.run && Array.isArray(body.data.patterns)) {
          return { ...body.data, minedAt: 'payload-spatial-api' };
        }
      } catch {
        // fall through to the labeled in-browser path
      }
    }
    return { ...runMiner(this.store.snapshot), minedAt: 'in-browser' };
  }

  async showMinedPattern(id: string): Promise<void> {
    const p = (await this.getMinedPatterns()).patterns.find((x) => x.id === id);
    if (!p) return;
    this.clearQuery(); // one lit structure at a time
    this.activePatternId = id;
    const nodeIds = new Set(p.entities.filter((e) => this.store.node(e)));
    this.nodesLayer.applyQuerySet(nodeIds.size ? nodeIds : null);
    const routeIds = new Set(p.routes.filter((r) => this.store.route(r)));
    this.routesLayer.applyBrush(routeIds.size ? routeIds : null);
    // frame the pattern's constituent facilities
    const pts = [...nodeIds].map((e) => {
      const n = this.store.node(e)!;
      return latLonToVec3(n.geometry.coordinates[1], n.geometry.coordinates[0], 1);
    });
    if (pts.length) {
      const c = pts.reduce((s, q) => s.add(q), new THREE.Vector3()).divideScalar(pts.length);
      if (c.lengthSq() > 0.01) {
        const { lat, lon } = vec3ToLatLon(c.clone().normalize());
        const spread = pts.length > 1 ? Math.max(...pts.map((q) => q.angleTo(c))) : 0;
        this.cameraCtl.flyToLatLon(lat, lon, {
          distance: Math.min(3.2, Math.max(1.5, 1.2 + spread * 2.2)),
          durationMs: 1300,
        });
      }
    }
    this.events.emit('pattern', { active: true, pattern: p });
  }

  clearMinedPattern(): void {
    if (!this.activePatternId) return;
    this.activePatternId = null;
    this.nodesLayer.applyQuerySet(null);
    this.routesLayer.applyBrush(this.commodityFocusSet);
    this.events.emit('pattern', { active: false });
  }

  isPatternActive(): boolean {
    return this.activePatternId !== null;
  }

  /** Active commodity focus — survives a B-brush release. */
  private commodityFocusSet: Set<EntityId> | null = null;

  setCommodityFocus(commodityId: EntityId | null): void {
    if (!commodityId) {
      this.commodityFocusSet = null;
      this.routesLayer.applyBrush(null);
      this.events.emit('commodityFocus', { commodityId: null, name: null, routes: 0, flows: 0 });
      return;
    }
    const flows = this.store.snapshot.flows.filter((f) => f.commodityId === commodityId);
    const lit = new Set<EntityId>();
    for (const f of flows) for (const seg of f.segments) lit.add(seg.routeId);
    this.commodityFocusSet = lit;
    this.routesLayer.applyBrush(lit);
    const name =
      this.store.snapshot.commodities.find((c) => c.id === commodityId)?.name ?? commodityId;
    this.events.emit('commodityFocus', {
      commodityId,
      name,
      routes: lit.size,
      flows: flows.length,
    });
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
    this.clearInjection(); // one hypothetical frame at a time

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

  // ------------------------------------------------ what-if injection
  // The UPSTREAM counterfactual engine's answer, worn honestly: the
  // perturbed entity and its affected set take the violet scenario
  // roles (dashed hypothetical vocabulary), the card carries the
  // engine's own reasoning trace, and NO state delta is fabricated —
  // this corpus's states are unobserved and stay that way.

  private injectionActive = false;

  async runInjection(p: InjectionParams): Promise<InjectionOutcome> {
    const outcome = await fetchInjection(resolveApiBase(), p);
    if (outcome.kind !== 'ok') return outcome;
    // one lit structure at a time — injection displaces the others
    this.clearInjection();
    this.clearMinedPattern();
    this.clearQuery();
    if (this.activeScenario) this.clearScenario();
    const impact = outcome.result.scenarioImpacts[0];
    if (impact) {
      if (this.store.node(impact.entityId)) this.nodesLayer.setScenarioRole(impact.entityId, 1);
      for (const a of impact.affected) {
        if (this.store.node(a.entityId)) this.nodesLayer.setScenarioRole(a.entityId, 2);
      }
      const n = this.store.node(impact.entityId);
      if (n) {
        void this.cameraCtl.flyToLatLon(n.geometry.coordinates[1], n.geometry.coordinates[0], {
          distance: 2.4,
          durationMs: 1300,
        });
      }
    }
    this.injectionActive = true;
    this.events.emit('injection', { active: true, result: outcome.result, disclaimer: outcome.disclaimer });
    this.events.emit('toast', {
      title: 'WHAT-IF INJECTED — HYPOTHETICAL',
      body: `${outcome.result.counterfactualFrame.scenarioLabel} — computed upstream; a simulated outcome is not an outcome.`,
      tone: 'warn',
    });
    return outcome;
  }

  clearInjection(): void {
    if (!this.injectionActive) return;
    this.injectionActive = false;
    // roles are shared with in-process scenarios; only safe to wipe
    // because entering either path clears the other first
    this.nodesLayer.clearScenarioRoles();
    this.routesLayer.clearScenarioRoles();
    this.events.emit('injection', { active: false });
  }

  isInjectionActive(): boolean {
    return this.injectionActive;
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
