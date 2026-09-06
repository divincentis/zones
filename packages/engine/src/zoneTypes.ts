import type { Vec2 } from './types.js';

/** A single rectangular piece of a zone, in world-space CCW vertices. */
export interface ZonePiece {
  zoneId: string;
  vertices: Vec2[];
  area: number;
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
