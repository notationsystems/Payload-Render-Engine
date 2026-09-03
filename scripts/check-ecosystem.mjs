#!/usr/bin/env node
/**
 * The apparatus register, checked against the trees it describes.
 *
 * A map of an ecosystem is exactly the kind of document that rots: the
 * trees move, the map does not, and nobody can tell which is stale. The
 * convergence this ecosystem already arrived at — doctrine that restates
 * code is generated from it, so it cannot drift — applies here too.
 *
 * So this check reads the actual sibling trees and holds the register to
 * them:
 *
 *   PRESENT   must carry source files, not just a .git
 *   DECLARED  must NOT carry source — a declared-but-actually-built row
 *             is the more dangerous direction, because it understates
 *             what exists
 *   SCAFFOLD  must be small and unmodified from its starter commit
 *   readFrom  every cited path must exist
 *
 * WHEN THE TREES ARE NOT HERE. This repository is checked out on its own
 * in CI, where the siblings do not exist. That is not a failure and must
 * not be reported as one — a check that fails for being run in the wrong
 * place teaches people to ignore it. It refuses with a reason instead,
 * and says exactly what it could not verify.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPARATUSES, LIFECYCLE, CONVERGENCES, DIVERGENCES } from '../shared/ecosystem.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The workspace that holds this repo and its siblings. */
const WORKSPACE = resolve(ROOT, '..');

let checks = 0;
const failures = [];
const check = (id, what, ok, found = '', remedy = '') => {
  checks += 1;
  if (ok) {
    console.log('  ok ', id, what);
    return;
  }
  console.log('  FAIL', id, what);
  failures.push({ id, what, found, remedy });
};

/** Source files in a tree, ignoring the plumbing. */
function sourceCount(dir, depth = 0) {
  if (depth > 4) return 0;
  let n = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) n += sourceCount(p, depth + 1);
    else if (/\.(ts|tsx|js|mjs|jsx|py|md|json|css|html)$/.test(e.name)) n += 1;
  }
  return n;
}

/** Where an apparatus's tree lives, if it is here at all. */
function treeOf(apparatus) {
  // the register names repos as owner/name or a bare workspace directory
  const tail = apparatus.repo.split('/').pop();
  for (const candidate of [
    join(WORKSPACE, apparatus.repo),
    join(WORKSPACE, tail),
    join(WORKSPACE, 'notationsystems', tail),
    ROOT,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      // ROOT only counts for the apparatus that IS this repo
      if (candidate === ROOT && apparatus.id !== 'render-engine') continue;
      return candidate;
    }
  }
  return null;
}

console.log('\nAPPARATUS REGISTER — checked against the trees it describes\n');

// ---------------------------------------------------------------- shape
// These hold with or without the sibling trees: the register must be
// internally honest before it is externally accurate.
{
  const stageIds = new Set(LIFECYCLE.map((s) => s.id));
  const badStage = APPARATUSES.flatMap((a) => a.stages.filter((s) => !stageIds.has(s)).map((s) => `${a.id}:${s}`));
  check(
    'ECO-001',
    'every apparatus stage exists in the lifecycle',
    badStage.length === 0,
    badStage.join(' · '),
    'add the stage to LIFECYCLE or correct the apparatus row — a stage nobody defined is a stage nobody owns'
  );

  const unexplained = APPARATUSES.filter(
    (a) => (a.presence === 'DECLARED' || a.presence === 'SCAFFOLD') && !a.absence?.reason
  );
  check(
    'ECO-002',
    'every DECLARED or SCAFFOLD apparatus carries its reason',
    unexplained.length === 0,
    unexplained.map((a) => a.id).join(' · '),
    'state why it is not built and what would unblock it — an absence with a reason is a decision, an absence without one is a gap'
  );

  const unsourced = APPARATUSES.filter((a) => !Array.isArray(a.readFrom) || a.readFrom.length === 0);
  check(
    'ECO-003',
    'every apparatus row names where its claims were read',
    unsourced.length === 0,
    unsourced.map((a) => a.id).join(' · '),
    'add readFrom — a register row without provenance is exactly the unsourced assertion this ecosystem refuses everywhere else'
  );

  const badConv = CONVERGENCES.filter(
    (c) => !c.evidence || c.seenIn.some((id) => !APPARATUSES.some((a) => a.id === id))
  );
  check(
    'ECO-004',
    'every convergence names real apparatuses and cites its evidence',
    badConv.length === 0,
    badConv.map((c) => c.id).join(' · '),
    'a claimed convergence with no evidence is a wish; name where it was seen in each tree'
  );

  const softDiv = DIVERGENCES.filter((d) => !d.proposal || !d.ownedBy);
  check(
    'ECO-005',
    'every divergence carries a proposal and names who owns the decision',
    softDiv.length === 0,
    softDiv.map((d) => d.id).join(' · '),
    'surfacing a disagreement without a proposal is a complaint; surfacing it without an owner is a decision taken by whoever reads it last'
  );

  // The spine puts every stage on one row; a long name there pushes the
  // empty slot off-screen, which is the one thing the graphic exists to
  // show. So the short form is a constraint, not a convenience.
  const longShort = APPARATUSES.filter((a) => typeof a.short !== 'string' || a.short.length > 16);
  check(
    'ECO-007',
    'every apparatus has a spine-sized short form',
    longShort.length === 0,
    longShort.map((a) => `${a.id}:${a.short ?? '(missing)'}`).join(' · '),
    'give it a short of 16 characters or fewer — seven stages share one row, and a name that overflows pushes the unowned stage out of view'
  );

  // The one that matters most: an unowned lifecycle stage must be
  // visible, not silently dropped from the map.
  const owned = new Set(APPARATUSES.filter((a) => a.presence !== 'DECLARED').flatMap((a) => a.stages));
  const unowned = LIFECYCLE.filter((s) => !owned.has(s.id));
  check(
    'ECO-006',
    'every unowned lifecycle stage has an apparatus row stating the gap',
    unowned.every((s) => APPARATUSES.some((a) => a.stages.includes(s.id))),
    unowned.map((s) => s.id).join(' · '),
    'a lifecycle stage with no row at all disappears from the map; give it a DECLARED row with the reason instead'
  );
}

