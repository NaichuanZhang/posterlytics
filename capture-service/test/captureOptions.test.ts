import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InvalidColorSchemeError,
  normalizeColorScheme,
} from '../src/captureOptions.js';

test('missing capture color scheme defaults to light for backward compatibility', () => {
  assert.equal(normalizeColorScheme(undefined), 'light');
  assert.equal(normalizeColorScheme(null), 'light');
});

test('capture color scheme accepts only light or dark', () => {
  assert.equal(normalizeColorScheme('light'), 'light');
  assert.equal(normalizeColorScheme('dark'), 'dark');
  assert.throws(() => normalizeColorScheme('system'), InvalidColorSchemeError);
  assert.throws(() => normalizeColorScheme(''), InvalidColorSchemeError);
});
