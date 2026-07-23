import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifyAppError,
  isChunkLoadError,
  isOfflineLikeError,
} from '../src/lib/clientErrors.ts'

test('chunk-load errors recognize browser, Vite, and bundler variants', () => {
  const namedError = new Error('The requested chunk could not be loaded')
  namedError.name = 'ChunkLoadError'

  for (const error of [
    namedError,
    new Error('Loading chunk campaign-wizard failed.'),
    new TypeError(
      'Failed to fetch dynamically imported module: https://example.test/assets/page.js',
    ),
    new TypeError(
      'error loading dynamically imported module: https://example.test/src/page.tsx',
    ),
    new TypeError('Importing a module script failed.'),
  ]) {
    assert.equal(isChunkLoadError(error), true)
  }

  assert.equal(isChunkLoadError(new Error('Poster rendering failed')), false)
})

test('offline-like errors preserve browser and SDK transport signals', () => {
  for (const error of [
    new TypeError('Failed to fetch'),
    new Error('NetworkError when attempting to fetch resource.'),
    { error: 'NETWORK_ERROR', message: 'Request unavailable' },
    { code: 'REQUEST_TIMEOUT', message: 'Request expired' },
    { statusCode: 0, message: 'Request unavailable' },
  ]) {
    assert.equal(isOfflineLikeError(error), true)
  }

  assert.equal(isOfflineLikeError(new Error('Poster rendering failed')), false)
})

test('browser connectivity is authoritative for dynamic-import error copy', () => {
  const chunkError = new TypeError(
    'Failed to fetch dynamically imported module: https://example.test/page.js',
  )

  assert.equal(classifyAppError(chunkError, true), 'unexpected')
  assert.equal(classifyAppError(chunkError, false), 'connection')
  assert.equal(classifyAppError(new Error('Unexpected render failure'), true), 'unexpected')
  assert.equal(classifyAppError(new TypeError('Failed to fetch'), true), 'connection')
})
