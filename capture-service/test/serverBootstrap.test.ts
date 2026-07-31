import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootstrapCaptureService } from '../src/serverBootstrap.js';

test('the service accepts traffic before Chromium is warmed', async () => {
  // The production failure this pins: a cold container held the connection for
  // the whole browser launch (measured 11.91s on GET /healthz), so the per-request
  // 13s deadline never armed and the edge's 15s abort fired instead, producing an
  // opaque timeout with no HTTP status rather than a structured retryable 504.
  const order: string[] = [];
  await bootstrapCaptureService({
    listen: async () => { order.push('listen'); },
    warmBrowser: async () => { order.push('warm'); },
    onWarmed: () => { order.push('warmed'); },
    onWarmFailed: () => { order.push('warm_failed'); },
  });

  assert.deepEqual(order, ['listen', 'warm', 'warmed']);
});

test('a warm-up failure still leaves the service listening', async () => {
  // Chromium can fail to launch for reasons a later request may not hit at all,
  // and captureUrl launches on demand anyway. Refusing to serve would turn a
  // recoverable cold start into an outage.
  const order: string[] = [];
  let reportedError: unknown = null;

  await bootstrapCaptureService({
    listen: async () => { order.push('listen'); },
    warmBrowser: async () => { throw new Error('chromium launch failed'); },
    onWarmed: () => { order.push('warmed'); },
    onWarmFailed: (error) => {
      order.push('warm_failed');
      reportedError = error;
    },
  });

  assert.deepEqual(order, ['listen', 'warm_failed']);
  assert.match((reportedError as Error).message, /chromium launch failed/);
});

test('warm duration is measured from after listen, not from process start', async () => {
  // The reported duration must describe the browser launch alone; folding the
  // listen step in would misattribute socket setup to Chromium.
  let clock = 1_000;
  const durations: number[] = [];

  await bootstrapCaptureService({
    listen: async () => { clock += 40; },
    warmBrowser: async () => { clock += 9_500; },
    onWarmed: (durationMs) => durations.push(durationMs),
    onWarmFailed: () => assert.fail('warm should have succeeded'),
    now: () => clock,
  });

  assert.deepEqual(durations, [9_500]);
});

test('bootstrap never rejects, so a warm failure cannot crash the process', async () => {
  await assert.doesNotReject(() => bootstrapCaptureService({
    listen: async () => {},
    warmBrowser: async () => { throw new Error('boom'); },
    onWarmed: () => {},
    onWarmFailed: () => {},
  }));
});
