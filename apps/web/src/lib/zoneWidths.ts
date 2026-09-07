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

const fmt = (n: number) => `${n.toFixed(2)} ft`;

/**
 * Per-zone width figures for the "Zone areas" table, computed the same way
 * as the matching call-outs in Scene3D's RoofDimensions / SteepRoofDimensions
 * / MonoslopeRoofDimensions / SteppedRoofDimensions, so the table and the 3D
 * view never disagree. Only zones with a meaningful single (or lower/upper,
 * or high/low) width figure are included; a zone with no entry renders as
 * "—" in the table.
 */
export function computeZoneWidths(result: ComputationResult): Partial<Record<AnyZoneId, ZoneWidthInfo>> {
  const { roof } = result;
  const out: Partial<Record<AnyZoneId, ZoneWidthInfo>> = {};

  if (isSteppedRoofResult(roof)) {
    const zone3Exists = roof.pieces.some((p) => p.zoneId === '3');
    const regions = roof.regions;
    const perRegion = (get: (r: SteppedRegionSummary) => number) =>
      regions.length > 1
        ? regions.map((r) => `${fmt(get(r))} (${r.role})`).join(' / ')
        : fmt(get(regions[0]!));
    out['2'] = { width: perRegion((r) => r.dEdge) };
    if (zone3Exists) {
      out['3'] = { width: perRegion((r) => r.legWidth), legLength: perRegion((r) => r.dEdge) };
    }
    return out;
  }

  if (isMonoslopeRoofResult(roof)) {
    out['2'] =
      roof.pitchBand === '3-10'
        ? { width: `${fmt(roof.lowBand)} (low) / ${fmt(roof.highBand)} (high)` }
        : { width: `${fmt(roof.lowBand)} (wrap) / ${fmt(roof.highBand)} (high)` };
    out['3'] =
      roof.pitchBand === '3-10'
        ? { width: `${fmt(roof.lowCornerBand)} (low) / ${fmt(roof.highCornerBand)} (high)` }
        : { width: fmt(roof.highCornerBand) };
    return out;
  }

  if (isSteepRoofResult(roof)) {
    out['2'] = { width: fmt(roof.rakeBand) };
    out['3'] =
      roof.pitchBand === '7-27'
        ? { width: `${fmt(2 * roof.ridgeOrEaveBand)} (straddles ridge)` }
        : { width: fmt(roof.ridgeOrEaveBand) };
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
    out['3'] = { width: fmt(legW), legLength: fmt(dEdgeX) };
  }
  if (zone1Exists) {
    out['2'] = { width: fmt(dEdgeY) };
    out[roof.hasZone1Prime ? "1'" : '1'] = {
      width: fmt(roof.hasZone1Prime ? zone1PrimeWidth : zone1Width),
    };
  }
  return out;
}
