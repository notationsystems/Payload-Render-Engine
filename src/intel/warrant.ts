/**
 * Warrant Graph assembler — "why do we believe this?" as a structure.
 *
 * The trustgraph adapted to the honesty discipline: there is NO
 * composite trust score anywhere in this module and never will be.
 * Trust is a chain you can WALK — claim → computation → records →
 * sources → build — and weakness is visible structurally: a claim
 * resting on one representative record looks thin because it is thin;
 * an unobserved state says so; a hypothetical chain terminates at an
 * engine, not at evidence.
 *
 * Layers (left to right):
 *   0 CLAIM        what the OS is showing
 *   1 COMPUTATION  the named process that produced it
 *   2 RECORDS      the corpus records it rests on (capped, stated)
 *   3 SOURCES      distinct provenance sources of those records
 *   4 BUILD        the corpus build — or its honest absence
 *
 * Every node carries a basis from the semantic vocabulary; the panel
 * colors from it. Pure functions over the store — no fetching, no
 * mutation, no renderer imports.
 */

import type { EntityId, Observation, Provenance, Timestamp } from '../data/contracts';
import type { WorldStore } from '../data/store';
import type { MinedPattern, MiningRun } from './miner';
import type { InjectionResult } from '../data/injection';

export type WarrantBasis =
  | 'observed'
  | 'declared'
  | 'computed'
  | 'mined'
  | 'hypothetical'
  | 'representative'
  | 'unobserved'
  | 'source'
  | 'build'
  | 'absent';

export interface WarrantNode {
  id: string;
  layer: 0 | 1 | 2 | 3 | 4;
  label: string;
  sub?: string;
  basis: WarrantBasis;
  /** click → focus this entity on the globe */
  entityRef?: EntityId;
}

export interface WarrantEdge {
  from: string;
  to: string;
  basis: WarrantBasis;
}

export interface WarrantGraphDoc {
  subjectKind: 'selection' | 'pattern' | 'query' | 'injection';
  title: string;
  nodes: WarrantNode[];
  edges: WarrantEdge[];
  /** stated caps and absences — never silent */
  notes: string[];
}

export const WARRANT_LAYER_TITLES = ['CLAIM', 'COMPUTATION', 'RECORDS', 'SOURCES', 'BUILD'] as const;

const RECORD_CAP = 12;

/** Basis of one record from its own provenance — per record, never blanket. */
function recordBasis(p: Provenance | undefined, fallback: WarrantBasis): WarrantBasis {
  if (!p) return fallback;
  if (p.valueKind === 'representative' || p.admissible === false) return 'representative';
  if (p.valueKind === 'reported' || p.valueKind === 'estimated') return 'observed';
  return fallback;
}

interface Ctx {
  nodes: WarrantNode[];
  edges: WarrantEdge[];
  notes: string[];
  sourceIds: Map<string, string>; // source name → node id
}

function ctx(): Ctx {
  return { nodes: [], edges: [], notes: [], sourceIds: new Map() };
}

function add(c: Ctx, n: WarrantNode): string {
  c.nodes.push(n);
  return n.id;
}

function link(c: Ctx, from: string, to: string, basis: WarrantBasis): void {
  c.edges.push({ from, to, basis });
}

/** One SOURCES-layer node per distinct provenance source, deduped. */
function sourceNode(c: Ctx, source: string, count: number): string {
  const existing = c.sourceIds.get(source);
  if (existing) {
    const n = c.nodes.find((x) => x.id === existing);
    if (n) n.sub = `${Number(n.sub?.split(' ')[0] ?? 0) + count} records`;
    return existing;
  }
  const id = `src-${c.sourceIds.size}`;
  c.sourceIds.set(source, id);
  add(c, { id, layer: 3, label: source, sub: `${count} records`, basis: 'source' });
  return id;
}

