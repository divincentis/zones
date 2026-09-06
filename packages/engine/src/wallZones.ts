import type { ABasis, FootprintNode } from './types.js';
import { computeA, type AResult } from './aParameter.js';
import { distance } from './geometry.js';

/**
 * Wall Zone 4/5 per scope §4.2: "Zone 5 is a strip of width `a` from each
 * corner, full height; Zone 4 is the remainder." Unlike roof zones (see
 * lowSlopeRoofZones.ts, now sourced from FM 1-28), no contradicting source
 * was found for walls, so this keeps the original ASCE-style `a`-parameter
 * formulation. Works for any closed polygon, not just rectangles — each
 * wall panel (edge) is independent.
 */

export type WallZoneId = '4' | '5';

export interface WallZonePiece {
  zoneId: WallZoneId;
  edgeIndex: number;
  /** Distance along the wall from its start vertex, in feet. */
  alongMin: number;
  alongMax: number;
  /** Height above the wall base, in feet. Full height for both zones. */
  heightMin: number;
  heightMax: number;
  area: number;
}

export interface WallZoneResult {
  pieces: WallZonePiece[];
  a: AResult;
}

export function computeWallZones(node: FootprintNode, aBasis: ABasis): WallZoneResult {
  const a = computeA(node, aBasis);
  const height = node.eaveHeight;
  const n = node.vertices.length;
  const pieces: WallZonePiece[] = [];

  for (let i = 0; i < n; i++) {
    const start = node.vertices[i]!;
    const end = node.vertices[(i + 1) % n]!;
    const wallLength = distance(start, end);

    // Collision clamp: the two corner strips must not cross past the wall's
    // midpoint (mirrors the roof-zone collision handling in scope §6).
    const cornerWidth = Math.min(a.a, wallLength / 2);

    if (cornerWidth > 1e-9) {
      pieces.push({
        zoneId: '5',
        edgeIndex: i,
        alongMin: 0,
        alongMax: cornerWidth,
        heightMin: 0,
        heightMax: height,
        area: cornerWidth * height,
      });
      pieces.push({
        zoneId: '5',
        edgeIndex: i,
        alongMin: wallLength - cornerWidth,
        alongMax: wallLength,
        heightMin: 0,
        heightMax: height,
        area: cornerWidth * height,
      });
    }

    const middleWidth = wallLength - 2 * cornerWidth;
    if (middleWidth > 1e-9) {
      pieces.push({
        zoneId: '4',
        edgeIndex: i,
        alongMin: cornerWidth,
        alongMax: wallLength - cornerWidth,
        heightMin: 0,
        heightMax: height,
        area: middleWidth * height,
      });
    }
  }

  return { pieces, a };
}
