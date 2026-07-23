export interface ModelCopyPolicy {
  verbatimTexts?: readonly string[];
  emojiSourceTexts?: readonly string[];
}

const DEFAULT_MAX_CODE_POINTS = 280;

const SOURCEABLE_CTA = new Set([
  'sign up',
  'get started',
]);

const STRUCTURAL_PLACEHOLDERS = new Set([
  'body',
  'body copy',
  'brand logo',
  'brand name',
  'button text',
  'call to action',
  'company logo',
  'company name',
  'copy',
  'cta',
  'description',
  'feature',
  'features',
  'headline',
  'insert headline',
  'logo',
  'placeholder',
  'product name',
  'subhead',
  'subheadline',
  'subtitle',
  'tagline',
  'text',
  'title',
  'tbd',
  'todo',
  'your headline',
  'your logo',
]);

const SOURCEABLE_CTA_PATTERNS = new Map([
  [
    'sign up',
    /(?:^|[^\p{L}\p{N}_])sign\s+up(?=$|[^\p{L}\p{N}_])/iu,
  ],
  [
    'get started',
    /(?:^|[^\p{L}\p{N}_])get\s+started(?=$|[^\p{L}\p{N}_])/iu,
  ],
]);

const CJK_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;

const EMOJI_COMPONENT =
  String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F?)(?:\p{Emoji_Modifier})?`;
const DECORATIVE_EMOJI_SOURCE = [
  `${EMOJI_COMPONENT}(?:\\u200D${EMOJI_COMPONENT})+`,
  String.raw`[0-9#*]\uFE0F?\u20E3`,
  String.raw`\p{Regional_Indicator}{2}`,
  String.raw`\p{Emoji_Presentation}[\u{E0020}-\u{E007E}]+\u{E007F}`,
  String.raw`\p{Emoji_Modifier_Base}\uFE0F?\p{Emoji_Modifier}`,
  String.raw`\p{Extended_Pictographic}\uFE0F`,
  String.raw`\p{Emoji_Presentation}\uFE0F?`,
].join('|');

const ADJACENT_LATIN_DUPLICATE =
  /(?<![\p{Script=Latin}\p{M}'’-])(\p{Script=Latin}[\p{Script=Latin}\p{M}'’-]*)([ \t]+)\1(?![\p{Script=Latin}\p{M}'’-])/giu;

export function sanitizeModelCopy(
  value: unknown,
  maxCodePoints = DEFAULT_MAX_CODE_POINTS,
  policy: ModelCopyPolicy = {},
): string {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFC').trim();
  if (!normalized) return '';

  const protectedTexts = normalizedPolicyTexts(policy.verbatimTexts);
  if (isSolePlaceholder(normalized, protectedTexts)) return '';
  if (protectedTexts.has(normalized)) {
    return finalizeBoundedCopy(normalized, maxCodePoints);
  }

  const allowedEmoji = collectAllowedEmoji(policy.emojiSourceTexts);
  let sanitized = normalized.replace(
    new RegExp(DECORATIVE_EMOJI_SOURCE, 'gu'),
    (emoji) => allowedEmoji.has(emojiKey(emoji)) ? emoji : '',
  );
  sanitized = collapseAdjacentLatinDuplicates(sanitized, protectedTexts);
  sanitized = collapseSeparators(sanitized);
  sanitized = sanitized.replace(/[ \t]{2,}/g, ' ').trim().normalize('NFC');
  if (!sanitized || isSolePlaceholder(sanitized, protectedTexts)) return '';
  sanitized = finalizeBoundedCopy(sanitized, maxCodePoints);
  if (!sanitized || isSolePlaceholder(sanitized, protectedTexts)) return '';
  return sanitized;
}

export function sanitizeModelCopyList(
  value: unknown,
  limit: number,
  maxCodePoints: number,
  policy: ModelCopyPolicy = {},
): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? [value]
      : [];
  const sanitized: string[] = [];
  for (const item of values) {
    const copy = sanitizeModelCopy(item, maxCodePoints, policy);
    if (copy) sanitized.push(copy);
    if (sanitized.length >= Math.max(0, limit)) break;
  }
  return sanitized;
}

function normalizedPolicyTexts(values: readonly string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.normalize('NFC').trim())
      .filter(Boolean),
  );
}

