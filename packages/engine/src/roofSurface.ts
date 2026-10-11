import type { FootprintNode, Vec2 } from './types.js';
import { worldToLocal } from './geometry.js';
import { resolveMonoslopeGeometry } from './monoslopeGeometry.js';
import { resolveRidgeGeometry } from './ridgeGeometry.js';

/**
 * Where the roof surface actually is, as the zone algorithms model it — the
 * one place that answers "how high is the roof above this plan point", so
 * the walls can be built up to it.
 *
 * A roof is only treated as pitched when its zones are: a gable at ≤ 7° or a
 * monoslope at ≤ 3° is zoned by the low-slope figures on a flat plane at eave
 * height (FM 1-28 §3.2.2, §3.4.1.A), so its walls stop there too and the
 * model stays one consistent solid. A hip roof has eaves on all four sides,
 * so its walls are flat-topped at any pitch.
 */
export const GABLE_LOW_SLOPE_MAX_DEGREES = 7;
export const MONOSLOPE_LOW_SLOPE_MAX_DEGREES = 3;

/** Plan area × this = area measured on the roof surface. 1 for a roof modeled flat. */
export function roofSlopeFactor(node: FootprintNode): number {
  return isModeledPitched(node) ? 1 / Math.cos((node.roof.pitchDegrees * Math.PI) / 180) : 1;
}

export function isModeledPitched(node: FootprintNode): boolean {
  if (node.roofType === 'gable') return node.roof.pitchDegrees > GABLE_LOW_SLOPE_MAX_DEGREES;
  if (node.roofType === 'monoslope') return node.roof.pitchDegrees > MONOSLOPE_LOW_SLOPE_MAX_DEGREES;
  return false;
}

/**
 * Height of the roof surface above a plan point on or inside the footprint,
 * in feet above grade.
 */
export function roofHeightAt(node: FootprintNode): (p: Vec2) => number {
  const eave = node.eaveHeight;
  if (!isModeledPitched(node)) return () => eave;
  const tan = Math.tan((node.roof.pitchDegrees * Math.PI) / 180);

  if (node.roofType === 'gable') {
    const { frame, ridgeAxis, perpExtent } = resolveRidgeGeometry(node);
    return (p) => {
      const local = worldToLocal(frame, p);
      const across = ridgeAxis === 'u' ? local.v : local.u;
      const fromEave = Math.min(across, perpExtent - across);
      return eave + Math.min(Math.max(fromEave, 0), perpExtent / 2) * tan;
    };
  }

  const { frame, slopeAxis, highSide, span } = resolveMonoslopeGeometry(node);
  return (p) => {
    const local = worldToLocal(frame, p);
    const along = slopeAxis === 'u' ? local.u : local.v;
    const fromLow = highSide === 'near' ? span - along : along;
    return eave + Math.min(Math.max(fromLow, 0), span) * tan;
  };
}
