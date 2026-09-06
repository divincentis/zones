import type { Vec2, ABasis } from './types.js';

const TOLERANCE_FT = 0.01;

export function vecSub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function vecLength(v: Vec2): number {
  return Math.hypot(v[0], v[1]);
}

export function distance(a: Vec2, b: Vec2): number {
  return vecLength(vecSub(a, b));
}

/** Shoelace formula. Positive for CCW winding. */
export function signedArea(vertices: Vec2[]): number {
  let sum = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = vertices[i]!;
    const [x2, y2] = vertices[(i + 1) % n]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function area(vertices: Vec2[]): number {
  return Math.abs(signedArea(vertices));
}

export function edgeLengths(vertices: Vec2[]): number[] {
  const n = vertices.length;
  const lengths: number[] = [];
  for (let i = 0; i < n; i++) {
    lengths.push(distance(vertices[i]!, vertices[(i + 1) % n]!));
  }
  return lengths;
}

/**
 * Minimum-area bounding rectangle via rotating calipers on the convex hull.
 * Returns the rectangle's short and long side lengths. For an exact
 * (possibly rotated) rectangle input, this recovers the true L and B
 * regardless of world-frame orientation.
 */
export function minimumBoundingRect(vertices: Vec2[]): { short: number; long: number } {
  const hull = convexHull(vertices);
  if (hull.length < 3) {
    throw new Error('minimumBoundingRect requires a non-degenerate polygon');
  }

  let best: { short: number; long: number; area: number } | undefined;

  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i]!;
    const p2 = hull[(i + 1) % hull.length]!;
    const edge = vecSub(p2, p1);
    const edgeLen = vecLength(edge);
    if (edgeLen < TOLERANCE_FT) continue;

    const ux = edge[0] / edgeLen;
    const uy = edge[1] / edgeLen;
    // Project all hull points onto the (u, perp-u) frame defined by this edge.
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const dx = p[0] - p1[0];
      const dy = p[1] - p1[1];
      const u = dx * ux + dy * uy;
      const v = dx * -uy + dy * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }

    const width = maxU - minU;
    const height = maxV - minV;
    const rectArea = width * height;
    const short = Math.min(width, height);
    const long = Math.max(width, height);

    if (!best || rectArea < best.area) {
      best = { short, long, area: rectArea };
    }
  }

  if (!best) {
    throw new Error('minimumBoundingRect could not find a valid supporting edge');
  }
  return { short: best.short, long: best.long };
}

/** Andrew's monotone chain convex hull. Input need not be CCW or deduplicated. */
export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const n = pts.length;
  if (n < 3) return pts;

  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Vec2[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export interface RectFrame {
  /** World-space origin corresponding to local (0,0). */
  origin: Vec2;
  /** Unit vector for local +x, in world space. */
  u: Vec2;
  /** Unit vector for local +y, in world space. */
  v: Vec2;
  /** Local-frame extent along u. */
  length: number;
  /** Local-frame extent along v. */
  width: number;
}

/**
 * Builds a local (origin, u, v) frame for an axis-aligned-in-its-own-frame
 * rectangle given as 4 CCW vertices in any world-space orientation. Throws
 * if the input isn't (within tolerance) a rectangle — Phase 1 scope is
 * rectangles only; non-rectangular footprints are Phase 3.
 */
export function rectFrame(vertices: Vec2[]): RectFrame {
  if (vertices.length !== 4) {
    throw new Error(`rectFrame requires exactly 4 vertices, got ${vertices.length}`);
  }
  const [p0, p1, p2, p3] = vertices as [Vec2, Vec2, Vec2, Vec2];

  const edgeU = vecSub(p1, p0);
  const edgeV = vecSub(p3, p0);
  const length = vecLength(edgeU);
  const width = vecLength(edgeV);
  if (length < TOLERANCE_FT || width < TOLERANCE_FT) {
    throw new Error('rectFrame: degenerate rectangle (zero-length edge)');
  }

  const u: Vec2 = [edgeU[0] / length, edgeU[1] / length];
  const v: Vec2 = [edgeV[0] / width, edgeV[1] / width];

  // Verify p2 is consistent with p0 + edgeU + edgeV (i.e. input is a
  // rectangle, not an arbitrary quadrilateral) and that edges are
  // perpendicular.
  const dot = u[0] * v[0] + u[1] * v[1];
  if (Math.abs(dot) > 1e-6) {
    throw new Error('rectFrame: input edges are not perpendicular — not a rectangle');
  }
  const expectedP2: Vec2 = [p0[0] + edgeU[0] + edgeV[0], p0[1] + edgeU[1] + edgeV[1]];
  if (distance(expectedP2, p2) > TOLERANCE_FT) {
    throw new Error('rectFrame: input is not a rectangle (vertex 2 out of position)');
  }

  return { origin: p0, u, v, length, width };
}

/** Maps a local (u, v) coordinate against a RectFrame to a world-space point. */
export function localToWorld(frame: RectFrame, u: number, v: number): Vec2 {
  return [
    frame.origin[0] + u * frame.u[0] + v * frame.v[0],
    frame.origin[1] + u * frame.u[1] + v * frame.v[1],
  ];
}

/** Inverse of localToWorld: projects a world-space point onto a RectFrame's local (u, v) axes. */
export function worldToLocal(frame: RectFrame, p: Vec2): { u: number; v: number } {
  const dx = p[0] - frame.origin[0];
  const dy = p[1] - frame.origin[1];
  return {
    u: dx * frame.u[0] + dy * frame.u[1],
    v: dx * frame.v[0] + dy * frame.v[1],
  };
}

export function localRectToWorld(
  frame: RectFrame,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number
): Vec2[] {
  // CCW: (xMin,yMin) -> (xMax,yMin) -> (xMax,yMax) -> (xMin,yMax)
  return [
    localToWorld(frame, xMin, yMin),
    localToWorld(frame, xMax, yMin),
    localToWorld(frame, xMax, yMax),
    localToWorld(frame, xMin, yMax),
  ];
}

/**
 * L_min per scope §4.1/§4.3. `aBasis` selects how ambiguity for non-rectangular
 * footprints is resolved; for a true rectangle all three modes agree.
 */
export function leastHorizontalDimension(vertices: Vec2[], aBasis: ABasis): number {
  switch (aBasis) {
    case 'boundingRect':
      return minimumBoundingRect(vertices).short;
    case 'shortestEdge':
      return Math.min(...edgeLengths(vertices));
    case 'perWing':
      // True per-wing decomposition (splitting an L-shape into rectangular
      // wings and deriving a per-wing L_min) is Phase 3 scope. For a convex
      // quadrilateral there are no wings to split, so this is equivalent to
      // shortestEdge; a non-convex input must not silently fall back here.
      if (vertices.length !== 4) {
        throw new Error(
          'perWing aBasis is not yet implemented for non-rectangular footprints (Phase 3)'
        );
      }
      return Math.min(...edgeLengths(vertices));
  }
}
