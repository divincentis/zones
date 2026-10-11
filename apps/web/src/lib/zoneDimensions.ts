import {
  isMonoslopeRoofResult,
  isSteepRoofResult,
  isSteppedRoofResult,
  isTallRoofResult,
  roofSlopeFactor,
  zoneSurfaceArea,
  type ComputationResult,
} from './buildModel';
import { steppedSections, type SteppedSection } from './steppedSections';
import type { AnyZoneId } from './zoneColors';

/**
 * One figure in a zone's row of the "Zone areas" table: what it measures,
 * the code multiplier it comes from, and the number itself.
 *
 * The multipliers live here rather than in the 3D call-outs: on screen they
 * cost horizontal space the label can't spare (long labels drift off the
 * building as you zoom out), while in the table they sit in their own column
 * and are what makes the figure checkable against the source figure.
 */
export interface ZoneDimension {
  /** What this figure measures — 'Width', 'Leg length', 'High side', … */
  label: string;
  /**
   * The FM 1-28 / a-parameter multiplier behind it ('0.6h', '2a', …), or the
   * residual it's left over from ('B - 2(1.2h)'). Omitted when the figure has
   * no expression worth showing.
   */
  formula?: string;
  /** The figure, board-rounded when takeoff rounding is on (see fmtWidth). */
  value: string;
}

export const fmt = (n: number) => `${n.toFixed(2)} ft`;

/** Rounds n up to the next multiple of boardSize, e.g. for board-coverage takeoff. */
export const roundUpToBoard = (n: number, boardSize: number) => Math.ceil(n / boardSize) * boardSize;

/**
 * Formats a width. When boardSize is set, roofers order whole boards
 * (commonly 4 ft, sometimes 8 ft) to cover it, so the board-rounded figure
 * is what actually gets ordered and built — it's shown as the primary
 * figure, with the exact figure kept alongside as the minimum it must cover.
 */
export const fmtWidth = (n: number, boardSize?: number) => {
  if (!boardSize || boardSize <= 0) return fmt(n);
  const rounded = roundUpToBoard(n, boardSize);
  const roundedStr = Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2);
  return `${roundedStr} ft (min ${fmt(n)})`;
};

/**
 * Formats a band that straddles a centerline symmetrically (the 7°-27° Zone
 * 3 ridge band, `2a`), where `perSide` is the exact per-side distance (`a`).
 * The engine rounds and clamps *that* per-side distance before mirroring it
 * across the centerline to build the piece — rounding the already-doubled
 * total instead (i.e. `roundUpToBoard(2 * perSide, boardSize)`) can land on
 * a different, smaller multiple than `2 * roundUpToBoard(perSide, boardSize)`
 * and disagree with the actual geometry, so this must match the engine's
 * per-side-then-double order, not double-then-round.
 */
export const fmtDoubledWidth = (perSide: number, boardSize?: number) => {
  if (!boardSize || boardSize <= 0) return fmt(2 * perSide);
  const rounded = 2 * roundUpToBoard(perSide, boardSize);
  const roundedStr = Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2);
  return `${roundedStr} ft (min ${fmt(2 * perSide)})`;
};

/**
 * Per-zone dimension rows for the "Zone areas" table (and the PDF's copy of
 * it), computed the same way as the matching call-outs in Scene3D's
 * RoofDimensions / SteepRoofDimensions / MonoslopeRoofDimensions /
 * SteppedRoofDimensions, so the table and the 3D view never disagree — the
 * table just carries the multiplier and the full wording that the on-screen
 * labels drop for space. A zone with no rows renders bare (area only).
 *
 * `boardSize`, when provided, additionally rounds each edge-band width up to
 * the next whole board (see fmtWidth) for material takeoff — except Zone 1/1'
 * (the field/interior), which is a residual (roof dimension minus the edge
 * band(s)) rather than a board-ordered width: it's derived from the *rounded*
 * edge band instead, so it shrinks — never rounds up — as boardSize grows.
 * Zone 3's leg length is the same 0.6h edge distance as the Zone 2 band (the
 * leg runs from the corner in to that line), so it board-rounds right along
 * with it — the leg is cut from the same boards.
 */
/** One zone's line in a table: its total area, and the figures that describe it. */
export interface ZoneTableEntry {
  zoneId: AnyZoneId;
  area: number;
  rows: ZoneDimension[];
}

/**
 * A table of zones covering one roof — the whole building, or one level of a
 * stepped one.
 */
