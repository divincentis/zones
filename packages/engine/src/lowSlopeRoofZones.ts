import type { ABasis, FootprintNode } from './types.js';
import { leastHorizontalDimension, localRectToWorld, rectFrame } from './geometry.js';
import { meanRoofHeight } from './meanRoofHeight.js';
import { isDegenerateRect, rectArea, type ZonePiece } from './zoneTypes.js';

/**
 * Low-slope roof zone geometry (θ ≤ 7°), per FM Global Property Loss
 * Prevention Data Sheet 1-28, "Wind Design" (Fig. 3.2.2a): Zones 1, 1', 2, 3.
 *
 * This REPLACES the ASCE `a`-parameter-based offset approach originally
 * assumed in scope §4.2 for roof zones — FM 1-28 dimensions everything off
 * mean roof height `h` directly, and Zone 3 is L-shaped, not a square `a×a`
 * corner. `a` (see aParameter.ts) is retained for wall zones (§4.2), which
 * FM 1-28 does not cover in the source figures reviewed. See project
 * addendum in the scope doc for the decision record.
 *
 * All dimensions below are named exactly as they appear in Fig. 3.2.2a:
 *   Zone 2 width = 0.6h from roof edges
 *   Zone 3 (corner): L-shaped, legs 0.6h by 0.6h, leg thickness 0.2h
 *   Zone 1: field of roof, inward to 1.2h from the edge
 *   Zone 1': applies only to buildings with least horizontal dimension > 2.4h;
 *            covers the area beyond 1.2h. Absent that threshold, Zone 1
 *            simply continues to the building's center.
 *
 * Parapet corner credit (Table 3.2.2a, note 2, p.21): "If a parapet with a
 * minimum height of 3 ft (0.9 m) is provided around the entire perimeter,
 * Zone 2 values for GCP may be used in Zone 3." `parapetHeight` is a single
 * scalar applied uniformly to the whole building (no per-edge parapet in the
 * data model), so "around the entire perimeter" is automatically satisfied
 * whenever it's set at all — there's no partial-perimeter case to represent.
 * No equivalent footnote exists on Tables 3.2.2b/c/d (steep gable), so this
 * credit is scoped to the low-slope algorithm only.
 */

export type LowSlopeRoofZoneId = '1' | "1'" | '2' | '3';

/** FM 1-28 Table 3.2.2a, note 2 (p.21): minimum parapet height for the Zone 3→2 corner credit. */
export const PARAPET_CORNER_CREDIT_THRESHOLD_FT = 3;

export interface LowSlopeRoofZoneResult {
  pieces: ZonePiece[];
  h: number;
  dEdge: number; // 0.6h before per-axis collision clamping — the nominal Zone 2/3 depth and corner leg length
  dInterior: number; // 1.2h before clamping — nominal Zone 1/1' boundary
  legWidth: number; // 0.2h before clamping
  wideThreshold: number; // 2.4h — Zone 1' least-dimension threshold
  hasZone1Prime: boolean;
  roofLength: number; // plan dimension including overhang, along frame.u
  roofWidth: number; // plan dimension including overhang, along frame.v
  /** True if parapetHeight >= 3 ft — Zone 3 corners are credited to Zone 2 (Table 3.2.2a, note 2). */
  parapetCreditsCorners: boolean;
  source: 'FM Global 1-28 Fig 3.2.2a';
}

interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function boundsArea(b: Bounds): number {
  return rectArea(b.xMin, b.xMax, b.yMin, b.yMax);
}

function isDegenerate(b: Bounds, tol = 1e-9): boolean {
  return isDegenerateRect(b.xMin, b.xMax, b.yMin, b.yMax, tol);
}

