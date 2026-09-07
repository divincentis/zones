import type { SteppedRegionSummary } from '@zones/engine';
import {
  isMonoslopeRoofResult,
  isSteepRoofResult,
  isSteppedRoofResult,
  type ComputationResult,
} from './buildModel';
import type { AnyZoneId } from './zoneColors';

export interface ZoneWidthInfo {
  /** Formatted width call-out for this zone, mirroring the 3D dimension label(s) in Scene3D. */
  width: string;
  /**
   * Zone 3's corner-leg length (0.6h / dEdge), set only when Zone 3 is the
   * true L-shaped corner from FM 1-28 Fig. 3.2.2a/c (flat and stepped
   * roofs) — the pitched-roof Zone 3 shapes (ridge/eave band, monoslope
   * corner square) aren't L-shaped and have no separate leg length.
   */
  legLength?: string;
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
 * Per-zone width figures for the "Zone areas" table, computed the same way
 * as the matching call-outs in Scene3D's RoofDimensions / SteepRoofDimensions
 * / MonoslopeRoofDimensions / SteppedRoofDimensions, so the table and the 3D
 * view never disagree. Only zones with a meaningful single (or lower/upper,
 * or high/low) width figure are included; a zone with no entry renders as
 * "—" in the table.
 *
 * `boardSize`, when provided, additionally rounds each width up to the next
 * whole board (see fmtWidth) for material takeoff. Leg lengths are left exact.
 */
export function computeZoneWidths(
  result: ComputationResult,
  boardSize?: number
): Partial<Record<AnyZoneId, ZoneWidthInfo>> {
  const { roof } = result;
  const out: Partial<Record<AnyZoneId, ZoneWidthInfo>> = {};

  if (isSteppedRoofResult(roof)) {
    const zone3Exists = roof.pieces.some((p) => p.zoneId === '3');
    const regions = roof.regions;
    const perRegion = (get: (r: SteppedRegionSummary) => number, roundToBoard = false) =>
      regions.length > 1
        ? regions
            .map((r) => `${roundToBoard ? fmtWidth(get(r), boardSize) : fmt(get(r))} (${r.role})`)
            .join(' / ')
        : roundToBoard
          ? fmtWidth(get(regions[0]!), boardSize)
          : fmt(get(regions[0]!));
    out['2'] = { width: perRegion((r) => r.dEdge, true) };
    if (zone3Exists) {
      out['3'] = { width: perRegion((r) => r.legWidth, true), legLength: perRegion((r) => r.dEdge) };
    }
    return out;
  }

  if (isMonoslopeRoofResult(roof)) {
    out['2'] =
      roof.pitchBand === '3-10'
        ? { width: `${fmtWidth(roof.lowBand, boardSize)} (low) / ${fmtWidth(roof.highBand, boardSize)} (high)` }
        : { width: `${fmtWidth(roof.lowBand, boardSize)} (wrap) / ${fmtWidth(roof.highBand, boardSize)} (high)` };
    out['3'] =
      roof.pitchBand === '3-10'
        ? {
            width: `${fmtWidth(roof.lowCornerBand, boardSize)} (low) / ${fmtWidth(roof.highCornerBand, boardSize)} (high)`,
          }
        : { width: fmtWidth(roof.highCornerBand, boardSize) };
    return out;
  }

  if (isSteepRoofResult(roof)) {
    out['2'] = { width: fmtWidth(roof.rakeBand, boardSize) };
    out['3'] =
      roof.pitchBand === '7-27'
        ? { width: `${fmtWidth(2 * roof.ridgeOrEaveBand, boardSize)} (straddles ridge)` }
        : { width: fmtWidth(roof.ridgeOrEaveBand, boardSize) };
    return out;
  }

  // Low-slope (flat) — mirrors RoofDimensions in Scene3D.tsx.
  const dEdgeX = Math.min(roof.dEdge, roof.roofLength / 2);
  const dEdgeY = Math.min(roof.dEdge, roof.roofWidth / 2);
  const legW = Math.min(roof.legWidth, dEdgeX, dEdgeY);
  const dIntY = Math.min(roof.dInterior, roof.roofWidth / 2);
  const zone1PrimeWidth = Math.max(0, roof.roofWidth - 2 * dIntY);
  const zone1Width = Math.max(0, roof.roofWidth - 2 * dEdgeY);

  const zone1Exists = roof.pieces.some((p) => p.zoneId === '1' || p.zoneId === "1'");
  const zone3Exists = roof.pieces.some((p) => p.zoneId === '3');

  if (zone3Exists) {
    out['3'] = { width: fmtWidth(legW, boardSize), legLength: fmt(dEdgeX) };
  }
  if (zone1Exists) {
    out['2'] = { width: fmtWidth(dEdgeY, boardSize) };
    out[roof.hasZone1Prime ? "1'" : '1'] = {
      width: fmtWidth(roof.hasZone1Prime ? zone1PrimeWidth : zone1Width, boardSize),
    };
  }
  return out;
}
