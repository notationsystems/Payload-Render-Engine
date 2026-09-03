/**
 * Structured tool surface over the AppApi facade — the GeoAgent
 * pattern: one registry of operations with metadata (description,
 * params, safety flags) that BOTH the human command bar and a future
 * agent binding (Payload agents, MCP, Strands, tool-use) consume.
 * The twin stays a mirror: every tool here is a VIEW operation;
 * nothing mutates canonical state, so nothing needs a confirmation
 * gate yet — the flags exist so gated operations can be added without
 * changing the shape.
 *
 * Exposed at runtime as window.payloadEarth.tools.
 */

import type { AppApi, LayerId, ViewPreset } from './api';

/**
 * SEC-012 — the capability allowlist for the agent/tool surface.
 *
 * Every AppApi member a tool may reach is named here, and
 * `scripts/check-security.mjs` fails the build if a tool reaches
 * anything else. Adding a capability therefore becomes a deliberate,
 * reviewable act rather than an import away.
 *
 * Every entry is VIEW-LEVEL: it changes what is displayed, never what
 * is true. That is the same boundary the renderer as a whole obeys
 * (INV-6), so an agent driving this surface has exactly the authority
 * a human clicking the UI has — and no more.
 *
 * `runCommand` is deliberately listed and deliberately broad: it is
 * the command vocabulary, not a wider authority. Commands are
 * view-level for the same reason, and the routes any of them can
 * reach are rate-limited server-side (SEC-150). Recorded here so the
 * breadth is stated rather than discovered.
 */
export const TOOL_CAPABILITY_ALLOWLIST = Object.freeze([
  // camera / focus
  'camera', 'focus', 'select', 'getSelection', 'getSelectedCountry',
  // layers + presets (display only)
  'getLayers', 'setLayerVisible', 'getPreset', 'setPreset',
  'getFlowMode', 'setFlowMode',
  // time
  'clock',
  // read-only queries over the loaded corpus
  'store', 'search', 'getDataSourceId',
  // counterfactual frames — computed, never state
  'listScenarios', 'rankScenarios', 'runScenario', 'clearScenario',
  // demo + the command vocabulary
  'startFollowTheLoad', 'runCommand',
]);

import { fetchOperations } from '../data/operations';
import { resolveApiBase } from '../data/sources';

export interface ToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface TwinTool {
  name: string;
  description: string;
  category: 'navigate' | 'layers' | 'select' | 'time' | 'query' | 'demo';
  params: ToolParam[];
  safety: { destructive: boolean; longRunning: boolean; requiresConfirmation: boolean };
  invoke(args: Record<string, unknown>): unknown;
}

const SAFE = { destructive: false, longRunning: false, requiresConfirmation: false };

