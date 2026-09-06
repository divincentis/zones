import type { FootprintNode } from './types.js';
import { resolveGableGeometry } from './gableGeometry.js';

/**
 * Mean roof height `h` per scope §4.1: eave height for roof slopes ≤ 10°,
 * mean roof height otherwise. The branch lives here (not in the UI) because
 * `h` depends on pitch, and pitch is a model input.
 *
 * For gable roofs above 10°, mean height is the standard average of eave
 * and ridge height: ridgeHeight = eaveHeight + (perpExtent/2) * tan(pitch),
 * mean = (eaveHeight + ridgeHeight) / 2. This is plain roof geometry, not a
 * standard-specific provision, so it doesn't carry the same "must verify
 * against the source figure" risk as the zone boundaries themselves.
 *
 * Hip and monoslope mean-height geometry differ (hip has four sloped planes;
 * monoslope has no ridge at all) and are not yet implemented — deliberately
 * throws rather than guessing.
 */
export function meanRoofHeight(node: FootprintNode): number {
  if (node.roofType === 'flat') {
    return node.eaveHeight;
  }
  if (node.roof.pitchDegrees <= 10) {
    return node.eaveHeight;
  }
  if (node.roofType === 'gable') {
    const { perpExtent } = resolveGableGeometry(node);
    const rise = (perpExtent / 2) * Math.tan((node.roof.pitchDegrees * Math.PI) / 180);
    return node.eaveHeight + rise / 2;
  }
  throw new Error(
    `meanRoofHeight: pitch ${node.roof.pitchDegrees}° exceeds the 10° eave-height threshold for ` +
      `roofType "${node.roofType}". Mean-height geometry for hip and monoslope roofs is not yet ` +
      `implemented.`
  );
}
