import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureSite } from '../functions/_captureSite.ts'

test('capture client retains existing title and final_url response metadata', async () => {
  const originalDeno = globalThis.Deno
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const requests: Array<{ input: string; init?: RequestInit }> = []

  try {
    Object.assign(globalThis, {
      Deno: {
        env: {
          get: (key: string) => key === 'CAPTURE_SERVICE_URL'
            ? 'https://capture.example'
            : key === 'CAPTURE_TOKEN'
              ? 'capture-token'
              : undefined,
        },
      },
      fetch: async (input: string, init?: RequestInit) => {
        requests.push({ input, init })
        return new Response(JSON.stringify({
          tokens: null,
          screenshot_b64: null,
          title: 'Northstar Portable Signal Lamp',
          final_url: 'https://www.amazon.com/dp/B0TITLE001',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    console.info = () => {}

    assert.deepEqual(
      await captureSite('https://www.amazon.com/dp/B0TITLE001'),
      {
        tokens: null,
        styleBoardDataUrl: null,
        pageTitle: 'Northstar Portable Signal Lamp',
        finalUrl: 'https://www.amazon.com/dp/B0TITLE001',
        error: null,
      },
    )
    assert.equal(requests.length, 1)
    assert.equal(requests[0].input, 'https://capture.example/capture')
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).Authorization,
      'Bearer capture-token',
    )
  } finally {
    if (originalDeno === undefined) {
      delete (globalThis as { Deno?: unknown }).Deno
    } else {
      globalThis.Deno = originalDeno
    }
    globalThis.fetch = originalFetch
    console.info = originalInfo
  }
})
