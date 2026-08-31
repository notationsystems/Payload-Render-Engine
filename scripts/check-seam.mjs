#!/usr/bin/env node
/**
 * Seam check — mechanical enforcement of the digital-twin boundary.
 *
 * The semantic layer (src/data/**) must be renderer-blind:
 *   - no bare-module imports (no `three`, no DOM libs, nothing),
 *   - no relative imports that escape src/data, except the pure
 *     kernel modules explicitly allowed below.
 *
 * If this fails, the renderer is leaking into canonical-state land.
 * Structure, not discipline: the build breaks instead of a reviewer
 * having to notice.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DATA_DIR = join(ROOT, 'src', 'data');
const ALLOWED_OUTSIDE = new Set([
  join(ROOT, 'src', 'core', 'events.ts'),
  join(ROOT, 'src', 'core', 'time.ts'),
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const violations = [];
for (const file of walk(DATA_DIR)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    const rel = relative(ROOT, file);
    if (!spec.startsWith('.')) {
      violations.push(`${rel}: bare import '${spec}' — the data layer imports no packages`);
      continue;
    }
    const target = resolve(dirname(file), spec);
    const candidates = [target, `${target}.ts`, join(target, 'index.ts')];
    const inData = candidates.some((c) => c.startsWith(DATA_DIR));
    const allowed = candidates.some((c) => ALLOWED_OUTSIDE.has(c));
    if (!inData && !allowed) {
      violations.push(`${rel}: import '${spec}' escapes the semantic layer`);
    }
  }
}

if (violations.length) {
  console.error('SEAM CHECK FAILED — renderer must never become authoritative:\n');
  for (const v of violations) console.error('  ✗ ' + v);
  process.exit(1);
}
console.log('seam check ok — src/data imports nothing from the render layer');
