// Test-only ESM loader hook (the part that runs on the loader thread).
// The SPA source uses Vite-style extensionless relative imports (e.g.
// `./colorUtils`); Node's ESM resolver needs an extension. Append `.ts` for
// relative specifiers that resolve to a real file, so `node --test` can run the
// TypeScript source directly. Used only by `npm test`.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  // Stub Deno `npm:`/`https:` specifiers so the pure helpers in functions/_shared.ts
  // (which top-imports `npm:@insforge/sdk`) can be unit-tested under node. The
  // SDK is never exercised by the pure functions we test.
  if (specifier.startsWith('npm:') || specifier.startsWith('https:') || specifier.startsWith('jsr:')) {
    return { url: new URL('./empty-module.mjs', import.meta.url).href, shortCircuit: true }
  }
  if (specifier.startsWith('.') && !/\.[mc]?[jt]s$/.test(specifier)) {
    try {
      const url = new URL(specifier + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(url))) {
        return nextResolve(specifier + '.ts', context)
      }
    } catch {
      // fall through to default resolution
    }
  }
  return nextResolve(specifier, context)
}
