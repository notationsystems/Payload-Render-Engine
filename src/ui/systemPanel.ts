/**
 * SYSTEM — the control plane, with Payload as its first deeply
 * modeled ecosystem node.
 *
 * Four things, all from live facts:
 *   OPERATOR STRIP  what is healthy · stale · awaiting authority · blocked
 *                   (probed now, latency measured, staleness stated)
 *   TOPOLOGY        renderer → spatial API → upstreams → external sources,
 *                   from the service's own declared model + this renderer
 *   CAPABILITIES    per capability: probe health + latency, authority
 *                   PRESENT/ABSENT (never a value), provenance, the
 *                   action ladder observed → proposed → approved →
 *                   dispatched, and the instrument that opens it
 *   TIMELINE        the session journal — who/what requested what, and
 *                   that nothing was dispatched
 *
 * The ladder rule is the surface's spine: a cell lights only from a
 * recorded fact. This backend stops at approved; the UI never implies
 * an action happened when only a computation or an authorization did.
 * The globe behind this panel remains the spatial/temporal dock — the
 * panel controls the system that feeds it.
 */

import { esc } from '../core/escape';
import type { AppApi } from '../app/api';
import { resolveApiBase } from '../data/sources';
import {
  fetchTopology,
  opsLadderFromTower,
  probeCapability,
  type Capability,
  type EcosystemModel,
  type LadderCell,
  type Probe,
} from '../data/control';
import { fetchOperations } from '../data/operations';
import { feedHealth } from '../core/health';
import { journal, onJournal } from '../core/journal';


const STALE_AFTER_MS = 5 * 60_000;

const HEALTH_TONE: Record<Probe['health'], string> = {
  healthy: 'ok',
  'awaiting-authority': 'warn',
  blocked: 'alert',
  unsupported: 'dim',
  refused: 'warn',
  unreachable: 'alert',
};