// --------------------------------------------------------- against the trees
const reachable = APPARATUSES.map((a) => ({ a, tree: treeOf(a) })).filter((x) => x.tree);

if (reachable.length <= 1) {
  console.log('\n  REFUSED — the sibling apparatus trees are not checked out beside this one.');
  console.log('  The shape checks above still ran and still hold.');
  console.log('  REMEDY: clone the siblings into the workspace root to verify presence claims,');
  console.log('          or accept that presence is unverified in this environment — it is not');
  console.log('          a failure, and reporting it as one would teach people to ignore this check.\n');
} else {
  console.log('');
  for (const { a, tree } of reachable) {
    const n = sourceCount(tree);
    if (a.presence === 'PRESENT' || a.presence === 'OBSERVED') {
      check(
        'ECO-010',
        `${a.id}: PRESENT tree carries source (${n} files)`,
        n > 20,
        `${n} source files at ${tree}`,
        'the register says this apparatus is built; if the tree is empty the row should be DECLARED with its reason'
      );
    }
    if (a.presence === 'DECLARED') {
      check(
        'ECO-011',
        `${a.id}: DECLARED tree carries no source (${n} files)`,
        n === 0,
        `${n} source files at ${tree}`,
        'the tree has been built since this row was written — promote it to PRESENT and describe what it now holds. Understating what exists is the more dangerous direction: it hides a plane that other apparatuses may already depend on.'
      );
    }
    if (a.presence === 'SCAFFOLD') {
      check(
        'ECO-012',
        `${a.id}: SCAFFOLD tree is still a starter (${n} files)`,
        n < 60,
        `${n} source files at ${tree}`,
        'this tree has grown past a starter — give it a real row: what it is, what stage it owns, and what it refuses'
      );
    }
  }

  // readFrom paths must exist where the workspace has them
  const missing = [];
  for (const a of APPARATUSES) {
    for (const p of a.readFrom) {
      const clean = p.replace(/ \(.*\)$/, '').replace(/\/$/, '');
      if (clean.includes('(')) continue;
      const abs = clean.startsWith('notationsystems/') || clean.startsWith('tradewind')
        ? join(WORKSPACE, clean)
        : join(ROOT, clean);
      // only judge a path whose tree is actually here
      const treeRoot = clean.split('/').slice(0, 2).join('/');
      if (!existsSync(join(WORKSPACE, treeRoot)) && !clean.startsWith('docs/') && !clean.startsWith('shared/')) continue;
      if (!existsSync(abs)) missing.push(`${a.id}: ${clean}`);
    }
  }
  check(
    'ECO-013',
    'every cited readFrom path exists',
    missing.length === 0,
    missing.join(' · '),
    'the file a claim was read from has moved or gone; re-read the tree and update the row rather than leaving a citation that resolves to nothing'
  );
}

console.log('');
if (failures.length) {
  console.error(`APPARATUS REGISTER DRIFTED — ${failures.length} of ${checks} checks broken:\n`);
  for (const f of failures) {
    console.error(`  ${f.id} ${f.what}`);
    if (f.found) console.error(`    found: ${f.found}`);
    console.error(`    remedy: ${f.remedy}\n`);
  }
  process.exit(1);
}
console.log(`APPARATUS REGISTER COHERENT — ${checks} checked`);
