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
export type VisualTheme = 'light' | 'dark' | 'mixed';

export interface VisualPaletteColor {
  color: string;
  proportion: number;
}

export interface PixelEvidence {
  visualPalette: VisualPaletteColor[];
  theme: VisualTheme;
}

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

export type BrowserElementSample = Omit<ElementSample, 'area'> & {
  bounds: { left: number; top: number; right: number; bottom: number };
};

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

export interface DesignTokens {
  typography: {
    headingFamily: string;
    bodyFamily: string;
    scale: number[];
    weights: number[];
  };
  colors: {
    bg: string;
    text: string;
    primary: string;
    accent: string;
    palette: string[];
    visualPalette?: VisualPaletteColor[];
    theme?: VisualTheme;
  };
  radii: number[];
  shadows: string[];
  spacing: number[];
  button: {
    bg: string;
    color: string;
    radius: number;
    paddingX: number;
    paddingY: number;
    weight: number;
    shadow?: string;
  } | null;
  fontLinks: string[];
}

// What the in-browser collector returns (samples + page-level extras).
export interface BrowserCollection {
  samples: BrowserElementSample[];
  fontLinks: string[];
  title: string;
}

export interface CaptureResponse {
  tokens: DesignTokens | null;
  // Backward-compatible wire name. The bytes now contain a vertically merged
  // multi-frame style board rather than one above-the-fold screenshot.
  screenshot_b64: string | null;
  final_url: string;
  title: string;
}

export type CaptureOutcome = 'success' | 'partial' | 'timeout' | 'error';
export type CompletedCaptureOutcome = Extract<CaptureOutcome, 'success' | 'partial'>;

export interface CaptureExecutionResult {
  response: CaptureResponse;
  outcome: CompletedCaptureOutcome;
  framesCaptured: number;
}

export interface CaptureErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