export function createSystemPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-corpus pe-system';
  el.hidden = true;

  let model: EcosystemModel | null = null;
  let probes = new Map<string, Probe>();
  let opsLadder: ReturnType<typeof opsLadderFromTower> | null = null;
  let opsLadderNote = '';
  let probedAt: number | null = null;

  const openInstrument = (instrument: string): void => {
    setOpen(false);
    switch (instrument) {
      case 'compiler': window.dispatchEvent(new CustomEvent('pe:compiler-toggle')); break;
      case 'corpus': window.dispatchEvent(new CustomEvent('pe:corpus-toggle')); break;
      case 'patterns': window.dispatchEvent(new CustomEvent('pe:patterns-toggle')); break;
      case 'refusals': window.dispatchEvent(new CustomEvent('pe:refusals-toggle')); break;
      case 'security': window.dispatchEvent(new CustomEvent('pe:security-toggle')); break;
      case 'scenarios': api.setPreset('scenarios'); break;
      case 'operations': api.setPreset('operations'); break;
      case 'markets': api.setPreset('markets'); break;
      case 'layers': api.setLayerVisible('live.seismic', true); api.setLayerVisible('live.aircraft', true); break;
      default: break;
    }
  };

  const refresh = async (): Promise<void> => {
    const base = resolveApiBase();
    model = await fetchTopology(base);
    if (!model) {
      render();
      return;
    }
    const results = await Promise.all(model.capabilities.map((c) => probeCapability(base, c)));
    probes = new Map(results.map((p) => [p.capabilityId, p]));
    probedAt = Date.now();
    // the operations ladder from journal facts — only when the desk answers
    const ops = await fetchOperations(base);
    if (ops.kind === 'ok') {
      opsLadder = opsLadderFromTower(ops.snapshot.loads);
      opsLadderNote = '';
    } else {
      opsLadder = null;
      opsLadderNote = ops.kind === 'refused' ? `${ops.refusal.kind}: ${ops.refusal.message}` : ops.note;
    }
    render();
  };

  // ---- topology as a four-column SVG --------------------------------
  const COLS: Record<string, number> = { renderer: 0, service: 1, store: 1, upstream: 2, tool: 2, source: 3 };
  const COL_X = [10, 250, 500, 750];
  const COL_W = [200, 210, 210, 210];
  const COL_TITLES = ['RENDERER', 'SPATIAL API · CORPUS', 'UPSTREAMS', 'EXTERNAL SOURCES'];
  const ROW_H = 44;
  const NODE_H = 34;

  const topologySvg = (m: EcosystemModel): string => {
    const nodes = [
      { id: 'renderer', kind: 'renderer' as const, label: 'Payload Earth (this OS)', role: 'projection · never mutates · tool surface for agents', url: null },
      ...m.nodes,
    ];
    const edges = [
      { from: 'renderer', to: m.ecosystem.firstNode, relation: 'consumes the public contract' },
      ...m.edges,
    ];
    const rows = [0, 0, 0, 0];
    const pos = new Map<string, { x: number; y: number; w: number }>();
    for (const n of nodes) {
      const c = COLS[n.kind] ?? 3;
      pos.set(n.id, { x: COL_X[c], y: 24 + rows[c] * ROW_H, w: COL_W[c] });
      rows[c]++;
    }
    const height = 24 + Math.max(...rows) * ROW_H + 8;
    const nodeHealth = (id: string): string => {
      // a node is as healthy as its capabilities say
      const caps = m.capabilities.filter((c) => c.node === id);
      if (!caps.length) return 'var(--text-dim)';
      const classes = caps.map((c) => probes.get(c.id)?.health);
      if (classes.some((h) => h === 'blocked' || h === 'unreachable')) return 'var(--alert)';
      if (classes.some((h) => h === 'awaiting-authority' || h === 'refused')) return 'var(--warn)';
      if (classes.every((h) => h === 'healthy' || h === 'unsupported')) return 'var(--ok)';
      return 'var(--text-dim)';
    };
    const svgEdges = edges
      .map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return '';
        const x1 = a.x + a.w;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        const inactive = 'when' in e && typeof e.when === 'string' && e.when.startsWith('inactive');
        return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="rgba(140,180,220,${inactive ? 0.18 : 0.45})" stroke-width="1"${inactive ? ' stroke-dasharray="3 4"' : ''}><title>${esc(e.relation)}${'when' in e && e.when ? ` — ${esc(String(e.when))}` : ''}</title></path>`;
      })
      .join('');
    const svgNodes = nodes
      .map((n) => {
        const p = pos.get(n.id)!;
        const stroke = n.kind === 'renderer' ? 'var(--text-hi)' : nodeHealth(n.id);
        return `<g><title>${esc(n.label)} — ${esc(n.role)}${n.url ? ` · ${esc(n.url)}` : ''}</title>
          <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${NODE_H}" rx="3" fill="rgba(10,16,26,0.85)" stroke="${stroke}" stroke-opacity="0.85"/>
          <text x="${p.x + 8}" y="${p.y + 14}" class="pe-w-label" fill="var(--text-hi)">${esc(n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label)}</text>
          <text x="${p.x + 8}" y="${p.y + 26}" class="pe-w-sub">${esc(n.role.length > 38 ? `${n.role.slice(0, 37)}…` : n.role)}</text></g>`;
      })
      .join('');
    const headers = COL_TITLES.map((t, i) => `<text x="${COL_X[i]}" y="12" class="pe-w-coltitle">${t}</text>`).join('');
    return `<svg viewBox="0 0 980 ${height}" width="100%" style="min-width:760px" xmlns="http://www.w3.org/2000/svg">${headers}${svgEdges}${svgNodes}</svg>`;
  };

  // ---- the action ladder, never implying dispatch -------------------
  const ladderHtml = (cap: Capability): string => {
    const cell = (name: string, v: LadderCell, count?: number): string => {
      if (v === 'from journal') {
        if (!opsLadder) return `<span class="pe-sys-cell dim" title="${esc(opsLadderNote || 'journal not read')}">${name} —</span>`;
        const n = count ?? 0;
        return `<span class="pe-sys-cell ${n > 0 ? 'on' : ''}">${name} ${n}</span>`;
      }
      return `<span class="pe-sys-cell ${v ? 'on' : ''}">${name}${v ? ' ●' : ' —'}</span>`;
    };
    const l = cap.ladder;
    const fromJournal = l.proposed === 'from journal';
    return `<div class="pe-sys-ladder" title="${esc(l.note)}">
      ${cell('OBSERVED', l.observed, opsLadder?.observed)}
      <i>→</i>${cell('PROPOSED', l.proposed, opsLadder?.proposed)}
      <i>→</i>${cell('APPROVED', l.approved, opsLadder?.approved)}
      <i>→</i>${cell('DISPATCHED', l.dispatched, opsLadder?.dispatched)}
    </div>
    <div class="pe-sys-note">${esc(fromJournal && opsLadder ? opsLadder.basis : l.note)}</div>`;
  };

  const render = (): void => {
    const head = `
      <div class="pe-patterns-head">
        <span class="pe-corpus-kicker">SYSTEM</span>
        <span class="pe-patterns-title">CONTROL PLANE · ${esc(model?.ecosystem.label.toUpperCase() ?? 'PAYLOAD')}</span>
        <span class="pe-patterns-count">${probedAt ? `PROBED ${Math.round((Date.now() - probedAt) / 1000)}S AGO` : 'PROBING…'}</span>
        <button type="button" class="pe-query-chip pe-sys-reprobe" title="probe every capability again">RE-PROBE</button>
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>`;
    if (!model) {
      el.innerHTML = `${head}<div class="pe-corpus-body">
        <div class="pe-corpus-absent">${probedAt === null && api.getDataSourceId() !== 'payload-spatial-api' ? 'the in-browser corpus has no service to control — the control plane models the spatial API and its upstreams' : 'the spatial API did not answer /api/system/topology'}</div>
        <div class="pe-corpus-remedy">REMEDY: run against the spatial API (?api=&lt;base&gt;) — GET /api/system/topology serves the ecosystem model</div>
      </div>`;
      wire();
      return;
    }

    // operator strip — the four questions, answered from probes + ledger age
    const list = [...probes.values()];
    const healthy = list.filter((p) => p.health === 'healthy').length;
    const awaiting = list.filter((p) => p.health === 'awaiting-authority').length;
    const blocked = list.filter((p) => p.health === 'blocked' || p.health === 'unreachable').length;
    const stale = feedHealth().filter((f) => {
      const last = f.samples.at(-1);
      return last && Date.now() - last.t > STALE_AFTER_MS;
    }).length;
    const strip = `
      <div class="pe-sys-strip">
        <div class="pe-sys-kpi ok"><b>${healthy}</b><span>HEALTHY</span></div>
        <div class="pe-sys-kpi ${stale ? 'warn' : ''}"><b>${stale}</b><span>STALE FEEDS</span></div>
        <div class="pe-sys-kpi ${awaiting ? 'warn' : ''}"><b>${awaiting}</b><span>AWAITING AUTHORITY</span></div>
        <div class="pe-sys-kpi ${blocked ? 'alert' : ''}"><b>${blocked}</b><span>BLOCKED</span></div>
        <div class="pe-sys-kpi dim"><b>—</b><span>COST · ${esc(model.cost.status)}</span></div>
      </div>
      <div class="pe-sys-note">${esc(model.ladderRule)} · stale = a feed whose last ledger sample is older than ${STALE_AFTER_MS / 60000} min · cost: ${esc(model.cost.reason)}</div>`;

    // capabilities table
    const rows = model.capabilities
      .map((c) => {
        const p = probes.get(c.id);
        const tone = p ? HEALTH_TONE[p.health] : 'dim';
        const auth = c.authority
          ? `<span class="pe-sys-auth ${c.authority.present ? 'ok' : 'warn'}">${esc(c.authority.required)} ${c.authority.present ? 'PRESENT' : 'ABSENT'}</span>`
          : '<span class="pe-sys-auth dim">no authority required</span>';
        return `
        <div class="pe-sys-row">
          <div class="pe-sys-row-head">
            <span class="pe-sys-health ${tone}" title="${esc(p?.detail ?? 'not probed')}">${esc((p?.health ?? 'unprobed').toUpperCase())}</span>
            <span class="pe-sys-family">${esc(c.family)}</span>
            <span class="pe-sys-label">${esc(c.label)}</span>
            <span class="pe-sys-lat">${p?.latencyMs !== null && p?.latencyMs !== undefined ? `${p.latencyMs} MS` : '—'}</span>
            <button type="button" class="pe-query-chip pe-sys-open" data-instrument="${esc(c.instrument)}" title="open the instrument for this capability">OPEN</button>
          </div>
          <div class="pe-sys-meta">${auth} · PROVENANCE ${esc(c.provenance)} · ROUTES ${c.routes.map(esc).join(' · ')} · DOMAINS ${c.dataDomains.map(esc).join(', ')}</div>
          ${ladderHtml(c)}
          ${p && p.health !== 'healthy' ? `<div class="pe-sys-detail">${esc(p.detail)}</div>` : ''}
        </div>`;
      })
      .join('');

    // timeline
    const entries = journal().slice(0, 25);
    const timeline = entries.length
      ? entries
          .map(
            (e) =>
              `<div class="pe-corpus-row"><span class="pe-corpus-k">${esc(e.at.slice(11, 19))}Z · ${esc(e.source.toUpperCase())}</span><span class="pe-corpus-v">${esc(e.kind)} — ${esc(e.summary)} <span class="pe-sys-disp">DISPATCHED: ${esc(e.dispatched)}</span></span></div>`
          )
          .join('')
      : '<div class="pe-corpus-census">no events this session yet — the journal starts empty and says so</div>';

    el.innerHTML = `${head}
      <div class="pe-corpus-body">
        ${strip}
        <div class="pe-corpus-sec"><div class="pe-corpus-sectitle">LIVE TOPOLOGY — declared by the service, probed by this OS; node color = its capabilities' health</div>${topologySvg(model)}</div>
        <div class="pe-corpus-sec"><div class="pe-corpus-sectitle">CAPABILITIES — probe · authority · provenance · action ladder</div>${rows}</div>
        <div class="pe-corpus-sec"><div class="pe-corpus-sectitle">TIMELINE — session journal (${journal().length} events) · who/what requested · what was dispatched</div>${timeline}</div>
      </div>`;
    wire();
  };

  const wire = (): void => {
    el.querySelector('.pe-patterns-x')?.addEventListener('click', () => setOpen(false));
    el.querySelector('.pe-sys-reprobe')?.addEventListener('click', () => void refresh());
    for (const b of el.querySelectorAll('.pe-sys-open')) {
      b.addEventListener('click', () => openInstrument((b as HTMLElement).dataset.instrument ?? ''));
    }
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) {
      render();
      void refresh();
    }
  };

  window.addEventListener('pe:system-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    e.stopImmediatePropagation();
  });
  onJournal(() => {
    if (!el.hidden) render();
  });

  return { el };
}
