import {
  REDNOTE_POST_FORMAT,
  getRedNotePageComposition,
  parseRedNotePostPlan,
  type RedNotePostPlan,
} from '../src/lib/redNotePost.ts';
import {
  normalizeStyleProfile,
  type NormalizedStyleProfile,
  type PosterLayout,
} from './_shared.ts';
import {
  colorNameForHex,
  replacePainterHexColors,
} from './_painterColors.ts';

export const REDNOTE_BACKGROUND_RENDER_MODE = 'rednote-background-v1' as const;

export const REDNOTE_BACKGROUND_PREVIOUS_PURPOSE =
  'Previous text-free RedNote background; preserve useful visual continuity without copying or rendering text, letters, numbers, logos, wordmarks, or faux glyphs.';

export const REDNOTE_BACKGROUND_REFERENCE_PURPOSE =
  'User-supplied visual evidence for mood, imagery, lighting, texture, palette, motifs, and composition only; do not copy or render any visible text, letters, numbers, logos, wordmarks, or faux glyphs.';

export interface RedNoteBackgroundInput {
  posterContent: unknown;
  styleProfile: unknown;
  posterFormat: unknown;
}

export class RedNoteBackgroundValidationError extends Error {
  code = 'invalid_rednote_background_input';
  retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'RedNoteBackgroundValidationError';
  }
}

export function deriveRedNoteBackgroundLayout(
  input: RedNoteBackgroundInput,
): PosterLayout {
  const plan = requireRedNotePlan(input.posterContent);
  if (input.posterFormat !== REDNOTE_POST_FORMAT) {
    throw new RedNoteBackgroundValidationError(
      'RedNote background generation requires the full-bleed 3:4 format.',
    );
  }

  const style = normalizeStyleProfile(input.styleProfile);
  const composition = getRedNotePageComposition(
    plan.pages[0],
    0,
    plan.pages.length,
  );
  const reserved = composition.coverText;
  if (!reserved) {
    throw new RedNoteBackgroundValidationError(
      'RedNote background generation requires a leading cover page.',
    );
  }

  return {
    render_mode: REDNOTE_BACKGROUND_RENDER_MODE,
    composition: style.composition
      || style.layout_hint
      || 'full-bleed editorial background with a clear lower text reserve',
    mood: style.tone || 'editorial, focused',
    art_style: style.texture
      || 'reference-led editorial image with restrained graphic layering',
    ...(style.imagery ? { imagery: style.imagery } : {}),
    ...(style.lighting ? { lighting: style.lighting } : {}),
    ...(style.texture ? { texture: style.texture } : {}),
    ...(style.motifs?.length ? { motifs: [...style.motifs] } : {}),
    density: style.density || 'balanced',
    palette_roles: clonePalette(style),
    zones: [
      {
        band: 'top',
        role: 'text-free visual atmosphere and edge-to-edge background',
        content: '',
        emphasis: 'low',
      },
      {
        band: 'upper',
        role: 'primary text-free imagery focal area',
        content: '',
        emphasis: 'high',
      },
      {
        band: 'mid',
        role: 'supporting depth, texture, and visual transition',
        content: '',
        emphasis: 'med',
      },
      {
        band: 'lower',
        role:
          `quiet text-safe reserve at x ${reserved.x}, y ${reserved.y}, width ${reserved.width}, height ${reserved.height}`,
        content: '',
        emphasis: 'low',
      },
    ],
  };
}

