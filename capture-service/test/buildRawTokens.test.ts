import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRawTokens, primaryFamily } from '../src/buildRawTokens.js';
import type { ElementSample, RawTokens } from '../src/types.js';

const META: RawTokens['meta'] = {
  url: 'https://example.com',
  finalUrl: 'https://example.com',
  title: 'Example',
  viewport: { width: 1280, height: 800 },
};

function sample(overrides: Partial<ElementSample> = {}): ElementSample {
  return {
    tag: 'P',
    role: 'body',
    isButton: false,
    area: 1000,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 24,
    color: 'rgb(17, 24, 39)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderRadius: 0,
    boxShadow: 'none',
    paddingX: 0,
    paddingY: 0,
    isLink: false,
    ...overrides,
  };
}

test('primaryFamily strips the stack to the first family without quotes', () => {
  assert.equal(primaryFamily('"Inter", system-ui, sans-serif'), 'Inter');
  assert.equal(primaryFamily('Inter, system-ui'), 'Inter');
  assert.equal(primaryFamily("'Playfair Display', serif"), 'Playfair Display');
  assert.equal(primaryFamily(''), '');
});

test('heading and body fonts are separated by role and ranked by area', () => {
  const raw = buildRawTokens(
    [
      sample({ tag: 'H1', role: 'heading', area: 5000, fontFamily: 'Poppins, sans-serif' }),
      sample({ tag: 'P', role: 'body', area: 3000, fontFamily: 'Inter, sans-serif' }),
      sample({ tag: 'P', role: 'body', area: 2000, fontFamily: 'Inter, sans-serif' }),
    ],
    [],
    META,
  );
  const heading = raw.fonts.find((f) => f.role === 'heading');
  const body = raw.fonts.find((f) => f.role === 'body');
  assert.equal(heading?.value, 'Poppins');
  assert.equal(body?.value, 'Inter');
});

test('transparent and near-zero-alpha colors are dropped', () => {
  const raw = buildRawTokens(
    [
      sample({ color: 'rgba(0, 0, 0, 0)', backgroundColor: 'rgba(255,255,255,0.02)' }),
      sample({ color: 'rgb(20, 20, 20)', backgroundColor: 'rgb(255, 255, 255)' }),
    ],
    [],
    META,
  );
  const values = raw.colors.map((c) => c.value);
  assert.ok(!values.includes('rgba(0, 0, 0, 0)'));
  assert.ok(values.includes('rgb(20, 20, 20)'));
  assert.ok(values.includes('rgb(255, 255, 255)'));
});

test('button sample is the largest-area button', () => {
  const raw = buildRawTokens(
    [
      sample({ isButton: true, area: 500, backgroundColor: 'rgb(10, 10, 10)', borderRadius: 4 }),
      sample({
        isButton: true,
        area: 4000,
        backgroundColor: 'rgb(79, 70, 229)',
        color: 'rgb(255,255,255)',
        borderRadius: 12,
        fontWeight: 600,
        paddingX: 20,
        paddingY: 12,
      }),
    ],
    [],
    META,
  );
  assert.equal(raw.button?.bg, 'rgb(79, 70, 229)');
  assert.equal(raw.button?.radius, 12);
  assert.equal(raw.button?.weight, 600);
  assert.equal(raw.button?.paddingX, 20);
});

test('numeric scales bucket, dedupe, and sort ascending', () => {
  const raw = buildRawTokens(
    [
      sample({ fontSize: 16, borderRadius: 8, paddingX: 16, paddingY: 16 }),
      sample({ fontSize: 16.4, borderRadius: 8, paddingX: 15, paddingY: 17 }),
      sample({ fontSize: 32, borderRadius: 24, paddingX: 24, paddingY: 8 }),
    ],
    [],
    META,
  );
  // 16 and 16.4 collapse to one 16 bucket; sizes sorted asc.
  assert.deepEqual(raw.fontSizes, [16, 32]);
  assert.deepEqual(raw.radii, [8, 24]);
  // spacing bucketed to step 4
  assert.ok(raw.spacing.every((s) => s % 4 === 0));
  assert.deepEqual([...raw.spacing].sort((a, b) => a - b), raw.spacing);
});

test('font links are deduped and capped', () => {
  const link = 'https://fonts.googleapis.com/css2?family=Inter';
  const raw = buildRawTokens([sample()], [link, link, 'https://fonts.gstatic.com/x'], META);
  assert.equal(raw.fontLinks.filter((l) => l === link).length, 1);
});

test('shadows ranked by area, "none" excluded', () => {
  const raw = buildRawTokens(
    [
      sample({ boxShadow: 'none', area: 9999 }),
      sample({ boxShadow: '0 4px 12px rgba(0,0,0,0.1)', area: 3000 }),
      sample({ boxShadow: '0 1px 2px rgba(0,0,0,0.05)', area: 1000 }),
    ],
    [],
    META,
  );
  assert.ok(!raw.shadows.includes('none'));
  assert.equal(raw.shadows[0], '0 4px 12px rgba(0,0,0,0.1)');
});

test('empty input yields empty, well-formed tokens', () => {
  const raw = buildRawTokens([], [], META);
  assert.deepEqual(raw.fonts, []);
  assert.deepEqual(raw.colors, []);
  assert.equal(raw.button, null);
  assert.equal(raw.meta.url, 'https://example.com');
});
