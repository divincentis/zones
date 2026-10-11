import type { ABasis, FootprintNode, Vec2 } from './types.js';
import { computeA, type AResult } from './aParameter.js';
import { distance } from './geometry.js';
import { heightRegime, type HeightRegimeResult } from './heightRegime.js';
import { roofHeightAt } from './roofSurface.js';

/**
 * Wall Zones 4 and 5, per FM Global 1-28 Fig. 3.2.2e (p.24) and, for tall
 * buildings, the wall elevation of Fig. 3.2.2f (p.25). Both draw the same
 * thing: Zone 5 is a strip of width `a` at each wall corner, running the full
 * height of the wall, and Zone 4 is the rest. Table 3.2.2e's note gives the
 * width — "the lesser of 10% of the lesser plan dimension, or 0.4h, but not
 * less than 4% of the lesser plan dimension or 3 ft" — which is exactly
 * aParameter.ts. Works for any closed polygon, not just rectangles: each wall
 * (edge) is independent.
 *
 * "Full height" means up to the roof. Fig. 3.2.2e is drawn on a gabled
 * building and carries the corner strips up the gable-end wall to the rake,
 * with Zone 4 filling the rest of that wall including the triangle above the
 * eave line. So a wall's top follows the roof surface (roofSurface.ts) rather
 * than stopping at eave height: gable ends are pentagons, a monoslope's high
 * wall is taller than its low one and its side walls slope between the two.
 *
 * Gables steeper than 45° are the one case with more to it. §3.4.6 treats the
 * whole roof as wall construction, and Fig. 3.4.6b (p.42) draws the gable end
 * with the Zone 5 strip continuing up along the rake to the peak, still `a`
 * wide measured horizontally — leaving Zone 4 as a smaller pentagon whose
 * sloped sides run parallel to the rakes. The eave walls are unchanged
 * (Fig. 3.4.6a); the roof slopes above them are steepRoofZones.ts's.
 */

export type WallZoneId = '4' | '5';

export type WallZoneSource =
  | 'FM Global 1-28 Fig 3.2.2e'
  | 'FM Global 1-28 Fig 3.2.2f'
  | 'FM Global 1-28 Fig 3.4.6a/b';

/** Above this a gable is zoned as wall construction (FM 1-28 §3.4.6). */
export const GABLE_AS_WALL_MIN_DEGREES = 45;

/**
 * One piece of one wall: a quad standing on the footprint edge, with vertical
 * sides at `alongMin`/`alongMax` and straight (not necessarily level) base
 * and top edges between them.
 */
export interface WallZonePiece {
  zoneId: WallZoneId;
  edgeIndex: number;
  /** Distance along the wall from its start vertex, in feet. */
  alongMin: number;
  alongMax: number;
  /** Height above grade of the base and top edges at each end, in feet. */
  baseAtMin: number;
  baseAtMax: number;
  topAtMin: number;
  topAtMax: number;
  /** Lowest and highest points of the piece — its extent, not its shape. */
  heightMin: number;
  heightMax: number;
  area: number;
}

export interface WallZoneResult {
  pieces: WallZonePiece[];
  a: AResult;
  regime: HeightRegimeResult;
  source: WallZoneSource;
}

type WallQuad = Omit<WallZonePiece, 'heightMin' | 'heightMax' | 'area'>;

/** Fills in the derived fields, so no caller can leave them out of step with the corners. */
export function wallPiece(quad: WallQuad): WallZonePiece {
  const width = quad.alongMax - quad.alongMin;
  const meanTop = (quad.topAtMin + quad.topAtMax) / 2;
  const meanBase = (quad.baseAtMin + quad.baseAtMax) / 2;
  return {
    ...quad,
    heightMin: Math.min(quad.baseAtMin, quad.baseAtMax),
    heightMax: Math.max(quad.topAtMin, quad.topAtMax),
    area: width * (meanTop - meanBase),
  };
}

