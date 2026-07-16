import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  framePositions,
  visibleIntersectionArea,
} from '../src/frameSampling.js';

test('frame positions sample 0x, 0.8x, and 1.6x viewport height', () => {
  assert.deepEqual(framePositions(4000, 800), [0, 640, 1280]);
});

test('frame positions clamp and dedupe near the page end', () => {
  assert.deepEqual(framePositions(1450, 800), [0, 650]);
  assert.deepEqual(framePositions(800, 800), [0]);
  assert.deepEqual(framePositions(820, 800), [0]);
});

test('visible intersection weights only the portion inside the viewport', () => {
  const viewport = { width: 1280, height: 800 };
  assert.equal(
    visibleIntersectionArea({ left: 0, top: 0, right: 200, bottom: 100 }, viewport),
    20_000,
  );
  assert.equal(
    visibleIntersectionArea({ left: -50, top: 750, right: 150, bottom: 900 }, viewport),
    7_500,
  );
  assert.equal(
    visibleIntersectionArea({ left: 0, top: 801, right: 200, bottom: 900 }, viewport),
    0,
  );
});