function buildNode(c: Ctx, buildId: string | undefined): string {
  return add(
    c,
    buildId
      ? { id: 'build', layer: 4, label: buildId, sub: 'corpus build', basis: 'build' }
      : {
          id: 'build',
          layer: 4,
          label: 'UNSTAMPED',
          sub: 'not compiled by the projection service',
          basis: 'absent',
        }
  );
}

// ------------------------------------------------------------------
// Subject: a selected entity — the projection's state claim
// ------------------------------------------------------------------

export function buildSelectionWarrant(
  store: WorldStore,
  entityId: EntityId,
  simTime: Timestamp
): WarrantGraphDoc | null {
  const ent = store.entity(entityId);
  if (!ent) return null;
  const c = ctx();

  const state = store.stateAt(entityId, simTime);
  const observed = state.observed !== false;
  const claim = add(c, {
    id: 'claim',
    layer: 0,
    label: ent.name,
    sub: observed
      ? `state at sim time: ${state.status.toUpperCase()} · util ${Math.round(state.utilization * 100)}%`
      : 'STATE UNOBSERVED at sim time',
    basis: observed ? 'observed' : 'unobserved',
    entityRef: entityId,
  });

  const comp = add(c, {
    id: 'comp',
    layer: 1,
    label: 'stateAt(t) projection',
    sub: observed
      ? 'deterministic read over corpus records'
      : 'answers unobserved — nothing synthesizes a state',
    basis: 'computed',
  });
  link(c, 'claim', 'comp', observed ? 'observed' : 'unobserved');

  // the identity record itself
  const identity = add(c, {
    id: 'rec-identity',
    layer: 2,
    label: `${ent.name} (identity record)`,
    sub: `${'kind' in ent ? String(ent.kind) : 'record'} · known ${ent.provenance.knownAt.slice(0, 10)}`,
    basis: recordBasis(ent.provenance, 'declared'),
    entityRef: entityId,
  });
  link(c, 'comp', identity, 'declared');
  link(c, identity, sourceNode(c, ent.provenance.source, 1), 'source');

  // evidence: observations grouped by metric — bounded by construction
  const obs = store.observationsFor(entityId);
  const byMetric = new Map<string, Observation[]>();
  for (const o of obs) byMetric.set(o.metric, [...(byMetric.get(o.metric) ?? []), o]);
  let shown = 0;
  for (const [metric, list] of [...byMetric.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (shown >= RECORD_CAP) break;
    shown++;
    const latest = list.reduce((a, b) => (a.t > b.t ? a : b));
    const basis = recordBasis(latest.provenance, 'observed');
    const id = add(c, {
      id: `rec-obs-${metric}`,
      layer: 2,
      label: `${list.length} × ${metric} observations`,
      sub: `latest ${latest.t.slice(0, 10)} · ${basis === 'representative' ? 'REPRESENTATIVE — inadmissible' : 'admissible evidence'}`,
      basis,
    });
    link(c, 'comp', id, basis);
    const srcCounts = new Map<string, number>();
    for (const o of list) srcCounts.set(o.provenance.source, (srcCounts.get(o.provenance.source) ?? 0) + 1);
    for (const [s, n] of srcCounts) link(c, id, sourceNode(c, s, n), 'source');
  }
  if (byMetric.size > shown) {
    c.notes.push(`showing ${shown} of ${byMetric.size} observation metrics — capped, stated`);
  }
  if (obs.length === 0) {
    const none = add(c, {
      id: 'rec-noobs',
      layer: 2,
      label: '0 observations',
      sub: 'no evidence records for this entity — absence, not zero activity',
      basis: 'unobserved',
    });
    link(c, 'comp', none, 'unobserved');
  }

  // promises: assertions grouped by metric
  const asserts = store.assertionsFor(entityId);
  if (asserts.length) {
    const aByMetric = new Map<string, number>();
    for (const a of asserts) aByMetric.set(a.metric, (aByMetric.get(a.metric) ?? 0) + 1);
    for (const [metric, n] of aByMetric) {
      const id = add(c, {
        id: `rec-asrt-${metric}`,
        layer: 2,
        label: `${n} × ${metric} assertions`,
        sub: 'promises, not evidence — the deviation join keeps both',
        basis: 'declared',
      });
      link(c, 'comp', id, 'declared');
      const srcCounts = new Map<string, number>();
      for (const a of asserts.filter((x) => x.metric === metric))
        srcCounts.set(a.provenance.source, (srcCounts.get(a.provenance.source) ?? 0) + 1);
      for (const [s, cnt] of srcCounts) link(c, id, sourceNode(c, s, cnt), 'source');
    }
  }

  const build = buildNode(c, store.snapshot.meta.corpusBuild?.id);
  for (const [, sid] of c.sourceIds) link(c, sid, build, 'build');

  const admissible = obs.filter((o) => o.provenance.admissible !== false && o.provenance.valueKind !== 'representative').length;
  if (obs.length) {
    c.notes.push(
      `${admissible} of ${obs.length} observations admissible as real-world evidence — per record, never blanket`
    );
  }

  return { subjectKind: 'selection', title: `WHY THIS STATE — ${ent.name}`, nodes: c.nodes, edges: c.edges, notes: c.notes, };
}

// ------------------------------------------------------------------
// Subject: a mined pattern — candidate, never fact
// ------------------------------------------------------------------

export function buildPatternWarrant(
  store: WorldStore,
  pattern: MinedPattern,
  run: MiningRun
): WarrantGraphDoc {
  const c = ctx();
  add(c, {
    id: 'claim',
    layer: 0,
    label: pattern.statement,
    sub: `MINED CANDIDATE · score ${pattern.score.toFixed(2)} — ${pattern.scoreBasis}`,
    basis: 'mined',
    entityRef: pattern.entities[0],
  });
  const comp = add(c, {
    id: 'comp',
    layer: 1,
    label: `${pattern.algorithm}@${pattern.algorithmVersion}`,
    sub: `run ${run.miningRunId} · deterministic over declared fields`,
    basis: 'mined',
  });
  link(c, 'claim', 'comp', 'mined');

  const records = pattern.supportingRecords.slice(0, RECORD_CAP);
  for (const rid of records) {
    const ent = store.entity(rid);
    const basis: WarrantBasis = ent ? recordBasis(ent.provenance, 'declared') : 'declared';
    const id = add(c, {
      id: `rec-${rid}`,
      layer: 2,
      label: ent?.name ?? rid,
      sub: ent && 'kind' in ent ? String(ent.kind) : 'supporting record',
      basis,
      entityRef: ent ? rid : undefined,
    });
    link(c, comp, id, basis);
    if (ent) link(c, id, sourceNode(c, ent.provenance.source, 1), 'source');
  }
  if (pattern.supportingRecords.length > records.length) {
    c.notes.push(
      `showing ${records.length} of ${pattern.supportingRecords.length} supporting records — capped, stated`
    );
  }
  const build = buildNode(c, pattern.corpusBuildId === 'unstamped-corpus' ? undefined : pattern.corpusBuildId);
  for (const [, sid] of c.sourceIds) link(c, sid, build, 'build');
  c.notes.push('a mined pattern is a CANDIDATE — validation is a person or a stricter process, never the miner');
  return { subjectKind: 'pattern', title: 'WHY THIS PATTERN — MINED, NOT OBSERVED', nodes: c.nodes, edges: c.edges, notes: c.notes };
}

// ------------------------------------------------------------------
// Subject: a corpus query result — declared fields, never names
// ------------------------------------------------------------------

export function buildQueryWarrant(
  store: WorldStore,
  role: 'producers' | 'consumers',
  commodityId: EntityId,
  label: string
): WarrantGraphDoc {
  const c = ctx();
  const field = role === 'producers' ? 'outputs' : 'inputs';
  // recompute the matched set by the SAME declared-field rule the
  // query ran — no cached ids, no drift
  const matched = store.snapshot.nodes.filter((n) =>
    ((field === 'outputs' ? n.outputs : n.inputs) ?? []).includes(commodityId)
  );
  add(c, {
    id: 'claim',
    layer: 0,
    label,
    sub: `${matched.length} facilities lit — emphasis, not filter`,
    basis: 'declared',
  });
  add(c, {
    id: 'comp',
    layer: 1,
    label: `field match — ${field} ∋ ${commodityId}`,
    sub: 'declared corpus field; a name that merely looks right never matches',
    basis: 'computed',
  });
  link(c, 'claim', 'comp', 'declared');
  for (const n of matched.slice(0, RECORD_CAP)) {
    const basis = recordBasis(n.provenance, 'declared');
    const id = add(c, {
      id: `rec-${n.id}`,
      layer: 2,
      label: n.name,
      sub: `${String(n.kind)} · declares ${commodityId.split(':').pop()} in ${field}`,
      basis,
      entityRef: n.id,
    });
    link(c, 'comp', id, basis);
    link(c, id, sourceNode(c, n.provenance.source, 1), 'source');
  }
  if (matched.length > RECORD_CAP) {
    c.notes.push(`showing ${RECORD_CAP} of ${matched.length} matched facilities — capped, stated`);
  }
  const build = buildNode(c, store.snapshot.meta.corpusBuild?.id);
  for (const [, sid] of c.sourceIds) link(c, sid, build, 'build');
  return { subjectKind: 'query', title: `WHY THIS RESULT SET — ${label}`, nodes: c.nodes, edges: c.edges, notes: c.notes };
}

// ------------------------------------------------------------------
// Subject: a what-if injection — the chain ends at an engine
// ------------------------------------------------------------------

export function buildInjectionWarrant(store: WorldStore, result: InjectionResult): WarrantGraphDoc {
  const c = ctx();
  const impact = result.scenarioImpacts[0];
  add(c, {
    id: 'claim',
    layer: 0,
    label: impact?.eventTitle ?? result.counterfactualFrame.scenarioLabel,
    sub: `HYPOTHETICAL · ${impact ? `${impact.affected.length} affected downstream` : 'no propagation'}`,
    basis: 'hypothetical',
    entityRef: impact?.entityId,
  });
  const comp = add(c, {
    id: 'comp',
    layer: 1,
    label: 'terminal scenario engine (upstream)',
    sub: `frame ${result.counterfactualFrame.kind} · knowledge ${result.counterfactualFrame.knowledge} · ${result.counterfactualFrame.scenarioId}`,
    basis: 'hypothetical',
  });
  link(c, 'claim', 'comp', 'hypothetical');
  const ids = impact ? [impact.entityId, ...impact.affected.map((a) => a.entityId)] : [];
  let unresolved = 0;
  for (const id of ids.slice(0, RECORD_CAP)) {
    const ent = store.entity(id);
    if (!ent) {
      unresolved++;
      continue;
    }
    const nid = add(c, {
      id: `rec-${id}`,
      layer: 2,
      label: ent.name,
      sub: `declared structure · state UNOBSERVED at sim time`,
      basis: 'declared',
      entityRef: id,
    });
    link(c, comp, nid, 'hypothetical');
    link(c, nid, sourceNode(c, ent.provenance.source, 1), 'source');
  }
  if (ids.length > RECORD_CAP) c.notes.push(`showing ${RECORD_CAP} of ${ids.length} frame entities — capped, stated`);
  if (unresolved) c.notes.push(`${unresolved} frame entities not in the loaded corpus — upstream knows them, this projection does not`);
  add(c, {
    id: 'build',
    layer: 4,
    label: 'NO CORPUS BUILD',
    sub: 'computed upstream over upstream state — not a projection of this build',
    basis: 'absent',
  });
  for (const [, sid] of c.sourceIds) link(c, sid, 'build', 'hypothetical');
  c.notes.push('this chain terminates at an ENGINE, not at evidence — a simulated outcome is not an outcome');
  return { subjectKind: 'injection', title: 'WHY THIS HYPOTHETICAL — AND WHY IT IS ONLY THAT', nodes: c.nodes, edges: c.edges, notes: c.notes };
}