export interface ZoneTable {
  /** Heading, e.g. "Zone areas" or "Lower roof". */
  title: string;
  /** Elevation of this roof plane, ft above grade. Only set when there's more than one table. */
  elevation?: number;
  /** How the areas were measured, when that isn't the obvious way — set for a pitched roof. */
  areaNote?: string;
  zones: ZoneTableEntry[];
}

const ZONE_ORDER: AnyZoneId[] = ["1'", '1', '2', '3', '4', '5'];

/**
 * The "Zone areas" content: one table for an ordinary building, and one per
 * level for a stepped one. Splitting by level is what lets every figure drop
 * its "(lower)"/"(upper)" qualifier — the heading carries it — and it matches
 * how the work is actually ordered, per roof rather than per building.
 */
export function computeZoneTables(result: ComputationResult, boardSize?: number): ZoneTable[] {
  const sections = steppedSections(result);
  if (sections.length === 0) {
    const dims = roofZoneDimensions(result, boardSize);
    addWallDimensions(dims, result.walls);
    const slope = roofSlopeFactor(result.roof);
    return [
      {
        title: 'Zone areas',
        // Bands are plan dimensions, but area is what gets covered, so on a
        // pitched roof it is taken on the slope — and said so, since the two
        // no longer multiply out.
        areaNote:
          slope > 1
            ? `Roof areas are measured on the slope (plan area × ${slope.toFixed(3)}); band widths are plan dimensions.`
            : undefined,
        zones: zoneEntries(dims, (zoneId) => zoneSurfaceArea(result, zoneId)),
      },
    ];
  }

  const upperWalls = result.step!.upperWalls;
  return sections.map((section) => {
    const dims = steppedZoneDimensions(section, boardSize);
    const walls = section.role === 'upper' ? upperWalls : result.walls;
    addWallDimensions(dims, walls);
    const area = (zoneId: AnyZoneId) =>
      isWallZone(zoneId) ? sumArea(walls.pieces, zoneId) : (section.extents[zoneId]?.area ?? 0);
    return {
      title: section.role === 'upper' ? 'Upper roof' : 'Lower roof',
      elevation: section.elevation,
      zones: zoneEntries(dims, area),
    };
  });
}

const isWallZone = (zoneId: AnyZoneId) => zoneId === '4' || zoneId === '5';

const sumArea = (pieces: Array<{ zoneId: string; area: number }>, zoneId: AnyZoneId) =>
  pieces.filter((p) => p.zoneId === zoneId).reduce((sum, p) => sum + p.area, 0);

/** Zones with any area, in reading order, each with whatever figures describe it. */
function zoneEntries(
  dims: Partial<Record<AnyZoneId, ZoneDimension[]>>,
  area: (zoneId: AnyZoneId) => number
): ZoneTableEntry[] {
  return ZONE_ORDER.map((zoneId) => ({ zoneId, area: area(zoneId), rows: dims[zoneId] ?? [] })).filter(
    (entry) => entry.area > 0
  );
}

