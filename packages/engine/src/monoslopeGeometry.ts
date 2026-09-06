import type { FootprintNode } from './types.js';
import { rectFrame, worldToLocal, type RectFrame } from './geometry.js';

const TOLERANCE_FT = 0.01;

export type SlopeAxis = 'u' | 'v';
export type HighSide = 'near' | 'far';

export interface MonoslopeGeometry {
  frame: RectFrame;
  /** Frame axis the roof rises along (perpendicular to the high edge). */
  slopeAxis: SlopeAxis;
  /** Which side along slopeAxis is high: 'near' = local 0, 'far' = local length/width. */
  highSide: HighSide;
  /** Full plan span the roof rises across, from low eave to high eave (no mirroring, unlike gable/hip). */
  span: number;
}

/**
 * Resolves a monoslope roof's single high edge against the footprint's
 * rectangle frame. Unlike gable/hip (see ridgeGeometry.ts), there's no
 * interior ridge line — the "high edge" is one of the footprint's own four
 * wall-face edges, and the opposite edge is the low eave at `eaveHeight`.
 * The roof rises uniformly from low to high across the full perpendicular
 * span; there's no mirrored far side the way a gable ridge has one.
 */
export function resolveMonoslopeGeometry(node: FootprintNode): MonoslopeGeometry {
  if (!node.roof.highEdge) {
    throw new Error(`resolveMonoslopeGeometry: roofType "${node.roofType}" requires a highEdge`);
  }
  const frame = rectFrame(node.vertices);
  const [h0, h1] = node.roof.highEdge;

  const l0 = worldToLocal(frame, h0);
  const l1 = worldToLocal(frame, h1);

  const uConstant = Math.abs(l0.u - l1.u) < TOLERANCE_FT;
  const vConstant = Math.abs(l0.v - l1.v) < TOLERANCE_FT;

  if (uConstant === vConstant) {
    // Both constant (degenerate/zero-length) or neither (not axis-aligned).
    throw new Error(
      'resolveMonoslopeGeometry: highEdge is not parallel to a footprint edge — ' +
        'non-axis-aligned high edges are not yet supported'
    );
  }

  if (uConstant) {
    const u = l0.u;
    const vMin = Math.min(l0.v, l1.v);
    const vMax = Math.max(l0.v, l1.v);
    if (Math.abs(vMax - vMin - frame.width) > TOLERANCE_FT || vMin < -TOLERANCE_FT) {
      throw new Error('resolveMonoslopeGeometry: highEdge does not span a full footprint edge');
    }
    if (Math.abs(u) < TOLERANCE_FT) {
      return { frame, slopeAxis: 'u', highSide: 'near', span: frame.length };
    }
    if (Math.abs(u - frame.length) < TOLERANCE_FT) {
      return { frame, slopeAxis: 'u', highSide: 'far', span: frame.length };
    }
    throw new Error('resolveMonoslopeGeometry: highEdge is not one of the footprint\'s own edges');
  }

  const v = l0.v;
  const uMin = Math.min(l0.u, l1.u);
  const uMax = Math.max(l0.u, l1.u);
  if (Math.abs(uMax - uMin - frame.length) > TOLERANCE_FT || uMin < -TOLERANCE_FT) {
    throw new Error('resolveMonoslopeGeometry: highEdge does not span a full footprint edge');
  }
  if (Math.abs(v) < TOLERANCE_FT) {
    return { frame, slopeAxis: 'v', highSide: 'near', span: frame.width };
  }
  if (Math.abs(v - frame.width) < TOLERANCE_FT) {
    return { frame, slopeAxis: 'v', highSide: 'far', span: frame.width };
  }
  throw new Error('resolveMonoslopeGeometry: highEdge is not one of the footprint\'s own edges');
}
