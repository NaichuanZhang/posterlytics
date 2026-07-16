export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewportLike {
  width: number;
  height: number;
}

const FRAME_OFFSETS = [0, 0.8, 1.6] as const;

export function framePositions(scrollHeight: number, viewportHeight: number): number[] {
  const height = Math.max(1, Math.round(viewportHeight));
  const maxScroll = Math.max(0, Math.round(scrollHeight - height));
  if (maxScroll === 0) return [0];

  const nearThreshold = Math.max(2, Math.round(height * 0.05));
  const positions: number[] = [];
  for (const multiplier of FRAME_OFFSETS) {
    const position = Math.min(maxScroll, Math.max(0, Math.round(multiplier * height)));
    const previous = positions.at(-1);
    if (previous === undefined) {
      positions.push(position);
    } else if (Math.abs(position - previous) <= nearThreshold) {
      // Preserve the top frame, but prefer the true page-end position when two
      // lower frames collapse into nearly the same viewport.
      if (previous !== 0 && position > previous) positions[positions.length - 1] = position;
    } else {
      positions.push(position);
    }
  }
  return positions;
}

export function visibleIntersectionArea(rect: RectLike, viewport: ViewportLike): number {
  const width = Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
  return width * height;
}
