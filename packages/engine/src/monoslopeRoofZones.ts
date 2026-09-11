import type { ABasis, FootprintNode } from './types.js';
import { localRectToWorld } from './geometry.js';
import { resolveMonoslopeGeometry } from './monoslopeGeometry.js';
import { computeA, type AResult } from './aParameter.js';
import { isDegenerateRect, rectArea, roundUpToBoard, type ZonePiece } from './zoneTypes.js';

/**
 * Monoslope roof zone geometry, per FM Global 1-28 §3.4.1 and
 * Fig. 3.4.1a (3° < θ ≤ 10°) / Fig. 3.4.1b (10° < θ ≤ 30°). Both figures
 * are dimensioned with `a` (aParameter.ts) — same parameter as wall zones
 * and the gable/hip steep-roof zones — NOT `h`.
 *
 * Unlike gable/hip, a monoslope roof has no ridge — one edge is high, the
 * opposite is low (see monoslopeGeometry.ts), and the two get genuinely
 * different treatment (confirmed against the source figures, including a
 * user spot-check of the low-side boundary, 2026-09-06):
 *
 * Fig. 3.4.1a (3°–10°): the HIGH edge gets the bigger treatment — Zone 3'
 * corners (2a × 4a) and a Zone 2' middle band, both width 2a (no step
 * between corner and middle on this edge). The LOW edge gets Zone 3
 * corners (2a × 2a) but a NARROWER Zone 2 middle band (width a, not 2a) —
 * the corner literally pokes further into the field than the plain edge
 * band does, so Zone 1's boundary along the low edge steps from 2a (near
 * each corner) to a (away from both). The two ridge-parallel edges (top/
 * bottom in plan) carry no separate zone of their own here — only the
 * high/low distinction matters.
 *
 * Fig. 3.4.1b (10°–30°): simpler and unprimed. The high edge keeps the
 * same Zone 3 (2a × 4a) corners + Zone 2 (2a) middle band. Every other
 * edge — the low edge AND both ridge-parallel edges — gets a single
 * uniform Zone 2 band of width `a`, wrapping around three sides with no
 * separate corner zone at all on that side of the building.
 *
 * >30° is not covered by FM 1-28 (§2.1.7.B routes >3° to this section,
 * which itself tops out at 30°) — computeMonoslopeRoofZones throws rather
 * than guessing. ≤3° is explicitly "treated the same as low-slope gable
 * roofs" (§3.4.1.A) — use computeLowSlopeRoofZones instead.
 */

export type MonoslopeRoofZoneId = '1' | '2' | '3';
export type MonoslopePitchBand = '3-10' | '10-30';

export interface MonoslopeRoofZoneResult {
  pieces: ZonePiece[];
  a: AResult;
  pitchBand: MonoslopePitchBand;
  /** 2a, clamped — width of the high-edge band (corner and middle alike). */
  highBand: number;
  /** 4a, clamped — height of the high-edge corner zones (Zone 3'/3). */
  highCornerBand: number;
  /** a, clamped — width of the low-edge (3-10°) or wrap-around (10-30°) band. */
  lowBand: number;
  /** 2a, clamped — size of the low-edge corner zones. 0 for 10-30° (no low corner). */
  lowCornerBand: number;
  source: 'FM Global 1-28 Fig 3.4.1a' | 'FM Global 1-28 Fig 3.4.1b';
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

export function computeMonoslopeRoofZones(
  node: FootprintNode,
  aBasis: ABasis,
  /** Board width (ft) to round the band distances up to before laying out zone geometry — see the equivalent param on computeLowSlopeRoofZones. Returned band fields stay exact regardless. */
  boardSize?: number
): MonoslopeRoofZoneResult {
  const pitch = node.roof.pitchDegrees;
  if (pitch <= 3 || pitch > 30) {
    throw new Error(
      `computeMonoslopeRoofZones: pitch ${pitch}° is outside the 3°-30° range covered by ` +
        `Fig. 3.4.1a/b. θ ≤ 3° uses computeLowSlopeRoofZones (FM 1-28 §3.4.1.A); θ > 30° has ` +
        `no source figure yet (FM 1-28 §2.1.7.B routes it to ASCE 7 or elsewhere).`
    );
  }
  if (node.roofType !== 'monoslope') {
    throw new Error(
      `computeMonoslopeRoofZones: roofType "${node.roofType}" is not supported (monoslope only)`
    );
  }

  const { frame, slopeAxis, highSide, span } = resolveMonoslopeGeometry(node);
  const a = computeA(node, aBasis);

  // Local (x, y): x = distance from the HIGH edge, 0..span; y runs along
  // the ridge-parallel direction, 0..rakeExtent, with no high/low meaning.
  const rakeExtent = slopeAxis === 'u' ? frame.width : frame.length;

  const highBand = Math.min(2 * a.a, span / 2);
  const highCornerBand = Math.min(4 * a.a, rakeExtent / 2);
  const lowBand = Math.min(a.a, span / 2);

  // Board-rounded distances drive the actual piece geometry below; the exact
  // values above are what's returned in the summary.
  const round = (n: number) => (boardSize ? roundUpToBoard(n, boardSize) : n);
  const highBandGeom = Math.min(round(2 * a.a), span / 2);
  const highCornerBandGeom = Math.min(round(4 * a.a), rakeExtent / 2);
  const lowBandGeom = Math.min(round(a.a), span / 2);

  const pieces: ZonePiece[] = [];
  const addPiece = (zoneId: MonoslopeRoofZoneId, b: Bounds) => {
    if (isDegenerate(b)) return;
    // x measures distance from the high edge; map to the frame's slope
    // axis, flipping if the high edge sits at the "far" end.
    const localToFrame = (x: number, y: number): readonly [number, number] => {
      const alongSlope = highSide === 'near' ? x : span - x;
      return slopeAxis === 'u' ? [alongSlope, y] : [y, alongSlope];
    };
    const c0 = localToFrame(b.xMin, b.yMin);
    const c1 = localToFrame(b.xMax, b.yMin);
    const c2 = localToFrame(b.xMax, b.yMax);
    const c3 = localToFrame(b.xMin, b.yMax);
    const us = [c0[0], c1[0], c2[0], c3[0]];
    const vs = [c0[1], c1[1], c2[1], c3[1]];
    pieces.push({
      zoneId,
      vertices: localRectToWorld(frame, Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)),
      area: boundsArea(b),
    });
  };

