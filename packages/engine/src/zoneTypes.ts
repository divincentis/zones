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
