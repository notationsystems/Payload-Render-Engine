/**
 * COMMAND GRAMMAR — the parser behind the command bar (and, later,
 * the agent tool surface).
 *
 * Pure functions over the AppApi facade: no module state, no DOM.
 * Case-insensitive, forgiving; first matching rule wins. All result
 * messages are QUIET CAPS mono style ('MARITIME ON', 'FOCUS PORT OF
 * ROTTERDAM').
 */

import type { AppApi, CommandResult, LayerId, Suggestion, ViewPreset } from './api';
import type { EntityId, Flow, Route } from '../data/contracts';
import type { SearchResult } from '../data/store';

// ------------------------------------------------------------------
// Static tables (immutable data, not state)
// ------------------------------------------------------------------

/** thing-alias → layer. Longest aliases are matched exactly on the
 *  normalized remainder of 'show <thing>' / 'hide <thing>'. */
const LAYER_ALIASES: Record<string, LayerId> = {
  road: 'transport.road',
  roads: 'transport.road',
  trucking: 'transport.road',
  rail: 'transport.rail',
  railways: 'transport.rail',
  maritime: 'transport.maritime',
  shipping: 'transport.maritime',
  sea: 'transport.maritime',
  air: 'transport.air',
  flights: 'transport.air',
  ports: 'infra.ports',
  airports: 'infra.airports',
  'rail terminals': 'infra.rail_terminals',
  terminals: 'infra.rail_terminals',
  warehouses: 'infra.warehouses',
  distribution: 'infra.warehouses',
  industrial: 'infra.industrial',
  industry: 'infra.industrial',
  facilities: 'infra.industrial',
  countries: 'world.countries',
  borders: 'world.countries',
  cities: 'world.cities',
  labels: 'world.cities',
  'night lights': 'world.nightlights',
  lights: 'world.nightlights',
  terrain: 'world.terrain',
  graticule: 'world.terrain',
  flows: 'economy.flows',
  'commodity flows': 'economy.flows',
  bottlenecks: 'intel.bottlenecks',
  chokepoints: 'intel.bottlenecks',
  constraints: 'intel.constraints',
  anomalies: 'intel.anomalies',
  dependencies: 'intel.dependencies',
  'supply dependencies': 'intel.dependencies',
  risk: 'intel.risk',
  satellites: 'live.satellites',
  sats: 'live.satellites',
  aircraft: 'live.aircraft',
  planes: 'live.aircraft',
  adsb: 'live.aircraft',
  seismic: 'live.seismic',
  earthquakes: 'live.seismic',
  quakes: 'live.seismic',
};

/** Display names for layer toggle result messages. */
const LAYER_LABELS: Record<LayerId, string> = {
  'world.countries': 'COUNTRIES',
  'world.cities': 'CITIES',
  'world.terrain': 'TERRAIN',
  'world.nightlights': 'NIGHT LIGHTS',
  'transport.road': 'ROAD',
  'transport.rail': 'RAIL',
  'transport.pipeline': 'PIPELINE',
  'transport.multimodal': 'MULTIMODAL',
  'transport.unspecified': 'UNSPECIFIED MODE',
  'transport.maritime': 'MARITIME',
  'transport.air': 'AIR',
  'infra.ports': 'PORTS',
  'infra.airports': 'AIRPORTS',
  'infra.rail_terminals': 'RAIL TERMINALS',
  'infra.warehouses': 'WAREHOUSES',
  'infra.industrial': 'INDUSTRIAL',
  'economy.production': 'PRODUCTION',
  'economy.demand': 'DEMAND',
  'economy.inventory': 'INVENTORY',
  'economy.flows': 'FLOWS',
  'intel.bottlenecks': 'BOTTLENECKS',
  'intel.constraints': 'CONSTRAINTS',
  'intel.anomalies': 'ANOMALIES',
  'intel.dependencies': 'DEPENDENCIES',
  'intel.risk': 'RISK',
  'live.satellites': 'LIVE SATELLITES',
  'live.aircraft': 'LIVE AIRCRAFT',
  'live.seismic': 'LIVE SEISMIC',
};

