import type { ABasis, FootprintNode } from './types.js';
import { localRectToWorld, rectFrame } from './geometry.js';
import { heightRegime, type HeightRegimeResult } from './heightRegime.js';
import { isDegenerateRect, rectArea, roundUpToBoard, type ZonePiece } from './zoneTypes.js';

/**
 * Low-slope (θ ≤ 7°) roof zones on a TALL building, per FM Global 1-28
 * Fig. 3.2.2f, "Roof and wall zones for buildings ≥90 ft (27 m) high, or
 * buildings >60 ft (18 m) where h/w > 1" (p.25) — the roofs that
 * lowSlopeRoofZones.ts (Fig. 3.2.2a) is not drawn for. See heightRegime.ts
 * for which figure a building gets.
 *
 * Nothing here is dimensioned off `h`. Table 3.2.2f note 1 gives the whole
 * layout: "Zone 3 dimensions = 2a x 2a x a, where a = 10% of the lesser plan
 * dimension, but not less than 3 ft (0.9 m). Zone 2 width = a."
 *
 *   Zone 2: perimeter band, width a
 *   Zone 3: L-shaped corner, legs 2a long and a thick — the same thickness as
 *           the band, so unlike Fig. 3.2.2a's corner the L lies wholly inside
 *           it and leaves no Zone 2 remainder tucked behind
 *   Zone 1: everything inside the band. There is no Zone 1' in this figure.
 *
 * This `a` is NOT aParameter.ts's. That one (Table 3.2.2e's note, and the
 * steep-roof figures) is also capped at 0.4h and floored at 4% of the lesser
 * plan dimension; this note names neither. The two only part ways when the
 * lesser plan dimension exceeds 4h — a tall building at least 360 ft across —
 * but each is transcribed as its own figure states it rather than reconciled.
 *
 * Parapet corner credit: Table 3.2.2f note 2 repeats Table 3.2.2a's word for
 * word, so it applies here exactly as in lowSlopeRoofZones.ts.
 *
 * Steeper roofs on tall buildings are deliberately not this module's concern:
 * note 1 sends them back to "Tables 3.2.2b through d", i.e. the same gable
 * figures as any other building (steepRoofZones.ts).
 */

export type TallRoofZoneId = '1' | '2' | '3';

/** FM 1-28 Table 3.2.2f, note 2 (p.25) — the same threshold as Table 3.2.2a's. */
const PARAPET_CORNER_CREDIT_THRESHOLD_FT = 3;

export interface TallRoofZoneResult {
  pieces: ZonePiece[];
  /** 10% of the lesser plan dimension, floored at 3 ft — Zone 2 width and Zone 3 leg thickness, before collision clamping. */
  a: number;
  aGoverningBranch: '0.1*Lmin' | '3ft floor';
  lMin: number;
  /** 2a — Zone 3 leg length, before collision clamping. */
  cornerLeg: number;
  roofLength: number; // plan dimension including overhang, along frame.u
  roofWidth: number; // plan dimension including overhang, along frame.v
  /** True if parapetHeight >= 3 ft — Zone 3 corners are credited to Zone 2 (Table 3.2.2f, note 2). */
  parapetCreditsCorners: boolean;
  regime: HeightRegimeResult;
  source: 'FM Global 1-28 Fig 3.2.2f';
}

export function computeTallRoofZones(
  node: FootprintNode,
  aBasis: ABasis,
  /** Board width (ft) to round the band and leg distances up to before laying out zone geometry — see the equivalent param on computeLowSlopeRoofZones. Returned `a`/`cornerLeg` stay exact regardless. */
  boardSize?: number
): TallRoofZoneResult {
  if (node.roof.pitchDegrees > 7) {
    throw new Error(
      `computeTallRoofZones: pitch ${node.roof.pitchDegrees}° exceeds the 7° that Table 3.2.2f ` +
        'covers. Steeper roofs on tall buildings use the ordinary steep-roof figures (note 1).'
    );
  }
  const regime = heightRegime(node, aBasis);
  if (regime.regime !== 'tall') {
    throw new Error(
      `computeTallRoofZones: h = ${regime.h.toFixed(1)} ft with lesser plan dimension ` +
        `${regime.w.toFixed(1)} ft is not a tall building per Fig. 3.2.2f (≥90 ft, or >60 ft with ` +
        'h/w > 1). Use computeLowSlopeRoofZones (Fig. 3.2.2a) instead.'
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

  const lMin = regime.w;
  const tenPercentL = 0.1 * lMin;
  const a = Math.max(tenPercentL, 3);
  const cornerLeg = 2 * a;

  // Board-rounded distances drive the piece geometry; the exact values above
  // are what's returned (see computeLowSlopeRoofZones's boardSize param doc).
  const round = (n: number) => (boardSize ? roundUpToBoard(n, boardSize) : n);
  // Per-axis collision clamp, as in the other roof-zone modules: opposing
  // bands and legs stop at the centerline rather than crossing it.
  const bX = Math.min(round(a), roofLength / 2);
  const bY = Math.min(round(a), roofWidth / 2);
  const cX = Math.min(round(cornerLeg), roofLength / 2);
  const cY = Math.min(round(cornerLeg), roofWidth / 2);

  const parapetCreditsCorners = node.roof.parapetHeight >= PARAPET_CORNER_CREDIT_THRESHOLD_FT;
  const cornerZoneId: TallRoofZoneId = parapetCreditsCorners ? '2' : '3';

  const pieces: ZonePiece[] = [];
  const addPiece = (zoneId: TallRoofZoneId, xMin: number, xMax: number, yMin: number, yMax: number) => {
    if (isDegenerateRect(xMin, xMax, yMin, yMax)) return;
    pieces.push({
      zoneId,
      vertices: localRectToWorld(frame, xMin, xMax, yMin, yMax),
      area: rectArea(xMin, xMax, yMin, yMax),
    });
  };

  // --- Zone 3 corners: one leg along each edge, both inside the band ---
  for (const farX of [false, true]) {
    for (const farY of [false, true]) {
      const x = (lo: number, hi: number): [number, number] => (farX ? [roofLength - hi, roofLength - lo] : [lo, hi]);
      const y = (lo: number, hi: number): [number, number] => (farY ? [roofWidth - hi, roofWidth - lo] : [lo, hi]);
      // Leg along the X edge, full length; then the leg along the Y edge,
      // starting where the first one's thickness ends.
      addPiece(cornerZoneId, ...x(0, cX), ...y(0, bY));
      addPiece(cornerZoneId, ...x(0, bX), ...y(bY, cY));
    }
  }

  // --- Zone 2 perimeter strips between the corner legs ---
  addPiece('2', cX, roofLength - cX, 0, bY);
  addPiece('2', cX, roofLength - cX, roofWidth - bY, roofWidth);
  addPiece('2', 0, bX, cY, roofWidth - cY);
  addPiece('2', roofLength - bX, roofLength, cY, roofWidth - cY);

  // --- Zone 1: everything inside the band ---
  addPiece('1', bX, roofLength - bX, bY, roofWidth - bY);

  return {
    pieces,
    a,
    aGoverningBranch: tenPercentL >= 3 ? '0.1*Lmin' : '3ft floor',
    lMin,
    cornerLeg,
    roofLength,
    roofWidth,
    parapetCreditsCorners,
    regime,
    source: 'FM Global 1-28 Fig 3.2.2f',
  };
}
