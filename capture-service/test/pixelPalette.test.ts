import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPixelTheme,
  extractPixelEvidence,
} from '../src/pixelPalette.js';

function pixels(colors: Array<[number, number, number, number]>): Uint8Array {
  return Uint8Array.from(colors.flatMap(([r, g, b, count]) =>
    Array.from({ length: count }, () => [r, g, b]).flat()
  ));
}

test('pixel palette clusters nearby colors and reports weighted proportions', () => {
  const data = pixels([
    [3, 4, 5, 70],
    [10, 11, 12, 10],
    [240, 120, 20, 20],
  ]);
  const evidence = extractPixelEvidence(data, 3);
  assert.equal(evidence.visualPalette.length, 2);
  assert.ok(evidence.visualPalette[0].color.startsWith('#0'));
  assert.equal(evidence.visualPalette[0].proportion, 0.8);
  assert.equal(evidence.visualPalette[1].proportion, 0.2);
});

test('pixel theme classifies predominantly dark, light, and split boards', () => {
  const dark = pixels([[0, 0, 0, 80], [255, 255, 255, 20]]);
  const light = pixels([[255, 255, 255, 80], [0, 0, 0, 20]]);
  const mixed = pixels([[255, 255, 255, 50], [0, 0, 0, 50]]);
  assert.equal(classifyPixelTheme(dark, 3), 'dark');
  assert.equal(classifyPixelTheme(light, 3), 'light');
  assert.equal(classifyPixelTheme(mixed, 3), 'mixed');
});

test('transparent pixels do not affect palette or theme', () => {
  const rgba = Uint8Array.from([
    255, 255, 255, 0,
    0, 0, 0, 255,
  ]);
  const evidence = extractPixelEvidence(rgba, 4);
  assert.equal(evidence.visualPalette.length, 1);
  assert.equal(evidence.visualPalette[0].color, '#000000');
  assert.equal(evidence.theme, 'dark');
});
