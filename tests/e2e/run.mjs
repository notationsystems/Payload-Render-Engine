/**
 * E2E runner — sequential specs over one browser. Nonzero exit on any
 * failure; preconditions refused with remedies, never guessed around.
 */

import { API, VITE, launchBrowser, reachable } from './harness.mjs';

const SPECS = [
  '05-security.spec.mjs',
  '07-ecosystem.spec.mjs',
  '10-boot.spec.mjs',
  '15-workspace.spec.mjs',
  '20-query.spec.mjs',
  '30-miner.spec.mjs',
  '40-corpus-compiler.spec.mjs',
  '50-verification.spec.mjs',
  '60-injection.spec.mjs',
  '70-refusals.spec.mjs',
  '80-warrant.spec.mjs',
  '85-watches.spec.mjs',
  '90-ops.spec.mjs',
  '95-system.spec.mjs',
];

if (!(await reachable(`${VITE}/`))) {
  console.error(`E2E REFUSED — vite is not serving at ${VITE}`);
  console.error('REMEDY: npx vite --port 5173 --strictPort (or set E2E_VITE)');
  process.exit(2);
}
if (!(await reachable(`${API}/api/capabilities`))) {
  console.error(`E2E REFUSED — the spatial API is not serving at ${API}`);
  console.error('REMEDY: CORPUS=terminal PORT=8788 node server/index.mjs (or set E2E_API)');
  process.exit(2);
}

const browser = await launchBrowser();
const results = [];
for (const name of SPECS) {
  console.log(`\n— ${name} —`);
  const mod = await import(`./${name}`);
  try {
    results.push(await mod.run(browser));
  } catch (err) {
    console.log(`    FAIL spec crashed: ${err?.message ?? err}`);
    results.push({ spec: name, checks: 0, failures: [`spec crashed: ${err?.message ?? err}`] });
  }
}
await browser.close();

const totalChecks = results.reduce((a, r) => a + r.checks, 0);
const allFailures = results.flatMap((r) => r.failures.map((f) => `${r.spec}: ${f}`));
console.log(`\n${totalChecks} checks across ${results.length} specs`);
if (allFailures.length) {
  console.error(`${allFailures.length} FAILURES:`);
  for (const f of allFailures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('E2E SUITE CLEAN');
