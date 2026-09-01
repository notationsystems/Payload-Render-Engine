/**
 * AppApi — the single facade the UI instrument layer and demo
 * controllers talk to. UI components receive this and NOTHING else:
 * they never import renderer internals, and they never mutate data —
 * every call here is a view-level operation on the projection.
 */

import type { EntityId, Facility, Flow, LonLat, Route, TemporalState } from '../data/contracts';
import type { ScenarioImpact, ScenarioRankingRow, ScenarioSpec } from '../data/scenario';
import type { SearchResult, WorldStore } from '../data/store';
import type { EventBus } from '../core/events';
import type { SimClock } from '../core/time';

export type ViewPreset =
  | 'world'
  | 'freight'
  | 'trade'
  | 'commodities'
  | 'network'
  | 'intelligence' // formerly 'exceptions' — setPreset still accepts the old word
  | 'agents' // panel views: no layer change, they open an instrument panel
  | 'scenarios'
  | 'operations';

export interface LayerDef {
  id: LayerId;
  label: string;
  group: 'WORLD' | 'TRANSPORT' | 'INFRASTRUCTURE' | 'ECONOMY' | 'INTELLIGENCE' | 'LIVE';
  visible: boolean;
}

export type LayerId =
  | 'world.countries'
  | 'world.cities'
  | 'world.terrain'
  | 'world.nightlights'
  | 'transport.road'
  | 'transport.rail'
  | 'transport.maritime'
  | 'transport.air'
  | 'transport.pipeline'
  | 'transport.multimodal'
  | 'transport.unspecified'
  | 'infra.ports'
  | 'infra.airports'
  | 'infra.rail_terminals'
  | 'infra.warehouses'
  | 'infra.industrial'
  | 'economy.production'
  | 'economy.demand'
  | 'economy.inventory'
  | 'economy.flows'
  | 'intel.bottlenecks'
  | 'intel.constraints'
  | 'intel.anomalies'
  | 'intel.dependencies'
  | 'intel.risk'
  | 'live.satellites'
  | 'live.aircraft'
  | 'live.seismic';

/** One live contact projected to screen space (detection overlay). */
export interface LiveScreenContact {
  kind: 'aircraft' | 'satellite';
  name: string;
  x: number;
  y: number;
}

export interface CountryInfo {
  code: string;
  name: string;
  nodes: Facility[];
  routes: Route[];
  flows: Flow[];
  byMode: Record<string, number>; // route counts per mode
}

export interface Suggestion {
  text: string; // what gets filled into the bar
  label: string; // display line
  hint?: string; // right-aligned kind hint
}

export interface CommandResult {
  ok: boolean;
  message: string;
}

export interface AppEvents extends Record<string, unknown> {
  select: { id: EntityId | null; source: 'pick' | 'search' | 'command' | 'demo' | 'ui' };
  hover: { id: EntityId | null };
  countrySelect: { code: string | null; name: string | null };
  layersChange: { layers: LayerDef[] };
  time: TemporalState;
  preset: { preset: ViewPreset };
  flowMode: { enabled: boolean };
  demo: { active: boolean; step?: number; totalSteps?: number; caption?: string; title?: string };
  /** A hypothetical frame was entered or exited. */
  scenario: { active: boolean; impact?: ScenarioImpact };
  /** Route brush focus (hold B) engaged or released. */
  brush: { active: boolean };
  /** Commodity focus applied from the commodities workspace. */
  commodityFocus: { commodityId: EntityId | null; name: string | null; routes: number; flows: number };
  /** Live contact tracking (click-to-track) engaged/updated/released. */
  liveTrack: {
    active: boolean;
    kind?: 'aircraft' | 'satellite';
    name?: string;
    altKm?: number | null;
    gsKt?: number | null;
    track?: number | null;
    basis?: string;
    age?: string;
    contactsNearby?: number;
  };
  /** Sensor style changed (0 normal · 1 nvg · 2 flir · 3 crt · 4 noir). */
  sensor: { mode: 0 | 1 | 2 | 3 | 4; label: string };
  toast: { title: string; body?: string; tone?: 'info' | 'warn' | 'alert' };
  status: {
    fps: number;
    altitudeKm: number;
    visibleNodes: number;
    visibleRoutes: number;
    particles: number;
  };
}

