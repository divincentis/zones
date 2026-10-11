import type { ABasis, FootprintNode, Vec2 } from './types.js';
import { distance } from './geometry.js';
import { computeWallZones, sliceWallPiece, wallPiece, type WallZonePiece, type WallZoneResult } from './wallZones.js';

/**
 * Wall zones for a stepped (abutting) building.
 *
 * The Zone 4/5 rule itself is untouched — each section runs through
 * computeWallZones on its own footprint with its own `a` (see wallZones.ts,
 * FM 1-28 Fig. 3.2.2e/f). What this module adds is the one thing a stepped
 * building makes wrong about that output: the shared wall.
 *
 *  - The LOWER section's abutting wall is buried behind the taller section
 *    for its whole height. It is not a wind-exposed surface at all, so its
 *    pieces are removed rather than reported as zone area.
 *  - The UPPER section's abutting wall is exposed only ABOVE the lower roof.
 *    Its pieces over the shared stretch keep their zone but start at the
 *    lower roof's elevation instead of grade.
 *
 * Both are geometry bookkeeping, not a zone-classification claim: the zone a
 * given piece of wall is in does not change, only how much of it exists.
 * Nothing here re-derives `a` from the stepped configuration — each section's
 * `a` still comes from its own footprint and height, which is the honest
 * reading of a rule written for a single building. Callers should report it
 * per section rather than as one building-wide number.
 */

const TOLERANCE_FT = 0.01;

export interface SteppedWallSection {
  nodeId: string;
  walls: WallZoneResult;
}

export interface SteppedWallZoneResult {
  /** Lower section first, then upper — matching computeSteppedRoofZones' ordering. */
  sections: [SteppedWallSection, SteppedWallSection];
}

/** Projection of a world point onto an edge's along-axis, plus its perpendicular offset. */
function projectOntoEdge(start: Vec2, end: Vec2, p: Vec2): { along: number; offset: number } | null {
  const len = distance(start, end);
  if (len < TOLERANCE_FT) return null;
  const ux = (end[0] - start[0]) / len;
  const uy = (end[1] - start[1]) / len;
  const dx = p[0] - start[0];
  const dy = p[1] - start[1];
  return { along: dx * ux + dy * uy, offset: Math.abs(dx * -uy + dy * ux) };
}

/**
 * Which of a footprint's edges carries the shared wall, and over what stretch
 * of that edge. Returns null when the abutment doesn't lie on any of this
 * node's edges (shouldn't happen for a validated abutment, but the caller
 * should not silently trim the wrong wall if it does).
 */
function locateAbutment(
  node: FootprintNode,
  from: Vec2,
  to: Vec2
): { edgeIndex: number; t0: number; t1: number } | null {
  const n = node.vertices.length;
  for (let i = 0; i < n; i++) {
    const start = node.vertices[i]!;
    const end = node.vertices[(i + 1) % n]!;
    const a = projectOntoEdge(start, end, from);
    const b = projectOntoEdge(start, end, to);
    if (!a || !b) continue;
    if (a.offset > TOLERANCE_FT || b.offset > TOLERANCE_FT) continue;

    const len = distance(start, end);
    const t0 = Math.max(0, Math.min(a.along, b.along));
    const t1 = Math.min(len, Math.max(a.along, b.along));
    if (t1 - t0 <= TOLERANCE_FT) continue;
    return { edgeIndex: i, t0, t1 };
  }
  return null;
}

/**
 * Splits every piece on `edgeIndex` at the abutment's ends, then applies
 * `insideBase` to the stretch that is actually shared: `null` drops it (fully
 * buried), a number raises its base to that elevation (exposed only above).
 */
function trimAbuttingWall(
  pieces: WallZonePiece[],
  edgeIndex: number,
  t0: number,
  t1: number,
  insideBase: number | null
): WallZonePiece[] {
  const out: WallZonePiece[] = [];

  for (const piece of pieces) {
    if (piece.edgeIndex !== edgeIndex) {
      out.push(piece);
      continue;
    }

    const spans: Array<{ min: number; max: number; shared: boolean }> = [
      { min: piece.alongMin, max: Math.min(piece.alongMax, t0), shared: false },
      { min: Math.max(piece.alongMin, t0), max: Math.min(piece.alongMax, t1), shared: true },
      { min: Math.max(piece.alongMin, t1), max: piece.alongMax, shared: false },
    ];

    for (const span of spans) {
      if (span.max - span.min <= TOLERANCE_FT) continue;
      const slice = sliceWallPiece(piece, span.min, span.max);
      if (!span.shared) {
        out.push(slice);
        continue;
      }
      if (insideBase === null) continue;
      const raised = wallPiece({
        ...slice,
        baseAtMin: Math.max(slice.baseAtMin, insideBase),
        baseAtMax: Math.max(slice.baseAtMax, insideBase),
      });
      if (raised.heightMax - raised.heightMin <= TOLERANCE_FT) continue;
      out.push(raised);
    }
  }

  return out;
}

export function computeSteppedWallZones(
  lower: FootprintNode,
  upper: FootprintNode,
  abutment: { from: Vec2; to: Vec2 },
  /** Roof elevation of the lower section — where the upper section's shared wall becomes exposed. */
  lowerRoofElevation: number,
  aBasis: ABasis
): SteppedWallZoneResult {
  const lowerWalls = computeWallZones(lower, aBasis);
  const upperWalls = computeWallZones(upper, aBasis);

  const lowerAt = locateAbutment(lower, abutment.from, abutment.to);
  const upperAt = locateAbutment(upper, abutment.from, abutment.to);
  if (!lowerAt || !upperAt) {
    throw new Error(
      'computeSteppedWallZones: the abutment does not lie on an edge of both sections. ' +
        'Wall zones were not trimmed rather than trimming the wrong wall.'
    );
  }

  return {
    sections: [
      {
        nodeId: lower.id,
        walls: {
          ...lowerWalls,
          pieces: trimAbuttingWall(lowerWalls.pieces, lowerAt.edgeIndex, lowerAt.t0, lowerAt.t1, null),
        },
      },
      {
        nodeId: upper.id,
        walls: {
          ...upperWalls,
          pieces: trimAbuttingWall(
            upperWalls.pieces,
            upperAt.edgeIndex,
            upperAt.t0,
            upperAt.t1,
            lowerRoofElevation
          ),
        },
      },
    ],
  };
}
