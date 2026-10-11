import type { ABasis, FootprintNode } from './types.js';
import { localRectToWorld } from './geometry.js';
import { resolveRidgeGeometry } from './ridgeGeometry.js';
import { computeA, type AResult } from './aParameter.js';
import { isDegenerateRect, rectArea, roundUpToBoard, type ZonePiece } from './zoneTypes.js';

/**
 * Gable roof zone geometry, θ > 7°, per FM Global 1-28 Fig. 3.2.2d-1
 * (7° < θ ≤ 27°) and Fig. 3.2.2d-2 (27° < θ ≤ 45°). Both bands are dimensioned
 * with `a` (the same parameter as Algorithm A's walls — see aParameter.ts),
 * NOT `h` — unlike the low-slope roof zones in lowSlopeRoofZones.ts.
 *
 * As drawn, the ridge runs parallel to the eaves; its two endpoints sit on
 * the rake (gable-end) walls. This module works in local (rake, ridge)
 * coordinates: `rakeCoord` runs from 0 to rakeExtent between the two rakes,
 * `ridgeCoord` runs from 0 to perpExtent between the two eaves, with the
 * ridge centered at perpExtent/2 (resolveRidgeGeometry enforces centering).
 *
 * Fig. 3.2.2d-1 (7°–27°): Zone 3 sits where the near-ridge band and the
 * near-rake band overlap — i.e. at the two points where the ridge meets a
 * gable end, NOT at the building's outer (eave/rake) corners. Zone 2 covers
 * whichever of the two bands you're in alone; Zone 1 is the field. This is
 * the counter-intuitive case worth double-checking against the source
 * figure: the "corner" zone here is a ridge feature, not a plan corner.
 *
 * Fig. 3.2.2d-2 (27°–45°): No ridge-adjacent elevation at all. Zone 3 sits
 * at the true building corners (rake ∩ eave); the rest of the rake band
 * (including the portion straddling the ridge) is Zone 2; everything beyond
 * the rake band is Zone 1, with no separate near-ridge treatment.
 *
 * Fig. 3.4.6a (θ > 45°, p.42): not a roof figure at all. §3.4.6: "Treat the
 * areas shown as either Zone 4 or 5 wall construction as noted in the
 * figures" — so these pieces carry WALL zone ids. Drawn as an elevation of
 * the eave side, wall and roof slope together: a Zone 5 strip of width `a` up
 * each end (the wall's own corner strip carried on over the eave to the
 * peak), a Zone 5 band across the top of the slope, and Zone 4 for the rest.
 * The gable-end walls are Fig. 3.4.6b, in wallZones.ts.
 *
 * JUDGMENT CALL on that top band. The figure dimensions it `a`, drawn
 * vertically in an elevation view, so it is taken here as a vertical drop of
 * `a` below the peak — a plan run of a/tanθ either side of the ridge, which is
 * what `ridgeOrEaveBand` holds for this band. Reading it as `a` measured down
 * the slope instead would make the band narrower by a factor of sinθ; the
 * drawing is not to a stated slope, so it cannot settle which was meant, and
 * the wider reading is the conservative one.
 */

export type SteepRoofZoneId = '1' | '2' | '3' | '4' | '5';
export type SteepRoofPitchBand = '7-27' | '27-45' | '45+';

export interface SteepRoofZoneResult {
  pieces: ZonePiece[];
  a: AResult;
  pitchBand: SteepRoofPitchBand;
  rakeBand: number; // a, clamped to half the rake extent
  /**
   * Plan depth of the ridge band (each side of the ridge) or the eave band:
   * `a` clamped to half the perpendicular extent, except above 45° where it
   * is the plan run of a vertical drop of `a` — see `ridgeBandDrop`.
   */
  ridgeOrEaveBand: number;
  /** Above 45° only: the ridge band's vertical depth below the peak, `a` clamped to the roof's rise. */
  ridgeBandDrop?: number;
  /**
   * Every piece's `area` is a PLAN area (zones are laid out in plan — scope
   * §4.1). Multiply by this, 1/cosθ, for the area on the roof surface, which
   * is what gets covered.
   */
  slopeFactor: number;
  source:
    | 'FM Global 1-28 Fig 3.2.2d-1'
    | 'FM Global 1-28 Fig 3.2.2d-2'
    | 'FM Global 1-28 Fig 3.4.6a';
}

