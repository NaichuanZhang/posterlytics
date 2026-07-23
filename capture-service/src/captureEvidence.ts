import sharp from 'sharp';
import { buildRawTokens } from './buildRawTokens.js';
import {
  CaptureDeadlineError,
  classifyCaptureOutcome,
} from './captureLifecycle.js';
import { normalizeDesignTokens } from './normalizeDesignTokens.js';
import { extractPixelEvidence } from './pixelPalette.js';
import type {
  CompletedCaptureOutcome,
  DesignTokens,
  ElementSample,
  RawTokens,
} from './types.js';

const FRAME_QUALITY = 78;
const STYLE_BOARD_WIDTH = 960;
const STYLE_BOARD_QUALITY = 68;

export interface CaptureEvidenceResult {
  tokens: DesignTokens;
  styleBoard: Buffer;
  outcome: CompletedCaptureOutcome;
}

export async function finalizeCaptureEvidence({
  samples,
  fontLinks,
  meta,
  frameBuffers,
  captureComplete,
  useFastPath,
}: {
  samples: ElementSample[];
  fontLinks: string[];
  meta: RawTokens['meta'];
  frameBuffers: Buffer[];
  captureComplete: boolean;
  useFastPath: boolean;
}): Promise<CaptureEvidenceResult> {
  const rawTokens = buildRawTokens(samples, fontLinks, meta);
  if (useFastPath) {
    return partialEvidence(rawTokens, frameBuffers);
  }

  try {
    const styleBoard = await mergeStyleBoard(frameBuffers);
    const pixelEvidence = await readPixelEvidence(styleBoard);
    const tokens = normalizeDesignTokens(rawTokens, pixelEvidence);
    if (!tokens) throw new CaptureDeadlineError();

    const outcome = classifyCaptureOutcome({
      completed: captureComplete,
      framesCaptured: frameBuffers.length,
    });
    if (outcome !== 'success' && outcome !== 'partial') {
      throw new CaptureDeadlineError();
    }
    return { tokens, styleBoard, outcome };
  } catch {
    // Successful browser evidence is still useful if Sharp merge/pixel work
    // cannot finish. The raw first frame avoids spending more finalization time.
    return partialEvidence(rawTokens, frameBuffers);
  }
}

function partialEvidence(
  rawTokens: RawTokens,
  frameBuffers: Buffer[],
): CaptureEvidenceResult {
  const styleBoard = frameBuffers[0];
  const tokens = normalizeDesignTokens(rawTokens);
  if (!styleBoard || !tokens) throw new CaptureDeadlineError();

  const outcome = classifyCaptureOutcome({
    completed: false,
    framesCaptured: frameBuffers.length,
  });
  if (outcome !== 'partial') throw new CaptureDeadlineError();
  return { tokens, styleBoard, outcome };
}

export async function mergeStyleBoard(frames: Buffer[]): Promise<Buffer> {
  if (frames.length === 0) throw new CaptureDeadlineError();
  const normalized = await Promise.all(frames.map(async (frame) => {
    const { data, info } = await sharp(frame)
      .resize({ width: STYLE_BOARD_WIDTH, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: FRAME_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }));
  const width = Math.max(...normalized.map((frame) => frame.width));
  const height = normalized.reduce((sum, frame) => sum + frame.height, 0);
  let top = 0;
  const composites = normalized.map((frame) => {
    const input = { input: frame.data, left: 0, top };
    top += frame.height;
    return input;
  });
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(composites)
    .jpeg({ quality: STYLE_BOARD_QUALITY, mozjpeg: true })
    .toBuffer();
}

export async function readPixelEvidence(styleBoard: Buffer) {
  const { data, info } = await sharp(styleBoard)
    .resize({ width: 180, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return extractPixelEvidence(data, info.channels);
}
