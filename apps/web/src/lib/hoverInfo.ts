import type { AnyZoneId } from './zoneColors';
import type { ComputationResult } from './buildModel';
import { isMonoslopeRoofResult, isSteepRoofResult } from './buildModel';

export interface HoverInfo {
  zoneId: AnyZoneId;
  source: 'roof' | 'wall';
  area: number;
  note: string;
}

export function describeRoofHover(
  zoneId: AnyZoneId,
  area: number,
  roof: ComputationResult['roof']
): HoverInfo {
  if (isMonoslopeRoofResult(roof)) {
    const parts = [
      `pitch band ${roof.pitchBand}°`,
      `a = ${roof.a.a.toFixed(2)} ft (${roof.a.governingBranch}, basis: ${roof.a.aBasis})`,
    ];
    if (zoneId === '3') {
      parts.push(
        `high corner = 2a x 4a = ${roof.highBand.toFixed(2)} x ${roof.highCornerBand.toFixed(2)} ft` +
          (roof.pitchBand === '3-10'
            ? `; low corner = 2a x 2a = ${roof.lowCornerBand.toFixed(2)} x ${roof.lowCornerBand.toFixed(2)} ft`
            : ' (no separate low corner above 10°)')
      );
    } else if (zoneId === '2') {
      parts.push(`band width = ${roof.highBand.toFixed(2)} ft (high) or ${roof.lowBand.toFixed(2)} ft (low/wrap)`);
    }
    parts.push(roof.source);
    return { zoneId, source: 'roof', area, note: parts.join(' · ') };
  }

  if (isSteepRoofResult(roof)) {
    const parts = [
      `pitch band ${roof.pitchBand}°`,
      `a = ${roof.a.a.toFixed(2)} ft (${roof.a.governingBranch}, basis: ${roof.a.aBasis})`,
    ];
    if (zoneId === '3') {
      parts.push(
        roof.pitchBand === '7-27'
          ? `ridge band = a = ${roof.ridgeOrEaveBand.toFixed(2)} ft x rake band = a = ${roof.rakeBand.toFixed(2)} ft (ridge x rake overlap)`
          : `corner = a x a = ${roof.rakeBand.toFixed(2)} x ${roof.ridgeOrEaveBand.toFixed(2)} ft`
      );
    } else if (zoneId === '2') {
      parts.push(`band width = a = ${roof.rakeBand.toFixed(2)} ft`);
    }
    parts.push(roof.source);
    return { zoneId, source: 'roof', area, note: parts.join(' · ') };
  }

  const parts = [`h = ${roof.h.toFixed(2)} ft`];
  if (zoneId === '2' || zoneId === '3') {
    parts.push(`edge band = 0.6h = ${roof.dEdge.toFixed(2)} ft`);
  }
  if (zoneId === '2' && roof.parapetCreditsCorners) {
    parts.push('includes corner areas credited from Zone 3 (parapet >= 3 ft, Table 3.2.2a note 2)');
  }
  if (zoneId === '1' || zoneId === "1'") {
    parts.push(`interior boundary = 1.2h = ${roof.dInterior.toFixed(2)} ft`);
    parts.push(
      roof.hasZone1Prime
        ? `Zone 1' applies (Lmin > 2.4h = ${roof.wideThreshold.toFixed(2)} ft)`
        : `Zone 1' does not apply (Lmin <= 2.4h = ${roof.wideThreshold.toFixed(2)} ft)`
    );
  }
  return { zoneId, source: 'roof', area, note: parts.join(' · ') };
}

export function describeWallHover(
  zoneId: AnyZoneId,
  area: number,
  walls: ComputationResult['walls']
): HoverInfo {
  return {
    zoneId,
    source: 'wall',
    area,
    note: `a = ${walls.a.a.toFixed(2)} ft (${walls.a.governingBranch}, basis: ${walls.a.aBasis})`,
  };
}