export function buildToolSurface(api: AppApi): TwinTool[] {
  return [
    {
      name: 'fly_to',
      description: 'Fly the camera to a lat/lon at an optional altitude (earth radii above surface).',
      category: 'navigate',
      params: [
        { name: 'lat', type: 'number', description: 'Latitude in degrees', required: true },
        { name: 'lon', type: 'number', description: 'Longitude in degrees', required: true },
        { name: 'altitude', type: 'number', description: 'Altitude in earth radii (default keeps current)' },
      ],
      safety: SAFE,
      invoke: (a) =>
        api.camera.flyToLatLon(Number(a.lat), Number(a.lon), {
          distance: a.altitude !== undefined ? 1 + Number(a.altitude) : undefined,
        }),
    },
    {
      name: 'find',
      description: 'Search entities (nodes, routes, flows) by name and focus the best match.',
      category: 'query',
      params: [{ name: 'query', type: 'string', description: 'Name to search', required: true }],
      safety: SAFE,
      invoke: (a) => {
        const results = api.search(String(a.query));
        if (results.length) api.focus(results[0].id);
        return results;
      },
    },
    {
      name: 'select_entity',
      description: 'Select an entity by id (opens the inspector).',
      category: 'select',
      params: [{ name: 'id', type: 'string', description: 'Entity id', required: true }],
      safety: SAFE,
      invoke: (a) => api.select(String(a.id), 'command'),
    },
    {
      name: 'set_layer',
      description: 'Toggle a named layer (e.g. transport.maritime, intel.bottlenecks).',
      category: 'layers',
      params: [
        { name: 'layer', type: 'string', description: 'Layer id', required: true },
        { name: 'visible', type: 'boolean', description: 'Visibility', required: true },
      ],
      safety: SAFE,
      invoke: (a) => api.setLayerVisible(String(a.layer) as LayerId, Boolean(a.visible)),
    },
    {
      name: 'set_preset',
      description:
        'Apply a view preset: world, freight, trade, commodities, network, intelligence — or open the agents / scenarios panel views.',
      category: 'layers',
      params: [{ name: 'preset', type: 'string', description: 'Preset name', required: true }],
      safety: SAFE,
      invoke: (a) => api.setPreset(String(a.preset) as ViewPreset),
    },
    {
      name: 'set_flow_mode',
      description: 'Enable or disable animated flow particles.',
      category: 'layers',
      params: [{ name: 'enabled', type: 'boolean', description: 'On/off', required: true }],
      safety: SAFE,
      invoke: (a) => api.setFlowMode(Boolean(a.enabled)),
    },
    {
      name: 'set_time',
      description: 'Scrub simulation time to a fraction of the configured range (0..1).',
      category: 'time',
      params: [{ name: 'fraction', type: 'number', description: '0..1 across the time range', required: true }],
      safety: SAFE,
      invoke: (a) => api.clock.setFraction(Number(a.fraction)),
    },
    {
      name: 'set_playing',
      description: 'Play or pause simulation time.',
      category: 'time',
      params: [{ name: 'playing', type: 'boolean', description: 'Play state', required: true }],
      safety: SAFE,
      invoke: (a) => api.clock.setPlaying(Boolean(a.playing)),
    },
    {
      name: 'run_command',
      description: 'Run a command-bar command string (find/show/hide/compare/…).',
      category: 'query',
      params: [{ name: 'command', type: 'string', description: 'Command text', required: true }],
      safety: SAFE,
      invoke: (a) => api.runCommand(String(a.command)),
    },
    {
      name: 'get_operations',
      description:
        'READ-ONLY mirror of the Terminal brokerage control tower: exception-first load queue, portfolio, policy. Refusals pass through typed; the twin never issues an operations command.',
      category: 'query',
      params: [],
      safety: SAFE,
      invoke: async () => {
        const r = await fetchOperations(resolveApiBase());
        if (r.kind !== 'ok') return r;
        return {
          kind: 'ok',
          asOf: r.snapshot.asOf,
          portfolio: r.snapshot.portfolio,
          policy: r.snapshot.policy,
          queue: r.snapshot.loads.map((l) => ({
            operationId: l.operationId,
            lane: `${l.route.origin ?? '?'} -> ${l.route.destination ?? '?'}`,
            phase: l.state.operationPhase,
            attention: l.attentionLevel,
            nextAction: l.nextAction?.code ?? null,
            remedy: l.nextAction?.remedy ?? null,
          })),
          readOnlyMirror: true,
        };
      },
    },
    {
      name: 'get_state',
      description:
        'Snapshot of twin view state: sim time/regime, selection, preset, layers, data disclaimer.',
      category: 'query',
      params: [],
      safety: SAFE,
      invoke: () => ({
        source: api.getDataSourceId(),
        time: api.clock.state(),
        selection: api.getSelection(),
        country: api.getSelectedCountry(),
        preset: api.getPreset(),
        flowMode: api.getFlowMode(),
        layers: api.getLayers(),
        data: api.store.snapshot.meta,
      }),
    },
    {
      name: 'list_scenarios',
      description: 'List the counterfactual frame catalog (chokepoint closures).',
      category: 'query',
      params: [],
      safety: SAFE,
      invoke: () => api.listScenarios(),
    },
    {
      name: 'rank_scenarios',
      description:
        'Chokepoint criticality: compute every catalog frame at current sim time (without entering any) and rank by simulated queued delay. COMPUTED intelligence, not observation.',
      category: 'query',
      params: [],
      safety: SAFE,
      invoke: () => api.rankScenarios(),
    },
    {
      name: 'run_scenario',
      description:
        'Enter a HYPOTHETICAL frame: propagate a chokepoint closure through the network. A view-level projection — simulated outcome, not an outcome; nothing canonical changes.',
      category: 'query',
      params: [{ name: 'id', type: 'string', description: 'Scenario id from list_scenarios', required: true }],
      safety: SAFE,
      invoke: (a) => api.runScenario(String(a.id)),
    },
    {
      name: 'clear_scenario',
      description: 'Exit the hypothetical frame and return to observed state.',
      category: 'query',
      params: [],
      safety: SAFE,
      invoke: () => api.clearScenario(),
    },
    {
      name: 'follow_the_load',
      description: 'Run the cinematic multimodal demo scenario (Toronto → Chicago).',
      category: 'demo',
      params: [],
      safety: { ...SAFE, longRunning: true },
      invoke: () => api.startFollowTheLoad(),
    },
  ];
}
