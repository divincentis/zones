import type { FootprintNode } from './types.js';
import { distance, rectFrame, type RectFrame } from './geometry.js';

const TOLERANCE_FT = 0.01;

export type RidgeAxis = 'u' | 'v';

export interface RidgeGeometry {
  frame: RectFrame;
  ridgeAxis: RidgeAxis;
  /** Extent along the ridge direction — the distance between the two rake (gable-end or hip-end) walls. */
  rakeExtent: number;
  /** Extent perpendicular to the ridge — the distance between the two eave walls. */
  perpExtent: number;
}

/**
 * Resolves a symmetric ridge (gable or hip) against the footprint's
 * rectangle frame: which frame axis the ridge is parallel to, and validates
 * the ridge is centered (equal run to both eaves). A single `pitchDegrees`
 * field only describes one slope, so an off-center ridge with the same
 * pitch on both sides would meet at inconsistent heights — that's not
 * representable yet and must fail loudly rather than silently pick a side.
 *
 * Used for both `roofType: 'gable'` and `roofType: 'hip'`: ridge HEIGHT
 * depends only on perpendicular span and pitch, not on what happens at the
 * ends (gabled vs. hipped) — same cross-section either way. Hip-specific
 * zone geometry (the hip lines themselves) is a separate, not-yet-sourced
 * concern (see steepRoofZones.ts) and does not live here.
 */
export function resolveRidgeGeometry(node: FootprintNode): RidgeGeometry {
  if (!node.roof.ridgeLine) {
    throw new Error(`resolveRidgeGeometry: roofType "${node.roofType}" requires a ridgeLine`);
  }
  const frame = rectFrame(node.vertices);
  const [r0, r1] = node.roof.ridgeLine;

  const ridgeVec = [r1[0] - r0[0], r1[1] - r0[1]] as const;
  const ridgeLen = Math.hypot(ridgeVec[0], ridgeVec[1]);
  if (ridgeLen < TOLERANCE_FT) {
    throw new Error('resolveRidgeGeometry: ridgeLine has zero length');
  }
  const ridgeDir = [ridgeVec[0] / ridgeLen, ridgeVec[1] / ridgeLen] as const;

  const dotU = Math.abs(ridgeDir[0] * frame.u[0] + ridgeDir[1] * frame.u[1]);
  const dotV = Math.abs(ridgeDir[0] * frame.v[0] + ridgeDir[1] * frame.v[1]);

  let ridgeAxis: RidgeAxis;
  if (dotU > 1 - 1e-6) {
    ridgeAxis = 'u';
  } else if (dotV > 1 - 1e-6) {
    ridgeAxis = 'v';
  } else {
    throw new Error(
      'resolveRidgeGeometry: ridgeLine is not parallel to either footprint edge — ' +
        'non-axis-aligned ridges are not yet supported'
    );
  }

  const rakeExtent = ridgeAxis === 'u' ? frame.length : frame.width;
  const perpExtent = ridgeAxis === 'u' ? frame.width : frame.length;

  // Project ridge endpoints onto the perpendicular axis to find its offset
  // from the two eave walls, and confirm it spans the full rake extent.
  const toLocal = (p: readonly [number, number]) => {
    const dx = p[0] - frame.origin[0];
    const dy = p[1] - frame.origin[1];
    return {
      u: dx * frame.u[0] + dy * frame.u[1],
      v: dx * frame.v[0] + dy * frame.v[1],
    };
  };
  const l0 = toLocal(r0);
  const l1 = toLocal(r1);
  const perpCoord0 = ridgeAxis === 'u' ? l0.v : l0.u;
  const perpCoord1 = ridgeAxis === 'u' ? l1.v : l1.u;

  if (Math.abs(perpCoord0 - perpCoord1) > TOLERANCE_FT) {
    throw new Error('resolveRidgeGeometry: ridgeLine is not parallel to the footprint edge');
  }
  const ridgeOffset = perpCoord0;
  const otherEaveDistance = perpExtent - ridgeOffset;
  if (Math.abs(ridgeOffset - otherEaveDistance) > TOLERANCE_FT) {
    throw new Error(
      `resolveRidgeGeometry: ridge is off-center (${ridgeOffset.toFixed(2)} ft from one eave, ` +
        `${otherEaveDistance.toFixed(2)} ft from the other) — a single pitchDegrees value can't ` +
        'describe two different-run slopes meeting at a consistent ridge height. Asymmetric ' +
        'ridges are not yet supported.'
    );
  }

  return { frame, ridgeAxis, rakeExtent, perpExtent };
}
