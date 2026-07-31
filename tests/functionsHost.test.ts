import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveFunctionsHost } from '../src/lib/functionsHost.ts'

const API_BASE = 'https://3f9q2998.us-east.insforge.app'

test('the derived default is unchanged, so existing deployments keep working', () => {
  // Any drift here silently repoints every minted QR code.
  assert.equal(
    resolveFunctionsHost({ baseUrl: API_BASE }),
    'https://3f9q2998.functions.insforge.app',
  )
})

test('an explicit override wins, accepting a bare host or a full origin', () => {
  // Deno Deploy Classic was sunset 2026-07-20 and the replacement serves on
  // function2.insforge.app, so the host has to be movable by configuration.
  for (const override of [
    '3f9q2998.function2.insforge.app',
    'https://3f9q2998.function2.insforge.app',
    '  https://3f9q2998.function2.insforge.app/  ',
  ]) {
    assert.equal(
      resolveFunctionsHost({ override, baseUrl: API_BASE }),
      'https://3f9q2998.function2.insforge.app',
      `override ${JSON.stringify(override)} should resolve to the v2 origin`,
    )
  }
})

test('an unusable override falls back to the derived host instead of breaking URLs', () => {
  // A blank or malformed value must not be concatenated into a QR target — the
  // old inline literal could not express "ignore this", so it is pinned here.
  for (const override of ['', '   ', 'not a host!!', undefined, null]) {
    assert.equal(
      resolveFunctionsHost({ override, baseUrl: API_BASE }),
      'https://3f9q2998.functions.insforge.app',
      `override ${JSON.stringify(override)} should fall back`,
    )
  }
})

test('a non-HTTP override scheme is rejected, never used as a QR target', () => {
  // buildViewUrl feeds this straight into a rendered QR and a clipboard copy.
  // 'file:///etc/passwd' is the case that actually regressed: it has a scheme but
  // no authority, so a naive "does it contain ://" check prepended https and
  // produced the plausible-looking host 'https://file'.
  for (const override of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'file://host/path',
    'ftp://example.com',
    'mailto:someone@example.com',
    'ws://example.com',
  ]) {
    assert.equal(
      resolveFunctionsHost({ override, baseUrl: API_BASE }),
      'https://3f9q2998.functions.insforge.app',
      `scheme in ${JSON.stringify(override)} must not survive`,
    )
  }
})

test('a missing or malformed API base yields an empty host, not a broken one', () => {
  // Callers already treat '' as "functions unavailable"; a half-built
  // "https://undefined.functions..." would look valid and fail at request time.
  for (const baseUrl of ['', 'nonsense', undefined, null]) {
    assert.equal(resolveFunctionsHost({ baseUrl }), '')
  }
})

test('the functions host is resolved in one place, not re-derived per caller', () => {
  // The literal used to sit inline in insforge.ts. Keeping the derivation in a
  // single module is what makes the override reachable from every QR path.
  const client = readFileSync(new URL('../src/lib/insforge.ts', import.meta.url), 'utf8')
  assert.match(client, /resolveFunctionsHost\(\{/)
  assert.match(client, /VITE_INSFORGE_FUNCTIONS_HOST/)
  assert.doesNotMatch(
    client,
    /`https:\/\/\$\{appkey\}\.functions\.insforge\.app`/,
    'the inline literal must not come back',
  )
})