/** Roof zones of a whole (non-stepped) building — computeZoneTables adds the wall zones. */
function roofZoneDimensions(
  result: ComputationResult,
  boardSize?: number
): Partial<Record<AnyZoneId, ZoneDimension[]>> {
  const { roof } = result;
  const out: Partial<Record<AnyZoneId, ZoneDimension[]>> = {};

  // A stepped building has no whole-building figures — every one of them is
  // per level, so computeZoneTables goes to steppedZoneDimensions instead.
  if (isSteppedRoofResult(roof)) return out;

  if (isMonoslopeRoofResult(roof)) {
    out['2'] = [
      {
        label: roof.pitchBand === '3-10' ? 'Low side' : 'Wrap band',
        formula: 'a',
        value: fmtWidth(roof.lowBand, boardSize),
      },
      { label: 'High side', formula: '2a', value: fmtWidth(roof.highBand, boardSize) },
    ];
    out['3'] = [
      { label: 'High corner', formula: '4a', value: fmtWidth(roof.highCornerBand, boardSize) },
      ...(roof.pitchBand === '3-10'
        ? [
            {
              label: 'Low corner (square)',
              formula: '2a',
              value: fmtWidth(roof.lowCornerBand, boardSize),
            },
          ]
        : []),
    ];
    return out;
  }

  if (isSteepRoofResult(roof) && roof.pitchBand === '45+') {
    // Wall zones on a roof: the rake strip is the wall's own `a` strip (see
    // addWallDimensions), so only the peak band needs figures of its own —
    // both of them, since it is set out as a drop but covers a plan run.
    out['5'] = [
      { label: 'Peak band, vertical', formula: 'a', value: fmt(roof.ridgeBandDrop ?? 0) },
      { label: 'Peak band, in plan', formula: 'a / tan θ', value: fmt(roof.ridgeOrEaveBand) },
    ];
    return out;
  }

  if (isSteepRoofResult(roof)) {
    out['2'] = [{ label: 'Depth from rake', formula: 'a', value: fmtWidth(roof.rakeBand, boardSize) }];
    out['3'] =
      roof.pitchBand === '7-27'
        ? [
            {
              label: 'Width (straddles ridge)',
              formula: '2a',
              value: fmtDoubledWidth(roof.ridgeOrEaveBand, boardSize),
            },
          ]
        : [{ label: 'Width from eave', formula: 'a', value: fmtWidth(roof.ridgeOrEaveBand, boardSize) }];
    return out;
  }

  if (isTallRoofResult(roof)) {
    // Fig. 3.2.2f — mirrors RoofDimensions in Scene3D.tsx. Clamped the way
    // the engine clamps them, so a small roof shows what was actually built.
    const band = Math.min(roof.a, roof.roofWidth / 2);
    const leg = Math.min(roof.cornerLeg, roof.roofLength / 2);
    const bandForField = boardSize ? Math.min(roundUpToBoard(roof.a, boardSize), roof.roofWidth / 2) : band;
    if (roof.pieces.some((p) => p.zoneId === '3')) {
      out['3'] = [
        { label: 'Leg width', formula: 'a', value: fmtWidth(band, boardSize) },
        { label: 'Leg length', formula: '2a', value: fmtWidth(leg, boardSize) },
      ];
    }
    if (roof.pieces.some((p) => p.zoneId === '1')) {
      out['2'] = [{ label: 'Width', formula: 'a', value: fmtWidth(band, boardSize) }];
      out['1'] = [{ label: 'Width', formula: 'B - 2a', value: fmt(Math.max(0, roof.roofWidth - 2 * bandForField)) }];
    }
    return out;
  }

  // Low-slope (flat) — mirrors RoofDimensions in Scene3D.tsx.
  const dEdgeX = Math.min(roof.dEdge, roof.roofLength / 2);
  const dEdgeY = Math.min(roof.dEdge, roof.roofWidth / 2);
  const legW = Math.min(roof.legWidth, dEdgeX, dEdgeY);

  // Zone 1/1' is whatever's left after the edge band(s) — never a width in
  // its own right. Board-rounding pushes the edge band further in (it only
  // ever grows), so the field/interior residual can only shrink in response;
  // it must never be rounded up on its own, or it visibly grows instead.
  // Deriving it from the *rounded* edge distance (rather than rounding the
  // already-exact residual) is what keeps the direction correct, and what
  // makes this figure match the actual (also board-rounded) 3D geometry.
  const dEdgeYForInterior = boardSize ? Math.min(roundUpToBoard(roof.dEdge, boardSize), roof.roofWidth / 2) : dEdgeY;
  const dIntX = boardSize
    ? Math.min(roundUpToBoard(roof.dInterior, boardSize), roof.roofLength / 2)
    : Math.min(roof.dInterior, roof.roofLength / 2);
  const dIntY = boardSize
    ? Math.min(roundUpToBoard(roof.dInterior, boardSize), roof.roofWidth / 2)
    : Math.min(roof.dInterior, roof.roofWidth / 2);
  const zone1PrimeWidth = Math.max(0, roof.roofWidth - 2 * dIntY);
  const zone1PrimeLength = Math.max(0, roof.roofLength - 2 * dIntX);
  const zone1Width = Math.max(0, roof.roofWidth - 2 * dEdgeYForInterior);

  const zone1Exists = roof.pieces.some((p) => p.zoneId === '1' || p.zoneId === "1'");
  const zone3Exists = roof.pieces.some((p) => p.zoneId === '3');

  if (zone3Exists) {
    out['3'] = [
      { label: 'Leg width', formula: '0.2h', value: fmtWidth(legW, boardSize) },
      { label: 'Leg length', formula: '0.6h', value: fmtWidth(dEdgeX, boardSize) },
    ];
  }
  if (zone1Exists) {
    out['2'] = [{ label: 'Width', formula: '0.6h', value: fmtWidth(dEdgeY, boardSize) }];
    // With a Zone 1' beyond it, Zone 1 is the ring band between the 0.6h and
    // 1.2h lines rather than the whole inner residual — mirroring the pair of
    // call-outs RoofDimensions draws for that case.
    out['1'] = roof.hasZone1Prime
      ? [
          {
            label: 'Width',
            formula: '1.2h - 0.6h',
            value: fmt(Math.max(0, dIntY - dEdgeYForInterior)),
          },
        ]
      : [{ label: 'Width', formula: 'B - 2(0.6h)', value: fmt(zone1Width) }];
    if (roof.hasZone1Prime) {
      out["1'"] = [
        { label: 'Width', formula: 'B - 2(1.2h)', value: fmt(zone1PrimeWidth) },
        { label: 'Length', formula: 'L - 2(1.2h)', value: fmt(zone1PrimeLength) },
      ];
    }
  }
  return out;
}