interface Bounds {
  rakeMin: number;
  rakeMax: number;
  ridgeMin: number;
  ridgeMax: number;
}

function boundsArea(b: Bounds): number {
  return rectArea(b.rakeMin, b.rakeMax, b.ridgeMin, b.ridgeMax);
}

function isDegenerate(b: Bounds, tol = 1e-9): boolean {
  return isDegenerateRect(b.rakeMin, b.rakeMax, b.ridgeMin, b.ridgeMax, tol);
}

export function computeSteepRoofZones(
  node: FootprintNode,
  aBasis: ABasis,
  /** Board width (ft) to round the rake/ridge band distances up to before laying out zone geometry — see the equivalent param on computeLowSlopeRoofZones. Returned `rakeBand`/`ridgeOrEaveBand` stay exact regardless. */
  boardSize?: number
): SteepRoofZoneResult {
  const pitch = node.roof.pitchDegrees;
  if (pitch <= 7 || pitch >= 90) {
    throw new Error(
      `computeSteepRoofZones: pitch ${pitch}° is outside the range of a pitched gable roof ` +
        `(above 7°, below 90°). θ ≤ 7° uses computeLowSlopeRoofZones.`
    );
  }
  if (node.roofType !== 'gable') {
    throw new Error(
      `computeSteepRoofZones: roofType "${node.roofType}" is not yet supported (gable only)`
    );
  }

  const { frame, ridgeAxis, rakeExtent, perpExtent } = resolveRidgeGeometry(node);
  const a = computeA(node, aBasis);

  const rakeBand = Math.min(a.a, rakeExtent / 2);
  const ridgeOrEaveBand = Math.min(a.a, perpExtent / 2);
  const ridgeCenter = perpExtent / 2;

  // Board-rounded distances drive the actual piece geometry below; the exact
  // values above are what's returned in the summary. Not above 45°: that roof
  // is wall construction, its rake strip is the gable wall's own corner strip
  // carried up, and wall zones are never board-rounded (wallZones.ts) — so
  // rounding here would leave the two halves of one strip out of line.
  const round = (n: number) => (boardSize && pitch <= 45 ? roundUpToBoard(n, boardSize) : n);
  const rakeBandGeom = Math.min(round(a.a), rakeExtent / 2);
  const ridgeOrEaveBandGeom = Math.min(round(a.a), perpExtent / 2);

  const pieces: ZonePiece[] = [];
  const addPiece = (zoneId: SteepRoofZoneId, b: Bounds) => {
    if (isDegenerate(b)) return;
    const uMin = ridgeAxis === 'u' ? b.rakeMin : b.ridgeMin;
    const uMax = ridgeAxis === 'u' ? b.rakeMax : b.ridgeMax;
    const vMin = ridgeAxis === 'u' ? b.ridgeMin : b.rakeMin;
    const vMax = ridgeAxis === 'u' ? b.ridgeMax : b.rakeMax;
    pieces.push({
      zoneId,
      vertices: localRectToWorld(frame, uMin, uMax, vMin, vMax),
      area: boundsArea(b),
    });
  };

  const rakeLoNear = { min: 0, max: rakeBandGeom };
  const rakeHiNear = { min: rakeExtent - rakeBandGeom, max: rakeExtent };
  const rakeFieldMin = rakeBandGeom;
  const rakeFieldMax = rakeExtent - rakeBandGeom;
  const tan = Math.tan((pitch * Math.PI) / 180);
  const slopeFactor = 1 / Math.cos((pitch * Math.PI) / 180);

  if (pitch > 45) {
    // Fig. 3.4.6a: Zone 5 up each rake and across the peak, Zone 4 between.
    // The peak band is a vertical drop of `a` (see the header), so its plan
    // run shrinks as the roof steepens.
    const ridgeRun = Math.min(a.a / tan, perpExtent / 2);

    for (const rakeNear of [rakeLoNear, rakeHiNear]) {
      addPiece('5', { rakeMin: rakeNear.min, rakeMax: rakeNear.max, ridgeMin: 0, ridgeMax: perpExtent });
    }
    if (rakeFieldMax > rakeFieldMin) {
      addPiece('5', {
        rakeMin: rakeFieldMin,
        rakeMax: rakeFieldMax,
        ridgeMin: ridgeCenter - ridgeRun,
        ridgeMax: ridgeCenter + ridgeRun,
      });
      addPiece('4', {
        rakeMin: rakeFieldMin,
        rakeMax: rakeFieldMax,
        ridgeMin: 0,
        ridgeMax: ridgeCenter - ridgeRun,
      });
      addPiece('4', {
        rakeMin: rakeFieldMin,
        rakeMax: rakeFieldMax,
        ridgeMin: ridgeCenter + ridgeRun,
        ridgeMax: perpExtent,
      });
    }

    return {
      pieces,
      a,
      pitchBand: '45+',
      rakeBand,
      ridgeOrEaveBand: ridgeRun,
      ridgeBandDrop: ridgeRun * tan,
      slopeFactor,
      source: 'FM Global 1-28 Fig 3.4.6a',
    };
  }

  if (pitch <= 27) {
    // Fig. 3.2.2d-1: Zone 3 at ridge x rake overlap; Zone 2 in either band alone.
    const ridgeNear = { min: ridgeCenter - ridgeOrEaveBandGeom, max: ridgeCenter + ridgeOrEaveBandGeom };

    for (const rakeNear of [rakeLoNear, rakeHiNear]) {
      // Zone 3: near this rake AND near the ridge.
      addPiece('3', {
        rakeMin: rakeNear.min,
        rakeMax: rakeNear.max,
        ridgeMin: ridgeNear.min,
        ridgeMax: ridgeNear.max,
      });
      // Zone 2: near this rake, away from the ridge (both sides).
      addPiece('2', {
        rakeMin: rakeNear.min,
        rakeMax: rakeNear.max,
        ridgeMin: 0,
        ridgeMax: ridgeNear.min,
      });
      addPiece('2', {
        rakeMin: rakeNear.min,
        rakeMax: rakeNear.max,
        ridgeMin: ridgeNear.max,
        ridgeMax: perpExtent,
      });
    }

    if (rakeFieldMax > rakeFieldMin) {
      // Away from both rakes: near the ridge -> Zone 2; else Zone 1.
      addPiece('2', {
        rakeMin: rakeFieldMin,
        rakeMax: rakeFieldMax,
        ridgeMin: ridgeNear.min,
        ridgeMax: ridgeNear.max,
      });
      addPiece('1', {
        rakeMin: rakeFieldMin,
        rakeMax: rakeFieldMax,
        ridgeMin: 0,
        ridgeMax: ridgeNear.min,
      });
      addPiece('1', {
        rakeMin: rakeFieldMin,
        rakeMax: rakeFieldMax,
        ridgeMin: ridgeNear.max,
        ridgeMax: perpExtent,
      });
    }

    return {
      pieces,
      a,
      pitchBand: '7-27',
      rakeBand,
      ridgeOrEaveBand,
      slopeFactor,
      source: 'FM Global 1-28 Fig 3.2.2d-1',
    };
  }

  // Fig. 3.2.2d-2 (27°-45°): Zone 3 at true building corners (rake x eave);
  // rest of the rake band (incl. straddling the ridge) is Zone 2; field is Zone 1.
  for (const rakeNear of [rakeLoNear, rakeHiNear]) {
    addPiece('3', {
      rakeMin: rakeNear.min,
      rakeMax: rakeNear.max,
      ridgeMin: 0,
      ridgeMax: ridgeOrEaveBandGeom,
    });
    addPiece('3', {
      rakeMin: rakeNear.min,
      rakeMax: rakeNear.max,
      ridgeMin: perpExtent - ridgeOrEaveBandGeom,
      ridgeMax: perpExtent,
    });
    addPiece('2', {
      rakeMin: rakeNear.min,
      rakeMax: rakeNear.max,
      ridgeMin: ridgeOrEaveBandGeom,
      ridgeMax: perpExtent - ridgeOrEaveBandGeom,
    });
  }

  if (rakeFieldMax > rakeFieldMin) {
    addPiece('1', {
      rakeMin: rakeFieldMin,
      rakeMax: rakeFieldMax,
      ridgeMin: 0,
      ridgeMax: perpExtent,
    });
  }

  return {
    pieces,
    a,
    pitchBand: '27-45',
    rakeBand,
    ridgeOrEaveBand,
    slopeFactor,
    source: 'FM Global 1-28 Fig 3.2.2d-2',
  };
}
