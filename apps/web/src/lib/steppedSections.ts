import type { SteppedRegionSummary, Vec2, ZonePiece } from '@zones/engine';
import { isSteppedRoofResult, type ComputationResult } from './buildModel';
import type { AnyZoneId } from './zoneColors';

export interface PlanRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Which side of a PlanRect a thing sits on. */
export type PlanSide = 'x0' | 'x1' | 'y0' | 'y1';

export interface ZoneExtent extends PlanRect {
  /** Plan extent across the building's width axis (Y) and length axis (X). */
  width: number;
  length: number;
  area: number;
  /**
   * True when the zone's pieces tile that box exactly. A zone that doesn't —
   * Zone 1 as a ring around Zone 1', or a field wrapping an abutment — has no
   * honest width/length, so callers fall back to the band figure (or show
   * nothing) rather than dimension a box the zone doesn't fill.
   */
  rectangular: boolean;
}

const TOL = 1e-6;

/** Plan bounds of a set of pieces, or null if there are none. */
export function boundsOfPieces(pieces: ZonePiece[]): PlanRect | null {
  if (pieces.length === 0) return null;
  const xs = pieces.flatMap((p) => p.vertices.map((v) => v[0]));
  const ys = pieces.flatMap((p) => p.vertices.map((v) => v[1]));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

export function boundsOfVertices(vertices: Vec2[]): PlanRect {
  const xs = vertices.map((v) => v[0]);
  const ys = vertices.map((v) => v[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * What one zone actually occupies, measured off the built pieces rather than
 * re-derived from the roof outline. On a stepped building the field zones are
 * not a simple inset of the footprint — an abutting edge carries no band, and
 * under the combined treatment the "roof" is an L-shaped union whose bounding
 * box contains plenty of nothing — so piece geometry is the only figure that
 * matches what the 3D view draws.
 */
export function zoneExtent(pieces: ZonePiece[], zoneId: AnyZoneId): ZoneExtent | null {
  const own = pieces.filter((p) => p.zoneId === zoneId);
  const box = boundsOfPieces(own);
  if (!box) return null;
  const area = own.reduce((sum, p) => sum + p.area, 0);
  const width = box.y1 - box.y0;
  const length = box.x1 - box.x0;
  const boxArea = width * length;
  return {
    ...box,
    width,
    length,
    area,
    rectangular: Math.abs(boxArea - area) <= Math.max(TOL, boxArea * 1e-9),
  };
}

export type SteppedSectionRole = 'lower' | 'upper';

export interface SteppedSection {
  role: SteppedSectionRole;
  /** Roof-plane elevation of this section, in feet above grade. */
  elevation: number;
  /** The section's own footprint — never the union's bounding box. */
  rect: PlanRect;
  /**
   * The region whose figures govern this section: its own when the two roofs
   * are zoned separately (Fig. 3.2.2b), the single combined region otherwise
   * (Fig. 3.2.2c, where one `h` covers both levels).
   */
  region: SteppedRegionSummary;
  /**
   * The side of `rect` that carries no edge band because it abuts the other
   * section, or null when every side is free. Fig. 3.2.2b gives the TALLER
   * roof's abutting edge full perimeter treatment, so under that treatment
   * only the lower section has one; under Fig. 3.2.2c the shared line is
   * interior to the single roof, so both sections do.
   */
  shelteredSide: PlanSide | null;
  /** This section's zones, as built. */
  extents: Partial<Record<AnyZoneId, ZoneExtent>>;
}

/** Which side of `rect` the abutment segment runs along, if any. */
function abutmentSide(rect: PlanRect, from: Vec2, to: Vec2): PlanSide | null {
  if (Math.abs(from[0] - to[0]) < TOL) {
    const x = from[0];
    if (Math.abs(rect.x0 - x) < TOL) return 'x0';
    if (Math.abs(rect.x1 - x) < TOL) return 'x1';
    return null;
  }
  const y = from[1];
  if (Math.abs(rect.y0 - y) < TOL) return 'y0';
  if (Math.abs(rect.y1 - y) < TOL) return 'y1';
  return null;
}

/**
 * The two physical sections of a stepped building, each with the figures that
 * govern it and the zones it actually carries — the shared basis for the 3D
 * call-outs and the "Zone areas" table, so the two can't drift apart. Returns
 * [] for anything that isn't a stepped result.
 */
export function steppedSections(result: ComputationResult): SteppedSection[] {
  const { roof, building, step } = result;
  if (!isSteppedRoofResult(roof) || !step) return [];

  const byRole = (role: SteppedSectionRole): SteppedRegionSummary =>
    roof.treatment === 'combined' ? roof.regions[0]! : roof.regions.find((r) => r.role === role)!;

  const sections: Array<{ role: SteppedSectionRole; elevation: number; vertices: Vec2[] }> = [
    { role: 'lower', elevation: roof.lower.elevation, vertices: building.vertices },
    { role: 'upper', elevation: roof.upper.elevation, vertices: step.upper.vertices },
  ];

  return sections.map(({ role, elevation, vertices }) => {
    const rect = boundsOfVertices(vertices);
    const pieces = roof.pieces.filter((p) => p.elevation === elevation);
    const sheltered =
      roof.treatment === 'combined' || role === 'lower'
        ? abutmentSide(rect, roof.abutment.from, roof.abutment.to)
        : null;
    const extents: Partial<Record<AnyZoneId, ZoneExtent>> = {};
    for (const zoneId of ['1', "1'", '2', '3'] as AnyZoneId[]) {
      const extent = zoneExtent(pieces, zoneId);
      if (extent) extents[zoneId] = extent;
    }
    return { role, elevation, rect, region: byRole(role), shelteredSide: sheltered, extents };
  });
}
