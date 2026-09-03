#!/usr/bin/env node
/**
 * Security invariants, mechanically enforced (docs/SECURITY.md).
 *
 * The project's discipline is that an invariant nobody can break by
 * accident beats a rule everyone must remember. `check-seam.mjs`
 * already stops the renderer leaking into canonical state; this stops
 * the security substrate eroding the same way.
 *
 * Every failure names the invariant it breaks and the remedy.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const failures = [];
let checks = 0;

const fail = (invariant, name, detail, remedy) => {
  failures.push({ invariant, name, detail, remedy });
};
const check = (invariant, name, ok, detail, remedy) => {
  checks++;
  if (!ok) fail(invariant, name, detail, remedy);
  console.log(`  ${ok ? 'ok ' : 'FAIL'} ${invariant} ${name}`);
};

/** Walk source files, skipping build output and vendored trees. */
function* walk(dir, exts = ['.ts', '.mjs', '.js']) {
  const SKIP = new Set(['node_modules', 'dist', '.git', '.live-cache', 'fixtures', 'tests']);
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p, exts);
    else if (exts.some((e) => entry.endsWith(e))) yield p;
  }
}

const sourceFiles = [
  ...walk(join(ROOT, 'src')),
  ...walk(join(ROOT, 'server')),
  ...walk(join(ROOT, 'scripts')),
];
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p);

console.log('— security invariants —');

