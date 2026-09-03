/**
 * SECURITY — the security model as an operator surface.
 *
 * A control that nobody can see is a control that silently stops
 * working. This panel is the readable twin of docs/SECURITY.md: it
 * shows the policy actually in force, the invariant ledger, and the
 * refusals the gate has issued — as facts read from the running
 * system, never as a badge.
 *
 * Three disciplines, all of them the ones this OS already lives by:
 *
 *   NO WALL OF GREEN. The headline is a three-way split — enforced /
 *   deployment / absent — and the ABSENT rows carry their reason and
 *   what would unblock them, exactly like a refusal carries a remedy.
 *   A security surface that shows only what works is a marketing page.
 *
 *   OBSERVED HERE vs IN FORCE THERE. The client half (CSP, API base,
 *   browser storage) is observed in THIS browser; the service half is
 *   read from the gate. Neither speaks for the other, and the surface
 *   says which is which. A green client half proves nothing about the
 *   service.
 *
 *   THE JOURNAL STATES ITS WINDOW. Zero refusals since service start
 *   is an observed zero for that window — never "nothing has ever
 *   happened". Absence is not zero.
 *
 * Every value rendered here is escaped: the journal's detail fields
 * carry attacker-controlled text by construction (a rejected Host, a
 * rejected Origin), which is the whole point of showing them.
 */

import { esc, pick } from '../core/escape';
import type { AppApi } from '../app/api';
import {
  fetchPosture,
  observeClient,
  STORAGE_ALLOWLIST,
  type ClientObservation,
  type PostureResult,
  type SecurityInvariant,
  type SecurityJournalWindow,
} from '../data/security';

const DOMAIN_ORDER = ['transport', 'authority', 'agent', 'rendering', 'integrity'] as const;

const DOMAIN_BLURB: Record<string, string> = {
  transport: 'who may reach this service, and how',
  authority: 'what credentials exist, and where they are allowed to travel',
  agent: 'what a non-deterministic caller may reach',
  rendering: 'the renderer is the last line for upstream text',
  integrity: 'abuse resistance, and whether an answer can be trusted later',
};

/** Refusal kinds worth reading as a probe rather than a mistake. */
const PROBE_KINDS = new Set(['HOST_NOT_ALLOWED', 'ORIGIN_NOT_ALLOWED', 'HANDLER_FAULT']);