/**
 * One level of a stepped building. The band figures come from the governing
 * region's multipliers — its own `h` when the two roofs are zoned separately,
 * the taller section's when they're zoned as one. The field (Zone 1/1')
 * figures come from the pieces as built, since a stepped roof's field is not
 * a plain inset of the footprint: there's no band along the abutment, and
 * under the combined treatment the roof is an L-shaped union. A field that
 * doesn't fill its own bounding box has no honest width or length, so it
 * contributes no figures — just its area, and the note the panel prints.
 */
function steppedZoneDimensions(
  section: SteppedSection,
  boardSize?: number
): Partial<Record<AnyZoneId, ZoneDimension[]>> {
  const { region, extents } = section;
  const out: Partial<Record<AnyZoneId, ZoneDimension[]>> = {};
  const push = (zoneId: AnyZoneId, row: ZoneDimension) => {
    (out[zoneId] ??= []).push(row);
  };

  // A region over Fig. 3.2.2a's height limit is laid out with Fig. 3.2.2f's
  // dimensions instead (see steppedRoofZones.ts), so the multipliers differ.
  const tall = region.regime.regime === 'tall';
  if (extents['2']) {
    push('2', { label: 'Width', formula: tall ? 'a' : '0.6h', value: fmtWidth(region.dEdge, boardSize) });
  }
  if (extents['3']) {
    push('3', { label: 'Leg width', formula: tall ? 'a' : '0.2h', value: fmtWidth(region.legWidth, boardSize) });
    push('3', { label: 'Leg length', formula: tall ? '2a' : '0.6h', value: fmtWidth(region.legLength, boardSize) });
  }

  const zone1 = extents['1'];
  const zone1Prime = extents["1'"];
  if (zone1 && zone1Prime) {
    // Zone 1 is the ring between the 0.6h and 1.2h lines here — a band
    // figure, like Zone 2's, not an extent.
    const band = Math.max(0, roundIfBoard(region.dInterior, boardSize) - roundIfBoard(region.dEdge, boardSize));
    push('1', { label: 'Width', formula: '1.2h - 0.6h', value: fmt(band) });
  } else if (zone1?.rectangular) {
    push('1', { label: 'Width', value: fmt(zone1.width) });
    push('1', { label: 'Length', value: fmt(zone1.length) });
  }
  if (zone1Prime?.rectangular) {
    push("1'", { label: 'Width', value: fmt(zone1Prime.width) });
    push("1'", { label: 'Length', value: fmt(zone1Prime.length) });
  }
  return out;
}

/** The board-rounded figure the geometry was actually built from, or the exact one when rounding is off. */
const roundIfBoard = (n: number, boardSize?: number) =>
  boardSize && boardSize > 0 ? roundUpToBoard(n, boardSize) : n;

/**
 * Wall zones of one section. Zone 5 is the corner strip of width `a` running
 * the full wall height; Zone 4 is the field left over, so it has no width of
 * its own. `a` is shown exact — computeWallZones takes no board size, so the
 * wall geometry is never rounded and a rounded figure here would claim
 * otherwise. Each section of a stepped building keeps its own `a`, which is
 * why this takes the walls rather than the whole result.
 */
function addWallDimensions(
  out: Partial<Record<AnyZoneId, ZoneDimension[]>>,
  walls: ComputationResult['walls']
): void {
  if (walls.pieces.some((p) => p.zoneId === '5')) {
    (out['5'] ??= []).push({ label: 'Width', formula: 'a', value: fmt(walls.a.a) });
  }
}
