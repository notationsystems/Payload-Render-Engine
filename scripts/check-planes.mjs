#!/usr/bin/env node
/**
 * THE FOUR PLANES, mechanically enforced.
 *
 * The key invariant of this API is that every ok answer carries either
 * a canonical reference and a proof root, or an explicit declaration
 * that it is an operational observation with its limitations named -
 * never both, never neither.
 *
 * That sentence is worth nothing unless something tries it. This file
 * boots the real handlers in-process and reads what they actually
 * return, because the failure mode being guarded against is precisely
 * an answer that LOOKS canonical: before this existed,
 * /api/markets/fx answered `status: ok` with `verification.level:
 * PROVENANCE`, no build, no root and no declaration. Reading the source
 * would not have caught it - the disclaimer was there, in prose, and
 * read perfectly well to a human.
 *
 * Every failure names the plane rule it breaks and the remedy.
 */

import { registerRoutes } from '../server/api.mjs';
import { limbOf } from '../shared/envelope.mjs';
import {
  MODULE_FAMILIES,
  PLANES,
  ROUTE_PLANES,
  planeCoverage,
  planeOf,
  countPresence,
} from '../shared/planes.mjs';

const failures = [];
let checks = 0;
const check = (rule, name, ok, detail, remedy) => {
  checks += 1;
  if (!ok) failures.push({ rule, name, detail, remedy });
  console.log(`  ${ok ? 'ok ' : 'FAIL'} ${rule} ${name}`);
};

