import type { ABasis, FootprintNode } from './types.js';
import { localRectToWorld } from './geometry.js';
import { resolveRidgeGeometry } from './ridgeGeometry.js';
import { computeA, type AResult } from './aParameter.js';
import { isDegenerateRect, rectArea, type ZonePiece } from './zoneTypes.js';

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
 * >45° is not covered by the source figures reviewed and is out of scope
 * until a source is found.
 */

export type SteepRoofZoneId = '1' | '2' | '3';
export type SteepRoofPitchBand = '7-27' | '27-45';

export interface SteepRoofZoneResult {
  pieces: ZonePiece[];
  a: AResult;
  pitchBand: SteepRoofPitchBand;
  rakeBand: number; // a, clamped to half the rake extent
  ridgeOrEaveBand: number; // a, clamped to half the perpendicular extent
  source: 'FM Global 1-28 Fig 3.2.2d-1' | 'FM Global 1-28 Fig 3.2.2d-2';
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

export function computeSteepRoofZones(node: FootprintNode, aBasis: ABasis): SteepRoofZoneResult {
  const pitch = node.roof.pitchDegrees;
  if (pitch <= 7 || pitch > 45) {
    throw new Error(
      `computeSteepRoofZones: pitch ${pitch}° is outside the 7°-45° range covered by ` +
        `Fig. 3.2.2d-1/d-2. θ ≤ 7° uses computeLowSlopeRoofZones; θ > 45° has no source figure yet.`
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

  const rakeLoNear = { min: 0, max: rakeBand };
  const rakeHiNear = { min: rakeExtent - rakeBand, max: rakeExtent };
  const rakeFieldMin = rakeBand;
  const rakeFieldMax = rakeExtent - rakeBand;

  if (pitch <= 27) {
    // Fig. 3.2.2d-1: Zone 3 at ridge x rake overlap; Zone 2 in either band alone.
    const ridgeNear = { min: ridgeCenter - ridgeOrEaveBand, max: ridgeCenter + ridgeOrEaveBand };

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
      ridgeMax: ridgeOrEaveBand,
    });
    addPiece('3', {
      rakeMin: rakeNear.min,
      rakeMax: rakeNear.max,
      ridgeMin: perpExtent - ridgeOrEaveBand,
      ridgeMax: perpExtent,
    });
    addPiece('2', {
      rakeMin: rakeNear.min,
      rakeMax: rakeNear.max,
      ridgeMin: ridgeOrEaveBand,
      ridgeMax: perpExtent - ridgeOrEaveBand,
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
    source: 'FM Global 1-28 Fig 3.2.2d-2',
  };
}
