import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignTokens } from '../src/normalizeDesignTokens.js';
import type { RawTokens } from '../src/types.js';

const baseRaw: RawTokens = {
  fonts: [
    { value: 'Poppins', count: 5000, role: 'heading' },
    { value: 'system-ui', count: 9000, role: 'body' },
    { value: 'Inter', count: 4000, role: 'body' },
  ],
  fontSizes: [16, 16, 32, 48],
  fontWeights: [400, 400, 700],
  colors: [
    { value: 'rgb(255, 255, 255)', count: 9000, role: 'bg' },
    { value: 'rgb(17, 24, 39)', count: 7000, role: 'text' },
    { value: 'rgb(79, 70, 229)', count: 3000, role: 'button-bg' },
    { value: 'rgb(236, 72, 153)', count: 800, role: 'link' },
  ],
  radii: [8, 8, 12, 24],
  shadows: ['none', '0 4px 12px rgba(0,0,0,0.1)'],
  spacing: [8, 16, 16, 24],
  button: {
    bg: 'rgb(79, 70, 229)',
    color: 'rgb(255,255,255)',
    radius: 12,
    paddingX: 20,
    paddingY: 12,
    weight: 600,
    shadow: 'none',
  },
  fontLinks: ['https://fonts.googleapis.com/css2?family=Poppins'],
  meta: {
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    title: 'Example',
    viewport: { width: 1280, height: 800 },
  },
};

test('returns null for an empty capture', () => {
  assert.equal(normalizeDesignTokens(undefined), null);
  assert.equal(normalizeDesignTokens({ ...baseRaw, colors: [], fonts: [] }), null);
});

test('prefers named fonts and assigns captured color roles', () => {
  const tokens = normalizeDesignTokens(baseRaw);
  assert.ok(tokens);
  assert.equal(tokens.typography.headingFamily, 'Poppins');
  assert.equal(tokens.typography.bodyFamily, 'Inter');
  assert.equal(tokens.colors.bg, '#ffffff');
  assert.equal(tokens.colors.text, '#111827');
  assert.equal(tokens.colors.primary, '#4f46e5');
  assert.ok(['#4f46e5', '#ec4899'].includes(tokens.colors.accent));
});

test('dedupes bounded scales and normalizes button colors', () => {
  const tokens = normalizeDesignTokens(baseRaw);
  assert.ok(tokens);
  assert.deepEqual(tokens.typography.scale, [16, 32, 48]);
  assert.deepEqual(tokens.typography.weights, [400, 700]);
  assert.deepEqual(tokens.radii, [8, 12, 24]);
  assert.deepEqual(tokens.shadows, ['0 4px 12px rgba(0,0,0,0.1)']);
  assert.equal(tokens.button?.bg, '#4f46e5');
  assert.equal(tokens.button?.color, '#ffffff');
});
