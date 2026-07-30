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

/**
 * Runs captureSite against a stubbed environment and returns the structured log
 * lines it emitted, so the outcome log can be asserted rather than eyeballed.
 */
async function captureWithLogs({
  configured = true,
  respond,
}: {
  configured?: boolean
  respond?: () => Promise<Response> | Response
}): Promise<{
  result: Awaited<ReturnType<typeof captureSite>>
  info: Array<Record<string, unknown>>
  warn: Array<Record<string, unknown>>
}> {
  const originalDeno = globalThis.Deno
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const originalWarn = console.warn
  const info: Array<Record<string, unknown>> = []
  const warn: Array<Record<string, unknown>> = []
  const collect = (sink: Array<Record<string, unknown>>) =>
    (...values: unknown[]) => {
      for (const value of values) {
        if (typeof value !== 'string') continue
        try {
          sink.push(JSON.parse(value) as Record<string, unknown>)
        } catch {
          // Non-JSON console output is not part of this contract.
        }
      }
    }

  try {
    Object.assign(globalThis, {
      Deno: {
        env: {
          get: (key: string) => !configured
            ? undefined
            : key === 'CAPTURE_SERVICE_URL'
              ? 'https://capture.example'
              : key === 'CAPTURE_TOKEN'
                ? 'capture-token'
                : undefined,
        },
      },
      fetch: async () => {
        if (!respond) throw new Error('network down')
        return respond()
      },
    })
    console.info = collect(info)
    console.warn = collect(warn)
    const result = await captureSite('https://Example.COM/products/one', 'dark')
    return { result, info, warn }
  } finally {
    if (originalDeno === undefined) {
      delete (globalThis as { Deno?: unknown }).Deno
    } else {
      globalThis.Deno = originalDeno
    }
    globalThis.fetch = originalFetch
    console.info = originalInfo
    console.warn = originalWarn
  }
}

test('every capture outcome is logged and correlates with its request line', async () => {
  const cases: Array<{
    name: string
    outcome: string
    severity: 'info' | 'warn'
    configured?: boolean
    respond?: () => Response
  }> = [
    {
      name: 'unconfigured service',
      outcome: 'capture_unconfigured',
      severity: 'warn',
      configured: false,
    },
    {
      name: 'upstream 5xx',
      outcome: 'capture_http_error',
      severity: 'warn',
      respond: () => new Response('{}', { status: 502 }),
    },
    {
      name: 'network failure',
      outcome: 'capture_network_error',
      severity: 'warn',
    },
    {
      name: 'success with evidence',
      outcome: 'ok',
      severity: 'info',
      respond: () => new Response(
        JSON.stringify({ tokens: { colors: {} }, screenshot_b64: 'AAA' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    },
    {
      name: '200 carrying no evidence at all',
      outcome: 'capture_empty_evidence',
      severity: 'warn',
      respond: () => new Response(
        JSON.stringify({ tokens: null, screenshot_b64: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    },
  ]

  for (const testCase of cases) {
    const { info, warn } = await captureWithLogs({
      configured: testCase.configured,
      respond: testCase.respond,
    })
    const outcomes = [...info, ...warn].filter(
      (line) => line.event === 'capture_site_outcome',
    )
    assert.equal(outcomes.length, 1, `${testCase.name}: expected one outcome log`)
    const [outcome] = outcomes
    assert.equal(outcome.outcome, testCase.outcome, testCase.name)
    // Failures must be warnings so they are separable from healthy traffic.
    const sink = testCase.severity === 'warn' ? warn : info
    assert.ok(
      sink.some((line) => line.event === 'capture_site_outcome'),
      `${testCase.name}: outcome logged at the wrong severity`,
    )
    // Only the hostname, lowercased — never the full URL or captured bytes.
    assert.equal(outcome.target_host, 'example.com', testCase.name)
    assert.equal(outcome.color_scheme, 'dark', testCase.name)
    assert.equal(typeof outcome.duration_ms, 'number', testCase.name)
    assert.ok((outcome.duration_ms as number) >= 0, testCase.name)
    assert.equal(typeof outcome.request_id, 'string', testCase.name)
    for (const line of [...info, ...warn]) {
      assert.doesNotMatch(
        JSON.stringify(line),
        /products\/one|AAA/,
        `${testCase.name}: log leaked the URL path or captured bytes`,
      )
    }

    // The request line is only emitted once the service is configured; when it is,
    // the pair must share a request_id so the two halves can be joined.
    const requests = info.filter((line) => line.event === 'capture_site_request')
    if (testCase.configured === false) {
      assert.equal(requests.length, 0, testCase.name)
    } else {
      assert.equal(requests.length, 1, testCase.name)
      assert.equal(requests[0].request_id, outcome.request_id, testCase.name)
    }
  }
})

test('capture failures stay retryable-tagged so transient causes are separable', async () => {
  const { result, warn } = await captureWithLogs({
    respond: () => new Response('{}', { status: 502 }),
  })
  const [outcome] = warn.filter((line) => line.event === 'capture_site_outcome')
  assert.equal(outcome.retryable, true)
  assert.equal(outcome.http_status, 502)
  assert.equal(result.error?.retryable, true)

  const unconfigured = await captureWithLogs({ configured: false })
  const [permanent] = unconfigured.warn.filter(
    (line) => line.event === 'capture_site_outcome',
  )
  assert.equal(permanent.retryable, false)
  assert.equal(unconfigured.result.error?.retryable, false)
})