export function buildRedNoteBackgroundPrompt(
  layout: PosterLayout,
  posterFormat: unknown,
  posterContent: unknown,
): string {
  if (!isRedNoteBackgroundLayout(layout)) {
    throw new RedNoteBackgroundValidationError(
      'RedNote hero generation requires the deterministic background layout marker.',
    );
  }
  if (posterFormat !== REDNOTE_POST_FORMAT) {
    throw new RedNoteBackgroundValidationError(
      'RedNote hero generation requires the full-bleed 3:4 format.',
    );
  }
  requireRedNotePlan(posterContent);

  const p = layout.palette_roles;
  const visualDirection = [
    `Composition: ${layout.composition}.`,
    `Mood: ${layout.mood}.`,
    `Visual treatment: ${layout.art_style}.`,
    layout.imagery ? `Imagery: ${layout.imagery}.` : '',
    layout.lighting ? `Lighting: ${layout.lighting}.` : '',
    layout.texture ? `Texture and material finish: ${layout.texture}.` : '',
    layout.motifs?.length ? `Motifs: ${layout.motifs.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
  const supporting = [p.secondary, ...(p.supporting ?? [])]
    .filter((color): color is string => !!color)
    .map((color) => colorNameForHex(color, 'reference-matched color'))
    .join(', ');
  const proportions = p.proportions?.length
    ? p.proportions
        .map((entry) =>
          `${colorNameForHex(entry.color, 'reference-matched color')} about ${
            Math.round(entry.proportion * 100)
          }%`
        )
        .join(', ')
    : '';

  return replacePainterHexColors(
    `Create one clean, text-free PORTRAIT 3:4 full-bleed background image for a multi-page RedNote post.
${visualDirection}

Fill the complete frame with an intentional editorial composition. Keep the lower cover-copy reserve quiet and readable: x 96 to 1146, y 852 to 1488 in a 1242 by 1656 frame. Preserve useful negative space there while keeping the surrounding image visually complete. Do not draw a panel, card, textbox, label, placeholder, or interface in the reserve.

Use the palette as area fills and image color direction: background ${colorNameForHex(p.bg, 'reference-matched background')}; primary ${colorNameForHex(p.primary, 'reference-matched primary')}; accent ${colorNameForHex(p.accent, 'reference-matched accent')};${p.surface ? ` surface ${colorNameForHex(p.surface, 'reference-matched surface')};` : ''}${supporting ? ` supporting ${supporting};` : ''} keep accents restrained and preserve the reference-led hierarchy.${proportions ? ` Approximate color-area proportions: ${proportions}.` : ''}

Attached references are visual evidence only. Use their mood, imagery, lighting, texture, palette, motifs, and composition without copying any visible writing or identity marks.

ABSOLUTE TEXT EXCLUSION: render no letters, words, numbers, punctuation, symbols, captions, logos, wordmarks, watermarks, signatures, labels, UI, buttons, badges, QR codes, barcodes, faux typography, or text-like glyphs anywhere. Do not imitate writing in any language. Remove or abstract any writing visible in references.

High quality, sharp, cohesive, professional editorial background. The result must remain useful behind programmatically composited DOM text.`,
  );
}

export function isRedNoteBackgroundLayout(
  value: unknown,
): value is PosterLayout & {
  render_mode: typeof REDNOTE_BACKGROUND_RENDER_MODE;
} {
  return !!value
    && typeof value === 'object'
    && (value as Record<string, unknown>).render_mode
      === REDNOTE_BACKGROUND_RENDER_MODE;
}

export function hasCompatibleRedNoteBackgroundParent(value: unknown): boolean {
  return isRedNoteBackgroundLayout(value);
}

function requireRedNotePlan(posterContent: unknown): RedNotePostPlan {
  const content = recordOf(posterContent);
  const plan = parseRedNotePostPlan(content.rednote_post);
  if (!plan) {
    throw new RedNoteBackgroundValidationError(
      'RedNote background generation requires a valid multi-page post plan.',
    );
  }
  return plan;
}

function clonePalette(
  style: NormalizedStyleProfile,
): PosterLayout['palette_roles'] {
  const palette = style.palette;
  return {
    bg: palette.bg,
    text: palette.text,
    primary: palette.primary,
    accent: palette.accent,
    ...(palette.secondary ? { secondary: palette.secondary } : {}),
    ...(palette.supporting?.length
      ? { supporting: [...palette.supporting] }
      : {}),
    ...(palette.proportions?.length
      ? {
          proportions: palette.proportions.map((entry) => ({ ...entry })),
        }
      : {}),
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
