import type { SteppedRegionSummary } from '@zones/engine';
import {
  isMonoslopeRoofResult,
  isSteepRoofResult,
  isSteppedRoofResult,
  type ComputationResult,
} from './buildModel';
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
export function computeZoneDimensions(
  result: ComputationResult,
  boardSize?: number
): Partial<Record<AnyZoneId, ZoneDimension[]>> {
  const { roof } = result;
  const out: Partial<Record<AnyZoneId, ZoneDimension[]>> = {};

  if (isSteppedRoofResult(roof)) {
    const zone3Exists = roof.pieces.some((p) => p.zoneId === '3');
    const regions = roof.regions;
    // Under the 'separate' treatment the two roof levels have different h, so
    // every figure is per-level and the role has to ride along in the label.
    const perRegion = (
      label: string,
      formula: string,
      get: (r: SteppedRegionSummary) => number
    ): ZoneDimension[] =>
      regions.map((r) => ({
        label: regions.length > 1 ? `${label} (${r.role})` : label,
        formula,
        value: fmtWidth(get(r), boardSize),
      }));

    out['2'] = perRegion('Width', '0.6h', (r) => r.dEdge);
    if (zone3Exists) {
      // Grouped per level, so a level's leg width and leg length read as a pair.
      out['3'] = regions.flatMap((_, i) => [
        perRegion('Leg width', '0.2h', (r) => r.legWidth)[i]!,
        perRegion('Leg length', '0.6h', (r) => r.dEdge)[i]!,
      ]);
    }
    return out;
  }

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
