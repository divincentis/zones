import type { Vec2, WallZonePiece } from '@zones/engine';

export type Vec3 = [number, number, number];

/** Plan (x, y) at a given height -> Three.js world space (Y-up: height is Y, plan y is Z). */
export function planToWorld(v: Vec2, height: number): Vec3 {
  return [v[0], height, v[1]];
}

export function roofPieceCorners(vertices: Vec2[], height: number): Vec3[] {
  return vertices.map((v) => planToWorld(v, height));
}

/** World-space quad corners for a wall zone panel, given the footprint edge it sits on. */
export function wallPieceCorners(piece: WallZonePiece, edgeStart: Vec2, edgeEnd: Vec2): Vec3[] {
  const dx = edgeEnd[0] - edgeStart[0];
  const dy = edgeEnd[1] - edgeStart[1];
  const len = Math.hypot(dx, dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;

  const point = (along: number, height: number): Vec3 => [
    edgeStart[0] + along * dirX,
    height,
    edgeStart[1] + along * dirY,
  ];

  return [
    point(piece.alongMin, piece.heightMin),
    point(piece.alongMax, piece.heightMin),
    point(piece.alongMax, piece.heightMax),
    point(piece.alongMin, piece.heightMax),
  ];
}
