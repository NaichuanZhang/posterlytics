// A4 print-sheet geometry — the single source of truth for the poster layout.
// The sheet is portrait A4 at 150dpi; the export captures at pixelRatio 2 for a
// 300-DPI 2480×3508 PNG. The complete 2:3 AI artwork sits centered on the sheet
// (never cropped — object-fit: contain) with side mattes, and the QR footer is
// its own row OUTSIDE the artwork. Every number here is pure and unit-tested
// (tests/posterGeometry.test.ts) so the sheet always adds up exactly:
//   width:  MATTE_X + ARTWORK_WIDTH + MATTE_X                    = 1240
//   height: MARGIN_Y + ARTWORK_HEIGHT + GAP + FOOTER_H + MARGIN_Y = 1754
export const POSTER_WIDTH = 1240
export const POSTER_HEIGHT = 1754

// The 2:3 artwork area (exactly 980:1470 = 2:3), centered horizontally.
export const ARTWORK_WIDTH = 980
export const ARTWORK_HEIGHT = 1470
export const MATTE_X = (POSTER_WIDTH - ARTWORK_WIDTH) / 2 // 130px side mattes

export const SHEET_MARGIN_Y = 24 // top and bottom sheet margins
export const MATTE_GAP = 16 // gap between artwork and footer
export const FOOTER_H = 220 // QR footer row, aligned with the artwork width

export const QR_PX = 150
