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


// ---------------------------------------------------------------- SEC-012
// The agent/tool surface may reach only allowlisted capabilities.
// Adding one must be a deliberate, reviewable act — not an import away.
{
  const src = read(join(ROOT, 'src/app/toolSurface.ts'));
  // strip line comments BEFORE splitting: a comment line otherwise
  // swallows the entry that follows it on the next line
  const listedRaw = (src.match(/TOOL_CAPABILITY_ALLOWLIST = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] ?? '')
    .replace(/\/\/[^\n]*/g, '');
  const listed = new Set([...listedRaw.matchAll(/['"`]([\w$]+)['"`]/g)].map((m) => m[1]));
  // what the tools actually reach, minus the allowlist declaration itself
  const body = src.replace(/TOOL_CAPABILITY_ALLOWLIST = Object\.freeze\(\[[\s\S]*?\]\)/, '');
  const reached = new Set([...body.matchAll(/\bapi\.([a-zA-Z_$][\w$]*)/g)].map((m) => m[1]));
  const unlisted = [...reached].filter((c) => !listed.has(c));
  check(
    'SEC-012',
    'the tool surface reaches only allowlisted capabilities',
    unlisted.length === 0,
    unlisted.join(' · '),
    'add the capability to TOOL_CAPABILITY_ALLOWLIST in src/app/toolSurface.ts only if it is view-level — a tool must never reach authority the UI itself lacks'
  );
  // SEC-011 is checked across the WHOLE renderer, not just the tool
  // surface. `runCommand` is deliberately broad, so any module the
  // command grammar reaches is inside an agent's blast radius — an
  // allowlist that stopped at one file would be checking the door while
  // leaving the corridor behind it unwatched.
  const MUTATING = /^(dispatch|mutate|write|commit|approve|delete|rotate|sign)/i;
  const everywhere = new Set();
  for (const f of walk(join(ROOT, 'src'))) {
    if (!/\.ts$/.test(f)) continue;
    for (const m of read(f).matchAll(/\bapi\.([a-zA-Z_$][\w$]*)/g)) {
      if (MUTATING.test(m[1])) everywhere.add(`${rel(f)}: api.${m[1]}`);
    }
  }
  check(
    'SEC-011',
    'no module anywhere reaches a mutating or dispatching capability',
    everywhere.size === 0,
    [...everywhere].join(' · '),
    'a dispatching capability needs an authenticated execution identity and an approval gate before any agent may reach it — and because runCommand is broad, that holds for every module the command grammar can reach, not only the tool surface'
  );
}

// ---------------------------------------------------------------- SEC-151
// Every upstream body read is bounded: a hostile or broken upstream
// must not be able to exhaust this service's memory.
{
  const offenders = [];
  for (const f of walk(join(ROOT, 'server'))) {
    if (f.endsWith('security.mjs')) continue; // defines the bounded reader
    for (const m of read(f).matchAll(/await\s+(\w+)\.(json|text)\(\)/g)) {
      offenders.push(`${rel(f)}: ${m[0]}`);
    }
  }
  check(
    'SEC-151',
    'every upstream body read is size-bounded',
    offenders.length === 0,
    offenders.join(' · '),
    'use readCapped / readCappedJson from server/security.mjs — res.json() buffers whatever the far side sends'
  );
}

// ---------------------------------------------------------------- SEC-170
// The delivered app carries a CSP, and script-src is strict. This is
// defence in depth behind the escaper, and it is only defence if the
// one directive that stops execution is not quietly relaxed.
{
  const html = read(join(ROOT, 'index.html'));
  // the policy value itself contains single quotes ('none', 'self'), so
  // the attribute delimiter must be matched exactly, not as a class
  const meta = /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]*)"/i.exec(html);
  const policy = (meta?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const directive = (name) =>
    policy
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `))
      ?.slice(name.length + 1)
      .trim() ?? null;
  const scriptSrc = directive('script-src');
  check(
    'SEC-170',
    'the delivered app carries a Content-Security-Policy',
    policy.length > 0,
    policy ? '' : 'no Content-Security-Policy meta in index.html',
    'add a <meta http-equiv="Content-Security-Policy"> to index.html — the escaper stops the injection, the CSP stops what an injection that got through could do'
  );
  check(
    'SEC-170',
    'script-src admits no inline script and no eval',
    Boolean(scriptSrc) && !/unsafe-inline|unsafe-eval/.test(scriptSrc ?? ''),
    scriptSrc ?? '(script-src absent)',
    "keep script-src at 'self' — this app has no inline script, no eval and no worker, so strictness costs nothing and is the control that actually stops XSS from executing"
  );
  check(
    'SEC-170',
    'default-src denies by default and object/base are closed',
    /default-src 'none'/.test(policy) && /object-src 'none'/.test(policy) && /base-uri 'none'/.test(policy),
    policy.slice(0, 120),
    "set default-src 'none', object-src 'none' and base-uri 'none' — an allowlist that forgets a fetch type is an allowlist with a hole"
  );
}

// The CSP's one relaxation is style-src, and the reason given is a
// COUNT of render sites. A count in prose is the thing that drifts, so
// it is checked: if the number stated in index.html stops matching the
// tree, either new inline styles arrived unreviewed or the claim is
// stale. Both are worth a failure.
{
  const stated = Number(/(\d+) render sites/.exec(read(join(ROOT, 'index.html')))?.[1] ?? -1);
  let actual = 0;
  for (const f of walk(join(ROOT, 'src'))) {
    if (!/\.ts$/.test(f)) continue;
    actual += [...read(f).matchAll(/style="/g)].length;
  }
  check(
    'SEC-170',
    `the stated inline-style count matches the tree (${actual})`,
    stated === actual,
    `index.html says ${stated}, the tree has ${actual}`,
    'update the count in index.html and docs/SECURITY.md, and check the new site takes no wire text — style-src is relaxed on the strength of that claim, so the claim has to stay true'
  );
}

// ---------------------------------------------------------------- SEC-153
// Every client fetch is bounded. SEC-151 stops the service being hung by
// an upstream; this stops the OS being hung by the service. A surface
// waiting forever on a connection that was accepted and never answered
// neither works nor refuses, and an operator cannot tell it from a slow
// query — which is the one state this system does not allow.
{
  const offenders = [];
  for (const f of walk(join(ROOT, 'src'))) {
    if (!/\.ts$/.test(f)) continue;
    if (/sources\.ts$/.test(f)) continue; // defines the bounded reader
    // strip comments first: prose that mentions a call is not a call, and
    // a checker that cannot tell the difference gets ignored
    const code = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const m of code.matchAll(/(?<![\w.])fetch\s*\(/g)) {
      offenders.push(`${rel(f)}: bare fetch(`);
    }
  }
  check(
    'SEC-153',
    'every client fetch is bounded',
    offenders.length === 0,
    [...new Set(offenders)].join(' · '),
    'use fetchBounded from src/data/sources — a fetch with no timeout can leave a surface on "reading…" forever, which reads to an operator as working rather than as refused'
  );
}

// ---------------------------------------------------------------- SEC-152
// The served invariant ledger is the security model an operator reads.
// A row claiming ENFORCED with no check named, or a check named that no
// check function answers to, is a claim the operator can act on and be
// wrong about — which is worse than an honest ABSENT.
{
  const src = read(join(ROOT, 'server/security.mjs'));
  const ledger = /SECURITY_INVARIANTS = Object\.freeze\(\[([\s\S]*?)\n\]\);/.exec(src)?.[1] ?? '';
  // parse each row's OWN body: a span-based match would find the NEXT
  // row's `reason:` and report a missing one as present. These rows are
  // flat objects, so [^{}]* is exact where a lazy [\s\S]*? is not.
  const rows = [...ledger.matchAll(/\{[^{}]*\}/g)].map((m) => ({
    id: /id: '([^']+)'/.exec(m[0])?.[1] ?? '(unnamed)',
    state: /state: '([A-Z]+)'/.exec(m[0])?.[1] ?? '',
    check: /check: (null|'[^']*')/.exec(m[0])?.[1] ?? 'null',
    hasReason: /\breason:/.test(m[0]),
  }));
  check(
    'SEC-152',
    'the served invariant ledger is non-empty and parseable',
    rows.length >= 20,
    `parsed ${rows.length} rows`,
    'SECURITY_INVARIANTS in server/security.mjs is what the operator surface renders — it must stay the machine-readable twin of docs/SECURITY.md'
  );
  const claimed = rows.filter((r) => r.state === 'ENFORCED' && r.check === 'null');
  check(
    'SEC-152',
    'every ENFORCED row names the check that proves it',
    claimed.length === 0,
    claimed.map((r) => r.id).join(' · '),
    'name the check, or mark the row DEPLOYMENT / ABSENT with its reason — an unproven ENFORCED is a claim an operator will act on and be wrong about'
  );
  const unexplained = rows.filter((r) => r.state !== 'ENFORCED' && !r.hasReason);
  check(
    'SEC-152',
    'every DEPLOYMENT or ABSENT row carries its reason',
    unexplained.length === 0,
    unexplained.map((r) => r.id).join(' · '),
    'an absence without a reason is a gap; an absence with a reason is a decision — state it, the same way every refusal in this system carries a remedy'
  );
  check(
    'SEC-152',
    'the refusal journal is bounded and states its window',
    /RING_CAPACITY/.test(src) && /this\.dropped \+= 1/.test(src) && /since: this\.since/.test(src),
    '',
    'the journal must be a bounded ring that counts what it dropped and reports `since` — an unbounded incident log is an attacker amplifier, and an empty one that hides its window reads as "nothing ever happened"'
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
