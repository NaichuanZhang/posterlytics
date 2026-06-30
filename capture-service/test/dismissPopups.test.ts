import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConsentLabel, isBlockingOverlay } from '../src/dismissPopups.js';

test('isConsentLabel accepts recognized accept/close labels (case-insensitive, multilingual)', () => {
  for (const label of ['Accept', 'accept all', 'Got it', 'Close', 'OK', 'No thanks', 'Akzeptieren', 'Aceptar', '✕']) {
    assert.equal(isConsentLabel(label), true, `expected "${label}" to be a consent label`);
  }
});

test('isConsentLabel rejects non-consent labels, long sentences, and empty', () => {
  assert.equal(isConsentLabel('Subscribe'), false);
  assert.equal(isConsentLabel('Learn more'), false);
  assert.equal(isConsentLabel('Sign up for our newsletter'), false);
  // A long "I agree…" sentence must not match (length guard excludes paragraphs).
  assert.equal(isConsentLabel('I agree to the terms and conditions and privacy policy'), false);
  assert.equal(isConsentLabel(''), false);
  assert.equal(isConsentLabel('   '), false);
});

test('isBlockingOverlay is true only for fixed/sticky, high-z, large-coverage overlays', () => {
  assert.equal(isBlockingOverlay({ position: 'fixed', zIndex: 9999, coverage: 0.8 }), true);
  assert.equal(isBlockingOverlay({ position: 'sticky', zIndex: 1000, coverage: 0.6 }), true);
});

test('isBlockingOverlay spares sticky headers, in-flow content, and low-z elements', () => {
  // Sticky header: positioned + high-z but tiny coverage → not a blocker.
  assert.equal(isBlockingOverlay({ position: 'sticky', zIndex: 1000, coverage: 0.1 }), false);
  // In-flow big section: covers a lot but not positioned → keep.
  assert.equal(isBlockingOverlay({ position: 'static', zIndex: 0, coverage: 0.9 }), false);
  // Low z-index fixed element (e.g. a chat bubble) → keep.
  assert.equal(isBlockingOverlay({ position: 'fixed', zIndex: 10, coverage: 0.7 }), false);
  // Relative positioning never qualifies.
  assert.equal(isBlockingOverlay({ position: 'relative', zIndex: 9999, coverage: 0.95 }), false);
});
