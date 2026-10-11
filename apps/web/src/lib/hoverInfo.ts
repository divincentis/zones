import type { AnyZoneId } from './zoneColors';
import type { ComputationResult } from './buildModel';
import { describeBranch } from './terms';
import { formatLength, type LengthUnits } from './lengthFormat';
import { isMonoslopeRoofResult, isSteepRoofResult, isSteppedRoofResult, isTallRoofResult, pitchBandLabel } from './buildModel';

export interface HoverInfo {
  zoneId: AnyZoneId;
  source: 'roof' | 'wall';
  area: number;
  note: string;
}

export function describeRoofHover(
  zoneId: AnyZoneId,
  area: number,
  roof: ComputationResult['roof'],
  units: LengthUnits
): HoverInfo {
  const len = (feet: number) => formatLength(feet, units);
  if (isMonoslopeRoofResult(roof)) {
    const parts = [
      `pitch band ${pitchBandLabel(roof.pitchBand)}`,
      `a = ${len(roof.a.a)} (${describeBranch(roof.a.governingBranch)})`,
    ];
    if (zoneId === '3') {
      parts.push(
        `high corner = 2a x 4a = ${len(roof.highBand)} x ${len(roof.highCornerBand)}` +
          (roof.pitchBand === '3-10'
            ? `; low corner = 2a x 2a = ${len(roof.lowCornerBand)} x ${len(roof.lowCornerBand)}`
            : ' (no separate low corner above 10°)')
      );
    } else if (zoneId === '2') {
      parts.push(`band width = ${len(roof.highBand)} (high) or ${len(roof.lowBand)} (low/wrap)`);
    }
    parts.push(roof.source);
    return { zoneId, source: 'roof', area, note: parts.join(' · ') };
  }

  if (isSteepRoofResult(roof)) {
    const parts = [
      `pitch band ${pitchBandLabel(roof.pitchBand)}`,
      `a = ${len(roof.a.a)} (${describeBranch(roof.a.governingBranch)})`,
    ];
    if (roof.pitchBand === '45+') {
      parts.push('above 45° the roof is zoned as wall construction (FM 1-28 §3.4.6)');
      if (zoneId === '5') {
        parts.push(
          `strip up each rake = a = ${len(roof.rakeBand)}; band at the peak = a vertical drop of ` +
            `${len(roof.ridgeBandDrop ?? 0)} (${len(roof.ridgeOrEaveBand)} in plan each side of the ridge)`
        );
      }
    } else if (zoneId === '3') {
      parts.push(
        roof.pitchBand === '7-27'
          ? `ridge band = a = ${len(roof.ridgeOrEaveBand)} x rake band = a = ${len(roof.rakeBand)} (ridge x rake overlap)`
          : `corner = a x a = ${len(roof.rakeBand)} x ${len(roof.ridgeOrEaveBand)}`
      );
    } else if (zoneId === '2') {
      parts.push(`band width = a = ${len(roof.rakeBand)}`);
    }
    parts.push(roof.source);
    return { zoneId, source: 'roof', area, note: parts.join(' · ') };
  }

  if (isSteppedRoofResult(roof)) {
    const parts = [
      roof.treatment === 'separate'
        ? `roof elevations differ by ${len(roof.heightDifference)} (>= ${roof.threshold} ft) — zoned as two roofs, Fig. 3.2.2b`
        : `roof elevations differ by ${len(roof.heightDifference)} (< ${roof.threshold} ft) — zoned as one roof, Fig. 3.2.2c`,
    ];
    parts.push(
      roof.regions
        .map(
          (r) =>
            `${r.role} h = ${len(r.h)} (${r.regime.regime === 'tall' ? 'tall: band a' : '0.6h'} = ${len(r.dEdge)})`
        )
        .join('; ')
    );
    if (zoneId === '2' && roof.parapetCreditsCorners) {
      parts.push('includes corner areas credited from Zone 3 (parapet >= 3 ft on both sections, Table 3.2.2a note 2)');
    }
    if (zoneId === '1' || zoneId === "1'") {
      parts.push(
        roof.regions
          .map(
            (r) =>
              r.regime.regime === 'tall'
                ? `${r.role}: no Zone 1' on a tall roof (Fig. 3.2.2f)`
                : `${r.role}: Zone 1' ${r.hasZone1Prime ? 'applies' : 'does not apply'} (least plan dimension ${len(r.lMin)} against 2.4h = ${len(r.wideThreshold)})`
          )
          .join('; ')
      );
    }
    if (roof.hBasis === 'tallerSection') {
      parts.push("combined-roof h taken from the taller section (conservative — the figure doesn't say)");
    }
    parts.push(roof.source);
    return { zoneId, source: 'roof', area, note: parts.join(' · ') };
  }

  if (isTallRoofResult(roof)) {
    const parts = [
      `h = ${len(roof.regime.h)} — tall building`,
      `a = ${len(roof.a)} (${describeBranch(roof.aGoverningBranch)})`,
    ];
    if (zoneId === '2') parts.push(`band width = a = ${len(roof.a)}`);
    if (zoneId === '3') {
      parts.push(`L-shaped corner, legs 2a = ${len(roof.cornerLeg)} long by a = ${len(roof.a)} thick`);
    }
    if (zoneId === '2' && roof.parapetCreditsCorners) {
      parts.push('includes corner areas credited from Zone 3 (parapet >= 3 ft, Table 3.2.2f note 2)');
    }
    if (zoneId === '1') parts.push("everything inside the band — this figure has no Zone 1'");
    parts.push(roof.source);
    return { zoneId, source: 'roof', area, note: parts.join(' · ') };
  }

  const parts = [`h = ${len(roof.h)}`];
  if (zoneId === '2' || zoneId === '3') {
    parts.push(`edge band = 0.6h = ${len(roof.dEdge)}`);
  }
  if (zoneId === '2' && roof.parapetCreditsCorners) {
    parts.push('includes corner areas credited from Zone 3 (parapet >= 3 ft, Table 3.2.2a note 2)');
  }
  if (zoneId === '1' || zoneId === "1'") {
    parts.push(`interior boundary = 1.2h = ${len(roof.dInterior)}`);
    parts.push(
      roof.hasZone1Prime
        ? `Zone 1' applies (least plan dimension over 2.4h = ${len(roof.wideThreshold)})`
        : `Zone 1' does not apply (least plan dimension within 2.4h = ${len(roof.wideThreshold)})`
    );
  }
  return { zoneId, source: 'roof', area, note: parts.join(' · ') };
}

export function describeWallHover(
  zoneId: AnyZoneId,
  area: number,
  walls: ComputationResult['walls'],
  units: LengthUnits,
  /** Which section's wall this is — set for stepped buildings, where each section has its own `a`. */
  sectionLabel?: string
): HoverInfo {
  const len = (feet: number) => formatLength(feet, units);
  const a = `a = ${len(walls.a.a)} (${describeBranch(walls.a.governingBranch)}) · ${walls.source}`;
  return {
    zoneId,
    source: 'wall',
    area,
    note: sectionLabel ? `${sectionLabel}: ${a}` : a,
  };
}