const TRANSPORT_LAYERS: LayerId[] = [
  'transport.road',
  'transport.rail',
  'transport.maritime',
  'transport.air',
];

const INFRA_LAYERS: LayerId[] = [
  'infra.ports',
  'infra.airports',
  'infra.rail_terminals',
  'infra.warehouses',
  'infra.industrial',
];

const PRESETS: ViewPreset[] = [
  'world',
  'freight',
  'operations',
  'trade',
  'commodities',
  'markets',
  'network',
  'intelligence',
  'agents',
  'scenarios',
];

const HINT = 'TRY: find <place> · show <layer> · follow the load';

const HELP_MESSAGE =
  'FIND <NAME> · PRODUCERS/CONSUMERS OF <MATERIAL> · PATTERNS = MINED CANDIDATES · CORPUS = DEFINITION · COMPILER = BUILD REPORT · SHOW/HIDE <LAYER> · FLOWS ON/OFF · PLAY/PAUSE · SPEED 1H/6H/24H · NOW · ' +
  'COMPARE <A> VS <B> · SHIFT-CLICK = PIN A/B COMPARE · HOLD B = ROUTE BRUSH · CLICK LIVE CONTACT = TRACK (ESC RELEASES) · D = DETECTIONS · KEYS 1–5 = SENSOR STYLE · ' +
  'WORLD/FREIGHT/OPERATIONS/TRADE/COMMODITIES/MARKETS/NETWORK/INTELLIGENCE/AGENTS/SCENARIOS · BRIEF = SITREP · FOLLOW THE LOAD · EXIT';

const STARTERS: Suggestion[] = [
  { text: 'Find Toronto', label: 'Find Toronto', hint: 'SEARCH' },
  { text: 'Show maritime', label: 'Show maritime', hint: 'LAYER' },
  { text: 'Show bottlenecks', label: 'Show bottlenecks', hint: 'INTEL' },
  { text: 'Follow the load', label: 'Follow the load', hint: 'DEMO' },
  { text: 'Show copper flows', label: 'Show copper flows', hint: 'FLOWS' },
  { text: 'compare ', label: 'Compare <a> vs <b>', hint: 'ROUTES' },
  { text: 'Intelligence', label: 'Intelligence preset', hint: 'PRESET' },
];

/** Verb templates offered as prefix completions in suggestCommands. */
const VERB_SUGGESTIONS: Suggestion[] = [
  { text: 'find ', label: 'find <name>', hint: 'SEARCH' },
  { text: 'goto ', label: 'goto <name>', hint: 'SEARCH' },
  { text: 'show ', label: 'show <layer>', hint: 'LAYER' },
  { text: 'hide ', label: 'hide <layer>', hint: 'LAYER' },
  { text: 'flows on', label: 'flows on', hint: 'FLOWS' },
  { text: 'flows off', label: 'flows off', hint: 'FLOWS' },
  { text: 'follow the load', label: 'follow the load', hint: 'DEMO' },
  { text: 'stop demo', label: 'stop demo', hint: 'DEMO' },
  { text: 'what if ', label: 'what if <chokepoint> closes', hint: 'FRAME' },
  { text: 'exit frame', label: 'exit frame', hint: 'FRAME' },
  { text: 'rank chokepoints', label: 'rank chokepoints', hint: 'FRAME' },
  { text: 'compare ', label: 'compare <a> vs <b>', hint: 'ROUTES' },
  { text: 'play', label: 'play', hint: 'TIME' },
  { text: 'pause', label: 'pause', hint: 'TIME' },
  { text: 'now', label: 'now', hint: 'TIME' },
  { text: 'speed 1h', label: 'speed 1h', hint: 'TIME' },
  { text: 'speed 6h', label: 'speed 6h', hint: 'TIME' },
  { text: 'speed 24h', label: 'speed 24h', hint: 'TIME' },
  { text: 'world', label: 'world', hint: 'PRESET' },
  { text: 'freight', label: 'freight', hint: 'PRESET' },
  { text: 'trade', label: 'trade', hint: 'PRESET' },
  { text: 'commodities', label: 'commodities', hint: 'PRESET' },
  { text: 'markets', label: 'markets', hint: 'VIEW' },
  { text: 'brief', label: 'brief', hint: 'SITREP' },
  { text: 'producers of ', label: 'producers of <material>', hint: 'QUERY' },
  { text: 'consumers of ', label: 'consumers of <material>', hint: 'QUERY' },
  { text: 'patterns', label: 'patterns — mined candidates', hint: 'MINER' },
  { text: 'corpus', label: 'corpus — definition of the loaded corpus', hint: 'CORPUS' },
  { text: 'compiler', label: 'compiler — build + conservation report', hint: 'BUILD' },
  { text: 'refusals', label: 'refusals — the refused:* work queue', hint: 'QUEUE' },
  { text: 'warrant', label: 'warrant — why do we believe this?', hint: 'WARRANT' },
  { text: 'network', label: 'network', hint: 'PRESET' },
  { text: 'intelligence', label: 'intelligence', hint: 'PRESET' },
  { text: 'operations', label: 'operations', hint: 'VIEW' },
  { text: 'agents', label: 'agents', hint: 'VIEW' },
  { text: 'scenarios', label: 'scenarios', hint: 'VIEW' },
  { text: 'help', label: 'help', hint: 'HELP' },
];

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function ok(message: string): CommandResult {
  return { ok: true, message };
}
function err(message: string): CommandResult {
  return { ok: false, message };
}

