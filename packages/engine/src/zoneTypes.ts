import type { Vec2 } from './types.js';

/** A single rectangular piece of a zone, in world-space CCW vertices. */
export interface ZonePiece {
  zoneId: string;
  vertices: Vec2[];
  area: number;
  /**
   * Roof-plane elevation of this piece, in feet above grade. Only set by
   * algorithms whose pieces do NOT all share one roof plane — currently just
   * steppedRoofZones.ts, where a single zone map spans two roof levels. The
   * single-structure algorithms leave it undefined; their consumers already
   * derive height from the building's own eave/pitch geometry.
   */
  elevation?: number;
}

export function sumArea(pieces: ZonePiece[], zoneId: string): number {
  return pieces.filter((p) => p.zoneId === zoneId).reduce((sum, p) => sum + p.area, 0);
}

/**
 * Shared axis-aligned-rectangle arithmetic for the roof-zone algorithms
 * (lowSlopeRoofZones.ts, steepRoofZones.ts, monoslopeRoofZones.ts). Each
 * algorithm keeps its own domain-named `Bounds` shape (xMin/xMax/yMin/yMax
 * vs. rakeMin/rakeMax/ridgeMin/ridgeMax) for readability, but delegates the
 * actual area/degeneracy math here so a fix or tolerance change only needs
 * to happen once.
 */
export function rectArea(min1: number, max1: number, min2: number, max2: number): number {
  return Math.max(0, max1 - min1) * Math.max(0, max2 - min2);
}

export function isDegenerateRect(min1: number, max1: number, min2: number, max2: number, tol = 1e-9): boolean {
  return max1 - min1 <= tol || max2 - min2 <= tol;
}

/**
 * Rounds n up to the next multiple of boardSize, e.g. for board-coverage
 * takeoff (roofers order whole boards, commonly 4 ft or 8 ft). Shared by the
 * roof-zone algorithms (which round the edge-band distances that drive zone
 * geometry when a boardSize is supplied) and the UI layer (which uses the
 * identical function to render matching dimension labels) — one
 * implementation so the two can never disagree on what "rounded" means.
 */
export const roundUpToBoard = (n: number, boardSize: number): number => Math.ceil(n / boardSize) * boardSize;