// ---------------------------------------------------------------- SEC-004
// No secret committed. Shape-based: long high-entropy assignments to
// secret-named identifiers, and known credential prefixes.
{
  const SECRET_ASSIGN =
    /(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|token|bearer)\s*[:=]\s*['"`]([^'"`\n]{12,})['"`]/gi;
  const KNOWN_PREFIX = /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  const hits = [];
  for (const f of sourceFiles) {
    const src = read(f);
    for (const m of src.matchAll(SECRET_ASSIGN)) {
      const value = m[1];
      // an interpolated value is computed at runtime — there is no
      // literal in the file to leak (this is how test canaries are
      // written, and it is the right way to write them)
      if (value.includes('${')) continue;
      // placeholders, env reads and obvious prose are not secrets
      if (/^(process\.env|import\.meta|<|your|example|placeholder|redacted|changeme|test-token)/i.test(value)) continue;
      if (/^[a-z][a-z0-9-]*(\s|$)/i.test(value) && /\s/.test(value)) continue; // prose
      hits.push(`${rel(f)}: ${m[0].slice(0, 60)}…`);
    }
    if (KNOWN_PREFIX.test(src)) hits.push(`${rel(f)}: known credential prefix`);
  }
  check(
    'SEC-004',
    'no secret committed to source',
    hits.length === 0,
    hits.join(' · '),
    'move the value to the environment; the service reads secrets from process.env only'
  );
}

// ---------------------------------------------------------------- SEC-120
// One escaper. A module-local escaper is how the quote-unsafe variant
// came back last time.
{
  const offenders = sourceFiles
    .filter((f) => f.includes(join('src', 'ui')) || f.includes(join('src', 'app')))
    .filter((f) => /const\s+esc\s*=/.test(read(f)));
  check(
    'SEC-120',
    'no module defines its own escaper',
    offenders.length === 0,
    offenders.map(rel).join(' · '),
    "import { esc } from '../core/escape' — one escaper, markup-safe in element and attribute position"
  );
}

// ---------------------------------------------------------------- SEC-121
// The shared escaper must cover quotes, or every title="${esc(x)}" in
// the codebase is an attribute-injection sink.
{
  const src = read(join(ROOT, 'src/core/escape.ts'));
  const covers = ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'].every((e) => src.includes(e));
  check(
    'SEC-121',
    'the escaper covers quotes (attribute safety)',
    covers,
    'src/core/escape.ts does not encode all of & < > " \'',
    'attribute contexts break out on a bare quote — encode all five'
  );
}

// ---------------------------------------------------------------- SEC-103
// Wildcard CORS must not reappear.
{
  const offenders = [];
  for (const f of walk(join(ROOT, 'server'))) {
    const src = read(f);
    if (/Access-Control-Allow-Origin['"\s:,]+\*/.test(src) || /'\*'\s*\)/.test(src) && /Allow-Origin/.test(src)) {
      offenders.push(rel(f));
    }
  }
  check(
    'SEC-103',
    'no wildcard CORS',
    offenders.length === 0,
    offenders.join(' · '),
    'echo an allowlisted Origin (server/security.mjs) — a wildcard hands privileged data to any page the operator visits'
  );
}

// ---------------------------------------------------------------- SEC-130
// TLS verification is never disabled.
{
  const offenders = [];
  for (const f of sourceFiles) {
    const src = read(f);
    if (/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/.test(src) || /rejectUnauthorized\s*:\s*false/.test(src)) {
      offenders.push(rel(f));
    }
  }
  check(
    'SEC-130',
    'TLS verification never disabled',
    offenders.length === 0,
    offenders.join(' · '),
    'fix the trust store (NODE_EXTRA_CA_CERTS) instead of disabling verification'
  );
}

// ---------------------------------------------------------------- SEC-105
// Outbound hosts are fixed in code: no user input may steer egress.
{
  const offenders = [];
  for (const f of walk(join(ROOT, 'server'))) {
    const src = read(f);
    // a fetch whose URL interpolates something other than an env-derived
    // base or a numeric/validated segment is a potential SSRF primitive
    for (const m of src.matchAll(/fetch\(\s*`([^`]*)`/g)) {
      const url = m[1];
      if (!url.includes('${')) continue;
      const interps = [...url.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1].trim());
      const safe = interps.every(
        (i) =>
          /^(upstreamBase|base|baseUrl|apiBase)\b/.test(i) || // operator-configured base
          /^Math\.round\(/.test(i) || // validated numeric
          /^(key|ccy|id|start|path)$/.test(i) || // validated/fixed enumerations
          /^encodeURIComponent\(/.test(i) ||
          /FX_SYMBOLS\.join/.test(i)
      );
      if (!safe) offenders.push(`${rel(f)}: ${url.slice(0, 70)}`);
    }
  }
  check(
    'SEC-105',
    'no user-steerable outbound host',
    offenders.length === 0,
    offenders.join(' · '),
    'proxy destinations are fixed in code; validate and enumerate any dynamic segment'
  );
}

// ---------------------------------------------------------------- SEC-005
// Browser storage holds view conveniences only.
{
  const ALLOWED = new Set(['pe.alertCue', 'pe.workspace/v1', 'pe.watches/v1']);
  const keys = new Set();
  for (const f of walk(join(ROOT, 'src'))) {
    for (const m of read(f).matchAll(/localStorage\.\w+Item\(\s*['"]([^'"]+)['"]/g)) keys.add(m[1]);
    for (const m of read(f).matchAll(/const\s+KEY\s*=\s*['"](pe\.[^'"]+)['"]/g)) keys.add(m[1]);
  }
  const unexpected = [...keys].filter((k) => !ALLOWED.has(k));
  check(
    'SEC-005',
    'browser storage holds only known view conveniences',
    unexpected.length === 0,
    unexpected.join(' · '),
    'no credential or bearer token may live in browser storage; add genuinely-new view keys to the allowlist in this check'
  );
}

// ---------------------------------------------------------------- SEC-110
// The API base is validated before the OS will talk to it.
{
  const src = read(join(ROOT, 'src/data/sources.ts'));
  check(
    'SEC-110',
    'the API base is allowlisted before use',
    /isAllowedApiBase/.test(src) && /apiBaseRefusal/.test(src),
    'src/data/sources.ts does not validate ?api=',
    'an unvalidated backend controls every claim the OS renders, including its own verification'
  );
}

// ---------------------------------------------------------------- SEC-018
// Read-only service: no write verbs are routed.
{
  // Only ROUTE REGISTRATIONS count — an outbound fetch to an upstream
  // may of course POST (the scenario engine, the broker gateway); what
  // must not exist is a write verb this service ANSWERS.
  const offenders = [];
  for (const f of walk(join(ROOT, 'server'))) {
    for (const m of read(f).matchAll(/routes\.push\(\s*\{\s*method:\s*'(\w+)'/g)) {
      if (m[1] !== 'GET') offenders.push(`${rel(f)}: routes ${m[1]}`);
    }
  }
  check(
    'SEC-018',
    'the projection service routes GET only',
    offenders.length === 0,
    offenders.join(' · '),
    'a write path needs an authenticated execution identity first (docs/SECURITY.md §1)'
  );
}

// ---------------------------------------------------------------- SEC-140
// Internal error text must not be handed to clients.
{
  const src = read(join(ROOT, 'server/index.mjs'));
  const leaks = /String\(err[^)]*\)/.test(src) && !/redactError/.test(src);
  check(
    'SEC-140',
    'errors are redacted at the transport boundary',
    !leaks && /redactError/.test(src),
    'server/index.mjs returns raw error text',
    'return a correlation id; keep the detail in the scrubbed server log'
  );
}

// ---------------------------------------------------------------- SEC-160
// Dependencies pinned and minimal.
{
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  const deps = Object.keys(pkg.dependencies ?? {});
  let lockOk = true;
  try {
    statSync(join(ROOT, 'package-lock.json'));
  } catch {
    lockOk = false;
  }
  check(
    'SEC-160',
    'lockfile committed and runtime dependency surface small',
    lockOk && deps.length <= 8,
    `lockfile=${lockOk} runtimeDeps=${deps.length}`,
    'commit package-lock.json and keep the runtime dependency set minimal'
  );
}

// ------------------------------------------------------------------ verdict
console.log('');
if (failures.length) {
  console.error(`SECURITY CHECK FAILED — ${failures.length} of ${checks} invariants broken:\n`);
  for (const f of failures) {
    console.error(`  ${f.invariant} ${f.name}`);
    if (f.detail) console.error(`    found: ${f.detail}`);
    console.error(`    remedy: ${f.remedy}\n`);
  }
  process.exit(1);
}
console.log(`SECURITY INVARIANTS CLEAN — ${checks} checked`);