/** The part of a piece between two stations along its wall, with base and top interpolated. */
export function sliceWallPiece(piece: WallZonePiece, alongMin: number, alongMax: number): WallZonePiece {
  const width = piece.alongMax - piece.alongMin;
  const at = (min: number, max: number, along: number) =>
    width <= 0 ? min : min + ((max - min) * (along - piece.alongMin)) / width;
  return wallPiece({
    zoneId: piece.zoneId,
    edgeIndex: piece.edgeIndex,
    alongMin,
    alongMax,
    baseAtMin: at(piece.baseAtMin, piece.baseAtMax, alongMin),
    baseAtMax: at(piece.baseAtMin, piece.baseAtMax, alongMax),
    topAtMin: at(piece.topAtMin, piece.topAtMax, alongMin),
    topAtMax: at(piece.topAtMin, piece.topAtMax, alongMax),
  });
}

const EPS = 1e-9;

export function computeWallZones(node: FootprintNode, aBasis: ABasis): WallZoneResult {
  const a = computeA(node, aBasis);
  const regime = heightRegime(node, aBasis);
  const roofHeight = roofHeightAt(node);
  const gableAsWall = node.roofType === 'gable' && node.roof.pitchDegrees > GABLE_AS_WALL_MIN_DEGREES;
  const tan = Math.tan((node.roof.pitchDegrees * Math.PI) / 180);
  const n = node.vertices.length;
  const pieces: WallZonePiece[] = [];

  for (let i = 0; i < n; i++) {
    const start = node.vertices[i]!;
    const end = node.vertices[(i + 1) % n]!;
    const wallLength = distance(start, end);
    if (wallLength <= EPS) continue;
    const topAt = (along: number) => {
      const t = along / wallLength;
      const p: Vec2 = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
      return roofHeight(p);
    };

    // Collision clamp: the two corner strips must not cross past the wall's
    // midpoint (mirrors the roof-zone collision handling in scope §6).
    const cornerWidth = Math.min(a.a, wallLength / 2);

    // A wall's top is straight end to end unless it's a gable end, whose
    // top peaks at the ridge — the one place a piece has to be cut so that
    // every piece keeps a straight top.
    const mid = wallLength / 2;
    const peaked = Math.abs(topAt(mid) - (topAt(0) + topAt(wallLength)) / 2) > 1e-6;
    const stations = [0, cornerWidth, ...(peaked ? [mid] : []), wallLength - cornerWidth, wallLength]
      .sort((p, q) => p - q)
      .filter((v, k, all) => k === 0 || v - all[k - 1]! > EPS);

    for (let k = 0; k + 1 < stations.length; k++) {
      const alongMin = stations[k]!;
      const alongMax = stations[k + 1]!;
      const center = (alongMin + alongMax) / 2;
      const inCorner = center < cornerWidth || center > wallLength - cornerWidth;
      const span = { edgeIndex: i, alongMin, alongMax };
      const topAtMin = topAt(alongMin);
      const topAtMax = topAt(alongMax);

      if (!inCorner && peaked && gableAsWall) {
        // Fig. 3.4.6b: the rake carries a Zone 5 band `a` wide horizontally,
        // which on a slope of tanθ is a vertical drop of a·tanθ below the
        // rake — so Zone 4's top is the rake shifted down by that much.
        const drop = cornerWidth * tan;
        const inner = { baseAtMin: 0, baseAtMax: 0, topAtMin: topAtMin - drop, topAtMax: topAtMax - drop };
        pieces.push(wallPiece({ zoneId: '4', ...span, ...inner }));
        pieces.push(
          wallPiece({
            zoneId: '5',
            ...span,
            baseAtMin: inner.topAtMin,
            baseAtMax: inner.topAtMax,
            topAtMin,
            topAtMax,
          })
        );
        continue;
      }

      pieces.push(
        wallPiece({ zoneId: inCorner ? '5' : '4', ...span, baseAtMin: 0, baseAtMax: 0, topAtMin, topAtMax })
      );
    }
  }

  return {
    pieces,
    a,
    regime,
    source: gableAsWall
      ? 'FM Global 1-28 Fig 3.4.6a/b'
      : regime.regime === 'tall'
        ? 'FM Global 1-28 Fig 3.2.2f'
        : 'FM Global 1-28 Fig 3.2.2e',
  };
}