export function createSecurityPanel(_api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  // pe-corpus carries the overlay geometry + the Esc guard; pe-security
  // restyles to a ledger identity — steel, not alarm
  el.className = 'pe-corpus pe-security';
  el.hidden = true;

  // ---------------------------------------------------------- pieces

  const row = (k: string, v: string): string =>
    `<div class="pe-corpus-row"><span class="pe-corpus-k">${esc(k)}</span><span class="pe-corpus-v">${v}</span></div>`;

  const clientHtml = (c: ClientObservation): string => {
    // SEC-170 read from the document that actually loaded, not from
    // the source we hope was served
    const csp = c.csp.present
      ? row(
          'CSP',
          `<span class="pe-sec-pill enforced">PRESENT</span> script-src <b>${esc(c.csp.scriptSrc ?? '(unset)')}</b> · ${c.csp.directives.length} directives`
        )
      : row(
          'CSP',
          `<span class="pe-sec-pill absent">ABSENT</span> no policy reached this document — the built bundle is unprotected against what an injection could do with itself`
        );

    const base = c.apiBase.refusal
      ? row(
          'API BASE',
          `<span class="pe-sec-pill absent">REFUSED</span> ${esc(c.apiBase.refusal)}`
        )
      : row('API BASE', `<span class="pe-sec-pill enforced">ALLOWLISTED</span> ${esc(c.apiBase.inForce)}`);

    const rogue = c.storage.filter((s) => !s.allowed);
    const storage = !c.storageReadable
      ? row(
          'STORAGE',
          '<span class="pe-sec-pill deployment">UNREADABLE</span> this browser blocks site data — cannot see, which is not the same answer as nothing is there'
        )
      : c.storage.length === 0
        ? row('STORAGE', `<span class="pe-sec-pill enforced">EMPTY</span> 0 keys — an observed zero`)
        : `${row(
            'STORAGE',
            rogue.length === 0
              ? `<span class="pe-sec-pill enforced">${c.storage.length} KEYS, ALL ALLOWLISTED</span>`
              : `<span class="pe-sec-pill absent">${rogue.length} UNLISTED KEY${rogue.length === 1 ? '' : 'S'}</span> SEC-005 permits only ${STORAGE_ALLOWLIST.join(', ')}`
          )}${c.storage
            .map(
              (s) =>
                `<div class="pe-sec-storage${s.allowed ? '' : ' rogue'}"><span>${esc(s.key)}</span><span>${s.bytes}B ${s.allowed ? 'allowlisted' : 'UNLISTED'}</span></div>`
            )
            .join('')}`;

    return `
      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">OBSERVED HERE — this browser, right now</div>
        <div class="pe-sec-note">Proven by looking, not by trusting the source: the policy that actually reached this document, the base actually in force, and every key actually in storage.</div>
        ${csp}${base}${storage}
      </div>`;
  };

  const ledgerHtml = (invariants: SecurityInvariant[]): string =>
    DOMAIN_ORDER.map((domain) => {
      const rows = invariants.filter((i) => i.domain === domain);
      if (rows.length === 0) return '';
      return `
      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">${esc(domain.toUpperCase())} — ${esc(DOMAIN_BLURB[domain] ?? '')}</div>
        ${rows
          .map((i) => {
            // SEC-122 — the class is whitelisted, never interpolated
            const state = pick(i.state, ['ENFORCED', 'DEPLOYMENT', 'ABSENT'], 'ABSENT');
            const tone = state === 'ENFORCED' ? 'enforced' : state === 'DEPLOYMENT' ? 'deployment' : 'absent';
            return `
          <div class="pe-sec-inv ${tone}">
            <div class="pe-sec-invhead">
              <span class="pe-sec-id">${esc(i.id)}</span>
              <span class="pe-sec-pill ${tone}">${esc(state)}</span>
              ${i.check ? `<span class="pe-sec-check">check: ${esc(i.check)}</span>` : ''}
            </div>
            <div class="pe-sec-statement">${esc(i.statement)}</div>
            ${i.reason ? `<div class="pe-sec-reason">WHY NOT HERE — ${esc(i.reason)}</div>` : ''}
            ${i.unblockedBy ? `<div class="pe-corpus-remedy">UNBLOCKED BY: ${esc(i.unblockedBy)}</div>` : ''}
          </div>`;
          })
          .join('')}
      </div>`;
    }).join('');

  const journalHtml = (j: SecurityJournalWindow): string => {
    const kinds = Object.entries(j.byKind ?? {});
    const head = `
      <div class="pe-sec-note">Window: since ${esc((j.since ?? '').slice(0, 19) || 'unstated')}Z — ${j.recorded} refusal${j.recorded === 1 ? '' : 's'} recorded, ${j.retained} retained of ${j.capacity}${j.dropped ? `, ${j.dropped} dropped (the ring is bounded on purpose)` : ''}. This describes THIS process only; a restart resets the window.</div>`;
    if (j.recorded === 0) {
      return `${head}<div class="pe-corpus-census">0 refusals in this window — an observed zero, not a claim that nothing has ever been refused</div>`;
    }
    const chips = kinds
      .map(
        ([kind, n]) =>
          `<span class="pe-sec-kind${PROBE_KINDS.has(kind) ? ' probe' : ''}">${esc(kind.replace(/_/g, ' '))} ${n}</span>`
      )
      .join('');
    const entries = (j.entries ?? [])
      .map(
        (e) => `
      <div class="pe-sec-event${PROBE_KINDS.has(e.kind) ? ' probe' : ''}">
        <span class="pe-sec-eseq">#${e.seq}</span>
        <span class="pe-sec-ekind">${esc(e.kind.replace(/_/g, ' '))}</span>
        <span class="pe-sec-epath">${esc(e.path ?? '—')}</span>
        <span class="pe-sec-edetail">${esc(e.detail ?? '')}</span>
        <span class="pe-sec-eat">${esc(e.at.slice(11, 19))}Z</span>
      </div>`
      )
      .join('');
    return `${head}<div class="pe-sec-kinds">${chips}</div>${entries}`;
  };

  const postureHtml = (r: PostureResult): string => {
    if (!r.ok) {
      return `
      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">IN FORCE AT THE GATE</div>
        <div class="pe-corpus-absent">${esc(r.kind.replace(/_/g, ' '))} — ${esc(r.message)}</div>
        <div class="pe-corpus-remedy">REMEDY: ${esc(r.remedy)}</div>
        <div class="pe-sec-note">The client half above is still observed and still true. It says nothing about the service, and the surface will not pretend otherwise.</div>
      </div>`;
    }
    const p = r.posture;
    // SEC-110 admits any LOOPBACK backend, so the posture is not
    // trusted structurally either: a missing or malformed field must
    // degrade one row, never blank the whole security surface.
    const list = (v: unknown, absent = 'not reported'): string =>
      Array.isArray(v) && v.length ? esc(v.map(String).join(' · ')) : `<em class="pe-sec-hint">${esc(absent)}</em>`;
    const auth = (p.authority ?? [])
      .map(
        (a) =>
          `<div class="pe-sec-auth"><span class="pe-sec-pill ${a.state === 'PRESENT' ? 'enforced' : 'deployment'}">${esc(a.state)}</span><span>${esc(a.variable)}</span><span>${esc(a.purpose)}</span></div>`
      )
      .join('');
    const limits = p.limits
      ? Object.entries(p.limits)
          .map(([cls, l]) => `${esc(cls)} ${l.capacity} burst / ${l.refillPerSec}s⁻¹`)
          .join(' · ')
      : 'not reported';
    const caps = Object.entries(p.upstreamCaps ?? {})
      .map(([k, v]) => `${esc(k)} ${(v / 1024 / 1024).toFixed(0)}MiB`)
      .join(' · ');

    return `
      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">IN FORCE AT THE GATE — read from the running service</div>
        ${row('METHODS', `${list(p.policy?.methodsServed)} <span class="pe-sec-hint">a read-only projection answers nothing else</span>`)}
        ${row('ORIGINS', `${list(p.policy?.allowedOrigins)} <span class="pe-sec-hint">${p.policy?.wildcardCors ? 'WILDCARD — this is a defect' : 'allowlist, never a wildcard'}</span>`)}
        ${row(
          'HOSTS',
          `${list(p.policy?.allowedHosts)}<div class="pe-sec-note">${esc(p.policy?.hostPolicy ?? 'policy not reported')} · DNS-rebinding defence. These are Host HEADER values the gate answers to, which is a different question from the address it binds — 0.0.0.0 as a header is meaningless and harmless, as a bind address it means every interface and is refused at startup without an explicit policy (SEC-106).</div>`
        )}
        ${row('PRIVILEGED', `${list(p.policy?.privilegedPrefixes)} <span class="pe-sec-hint">fail closed on an unrecognised origin, before authority is spent</span>`)}
        ${row('RATE LIMIT', esc(limits))}
        ${row('UPSTREAM CAPS', `${caps} <span class="pe-sec-hint">streamed with a byte counter, cancelled at the cap</span>`)}
        ${row('TLS VERIFY', esc(p.policy?.tlsVerification ?? 'not reported'))}
      </div>
      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">AUTHORITY — presence only, never a value (SEC-013)</div>
        ${auth}
        <div class="pe-sec-note">Every credential this service holds is server-side. None of them is returned to a client, and none reaches an agent context.</div>
      </div>
      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">REFUSAL JOURNAL — what the gate actually stopped</div>
        ${!p.events || 'status' in p.events ? `<div class="pe-corpus-absent">${esc((p.events as { reason?: string })?.reason ?? 'the service returned no journal')}</div>` : journalHtml(p.events)}
      </div>
      ${ledgerHtml(p.invariants ?? [])}`;
  };

  // ---------------------------------------------------------- render

  const render = async (): Promise<void> => {
    const client = observeClient();
    const shell = (body: string, counts?: { enforced: number; deployment: number; absent: number }): string => `
      <div class="pe-patterns-head">
        <span class="pe-sec-kicker">SECURITY</span>
        <span class="pe-patterns-title">SECURITY POSTURE</span>
        ${
          counts
            ? `<span class="pe-sec-split"><b class="enforced">${counts.enforced} ENFORCED</b> · <b class="deployment">${counts.deployment} DEPLOYMENT</b> · <b class="absent">${counts.absent} ABSENT</b></span>`
            : ''
        }
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-sec-banner">The security model as facts, not a badge. Enforced means a named check proves it. Deployment means the control is real but belongs to whatever runs this, not to this process. Absent means it does not exist here — with the reason, and what would unblock it.</div>
      <div class="pe-corpus-body">${body}</div>`;

    el.innerHTML = shell(`${clientHtml(client)}<div class="pe-patterns-lineage">READING THE GATE…</div>`);
    el.querySelector('.pe-patterns-x')?.addEventListener('click', () => setOpen(false));

    const result = await fetchPosture();
    if (el.hidden) return;
    el.innerHTML = shell(
      `${clientHtml(client)}${postureHtml(result)}`,
      result.ok ? result.posture.counts : undefined
    );
    el.querySelector('.pe-patterns-x')?.addEventListener('click', () => setOpen(false));
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) void render();
  };

  window.addEventListener('pe:security-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    // consumed — the Esc ladder in main.ts must not also fire
    e.stopImmediatePropagation();
  });

  return { el };
}
