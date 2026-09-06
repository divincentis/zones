import type { RectFrame, Vec2, WallZonePiece } from '@zones/engine';

export type Vec3 = [number, number, number];

/** Plan (x, y) at a given height -> Three.js world space (Y-up: height is Y, plan y is Z). */
export function planToWorld(v: Vec2, height: number): Vec3 {
  return [v[0], height, v[1]];
}

export function roofPieceCorners(vertices: Vec2[], height: number): Vec3[] {
  return vertices.map((v) => planToWorld(v, height));
}

/**
 * Height of a symmetric gable roof surface above a plan point, given the
 * ridge line, pitch, and the full extent perpendicular to the ridge
 * (resolveRidgeGeometry's `perpExtent`). Zero at the ridge's perpendicular
 * distance 0 gives eaveHeight + full rise; at perpExtent/2 (the eave) it's
 * eaveHeight. Points are assumed to fall within the roof plan (callers pass
 * roof-zone piece vertices, which always do), so the perpendicular distance
 * to the ridge's infinite supporting line equals the distance to the ridge
 * segment.
 */
export function gableRoofHeight(
  ridgeLine: readonly [Vec2, Vec2],
  pitchDegrees: number,
  eaveHeight: number,
  perpExtent: number,
  p: Vec2
): number {
  const [r0, r1] = ridgeLine;
  const dx = r1[0] - r0[0];
  const dy = r1[1] - r0[1];
  const len = Math.hypot(dx, dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  const px = p[0] - r0[0];
  const py = p[1] - r0[1];
  const perpDist = Math.min(Math.abs(px * perpX + py * perpY), perpExtent / 2);
  const rise = Math.tan((pitchDegrees * Math.PI) / 180) * (perpExtent / 2 - perpDist);
  return eaveHeight + rise;
}

export function gableRoofPieceCorners(
  vertices: Vec2[],
  ridgeLine: readonly [Vec2, Vec2],
  pitchDegrees: number,
  eaveHeight: number,
  perpExtent: number
): Vec3[] {
  return vertices.map((v) =>
    planToWorld(v, gableRoofHeight(ridgeLine, pitchDegrees, eaveHeight, perpExtent, v))
  );
}

/**
 * Height of a monoslope roof surface above a plan point: a single tilted
 * plane, eaveHeight at the low edge, rising linearly to eaveHeight + span *
 * tan(pitch) at the high edge. Unlike a gable, there's no fold — every
 * rectangular zone piece is already exactly planar, no splitting needed.
 */
export function monoslopeRoofHeight(
  frame: RectFrame,
  slopeAxis: 'u' | 'v',
  highSide: 'near' | 'far',
  pitchDegrees: number,
  eaveHeight: number,
  span: number,
  p: Vec2
): number {
  const dx = p[0] - frame.origin[0];
  const dy = p[1] - frame.origin[1];
  const u = dx * frame.u[0] + dy * frame.u[1];
  const v = dx * frame.v[0] + dy * frame.v[1];
  const alongSlope = slopeAxis === 'u' ? u : v;
  const distFromLow = highSide === 'near' ? span - alongSlope : alongSlope;
  const clamped = Math.min(Math.max(distFromLow, 0), span);
  return eaveHeight + clamped * Math.tan((pitchDegrees * Math.PI) / 180);
}

export function monoslopeRoofPieceCorners(
  vertices: Vec2[],
  frame: RectFrame,
  slopeAxis: 'u' | 'v',
  highSide: 'near' | 'far',
  pitchDegrees: number,
  eaveHeight: number,
  span: number
): Vec3[] {
  return vertices.map((v) =>
    planToWorld(v, monoslopeRoofHeight(frame, slopeAxis, highSide, pitchDegrees, eaveHeight, span, v))
  );
}

/** Gable-end wall infill triangle: two base corners at eaveHeight, apex at the ridge point on that gable end. Not a wind zone — pure envelope fill so the 3D view doesn't show through the roof. */
export function gableEndTriangle(
  start: Vec2,
  end: Vec2,
  eaveHeight: number,
  ridgePoint: Vec2,
  ridgeHeight: number
): Vec3[] {
  return [planToWorld(start, eaveHeight), planToWorld(end, eaveHeight), planToWorld(ridgePoint, ridgeHeight)];
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
