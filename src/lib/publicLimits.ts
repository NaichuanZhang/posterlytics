/**
 * Limits the product actually enforces, as stated on the public terms page.
 *
 * These mirror `consume_capture_preview_quota` in db/schema.sql, which admits a
 * capture only while `v_short_count < 6 AND v_daily_count < 30`. They live here
 * so the public copy cannot quote a number the server does not enforce;
 * tests/publicLimits.test.ts asserts these against the migration SQL.
 *
 * Nothing here is a pricing or plan statement. No price, paid tier, or payment
 * path exists in this product, so none is described.
 */
export const CAPTURE_PREVIEW_LIMIT_PER_10_MINUTES = 6
export const CAPTURE_PREVIEW_LIMIT_PER_DAY = 30
