// Wire + internal shapes for the capture service.
//
// Separation of concerns:
//   - `ElementSample` is the dumb, per-element reading the BROWSER collects
//     (one getComputedStyle snapshot). It never leaves the container.
//   - `RawTokens` is the compact, frequency-aggregated result the container
//     RETURNS. Building it from samples (`buildRawTokens`) is a pure function,
//     unit-tested here.
//   - The edge function (`analyze`) then turns `RawTokens` into the final
//     bounded `DesignTokens` via `normalizeDesignTokens` (pure, tested on the
//     SPA/functions side). The browser does no ranking; the container does no
//     LLM work. Everything here is deterministic.

export type ColorRole =
  | 'text'
  | 'bg'
  | 'border'
  | 'link'
  | 'button-bg'
  | 'button-text'
  | 'other';

export type FontRole = 'heading' | 'body' | 'other';

// One raw computed-style reading for a single element, collected in-browser.
export interface ElementSample {
  tag: string;
  role: FontRole; // heading vs body vs other, decided from the tag
  isButton: boolean;
  area: number; // px^2 of the element box — used to weight "dominant" styles
  fontFamily: string;
  fontSize: number; // px
  fontWeight: number;
  lineHeight: number; // px (0 if 'normal'/unresolved)
  color: string; // rgb()/rgba() string from getComputedStyle
  backgroundColor: string; // rgb()/rgba() string ('rgba(0, 0, 0, 0)' when transparent)
  borderRadius: number; // px (top-left, representative)
  boxShadow: string; // 'none' when absent
  paddingX: number; // (left+right)/2 px
  paddingY: number; // (top+bottom)/2 px
  isLink: boolean;
}

// Compact, frequency-aggregated tokens the container returns over the wire.
export interface RawTokens {
  fonts: Array<{ value: string; count: number; role: FontRole }>;
  fontSizes: number[];
  fontWeights: number[];
  colors: Array<{ value: string; count: number; role: ColorRole }>;
  radii: number[];
  shadows: string[];
  spacing: number[];
  button:
    | {
        bg: string;
        color: string;
        radius: number;
        paddingX: number;
        paddingY: number;
        weight: number;
        shadow: string;
      }
    | null;
  fontLinks: string[];
  meta: { url: string; finalUrl: string; title: string; viewport: { width: number; height: number } };
}

// What the in-browser collector returns (samples + page-level extras).
export interface BrowserCollection {
  samples: ElementSample[];
  fontLinks: string[];
  title: string;
}

export interface CaptureResponse {
  raw_tokens: RawTokens;
  screenshot_b64: string | null;
  final_url: string;
  title: string;
  error?: string;
}
