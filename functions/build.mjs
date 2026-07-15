// Inlines functions/_shared.ts into each function so it deploys as a single
// file (InsForge `functions deploy --file` uploads only one file; Deno
// Subhosting can't resolve sibling imports). Output → functions/dist/<slug>.ts.
//
// Usage: node functions/build.mjs            (build all)
//        node functions/build.mjs view hero  (build a subset)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const distDir = join(dir, 'dist');
mkdirSync(distDir, { recursive: true });

// Read shared, strip `export ` so the symbols become file-local declarations.
const shared = readFileSync(join(dir, '_shared.ts'), 'utf8')
  .replace(/^export\s+(function|const|class|async)/gm, '$1');

const SHARED_BANNER =
  '// === inlined from _shared.ts (do not edit; run functions/build.mjs) ===\n';

const sourceSlugs = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
  .map((f) => f.replace(/\.ts$/, ''));

for (const file of readdirSync(distDir).filter((f) => f.endsWith('.ts'))) {
  if (!sourceSlugs.includes(file.replace(/\.ts$/, ''))) {
    rmSync(join(distDir, file));
    console.log(`removed orphaned dist/${file}`);
  }
}

const only = process.argv.slice(2);
const slugs = sourceSlugs
  .filter((s) => only.length === 0 || only.includes(s));

for (const slug of slugs) {
  const src = readFileSync(join(dir, `${slug}.ts`), 'utf8')
    // remove the shared import line entirely
    .replace(/^import\s+\{[^}]*\}\s+from\s+['"]\.\/_shared\.ts['"];?\s*$/gm, '');
  const out = `${SHARED_BANNER}${shared}\n// === function: ${slug} ===\n${src}`;
  writeFileSync(join(distDir, `${slug}.ts`), out);
  console.log(`built dist/${slug}.ts`);
}