function collectAllowedEmoji(values: readonly string[] | undefined): Set<string> {
  const allowed = new Set<string>();
  const matcher = new RegExp(DECORATIVE_EMOJI_SOURCE, 'gu');
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(matcher)) {
      allowed.add(emojiKey(match[0]));
    }
  }
  return allowed;
}

function emojiKey(value: string): string {
  return value.replace(/\uFE0F/g, '').normalize('NFC');
}

function collapseAdjacentLatinDuplicates(
  value: string,
  protectedTexts: ReadonlySet<string>,
): string {
  const protectedPairs = new Set<string>();
  for (const source of protectedTexts) {
    for (const match of source.matchAll(ADJACENT_LATIN_DUPLICATE)) {
      protectedPairs.add(caseFold(`${match[1]} ${match[1]}`));
    }
  }

  let result = value;
  while (true) {
    const next = result.replace(
      ADJACENT_LATIN_DUPLICATE,
      (doubled, word: string) => {
        if (protectedPairs.has(caseFold(`${word} ${word}`))) return doubled;
        return /\p{Ll}/u.test(doubled) && !/[\p{Lu}\p{Lt}]/u.test(doubled)
          ? word
          : doubled;
      },
    );
    if (next === result) return result;
    result = next;
  }
}

function caseFold(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('en-US');
}

function collapseSeparators(value: string): string {
  const collapsed = trimTrailingSeparators(value).replace(
    /(?:\s*([·|—])\s*)(?:[·|—]\s*)+/gu,
    (match: string, separator: string, offset: number, source: string) =>
      isCjkAdjacentEmDashRun(match, offset, source)
        ? match
        : ` ${separator} `,
  );
  return trimTrailingSeparators(collapsed);
}

function trimTrailingSeparators(value: string): string {
  return value.replace(
    /\s*[·|—](?:\s*[·|—])*\s*$/u,
    (match: string, offset: number, source: string) =>
      isCjkAdjacentEmDashRun(match, offset, source) ? match : '',
  );
}

function isCjkAdjacentEmDashRun(
  match: string,
  offset: number,
  source: string,
): boolean {
  const separators = Array.from(match).filter(
    (character) => character === '·' || character === '|' || character === '—',
  );
  if (
    separators.length < 1 ||
    separators.some((separator) => separator !== '—')
  ) {
    return false;
  }

  const preceding = Array.from(source.slice(0, offset).trimEnd());
  const following = Array.from(source.slice(offset + match.length).trimStart());
  return (
    isCjkCharacter(preceding[preceding.length - 1]) ||
    isCjkCharacter(following[0])
  );
}

function isCjkCharacter(value: string | undefined): boolean {
  return value !== undefined && CJK_CHARACTER.test(value);
}

function isSolePlaceholder(
  value: string,
  protectedTexts: ReadonlySet<string>,
): boolean {
  let candidate = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  let wrapped = false;
  const wrappers: Record<string, string> = {
    '[': ']',
    '{': '}',
    '(': ')',
    '<': '>',
  };
  while (
    candidate.length >= 2 &&
    wrappers[candidate[0]] === candidate[candidate.length - 1]
  ) {
    wrapped = true;
    candidate = candidate.slice(1, -1).trim();
  }
  const folded = candidate
    .toLocaleLowerCase('en-US')
    .replace(/[.!?]+$/u, '')
    .trim();
  if (
    STRUCTURAL_PLACEHOLDERS.has(folded) ||
    /^lorem ipsum(?:\b[\p{L}\s,.;:'"-]*)?$/iu.test(folded)
  ) {
    return true;
  }
  if (!SOURCEABLE_CTA.has(folded)) return false;
  if (wrapped) return true;

  const matcher = SOURCEABLE_CTA_PATTERNS.get(folded);
  return !matcher || !Array.from(protectedTexts).some(
    (source) => matcher.test(source.normalize('NFKC')),
  );
}

function boundCodePoints(value: string, maxCodePoints: number): string {
  const safeLimit = Number.isFinite(maxCodePoints)
    ? Math.max(0, Math.floor(maxCodePoints))
    : DEFAULT_MAX_CODE_POINTS;
  return Array.from(value).slice(0, safeLimit).join('').normalize('NFC');
}

function finalizeBoundedCopy(value: string, maxCodePoints: number): string {
  return trimTrailingSeparators(boundCodePoints(value, maxCodePoints))
    .trim()
    .normalize('NFC');
}
