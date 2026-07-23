import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAPTURE_DEADLINE_MS,
  EDGE_CAPTURE_TIMEOUT_MS,
  FRAME_SETTLE_MS,
  FULL_FINALIZATION_MIN_REMAINING_MS,
  NAV_TIMEOUT_MS,
  OPTIONAL_FRAME_MIN_REMAINING_MS,
  POST_NAV_SETTLE_MS,
  SOFT_SAMPLING_BUDGET_MS,
  TOP_FRAME_RESERVE_MS,
  buildCaptureOutcomeLog,
  classifyCaptureOutcome,
  extractTargetHostname,
  startMonotonicTimer,
} from '../src/captureLifecycle.js';
import { DISMISS_BUDGET_MS } from '../src/dismissPopups.js';

test('capture timing budgets preserve the service and edge timeout ordering', () => {
  assert.equal(SOFT_SAMPLING_BUDGET_MS, 10_000);
  assert.equal(CAPTURE_DEADLINE_MS, 13_000);
  assert.equal(EDGE_CAPTURE_TIMEOUT_MS, 15_000);
  assert.ok(SOFT_SAMPLING_BUDGET_MS < CAPTURE_DEADLINE_MS);
  assert.ok(CAPTURE_DEADLINE_MS < EDGE_CAPTURE_TIMEOUT_MS);
});

test('capture phase thresholds preserve top-frame and finalization reserves', () => {
  assert.equal(NAV_TIMEOUT_MS, 9_000);
  assert.equal(POST_NAV_SETTLE_MS, 200);
  assert.equal(FRAME_SETTLE_MS, 75);
  assert.equal(TOP_FRAME_RESERVE_MS + DISMISS_BUDGET_MS, 3_500);
  assert.equal(OPTIONAL_FRAME_MIN_REMAINING_MS, 2_000);
  assert.equal(FULL_FINALIZATION_MIN_REMAINING_MS, 1_000);
});

test('monotonic timer includes exact budget boundaries and clamps exhaustion', () => {
  let now = 500;
  const timer = startMonotonicTimer(() => now);

  assert.equal(timer.elapsedMs(), 0);
  assert.equal(timer.remainingMs(), 10_000);
  now = 7_000;
  assert.equal(timer.elapsedMs(), 6_500);
  assert.equal(timer.remainingMs(), 3_500);
  assert.equal(timer.hasRemaining(3_500), true);
  assert.equal(timer.hasRemaining(3_501), false);
  now = 10_501;
  assert.equal(timer.remainingMs(), 0);
  assert.equal(timer.hasRemaining(1), false);
});

test('outcome classification distinguishes complete, partial, timeout, and error attempts', () => {
  assert.equal(classifyCaptureOutcome({
    completed: true,
    framesCaptured: 3,
  }), 'success');
  assert.equal(classifyCaptureOutcome({
    completed: true,
    framesCaptured: 1,
  }), 'success');
  assert.equal(classifyCaptureOutcome({
    completed: false,
    framesCaptured: 2,
  }), 'partial');
  assert.equal(classifyCaptureOutcome({
    completed: false,
    framesCaptured: 0,
  }), 'timeout');
  assert.equal(classifyCaptureOutcome({
    completed: false,
    framesCaptured: 1,
    failure: 'timeout',
  }), 'timeout');
  assert.equal(classifyCaptureOutcome({
    completed: false,
    framesCaptured: 0,
    failure: 'error',
  }), 'error');
});

test('target hostname extraction normalizes only the host and fails closed', () => {
  assert.equal(
    extractTargetHostname('HTTPS://Example.COM:8443/private/path?token=secret#content'),
    'example.com',
  );
  assert.equal(extractTargetHostname('Example.COM/path'), 'example.com');
  assert.equal(extractTargetHostname('not a valid url'), '');
});

test('capture outcome logs expose only the normalized host from the target URL', () => {
  const log = buildCaptureOutcomeLog({
    timestamp: '2026-07-23T20:00:00.000Z',
    targetUrl: 'https://Example.COM/private/path?token=secret#content',
    durationMs: 9_876.4,
    outcome: 'partial',
    framesCaptured: 1,
    processUptimeMs: 12_345.6,
  });

  assert.deepEqual(log, {
    event: 'capture_request_outcome',
    timestamp: '2026-07-23T20:00:00.000Z',
    target_host: 'example.com',
    duration_ms: 9_876,
    outcome: 'partial',
    frames_captured: 1,
    process_uptime_ms: 12_346,
  });
  assert.deepEqual(Object.keys(log), [
    'event',
    'timestamp',
    'target_host',
    'duration_ms',
    'outcome',
    'frames_captured',
    'process_uptime_ms',
  ]);
  const serialized = JSON.stringify(log);
  for (const privateValue of ['/private/path', 'token', 'secret', '#content']) {
    assert.equal(serialized.includes(privateValue), false);
  }
});
