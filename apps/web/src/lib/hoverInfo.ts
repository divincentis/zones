import type { AnyZoneId } from './zoneColors';
import type { ComputationResult } from './buildModel';

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
  const parts = [`h = ${roof.h.toFixed(2)} ft`];
  if (zoneId === '2' || zoneId === '3') {
    parts.push(`edge band = 0.6h = ${roof.dEdge.toFixed(2)} ft`);
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