const src = (r) => r.pattern.source.replace(/^\^|\$$/g, '').replace(/\\\//g, '/');

console.log('- the four planes -');

const routes = await registerRoutes();
const patterns = routes.map(src);
const cov = planeCoverage(patterns);

// ---------------------------------------------------------- PLANE-001
check(
  'PLANE-001',
  `every served route is assigned a plane (${cov.assigned}/${cov.total})`,
  cov.unassigned.length === 0,
  cov.unassigned.join(' - '),
  'add the route to ROUTE_PLANES in shared/planes.mjs with its plane and the limb its answer carries. A route with no plane is not a route with a default - it is a route nobody decided about, and "may a tenant read this?" then gets answered by whoever wrote it'
);

// ---------------------------------------------------------- PLANE-002
check(
  'PLANE-002',
  'no plane assignment names a route that no longer exists',
  cov.stale.length === 0,
  cov.stale.join(' - '),
  'remove the stale key from ROUTE_PLANES - a map that describes routes the service does not serve has stopped describing the service'
);

// ---------------------------------------------------------- PLANE-003
// the internal-operator plane is declared and MUST stay empty here
{
  const assignedInternal = Object.entries(ROUTE_PLANES).filter(([, v]) => v.plane === 'internal-operator');
  check(
    'PLANE-003',
    'the internal ingestion / operator plane is empty',
    assignedInternal.length === 0,
    assignedInternal.map(([k]) => k).join(' - '),
    'this service serves GET only and SEC-018 refuses every other method at the transport layer, so there is no ingestion path to govern. A route appearing in this plane means the service has grown a write surface, which is a decision that belongs with the substrate and not here'
  );
}

// ---------------------------------------------------------- PLANE-004
// THE KEY INVARIANT, over the live surface
{
  const call = (path) => {
    const url = new URL(path, 'http://test');
    for (const r of routes) {
      const m = r.pattern.exec(url.pathname);
      if (m && r.method === 'GET') return r.handler({ params: m.groups ?? {}, query: url.searchParams });
    }
    return null;
  };
  const PROXIED = ['/api/live/', '/api/markets/', '/api/operations', '/api/scenarios/inject', '/api/refusals'];

  const bothLimbs = [];
  const neitherLimb = [];
  const incomplete = [];
  const undeclaredLimits = [];
  let answered = 0;

  for (const path of patterns) {
    // a parameterised route has no id to supply, and a proxied one
    // would spend an upstream quota from a test run - both are
    // exercised over HTTP by the e2e suite instead
    if (path.includes('(?<')) continue;
    if (PROXIED.some((p) => path.startsWith(p))) continue;
    let out;
    try {
      out = await call(path);
    } catch {
      continue;
    }
    if (!out || out.status !== 'ok') continue;
    answered += 1;
    const verdict = limbOf(out.meta);
    if (verdict.violation === 'BOTH_LIMBS') bothLimbs.push(path);
    else if (verdict.violation === 'NEITHER_LIMB') neitherLimb.push(path);
    else if (verdict.violation === 'CANONICAL_INCOMPLETE') incomplete.push(path);
    else if (verdict.violation === 'LIMITATIONS_UNDECLARED') undeclaredLimits.push(path);
  }

  check(
    'PLANE-004',
    `no answer claims BOTH limbs (${answered} answers read)`,
    bothLimbs.length === 0,
    bothLimbs.join(' - '),
    'an answer carrying meta.reference AND meta.observation declares an operational reading to be canonical. Strip the canonical limb on the operational path - live.mjs and markets.mjs do this with `reference: undefined`'
  );
  check(
    'PLANE-004',
    'no answer carries NEITHER limb',
    neitherLimb.length === 0,
    neitherLimb.join(' - '),
    'this is the defect the invariant exists for: an answer with a verification level but no root and no declaration reads as canonical to every client that does not already know better. Use canonicalBasis() or declare the route OPERATIONAL in ROUTE_PLANES'
  );
  check(
    'PLANE-005',
    'every canonical answer carries both a reference and a proof root',
    incomplete.length === 0,
    incomplete.join(' - '),
    'a canonical reference with nothing to verify it against is the claim this envelope refuses to make. canonicalBasis() returns the OPERATIONAL limb when there is no root, which is the honest answer for an unstamped corpus'
  );
  check(
    'PLANE-006',
    'every operational answer states its limitations',
    undeclaredLimits.length === 0,
    undeclaredLimits.join(' - '),
    'declare limitations on the route in ROUTE_PLANES, or pass them at the call site. An operational reading whose limitations are unstated is indistinguishable from a canonical one to a reader, which is the whole failure mode'
  );
}

// ---------------------------------------------------------- PLANE-007
// Two declarations, written independently, must agree.
//
// This started as "every answer carries the limb its plane assignment
// declared" and could not fail: the router wrapper READS that
// assignment to build the envelope, so for every wrapped route the
// answer agrees with the declaration by construction. A check whose
// subject is derived from its own expectation proves nothing, and a
// green line saying otherwise is worse than no line at all.
//
// What can fail is a cross-check between two tables maintained by
// different hands for different reasons: ROUTE_PLANES says which limb a
// route carries, MODULE_FAMILIES says what ROLE the family serving it
// holds. A PROOF_VERIFIABLE family serves canonical answers; a
// PUBLICLY_READABLE or HOST_ONLY one does not. Flip either table alone
// and they disagree.
{
  const roleOf = new Map();
  for (const f of MODULE_FAMILIES) for (const r of f.routes ?? []) roleOf.set(r, { role: f.role, family: f.id });
  const crossChecked = [...roleOf.keys()].filter((r) => planeOf(r));
  const disagree = [];
  for (const r of crossChecked) {
    const limb = planeOf(r).limb;
    const { role, family } = roleOf.get(r);
    if (limb === 'CANONICAL' && role !== 'PROOF_VERIFIABLE') {
      disagree.push(`${r}: limb CANONICAL but family '${family}' holds role ${role}`);
    }
    if (limb === 'OPERATIONAL' && role === 'PROOF_VERIFIABLE') {
      disagree.push(`${r}: limb OPERATIONAL but family '${family}' holds role PROOF_VERIFIABLE`);
    }
  }
  check(
    'PLANE-007',
    `limb and family role agree, over the ${crossChecked.length} routes a family claims`,
    disagree.length === 0,
    disagree.join(' - '),
    'ROUTE_PLANES and MODULE_FAMILIES disagree about what this route is. A PROOF_VERIFIABLE family serves canonical, proof-rooted answers; a PUBLICLY_READABLE or HOST_ONLY one serves operational readings. Change both tables or neither'
  );
}

// ---------------------------------------------------------- PLANE-008
// the module families: present with routes, or absent with a reason
{
  const counts = countPresence();
  const noReason = MODULE_FAMILIES.filter(
    (f) => f.presence === 'ABSENT' && (!f.absent || !f.unblockedBy)
  );
  check(
    'PLANE-008',
    `every ABSENT module family states its reason AND what would unblock it (${counts.ABSENT} absent)`,
    noReason.length === 0,
    noReason.map((f) => f.id).join(' - '),
    'an absence without a reason is a gap; an absence with a reason is a decision. State it, the same way every refusal in this system carries a remedy'
  );
  const partialNoAbsent = MODULE_FAMILIES.filter((f) => f.presence === 'PARTIAL' && !f.absent);
  check(
    'PLANE-008',
    'every PARTIAL family names the half it does NOT hold',
    partialNoAbsent.length === 0,
    partialNoAbsent.map((f) => f.id).join(' - '),
    'PARTIAL without a stated missing half reads as PRESENT to anyone scanning the register - say which half is missing and who owns it'
  );
  const emptyClaims = MODULE_FAMILIES.filter(
    (f) => (f.presence === 'PRESENT' || f.presence === 'PARTIAL') && (f.here ?? []).length === 0
  );
  check(
    'PLANE-008',
    'every PRESENT or PARTIAL family names what it actually holds',
    emptyClaims.length === 0,
    emptyClaims.map((f) => f.id).join(' - '),
    'a presence claim with nothing behind it is an assertion. List what is held, the way the apparatus register makes every row carry where its claims were read from'
  );
}

// ---------------------------------------------------------- PLANE-009
{
  const claimed = new Set(MODULE_FAMILIES.flatMap((f) => f.routes ?? []));
  const phantom = [...claimed].filter((r) => !patterns.includes(r));
  check(
    'PLANE-009',
    `every route a module family claims is actually served (${claimed.size} claimed)`,
    phantom.length === 0,
    phantom.join(' - '),
    'a family claiming a route the service does not serve is the register describing an API that does not exist. Remove the claim, or serve the route'
  );
  const planeIds = new Set(PLANES.map((p) => p.id));
  const badPlane = Object.entries(ROUTE_PLANES).filter(([, v]) => !planeIds.has(v.plane));
  check(
    'PLANE-009',
    'every route names a plane that exists',
    badPlane.length === 0,
    badPlane.map(([k, v]) => `${k} -> ${v.plane}`).join(' - '),
    'the plane id must be one of the four declared in PLANES'
  );
  const famPlanes = MODULE_FAMILIES.filter((f) => !planeIds.has(f.plane));
  check(
    'PLANE-009',
    'every module family names a plane that exists',
    famPlanes.length === 0,
    famPlanes.map((f) => f.id).join(' - '),
    'the plane id must be one of the four declared in PLANES'
  );
}

// -------------------------------------------------------------- verdict
console.log('');
if (failures.length) {
  console.error(`PLANE CHECK FAILED - ${failures.length} of ${checks} rules broken:\n`);
  for (const f of failures) {
    console.error(`  ${f.rule} ${f.name}`);
    if (f.detail) console.error(`    found: ${f.detail}`);
    console.error(`    remedy: ${f.remedy}\n`);
  }
  process.exit(1);
}
console.log(`API PLANES CLEAN - ${checks} rules checked`);