export interface CameraFacade {
  /** Smoothly fly to a lat/lon; distance in earth-radii from center (1 = surface). */
  flyToLatLon(
    lat: number,
    lon: number,
    opts?: { distance?: number; durationMs?: number }
  ): Promise<void>;
  /** Frame a whole route in view (midpoint + fitted distance). */
  frameRoute(routeId: EntityId, opts?: { durationMs?: number }): Promise<void>;
  /** Cinematic dolly along a lon/lat path (Follow-the-Load). */
  followPath(
    coords: LonLat[],
    opts: {
      durationMs: number;
      distance?: number;
      onProgress?: (u: number) => void;
    }
  ): Promise<void>;
  /** Cancel any in-flight camera animation. */
  cancel(): void;
  /** Camera altitude above the surface, in earth-radii. */
  altitudeRadii(): number;
  setAutoRotate(enabled: boolean): void;
}

export interface AppApi {
  readonly events: EventBus<AppEvents>;
  readonly store: WorldStore;
  readonly clock: SimClock;
  readonly camera: CameraFacade;

  // ---- layers / presets
  getLayers(): LayerDef[];
  setLayerVisible(id: LayerId, visible: boolean): void;
  setPreset(preset: ViewPreset): void;
  getPreset(): ViewPreset;
  /** Last layer-changing preset — where a closing panel view returns. */
  getLastLayerPreset(): ViewPreset;
  /** Control-tower lane overlay (read-only; tracking honesty in the arc). */
  showOperationsLane(origin: LonLat, destination: LonLat, tracked: boolean): void;
  clearOperationsLane(): void;
  /** Commodity focus: dim routes carrying nothing of this commodity.
   *  Emphasis only — nothing hidden, nothing mutated. null clears. */
  setCommodityFocus(commodityId: EntityId | null): void;
  /** Release the tracked live contact (camera chase + trail + readout). */
  releaseLiveTrack(): void;
  /** Step to the nearest other live aircraft contact. */
  nextLiveContact(): void;
  /** Sensor style over the rendered feed (0 normal · 1 nvg · 2 flir · 3 crt · 4 noir).
   *  A styled feed is still the same data — HUD instruments are untouched. */
  setSensorMode(mode: 0 | 1 | 2 | 3 | 4): void;
  getSensorMode(): 0 | 1 | 2 | 3 | 4;
  /** Screen positions of currently visible live contacts (detection overlay). */
  liveScreenContacts(): LiveScreenContact[];
  setFlowMode(enabled: boolean): void;
  getFlowMode(): boolean;

  // ---- selection / focus
  select(id: EntityId | null, source?: AppEvents['select']['source']): void;
  getSelection(): EntityId | null;
  getSelectedCountry(): { code: string; name: string } | null;
  selectCountry(code: string | null): void;
  /** Select and cinematically frame an entity. */
  focus(id: EntityId): void;
  countryInfo(code: string): CountryInfo | null;

  // ---- command interface
  runCommand(input: string): CommandResult;
  suggest(input: string): Suggestion[];
  search(q: string): SearchResult[];

  // ---- demo scenario
  startFollowTheLoad(): void;
  stopFollowTheLoad(): void;
  isDemoActive(): boolean;

  /** Which registered data source hydrated the store ('synthetic-demo' | 'payload-spatial-api'). */
  getDataSourceId(): string;

  // ---- counterfactual frames (hypothetical — never confused with state)
  listScenarios(): ScenarioSpec[];
  /** Non-null when the catalog is empty for a stated reason (e.g. a
   *  projected corpus with no observed baseline). */
  scenariosUnavailableReason: string | null;
  /**
   * Chokepoint criticality: every catalog frame computed (not entered)
   * at the current sim time, ranked by simulated network damage.
   * COMPUTED intelligence, never observation.
   */
  rankScenarios(): ScenarioRankingRow[];
  /** Enter a hypothetical frame; regime becomes 'scenario' until cleared. */
  runScenario(id: EntityId): ScenarioImpact | null;
  clearScenario(): void;
  getActiveScenario(): ScenarioImpact | null;
}
