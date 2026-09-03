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

// ---------------------------------------------------------------------
// INV-7 — the help cannot drift from the grammar.
//
// The vocabulary overlay says "every row is a real capability that
// exists today; nothing aspirational is listed". The dangerous half of
// that promise is the other direction: a capability the grammar accepts
// and the help never mentions is a feature nobody can find, which for an
// operator surface is the same as not shipping it.
{
  const commands = readFileSync(join(ROOT, 'src/app/commands.ts'), 'utf8');
  const vocab = readFileSync(join(ROOT, 'src/ui/vocabPanel.ts'), 'utf8');
  const listed = [...commands.matchAll(/\{ text: '([^']+)'/g)].map((m) => m[1].trim());
  const missing = listed.filter((text) => {
    // Capitalised entries are SEED EXAMPLES for the command bar's
    // suggestion list — 'Find Toronto' is an instance of the generic
    // 'find <name>' the vocabulary already documents. The convention is
    // the data's own, and requiring a help row per example would be
    // requiring the help to list its own examples.
    if (/^[A-Z]/.test(text)) return false;
    // a row may name several spellings ('security · posture'), so match
    // on the primary word rather than the whole label
    const head = text.replace(/[<:/].*$/, '').trim().split(/\s+/)[0];
    return head.length > 2 && !vocab.includes(head);
  });
  if (missing.length) {
    violations.push(
      `src/ui/vocabPanel.ts: ${missing.length} command(s) the grammar accepts and the vocabulary never lists: ${missing.join(', ')}`
    );
  }
}

if (violations.length) {
  console.error('SEAM CHECK FAILED — renderer must never become authoritative:\n');
  for (const v of violations) console.error('  ✗ ' + v);
  process.exit(1);
}
console.log('seam check ok — src/data imports nothing from the render layer');
