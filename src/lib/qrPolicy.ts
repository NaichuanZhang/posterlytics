import {
  DEFAULT_POSTER_SIZE_SLUG,
  getPosterSize,
  getPosterSizeTwin,
  hasPosterQrBand,
  splitPosterFormat,
  type PosterSizeSlug,
} from './posterSize'

/**
 * The QR band is a property of the poster format, not of the use case.
 *
 * These helpers are the single place that maps between a QR toggle and a format
 * slug, so the wizard, the editor and draft restore cannot drift apart. Nothing
 * here clears a destination or retires a placement: per
 * docs/decisions/2026-07-24-social-cover-qr-stitch.md, destination presence — not
 * band geometry — is the link-validity invariant, and a bandless poster may still
 * belong to a campaign with a live tracked link.
 */

/**
 * The campaign's effective format. `campaigns.poster_format` is optional on rows
 * predating the format migration, and every such row rendered the A4 default.
 */
export function effectivePosterFormat(
  format: PosterSizeSlug | null | undefined,
): PosterSizeSlug {
  return format ?? DEFAULT_POSTER_SIZE_SLUG
}

/** True when the persisted format carries a scannable QR footer band. */
export function posterFormatHasQr(
  format: PosterSizeSlug | null | undefined,
): boolean {
  return hasPosterQrBand(getPosterSize(effectivePosterFormat(format)))
}

/**
 * The format to persist when the creator flips the QR toggle, preserving the
 * chosen aspect. Returns the input unchanged when the aspect has no twin, so a
 * caller can never crash on `resolvePosterFormat`'s RangeError.
 */
export function posterFormatWithQr(
  format: PosterSizeSlug | null | undefined,
  qrEnabled: boolean,
): PosterSizeSlug {
  const current = effectivePosterFormat(format)
  if (posterFormatHasQr(current) === qrEnabled) return current
  return getPosterSizeTwin(current) ?? current
}

/** True when the aspect can express both band modes, i.e. the toggle is usable. */
export function posterFormatSupportsQrToggle(
  format: PosterSizeSlug | null | undefined,
): boolean {
  return getPosterSizeTwin(effectivePosterFormat(format)) !== null
}

/**
 * Whether a campaign in this format is REQUIRED to carry a usable destination.
 *
 * Mirrors the `campaigns_banded_format_destination_required` CHECK: a banded
 * format would otherwise render a dead QR band. One-directional — a bandless
 * format neither requires nor forbids a destination.
 */
export function posterFormatRequiresDestination(
  format: PosterSizeSlug | null | undefined,
): boolean {
  return posterFormatHasQr(format)
}

export { splitPosterFormat }