function normalize(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function fmtKm(km: number): string {
  return Math.round(km).toLocaleString('en-US');
}

/** A route without a recorded promise says so — never a made-up figure. */
function fmtPromise(hours: number | undefined): string {
  return hours === undefined ? 'NO PROMISE' : `${Math.round(hours)}H PROMISED`;
}

function pct(u: number): string {
  return `${Math.round(u * 100)}%`;
}

/** find/goto/bare-entity: search, focus the best hit. */
function runFind(api: AppApi, q: string, hintOnMiss: boolean): CommandResult {
  const results = api.search(q);
  if (!results.length) {
    return err(
      hintOnMiss ? `NO MATCH FOR "${q.toUpperCase()}" · ${HINT}` : `NO MATCH FOR "${q.toUpperCase()}"`
    );
  }
  const best = results[0];
  api.focus(best.id);
  return ok(`FOCUS ${best.name.toUpperCase()}`);
}

function setLayers(api: AppApi, ids: LayerId[], visible: boolean): void {
  for (const id of ids) api.setLayerVisible(id, visible);
}

/** Flows matching a commodity term by flow name or commodity name. */
function matchFlows(api: AppApi, term: string): Flow[] {
  const t = term.toLowerCase();
  return api.store.snapshot.flows.filter((f) => {
    if (f.name.toLowerCase().includes(t)) return true;
    const c = api.store.commodity(f.commodityId);
    return !!c && c.name.toLowerCase().includes(t);
  });
}

/** 'show <commodity> flows' / '<commodity> flows'. */
function runCommodityFlows(api: AppApi, term: string): CommandResult {
  const matches = matchFlows(api, term);
  if (!matches.length) return err(`NO FLOWS FOR "${term.toUpperCase()}"`);
  api.setLayerVisible('economy.flows', true);
  api.setFlowMode(true);
  api.focus(matches[0].id);
  const listed = matches.slice(0, 4).map((f) => f.name.toUpperCase());
  const more = matches.length > listed.length ? ` +${matches.length - listed.length}` : '';
  api.events.emit('toast', {
    title: `${term.toUpperCase()} FLOWS · ${matches.length}`,
    body: listed.join(' · ') + more,
    tone: 'info',
  });
  return ok(`${term.toUpperCase()} FLOWS ON · ${matches.length} MATCHED`);
}

/** Resolve a query to a Route via best search hit, else undefined. */
function findRoute(api: AppApi, q: string): Route | undefined {
  for (const r of api.search(q)) {
    const route = api.store.route(r.id);
    if (route) return route;
  }
  return undefined;
}

function runCompare(api: AppApi, aq: string, bq: string): CommandResult {
  const aHit = api.search(aq)[0];
  const bHit = api.search(bq)[0];
  if (!aHit) return err(`NO MATCH FOR "${aq.toUpperCase()}"`);
  if (!bHit) return err(`NO MATCH FOR "${bq.toUpperCase()}"`);
  const a = findRoute(api, aq);
  const b = findRoute(api, bq);
  if (!a || !b) return err('COMPARE NEEDS TWO ROUTES');
  const t = api.clock.simTime;
  const sa = api.store.stateAt(a.id, t);
  const sb = api.store.stateAt(b.id, t);
  const ua = sa.observed === false ? 'UNOBSERVED' : pct(sa.utilization);
  const ub = sb.observed === false ? 'UNOBSERVED' : pct(sb.utilization);
  const line =
    `${a.name.toUpperCase()} ${fmtKm(a.distanceKm)} KM / ${ua} · ` +
    `${b.name.toUpperCase()} ${fmtKm(b.distanceKm)} KM / ${ub}`;
  api.select(a.id, 'command');
  api.events.emit('toast', {
    title: 'ROUTE COMPARISON',
    body:
      `${a.name.toUpperCase()} ${fmtKm(a.distanceKm)} KM · ${fmtPromise(a.estimatedDurationHours)} · ${ua} · ` +
      `${b.name.toUpperCase()} ${fmtKm(b.distanceKm)} KM · ${fmtPromise(b.estimatedDurationHours)} · ${ub}`,
    tone: 'info',
  });
  return ok(line);
}

// ------------------------------------------------------------------
// executeCommand
// ------------------------------------------------------------------

export function executeCommand(api: AppApi, input: string): CommandResult {
  const text = normalize(input);
  if (!text) return err(HINT);
  const lower = text.toLowerCase();

  // -- 8. help
  if (lower === 'help' || lower === '?') return ok(HELP_MESSAGE);

  // -- sitrep: the composed brief
  if (lower === 'brief' || lower === 'sitrep') {
    window.dispatchEvent(new CustomEvent('pe:sitrep-toggle'));
    return ok('SITUATION REPORT — composed from loaded surfaces, basis labeled');
  }

  // -- payload miner: the pattern registry (candidates, never facts)
  if (lower === 'patterns' || lower === 'mine' || lower === 'miner') {
    window.dispatchEvent(new CustomEvent('pe:patterns-toggle'));
    return ok('PATTERN REGISTRY — mined candidates with algorithm · run · build lineage');
  }

  // -- corpus definition: the corpus as a manufactured artifact
  if (lower === 'corpus' || lower === 'definition' || lower === 'corpus definition') {
    window.dispatchEvent(new CustomEvent('pe:corpus-toggle'));
    return ok('CORPUS DEFINITION — declared rules · derived censuses · stated absences');
  }

  // -- compiler console: the build + its conservation report
  if (lower === 'compiler' || lower === 'build' || lower === 'builds') {
    window.dispatchEvent(new CustomEvent('pe:compiler-toggle'));
    return ok('COMPILER CONSOLE — build identity · record census · conservation report');
  }

  // -- warrant graph: why do we believe this? A walkable chain.
  if (lower === 'warrant' || lower === 'why') {
    window.dispatchEvent(new CustomEvent('pe:warrant-toggle'));
    return ok('WARRANT GRAPH — claim → computation → records → sources → build; no score, a chain');
  }

  // -- vocabulary overlay: the OS learnable in thirty seconds
  if (lower === 'keys' || lower === 'vocabulary' || lower === 'vocab') {
    window.dispatchEvent(new CustomEvent('pe:vocab-toggle'));
    return ok('VOCABULARY — the command and keyboard surface, grouped by what it does');
  }

  // -- refusals work queue: what the upstream declined, with remedies
  if (lower === 'refusals' || lower === 'refused' || lower === 'queue') {
    window.dispatchEvent(new CustomEvent('pe:refusals-toggle'));
    return ok('REFUSALS WORK QUEUE — one mechanism per group, one shared remedy, ranked');
  }
  if (lower === 'clear pattern' || lower === 'exit pattern') {
    api.clearMinedPattern();
    return ok('PATTERN CLEARED');
  }

  // -- corpus query: Earth as the visual query surface. Field-based:
  // a producer is a facility whose record DECLARES the commodity in
  // outputs — never a name that looked right.
  const matQuery =
    /^(?:producers?\s+of|who\s+makes|who\s+produces)\s+(.+)$/.exec(lower) ??
    /^(?:consumers?\s+of|who\s+uses|who\s+consumes)\s+(.+)$/.exec(lower);
  if (matQuery) {
    const role: 'producers' | 'consumers' = /^(producers?|who\s+makes|who\s+produces)/.test(lower)
      ? 'producers'
      : 'consumers';
    const term = matQuery[1];
    let best: { id: EntityId; name: string } | null = null;
    let bestScore = -Infinity;
    for (const c of api.store.snapshot.commodities) {
      const s = fuzzyScore(term, c.name);
      if (s !== null && s > bestScore) {
        bestScore = s;
        best = { id: c.id, name: c.name };
      }
    }
    if (!best) return err(`NO COMMODITY MATCHING "${term.toUpperCase()}" IN THE LOADED CORPUS`);
    const n = api.runMaterialQuery(role, best.id);
    if (!n) {
      return ok(
        `0 FACILITIES DECLARE ${best.name.toUpperCase()} AS AN ${role === 'producers' ? 'OUTPUT' : 'INPUT'} — absence of declaration, not proof of absence`
      );
    }
    return ok(`${n} ${role.toUpperCase()} OF ${best.name.toUpperCase()} LIT — the rest of the globe is quieted, not hidden`);
  }
  if (lower === 'clear query' || lower === 'exit query') {
    api.clearQuery();
    return ok('QUERY CLEARED');
  }

  // -- 6. time controls
  if (lower === 'play') {
    api.clock.setPlaying(true);
    return ok('PLAY');
  }
  if (lower === 'pause') {
    api.clock.setPlaying(false);
    return ok('PAUSE');
  }
  if (lower === 'now') {
    api.clock.jumpToNow();
    return ok('SIM TIME → NOW');
  }
  const speed = /^speed\s+(\d+)\s*h(?:ours?)?(?:\/s)?$/.exec(lower);
  if (speed) {
    const hours = parseInt(speed[1], 10);
    if (hours <= 0) return err('SPEED MUST BE > 0');
    api.clock.setSpeed(hours * 3600);
    return ok(`SPEED ${hours}H/S`);
  }

  // -- 3. flow mode
  const flowToggle = /^flows?(?:\s+mode)?\s+(on|off)$/.exec(lower);
  if (flowToggle) {
    const enabled = flowToggle[1] === 'on';
    api.setFlowMode(enabled);
    return ok(enabled ? 'FLOW MODE ON' : 'FLOW MODE OFF');
  }
  if (lower === 'flow mode' || lower === 'flows') {
    const next = !api.getFlowMode();
    api.setFlowMode(next);
    return ok(next ? 'FLOW MODE ON' : 'FLOW MODE OFF');
  }

  // -- 4. demo
  if (lower === 'follow the load' || lower === 'demo') {
    api.startFollowTheLoad();
    return ok('FOLLOW THE LOAD');
  }
  if (lower === 'stop demo' || lower === 'exit' || lower === 'stop') {
    api.stopFollowTheLoad();
    return ok('DEMO STOPPED');
  }

  // -- 4b. counterfactual frames
  if (
    lower === 'rank chokepoints' ||
    lower === 'criticality' ||
    lower === 'rank frames' ||
    lower === 'rank scenarios'
  ) {
    const rows = api.rankScenarios();
    if (!rows.length) return err(api.scenariosUnavailableReason ?? 'NO FRAMES TO RANK');
    api.setPreset('scenarios');
    const top = rows
      .slice(0, 3)
      .map((r, i) => `${i + 1}. ${r.name.toUpperCase()} +${r.summary.totalDelayHours}H`)
      .join(' · ');
    return ok(`CRITICALITY (COMPUTED) · ${top}`);
  }
  if (
    lower === 'exit frame' ||
    lower === 'clear frame' ||
    lower === 'clear scenario' ||
    lower === 'exit scenario'
  ) {
    if (!api.getActiveScenario()) return ok('NO ACTIVE FRAME');
    api.clearScenario();
    return ok('FRAME EXITED — BACK TO THE MIRROR');
  }
  const frameMatch = /^(?:scenario|run frame|what if)\s+(.+)$/.exec(lower);
  if (frameMatch) {
    const q = frameMatch[1].replace(/\b(closes?|closure|closed|shuts?( down)?)\b/g, ' ').trim();
    if (api.scenariosUnavailableReason && !api.listScenarios().length) {
      return err(api.scenariosUnavailableReason);
    }
    const spec = api
      .listScenarios()
      .find((sp) => sp.name.toLowerCase().includes(q) || sp.id.toLowerCase().includes(q));
    if (!spec) return err(`NO FRAME MATCHES "${q.toUpperCase()}"`);
    api.runScenario(spec.id);
    api.setPreset('scenarios');
    return ok(`HYPOTHETICAL FRAME · ${spec.name.toUpperCase()}`);
  }

  // -- 5. bare preset word ('exceptions' remains a legacy alias)
  if (lower === 'exceptions') {
    api.setPreset('intelligence');
    return { ok: true, message: 'PRESET INTELLIGENCE' };
  }
  if (lower === 'ops' || lower === 'tower' || lower === 'control tower' || lower === 'desk') {
    api.setPreset('operations');
    return ok('OPERATIONS — CONTROL TOWER MIRROR');
  }
  if ((PRESETS as string[]).includes(lower)) {
    api.setPreset(lower as ViewPreset);
    return ok(`PRESET ${lower.toUpperCase()}`);
  }

  // -- 2. show / hide
  const showHide = /^(show|hide)\s+(.+)$/.exec(lower);
  if (showHide) {
    const visible = showHide[1] === 'show';
    const thing = showHide[2].trim();

    if (thing === 'everything' || thing === 'all') {
      setLayers(api, [...TRANSPORT_LAYERS, ...INFRA_LAYERS], visible);
      return ok(visible ? 'ALL TRANSPORT + INFRASTRUCTURE ON' : 'ALL TRANSPORT + INFRASTRUCTURE OFF');
    }
    if (thing === 'freight corridors' || thing === 'corridors') {
      setLayers(api, TRANSPORT_LAYERS, visible);
      return ok(visible ? 'FREIGHT CORRIDORS ON' : 'FREIGHT CORRIDORS OFF');
    }

    const layer = LAYER_ALIASES[thing];
    if (layer) {
      api.setLayerVisible(layer, visible);
      if (layer === 'economy.flows') api.setFlowMode(visible);
      return ok(`${LAYER_LABELS[layer]} ${visible ? 'ON' : 'OFF'}`);
    }

    // 'show <commodity> flows'
    const commodityFlows = /^(.+?)\s+flows$/.exec(thing);
    if (visible && commodityFlows) return runCommodityFlows(api, commodityFlows[1]);

    return err(`UNKNOWN LAYER "${thing.toUpperCase()}" · ${HINT}`);
  }

  // -- 7. compare <a> vs <b> / compare routes a and b
  const compare = /^compare\s+(?:routes?\s+)?(.+?)\s+(?:vs\.?|and)\s+(.+)$/.exec(lower);
  if (compare) return runCompare(api, compare[1], compare[2]);

  // -- '<commodity> flows' without the show verb
  const bareFlows = /^(.+?)\s+flows$/.exec(lower);
  if (bareFlows && !LAYER_ALIASES[lower]) return runCommodityFlows(api, bareFlows[1]);

  // -- 1. find / goto
  const find = /^(?:find|goto|go to)\s+(.+)$/.exec(lower);
  if (find) return runFind(api, find[1], false);

  // -- fallback: bare text that matches an entity, else hint
  return runFind(api, text, true);
}

// ------------------------------------------------------------------
// suggestCommands
// ------------------------------------------------------------------

/**
 * Fuzzy match score — one ranking for verbs, layers, presets, and
 * entities alike. Exact > prefix > word-boundary > substring >
 * subsequence (with word-start and consecutive-run bonuses). null =
 * no match. Deterministic, dependency-free.
 */
/** Diacritic fold so 'glog' finds Głogów: NFD strip + the few letters
 *  (ł, ø, đ, æ) that don't decompose into base + combining mark. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/ø/g, 'o')
    .replace(/đ/g, 'd')
    .replace(/æ/g, 'ae');
}

function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query);
  const t = fold(text);
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - t.length * 0.2;
  const word = t.indexOf(' ' + q);
  if (word >= 0) return 800 - word - t.length * 0.1;
  const sub = t.indexOf(q);
  if (sub >= 0) return 700 - sub - t.length * 0.1;
  let ti = 0;
  let score = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found < 0) return null;
    const wordStart = found === 0 || t[found - 1] === ' ' || t[found - 1] === '-';
    run = qi > 0 && found > 0 && t[found - 1] === q[qi - 1] ? run + 1 : 0;
    score += 10 + (wordStart ? 15 : 0) + run * 8 - Math.min(found, 30) * 0.3;
    ti = found + 1;
  }
  return score - t.length * 0.2;
}

/**
 * One fuzzy, ranked palette: verbs, layer toggles, presets, commodity
 * flows, and corpus entities compete in a single scored list instead
 * of three concatenated grammars. Entities are matched over the whole
 * snapshot (a few hundred names — a linear scan is nothing).
 */
export function suggestCommands(api: AppApi, input: string): Suggestion[] {
  const text = normalize(input);
  if (!text) return STARTERS.slice();
  const lower = text.toLowerCase();

  interface Ranked {
    s: Suggestion;
    score: number;
  }
  const ranked: Ranked[] = [];
  const seen = new Set<string>();
  const consider = (s: Suggestion, score: number | null, weight = 0): void => {
    if (score === null) return;
    const key = s.text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ranked.push({ s, score: score + weight });
  };

  // command verbs & templates — a small weight so a typed verb beats a
  // weak entity subsequence, but a strong entity prefix still wins
  for (const v of VERB_SUGGESTIONS) {
    consider(v, fuzzyScore(lower, v.label) ?? fuzzyScore(lower, v.text), 30);
  }

  // layer toggles — matched on the alias itself AND on 'show <alias>'
  const showHide = /^(show|hide)\s+(.*)$/.exec(lower);
  for (const alias of Object.keys(LAYER_ALIASES)) {
    const verb = showHide?.[1] ?? 'show';
    const needle = showHide ? showHide[2] : lower;
    consider(
      {
        text: `${verb} ${alias}`,
        label: `${verb} ${alias}`,
        hint: LAYER_LABELS[LAYER_ALIASES[alias]],
      },
      fuzzyScore(needle, alias),
      showHide ? 60 : -10
    );
  }

  // commodity shortcuts: flows + the corpus query verbs
  for (const c of api.store.snapshot.commodities) {
    const s = fuzzyScore(lower, c.name);
    consider(
      { text: `show ${c.name.toLowerCase()} flows`, label: `show ${c.name} flows`, hint: 'FLOWS' },
      s,
      5
    );
    consider(
      { text: `producers of ${c.name.toLowerCase()}`, label: `producers of ${c.name}`, hint: 'QUERY' },
      s ?? fuzzyScore(lower, `producers of ${c.name}`),
      6
    );
  }

  // corpus entities — fuzzy over the whole snapshot, one scan
  const snap = api.store.snapshot;
  const entity = (name: string, hint: string): void =>
    consider({ text: `find ${name}`, label: name, hint }, fuzzyScore(lower, name), 0);
  for (const n of snap.nodes) entity(n.name, n.kind.replace(/_/g, ' ').toUpperCase());
  for (const r of snap.routes) entity(r.name, r.mode.toUpperCase());
  for (const f of snap.flows) entity(f.name, 'FLOW');

  // the store's own search may catch alias/id matches the name scan missed
  for (const r of api.search(lower).slice(0, 5) as SearchResult[]) {
    consider({ text: `find ${r.name}`, label: r.name, hint: r.kind.toUpperCase() }, 400);
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 12).map((r) => r.s);
}