  // --- High edge: Zone 3' corners (2a x 4a) + Zone 2' middle band (2a) ---
  addPiece('3', { xMin: 0, xMax: highBandGeom, yMin: 0, yMax: highCornerBandGeom });
  addPiece('3', { xMin: 0, xMax: highBandGeom, yMin: rakeExtent - highCornerBandGeom, yMax: rakeExtent });
  if (rakeExtent - highCornerBandGeom > highCornerBandGeom) {
    addPiece('2', { xMin: 0, xMax: highBandGeom, yMin: highCornerBandGeom, yMax: rakeExtent - highCornerBandGeom });
  }

  if (pitch <= 10) {
    // --- Fig 3.4.1a: low edge gets 2a x 2a corners, but only an `a`-wide
    // middle band — Zone 1 steps in to fill the gap away from the corners.
    const lowCornerBand = Math.min(2 * a.a, rakeExtent / 2);
    const lowCornerBandGeom = Math.min(round(2 * a.a), rakeExtent / 2);
    addPiece('3', { xMin: span - lowCornerBandGeom, xMax: span, yMin: 0, yMax: lowCornerBandGeom });
    addPiece('3', {
      xMin: span - lowCornerBandGeom,
      xMax: span,
      yMin: rakeExtent - lowCornerBandGeom,
      yMax: rakeExtent,
    });
    if (rakeExtent - lowCornerBandGeom > lowCornerBandGeom) {
      addPiece('2', {
        xMin: span - lowBandGeom,
        xMax: span,
        yMin: lowCornerBandGeom,
        yMax: rakeExtent - lowCornerBandGeom,
      });
    }

    // Zone 1: stepped near the low edge (2a from edge near the low
    // corners, a from edge in the field between them).
    addPiece('1', {
      xMin: highBandGeom,
      xMax: span - lowCornerBandGeom,
      yMin: 0,
      yMax: Math.min(lowCornerBandGeom, rakeExtent / 2),
    });
    addPiece('1', {
      xMin: highBandGeom,
      xMax: span - lowCornerBandGeom,
      yMin: Math.max(rakeExtent - lowCornerBandGeom, rakeExtent / 2),
      yMax: rakeExtent,
    });
    if (rakeExtent - lowCornerBandGeom > lowCornerBandGeom) {
      addPiece('1', {
        xMin: highBandGeom,
        xMax: span - lowBandGeom,
        yMin: lowCornerBandGeom,
        yMax: rakeExtent - lowCornerBandGeom,
      });
    }

    return {
      pieces,
      a,
      pitchBand: '3-10',
      highBand,
      highCornerBand,
      lowBand,
      lowCornerBand,
      source: 'FM Global 1-28 Fig 3.4.1a',
    };
  }

  // --- Fig 3.4.1b: low edge + both ridge-parallel edges share one
  // uniform `a`-wide Zone 2 wrap band; no separate low corner zone.
  addPiece('2', { xMin: highBandGeom, xMax: span, yMin: rakeExtent - lowBandGeom, yMax: rakeExtent }); // "top"
  addPiece('2', { xMin: highBandGeom, xMax: span, yMin: 0, yMax: lowBandGeom }); // "bottom"
  if (rakeExtent - 2 * lowBandGeom > 0) {
    addPiece('2', { xMin: span - lowBandGeom, xMax: span, yMin: lowBandGeom, yMax: rakeExtent - lowBandGeom }); // low edge
    addPiece('1', { xMin: highBandGeom, xMax: span - lowBandGeom, yMin: lowBandGeom, yMax: rakeExtent - lowBandGeom });
  }

  return {
    pieces,
    a,
    pitchBand: '10-30',
    highBand,
    highCornerBand,
    lowBand,
    lowCornerBand: 0,
    source: 'FM Global 1-28 Fig 3.4.1b',
  };
}