export function computeLowSlopeRoofZones(
  node: FootprintNode,
  aBasis: ABasis
): LowSlopeRoofZoneResult {
  if (node.roof.pitchDegrees > 7) {
    throw new Error(
      `computeLowSlopeRoofZones: pitch ${node.roof.pitchDegrees}° exceeds the 7° low-slope ` +
        `threshold (scope §4.2, Algorithm A). Use the pitched-roof algorithm (Phase 2) instead.`
    );
  }

  const wallFrame = rectFrame(node.vertices);
  const overhang = node.roof.overhangDepth;
  const roofLength = wallFrame.length + 2 * overhang;
  const roofWidth = wallFrame.width + 2 * overhang;
  const frame = {
    ...wallFrame,
    origin: [
      wallFrame.origin[0] - overhang * wallFrame.u[0] - overhang * wallFrame.v[0],
      wallFrame.origin[1] - overhang * wallFrame.u[1] - overhang * wallFrame.v[1],
    ] as const as [number, number],
    length: roofLength,
    width: roofWidth,
  };

  const h = meanRoofHeight(node);
  const dEdge = 0.6 * h;
  const dInterior = 1.2 * h;
  const nominalLegWidth = 0.2 * h;
  const wideThreshold = 2.4 * h;

  // Per-axis collision clamp: opposing edge bands must not cross past the
  // building's centerline (scope §6: "bands collide — define the behavior").
  const dX = Math.min(dEdge, roofLength / 2);
  const dY = Math.min(dEdge, roofWidth / 2);
  const legW = Math.min(nominalLegWidth, dX, dY);

  const parapetCreditsCorners = node.roof.parapetHeight >= PARAPET_CORNER_CREDIT_THRESHOLD_FT;
  const cornerZoneId: LowSlopeRoofZoneId = parapetCreditsCorners ? '2' : '3';

  const pieces: ZonePiece[] = [];

  const addPiece = (zoneId: LowSlopeRoofZoneId, b: Bounds) => {
    if (isDegenerate(b)) return;
    pieces.push({
      zoneId,
      vertices: localRectToWorld(frame, b.xMin, b.xMax, b.yMin, b.yMax),
      area: boundsArea(b),
    });
  };

  // --- Zone 3 corners + their Zone 2 far-corner remainder ---
  const corners: Array<{ signX: 1 | -1; signY: 1 | -1 }> = [
    { signX: 1, signY: 1 },
    { signX: -1, signY: 1 },
    { signX: -1, signY: -1 },
    { signX: 1, signY: -1 },
  ];

  for (const { signX, signY } of corners) {
    const xNear = signX === 1 ? 0 : roofLength;
    const xFar = signX === 1 ? dX : roofLength - dX;
    const xLegEdge = signX === 1 ? legW : roofLength - legW;
    const yNear = signY === 1 ? 0 : roofWidth;
    const yFar = signY === 1 ? dY : roofWidth - dY;
    const yLegEdge = signY === 1 ? legW : roofWidth - legW;

    const xLo = Math.min(xNear, xLegEdge);
    const xHi = Math.max(xNear, xLegEdge);
    const yLo = Math.min(yNear, yLegEdge);
    const yHi = Math.max(yNear, yLegEdge);
    const xFarLo = Math.min(xLegEdge, xFar);
    const xFarHi = Math.max(xLegEdge, xFar);
    const yFarLo = Math.min(yLegEdge, yFar);
    const yFarHi = Math.max(yLegEdge, yFar);

    // Leg along the X edge (hugging top/bottom), thickness legW in Y.
    addPiece(cornerZoneId, {
      xMin: Math.min(xNear, xFar),
      xMax: Math.max(xNear, xFar),
      yMin: yLo,
      yMax: yHi,
    });
    // Leg along the Y edge (hugging left/right), thickness legW in X,
    // trimmed to exclude the tip already covered by the X-leg above.
    addPiece(cornerZoneId, {
      xMin: xLo,
      xMax: xHi,
      yMin: yFarLo,
      yMax: yFarHi,
    });
    // Zone 2 remainder tucked in the far inner corner of the corner square.
    addPiece('2', {
      xMin: xFarLo,
      xMax: xFarHi,
      yMin: yFarLo,
      yMax: yFarHi,
    });
  }

  // --- Zone 2 perimeter strips between corners ---
  addPiece('2', { xMin: dX, xMax: roofLength - dX, yMin: 0, yMax: dY }); // bottom
  addPiece('2', { xMin: dX, xMax: roofLength - dX, yMin: roofWidth - dY, yMax: roofWidth }); // top
  addPiece('2', { xMin: 0, xMax: dX, yMin: dY, yMax: roofWidth - dY }); // left
  addPiece('2', { xMin: roofLength - dX, xMax: roofLength, yMin: dY, yMax: roofWidth - dY }); // right

  // --- Zone 1 / Zone 1' ---
  const insetD1: Bounds = { xMin: dX, xMax: roofLength - dX, yMin: dY, yMax: roofWidth - dY };
  const lMin = leastHorizontalDimension(node.vertices, aBasis);
  const hasZone1Prime = lMin > wideThreshold && !isDegenerate(insetD1);

  if (!isDegenerate(insetD1)) {
    if (hasZone1Prime) {
      // wideThreshold = 2 * dInterior, so lMin > wideThreshold guarantees
      // dInterior fits unclamped on both axes — see design note below.
      const d2X = dInterior;
      const d2Y = dInterior;
      const insetD2: Bounds = {
        xMin: d2X,
        xMax: roofLength - d2X,
        yMin: d2Y,
        yMax: roofWidth - d2Y,
      };
      addPiece('1', { xMin: insetD1.xMin, xMax: insetD1.xMax, yMin: insetD1.yMin, yMax: insetD2.yMin }); // bottom
      addPiece('1', { xMin: insetD1.xMin, xMax: insetD1.xMax, yMin: insetD2.yMax, yMax: insetD1.yMax }); // top
      addPiece('1', { xMin: insetD1.xMin, xMax: insetD2.xMin, yMin: insetD2.yMin, yMax: insetD2.yMax }); // left
      addPiece('1', { xMin: insetD2.xMax, xMax: insetD1.xMax, yMin: insetD2.yMin, yMax: insetD2.yMax }); // right
      addPiece("1'", insetD2);
    } else {
      addPiece('1', insetD1);
    }
  }

  return {
    pieces,
    h,
    dEdge,
    dInterior,
    legWidth: nominalLegWidth,
    wideThreshold,
    hasZone1Prime,
    roofLength,
    roofWidth,
    parapetCreditsCorners,
    source: 'FM Global 1-28 Fig 3.2.2a',
  };
}
