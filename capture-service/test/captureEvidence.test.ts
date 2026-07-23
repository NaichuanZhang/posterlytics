import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { finalizeCaptureEvidence } from '../src/captureEvidence.js';
import { CaptureDeadlineError } from '../src/captureLifecycle.js';
import type { ElementSample, RawTokens } from '../src/types.js';

const META: RawTokens['meta'] = {
  url: 'https://example.com/',
  finalUrl: 'https://example.com/',
  title: 'Example',
  viewport: { width: 1280, height: 800 },
};

function sample(): ElementSample {
  return {
    tag: 'H1',
    role: 'heading',
    isButton: false,
    area: 24_000,
    fontFamily: 'Inter, sans-serif',
    fontSize: 42,
    fontWeight: 700,
    lineHeight: 48,
    color: 'rgb(17, 24, 39)',
    backgroundColor: 'rgb(255, 255, 255)',
    borderRadius: 0,
    boxShadow: 'none',
    paddingX: 0,
    paddingY: 0,
    isLink: false,
  };
}

async function jpeg(color = '#2563eb'): Promise<Buffer> {
  return sharp({
    create: {
      width: 12,
      height: 8,
      channels: 3,
      background: color,
    },
  }).jpeg({ quality: 78 }).toBuffer();
}

test('one-frame fast path returns adoptable tokens and raw JPEG partial evidence', async () => {
  const frame = await jpeg();
  const result = await finalizeCaptureEvidence({
    samples: [sample()],
    fontLinks: ['https://fonts.googleapis.com/css2?family=Inter'],
    meta: META,
    frameBuffers: [frame],
    captureComplete: false,
    useFastPath: true,
  });

  assert.equal(result.outcome, 'partial');
  assert.equal(result.tokens.typography.headingFamily, 'Inter');
  assert.deepEqual(result.styleBoard, frame);

  const encoded = result.styleBoard.toString('base64');
  const decoded = Buffer.from(encoded, 'base64');
  assert.equal(decoded[0], 0xff);
  assert.equal(decoded[1], 0xd8);
  assert.equal((await sharp(decoded).metadata()).format, 'jpeg');
});

test('full finalization merges frames and adds pixel evidence', async () => {
  const result = await finalizeCaptureEvidence({
    samples: [sample()],
    fontLinks: [],
    meta: META,
    frameBuffers: [await jpeg('#ffffff'), await jpeg('#111827')],
    captureComplete: true,
    useFastPath: false,
  });

  assert.equal(result.outcome, 'success');
  assert.ok(result.tokens.colors.visualPalette?.length);
  assert.equal((await sharp(result.styleBoard).metadata()).format, 'jpeg');
});

test('budget-constrained finalization rejects zero screenshot frames', async () => {
  await assert.rejects(
    finalizeCaptureEvidence({
      samples: [sample()],
      fontLinks: [],
      meta: META,
      frameBuffers: [],
      captureComplete: false,
      useFastPath: true,
    }),
    CaptureDeadlineError,
  );
});

test('budget-constrained finalization rejects a screenshot without normalized tokens', async () => {
  await assert.rejects(
    finalizeCaptureEvidence({
      samples: [],
      fontLinks: [],
      meta: META,
      frameBuffers: [await jpeg()],
      captureComplete: false,
      useFastPath: true,
    }),
    CaptureDeadlineError,
  );
});
