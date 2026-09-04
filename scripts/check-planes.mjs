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

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
import { PLATFORM_LAYERS, disclosureDefect } from '../shared/platform.mjs';
import { APPARATUSES } from '../shared/ecosystem.mjs';
import { APIS, PRODUCT_HIERARCHY, STREAM_OWNERS, ownerOf, streamCoverage } from '../shared/apis.mjs';

// the workspace root: this repo's parent, where the sibling apparatuses live
const WORKSPACE = resolve(new URL('../..', import.meta.url).pathname);

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
  const assignedInternal = Object.entries(ROUTE_PLANES).filter(([, v]) => v.plane === 'internal_operator');
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

  const multiLimb = [];
  const noLimb = [];
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
    if (verdict.violation === 'MULTIPLE_LIMBS') multiLimb.push(path);
    else if (verdict.violation === 'NO_LIMB') noLimb.push(path);
    else if (verdict.violation === 'CANONICAL_INCOMPLETE') incomplete.push(path);
    else if (verdict.violation === 'LIMITATIONS_UNDECLARED') undeclaredLimits.push(path);
  }

  check(
    'PLANE-004',
    `no answer claims MORE THAN ONE limb (${answered} answers read)`,
    multiLimb.length === 0,
    multiLimb.join(' - '),
    'an answer carrying meta.reference AND meta.observation declares an operational reading to be canonical. Strip the canonical limb on the operational path - live.mjs and markets.mjs do this with `reference: undefined`'
  );
  check(
    'PLANE-004',
    'no answer carries NO limb',
    noLimb.length === 0,
    noLimb.join(' - '),
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
    if (limb === 'CANONICAL_PROOF' && role !== 'proof_verifiable') {
      disagree.push(`${r}: limb CANONICAL but family '${family}' holds role ${role}`);
    }
    if (limb === 'OPERATIONAL_OBSERVATION' && role === 'proof_verifiable') {
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

// ---------------------------------------------------------- PLANE-010
// The platform position: a layer claimed before it exists is how an
// architecture diagram stops describing a system.
{
  const noSeam = PLATFORM_LAYERS.filter((l) => !l.seam || l.seam.length < 10);
  check(
    'PLANE-010',
    `every platform layer names the seam where it attaches (${PLATFORM_LAYERS.length} layers)`,
    noSeam.length === 0,
    noSeam.map((l) => l.id).join(' - '),
    'a seam named with a file is a decision someone can act on; a seam described in prose is a wish. Name the file'
  );
  const absentNoReason = PLATFORM_LAYERS.filter(
    (l) => l.presence !== 'PRESENT' && (!l.absent || !l.unblockedBy)
  );
  check(
    'PLANE-010',
    'every ABSENT or PARTIAL layer states what is missing AND what would unblock it',
    absentNoReason.length === 0,
    absentNoReason.map((l) => l.id).join(' - '),
    'an absence without a reason is a gap; an absence with a reason is a decision'
  );
  const claimNoEvidence = PLATFORM_LAYERS.filter(
    (l) => (l.here ?? []).length > 0 && (!l.evidence || l.evidence.length < 20)
  );
  check(
    'PLANE-010',
    'every layer claiming to hold something cites its evidence',
    claimNoEvidence.length === 0,
    claimNoEvidence.map((l) => l.id).join(' - '),
    'a presence claim with no evidence behind it is an assertion. Say how it is known - which check holds it, or which measurement established it'
  );
  const emptyPresent = PLATFORM_LAYERS.filter(
    (l) => (l.presence === 'PRESENT' || l.presence === 'PARTIAL') && (l.here ?? []).length === 0
  );
  check(
    'PLANE-010',
    'no layer is marked present while holding nothing',
    emptyPresent.length === 0,
    emptyPresent.map((l) => l.id).join(' - '),
    'mark it ABSENT with its reason, which is the honest state, rather than PARTIAL with an empty list'
  );
}

// ---------------------------------------------------------- PLANE-011
// TWO SCOPES, NEVER COLLAPSED.
//
// `presence` is this service; `ecosystem` is who in the program holds
// the layer. Reporting only the first is how a register tells the
// systems engineer his work does not exist: four of the six layers are
// ABSENT here and held by the Terminal, which has an archive manifest
// with per-file content hashes, a canonical state assembly, a carrier
// outbox with a dispatch gateway, flow vintages, and a notary whose SP1
// program is written and tested against its reference implementation.
{
  const noScope = PLATFORM_LAYERS.filter((l) => !l.ecosystem);
  check(
    'PLANE-011',
    `every layer states BOTH scopes - here, and who holds it in the program (${PLATFORM_LAYERS.length} layers)`,
    noScope.length === 0,
    noScope.map((l) => l.id).join(' - '),
    'add an ecosystem block naming the holder, what it holds and where that was read from - or holder: null with the reason nobody holds it. A layer reporting only this service reads as "the program has none of this"'
  );

  const claimsNothing = PLATFORM_LAYERS.filter(
    (l) => l.ecosystem?.holder && (l.ecosystem.holds ?? []).length === 0
  );
  check(
    'PLANE-011',
    'a named ecosystem holder names what it actually holds',
    claimsNothing.length === 0,
    claimsNothing.map((l) => l.id).join(' - '),
    'naming a holder without naming what it holds is an attribution, not a finding'
  );

  // the phantom-route lesson, applied to the platform register: a claim
  // about another apparatus must cite a file that exists, or the
  // register is describing a program that does not
  const missing = [];
  for (const l of PLATFORM_LAYERS) {
    for (const r of l.ecosystem?.readFrom ?? []) {
      if (!existsSync(join(WORKSPACE, r))) missing.push(`${l.id}: ${r}`);
    }
  }
  check(
    'PLANE-011',
    `every ecosystem claim cites a file that exists (${PLATFORM_LAYERS.reduce((n, l) => n + (l.ecosystem?.readFrom ?? []).length, 0)} sources)`,
    missing.length === 0,
    missing.join(' - '),
    'a claim about a sibling apparatus read from a path that is not there is the register describing a program that does not exist. Read it again, or drop the claim'
  );

  const unsourced = PLATFORM_LAYERS.filter(
    (l) => l.ecosystem?.holder && (l.ecosystem.readFrom ?? []).length === 0
  );
  check(
    'PLANE-011',
    'every ecosystem claim says where it was read',
    unsourced.length === 0,
    unsourced.map((l) => l.id).join(' - '),
    'the apparatus register makes every row carry its readFrom for the same reason: a claim about another team work is worth exactly what its source is'
  );
}

  // A canonical record is READ, not produced. A route that names a method
  // is describing something it computed, which is a derivation.
  //
  // This exists because PLANE-007 cannot tell the two proof-bearing limbs
  // apart: both admit a proof_verifiable family, so a derivation
  // misdeclared as CANONICAL_PROOF passed the cross-table check. That is
  // a regression of the exact over-claim this class was added to fix -
  // mined candidates, scenarios and censuses all carried the canonical
  // limb, whose text promises membership of the committed build and an
  // inclusion proof that will never exist for them.
  //
  // A stronger check is available and not built: verify that a canonical
  // route's record ids are IN the build's commitment index and a derived
  // route's are not. It needs both sides reading the same corpus, which
  // this checker does not currently arrange.
  const methodOnCanonical = Object.entries(ROUTE_PLANES).filter(
    ([, v]) => v.limb === 'CANONICAL_PROOF' && v.method
  );
  check(
    'PLANE-012',
    'no route declared CANONICAL_PROOF names a production method',
    methodOnCanonical.length === 0,
    methodOnCanonical.map(([k]) => k).join(' - '),
    'a canonical answer is read from the committed build, not computed from it. If it has a method it is a VERIFIED_DERIVATION - the root binds its inputs rather than certifying its membership'
  );

  const noMethod = Object.entries(ROUTE_PLANES).filter(([, v]) => v.limb === 'VERIFIED_DERIVATION' && !v.method);
  check(
    'PLANE-012',
    'every declared derivation names the method that produced it',
    noMethod.length === 0,
    noMethod.map(([k]) => k).join(' - '),
    'a derivation whose method is unnamed cannot be reproduced or argued with, which is the only thing that makes it VERIFIED rather than merely computed'
  );

// ----------------------------------------------------------- API-001
// Which of the three products each stream powers. A third axis, and the
// conservation rule is the same: a stream absent from the map is a
// defect, never a default.
{
  const cov = streamCoverage(patterns);
  check(
    'API-001',
    `every served stream names the product it powers (${cov.assigned}/${cov.total})`,
    cov.unassigned.length === 0,
    cov.unassigned.join(' - '),
    'add the route to STREAM_OWNERS in shared/apis.mjs with its api and role. A stream nobody assigned is a stream whose product boundary nobody decided'
  );
  check(
    'API-001',
    'no stream assignment names a route that is no longer served',
    cov.stale.length === 0,
    cov.stale.join(' - '),
    'remove the stale key - a product map describing routes the service does not serve has stopped describing the service'
  );

  // ------------------------------------------------------------- API-002
  // An empty product is a fact, not a gap. Landshark has zero streams and
  // the register must SAY so, with the reason and the four gates it has
  // not passed - because the alternative is padding it with whatever
  // geographic data is lying around, which is the false coverage this
  // whole system refuses.
  const emptyUnexplained = APIS.filter(
    (a2) => cov.byApi[a2.id]?.total === 0 && (!a2.reason || !a2.unblockedBy)
  );
  check(
    'API-002',
    `every product with no streams states why, and what would unblock it (${cov.empty.length} empty)`,
    emptyUnexplained.length === 0,
    emptyUnexplained.map((a2) => a2.id).join(' - '),
    'an absence with a reason is a decision; an absence without one is a gap someone will later fill with anything to hand'
  );
  const wrongStatus = APIS.filter((a2) => cov.byApi[a2.id]?.total === 0 && a2.status !== 'ABSENT');
  check(
    'API-002',
    'no product claims a status its stream count does not support',
    wrongStatus.length === 0,
    wrongStatus.map((a2) => `${a2.id} claims ${a2.status} with 0 streams`).join(' - '),
    'a product with no streams is ABSENT. Any other status is a claim the twin cannot back'
  );

  // ------------------------------------------------------------- API-003
  // Payload OS is a layer. The moment it renders as a fourth product row
  // the hierarchy the charter fixes has been broken.
  check(
    'API-003',
    'Payload OS is declared a layer, never a fourth public API',
    PRODUCT_HIERARCHY.bundle.isPublicApi === false && !PRODUCT_HIERARCHY.apis.includes('payload-os'),
    `isPublicApi=${PRODUCT_HIERARCHY.bundle.isPublicApi}, apis=[${PRODUCT_HIERARCHY.apis.join(', ')}]`,
    'the hierarchy is Ecosystem -> Payload OS -> {Caravan, Tradewind, Landshark}. Payload OS is the shared layer the three stand on and is not offered as a product'
  );

  // ------------------------------------------------------------- API-004
  // THE ORTHOGONALITY THE DESIGN CLAIMS.
  //
  // Plane, limb and owning API are asserted to be three independent
  // facts. That is a claim, so it is measured: if API ownership were
  // derivable from plane or limb, some plane would hold exactly one
  // product and some product exactly one limb, and the third axis would
  // be decoration. This fails the moment the axes collapse.
  const planeApis = new Map();
  const apiLimbs = new Map();
  for (const pat of patterns) {
    const owner = ownerOf(pat);
    const plane = planeOf(pat);
    if (!owner || !plane) continue;
    if (!planeApis.has(plane.plane)) planeApis.set(plane.plane, new Set());
    planeApis.get(plane.plane).add(owner.api);
    if (!apiLimbs.has(owner.api)) apiLimbs.set(owner.api, new Set());
    apiLimbs.get(owner.api).add(plane.limb);
  }
  const mixedPlane = [...planeApis.entries()].find(([, v]) => v.size > 1);
  const mixedApi = [...apiLimbs.entries()].find(([, v]) => v.size > 1);
  check(
    'API-004',
    `owning-API is not derivable from plane (${mixedPlane ? `${mixedPlane[0]} holds ${mixedPlane[1].size} products` : 'no plane holds more than one'})`,
    Boolean(mixedPlane),
    'every plane maps to exactly one product',
    'if each plane held one product, plane and product would be the same fact under two names and one of them should go. The axes are only worth keeping separate while they actually differ'
  );
  check(
    'API-004',
    `owning-API is not derivable from limb (${mixedApi ? `${mixedApi[0]} spans ${mixedApi[1].size} limbs` : 'no product spans more than one'})`,
    Boolean(mixedApi),
    'every product carries exactly one limb',
    'if each product carried one limb, product and limb would be the same fact under two names'
  );

  // ------------------------------------------------------------- API-005
  const noStream = Object.entries(STREAM_OWNERS).filter(([, v]) => !v.stream || !v.role);
  check(
    'API-005',
    `every stream says what it carries and in what role (${Object.keys(STREAM_OWNERS).length} streams)`,
    noStream.length === 0,
    noStream.map(([k]) => k).join(' - '),
    'role separates a product record from context that merely informs it - an aircraft track is not a shipment, and without the distinction a view can promote one into the other'
  );
}

// ----------------------------------------------------------- SEC-180
// Provenance citations are SERVED. GET /api/platform discloses every
// readFrom path to any unauthenticated caller, so the set of
// repositories whose layout may appear there is a security decision.
{
  const cited = [
    ...PLATFORM_LAYERS.flatMap((l) => (l.ecosystem?.readFrom ?? []).map((p2) => ({ where: `platform:${l.id}`, path: p2 }))),
    ...APPARATUSES.flatMap((a2) => (a2.readFrom ?? []).map((p2) => ({ where: `apparatus:${a2.id}`, path: p2 }))),
  ];
  const offenders = cited.map((c) => ({ ...c, defect: disclosureDefect(c.path) })).filter((c) => c.defect);
  check(
    'SEC-180',
    `every served provenance citation names a repository cleared for disclosure (${cited.length} citations)`,
    offenders.length === 0,
    offenders.map((o) => `${o.where}: ${o.path} - ${o.defect}`).join(' · '),
    'these paths are served to anonymous callers by GET /api/platform and GET /api/ecosystem/register. Cite only repositories on DISCLOSABLE_REPOS, or add the repository there as an explicit decision that its layout may be published. A private repository must never appear'
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
