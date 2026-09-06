import type { FootprintNode } from './types.js';
import { resolveRidgeGeometry } from './ridgeGeometry.js';
import { resolveMonoslopeGeometry } from './monoslopeGeometry.js';

/**
 * Mean roof height `h` per scope §4.1: eave height for roof slopes ≤ 10°,
 * mean roof height otherwise. The branch lives here (not in the UI) because
 * `h` depends on pitch, and pitch is a model input.
 *
 * For gable and hip roofs above 10°, mean height is the standard average of
 * eave and ridge height: ridgeHeight = eaveHeight + (perpExtent/2) * tan(pitch),
 * mean = (eaveHeight + ridgeHeight) / 2. This is plain roof geometry, not a
 * standard-specific provision, so it doesn't carry the same "must verify
 * against the source figure" risk as the zone boundaries themselves. Ridge
 * height depends only on perpendicular span and pitch, not on what happens
 * at the ends (gabled vs. hipped) — same cross-section either way — so
 * gable and hip share resolveRidgeGeometry and this formula.
 *
 * For monoslope above 10°, there's no ridge — just a single slope rising
 * from the low eave (`eaveHeight`) to a high edge across the full plan
 * span (see monoslopeGeometry.ts). Mean height is the same "average of low
 * and high" idea: highHeight = eaveHeight + span * tan(pitch),
 * mean = (eaveHeight + highHeight) / 2 = eaveHeight + (span * tan(pitch)) / 2.
 * Also plain geometry, not standard-specific.
 *
 * Hip and monoslope ZONE geometry (where Zones 1/2/3 fall) is a separate,
 * not-yet-sourced concern — see steepRoofZones.ts, which still throws for
 * both. This function only resolves `h`, which wall zones' `a` parameter
 * (aParameter.ts) also depends on — so wall zones become computable for
 * hip/monoslope buildings even before their roof zone figures are sourced.
 */
export function meanRoofHeight(node: FootprintNode): number {
  if (node.roofType === 'flat') {
    return node.eaveHeight;
  }
  if (node.roof.pitchDegrees <= 10) {
    return node.eaveHeight;
  }
  if (node.roofType === 'gable' || node.roofType === 'hip') {
    const { perpExtent } = resolveRidgeGeometry(node);
    const rise = (perpExtent / 2) * Math.tan((node.roof.pitchDegrees * Math.PI) / 180);
    return node.eaveHeight + rise / 2;
  }
  if (node.roofType === 'monoslope') {
    const { span } = resolveMonoslopeGeometry(node);
    const rise = span * Math.tan((node.roof.pitchDegrees * Math.PI) / 180);
    return node.eaveHeight + rise / 2;
  }
  throw new Error(`meanRoofHeight: unhandled roofType "${node.roofType}"`);
}
