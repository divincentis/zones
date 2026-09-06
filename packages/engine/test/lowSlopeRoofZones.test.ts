import { describe, expect, it } from 'vitest';
import { computeLowSlopeRoofZones } from '../src/lowSlopeRoofZones.js';
import { sumArea } from '../src/zoneTypes.js';
import { flatRoofBuilding } from './fixtures.js';

// Hand-calculated fixtures for FM Global 1-28 Fig. 3.2.2a low-slope roof
// zones. h = eave height throughout (flat roof, pitch = 0 <= 10 degree
// threshold, so h = eave height per meanRoofHeight).
//
// Per corner, with d = 0.6h (leg length, unclamped) and w = 0.2h (leg width):
//   corner square area   = d^2
//   zone 3 (L) area      = 2*d*w - w^2         (two d-by-w legs minus their w-by-w overlap)
//   zone 2 remainder     = (d - w)^2           (far inner square of the corner)
//   check: d^2 = (2dw - w^2) + (d-w)^2  =>  d^2 = 2dw - w^2 + d^2 - 2dw + w^2 = d^2  [OK]

describe('computeLowSlopeRoofZones — normal case, Zone 1\' present', () => {
  // h = 10 -> d = 6, legW = 2, dInterior = 12, wideThreshold = 24.
  // L=100, W=80, Lmin=80 > 24 -> Zone 1' applies.
  const building = flatRoofBuilding({ length: 100, width: 80, eaveHeight: 10 });
  const result = computeLowSlopeRoofZones(building, 'boundingRect');

  it('derives h, dEdge, dInterior, wideThreshold from eave height', () => {
    expect(result.h).toBeCloseTo(10);
    expect(result.dEdge).toBeCloseTo(6);
    expect(result.dInterior).toBeCloseTo(12);
    expect(result.wideThreshold).toBeCloseTo(24);
    expect(result.hasZone1Prime).toBe(true);
  });

  it('Zone 3 total area: 4 corners * (2*6*2 - 2^2) = 4*20 = 80', () => {
    expect(sumArea(result.pieces, '3')).toBeCloseTo(80);
  });

  it('Zone 1\' area: inset by 1.2h=12 on all sides -> (100-24)*(80-24) = 76*56 = 4256', () => {
    expect(sumArea(result.pieces, "1'")).toBeCloseTo(4256);
  });

  it('Zone 1 area: inset-by-6 rect (88*68=5984) minus inset-by-12 rect (4256) = 1728', () => {
    expect(sumArea(result.pieces, '1')).toBeCloseTo(1728);
  });

  it('Zone 2 area: total band (8000 - 5984 = 2016) minus Zone 3 (80) = 1936', () => {
    expect(sumArea(result.pieces, '2')).toBeCloseTo(1936);
  });

  it('all zone areas sum to the total footprint area (100*80=8000)', () => {
    const total =
      sumArea(result.pieces, '1') +
      sumArea(result.pieces, "1'") +
      sumArea(result.pieces, '2') +
      sumArea(result.pieces, '3');
    expect(total).toBeCloseTo(8000);
  });

  it('no zone pieces overlap (spot check: total area from pieces equals sum of individual piece areas)', () => {
    const naiveSum = result.pieces.reduce((s, p) => s + p.area, 0);
    const total =
      sumArea(result.pieces, '1') +
      sumArea(result.pieces, "1'") +
      sumArea(result.pieces, '2') +
      sumArea(result.pieces, '3');
    expect(naiveSum).toBeCloseTo(total);
  });
});

describe('computeLowSlopeRoofZones — below the Zone 1\' width threshold', () => {
  // h = 10 -> wideThreshold = 24. Lmin = 60*... choose 60x40, Lmin=40 <= ... wait need <=24.
  // Use L=60, W=20 -> Lmin=20 <= 24: no Zone 1'.
  const building = flatRoofBuilding({ length: 60, width: 20, eaveHeight: 10 });
  const result = computeLowSlopeRoofZones(building, 'boundingRect');

  it('Zone 1\' does not apply; entire interior beyond dEdge is Zone 1', () => {
    expect(result.hasZone1Prime).toBe(false);
    expect(sumArea(result.pieces, "1'")).toBeCloseTo(0);
    // inset by dEdge=6 on all sides of 60x20 -> (60-12)*(20-12) = 48*8 = 384
    expect(sumArea(result.pieces, '1')).toBeCloseTo(384);
  });
});

describe('computeLowSlopeRoofZones — small building, edge bands collide (no Zone 1 at all)', () => {
  // h = 10 -> dEdge = 6 (nominal). W=10 -> W/2=5 < 6, so dY clamps to 5,
  // meaning the perimeter band consumes the entire width: no Zone 1 anywhere.
  const building = flatRoofBuilding({ length: 60, width: 10, eaveHeight: 10 });
  const result = computeLowSlopeRoofZones(building, 'boundingRect');

  it('has no Zone 1 or Zone 1\' pieces', () => {
    expect(sumArea(result.pieces, '1')).toBeCloseTo(0);
    expect(sumArea(result.pieces, "1'")).toBeCloseTo(0);
  });

  it('Zone 2 + Zone 3 still account for the full footprint area (60*10=600)', () => {
    const total = sumArea(result.pieces, '2') + sumArea(result.pieces, '3');
    expect(total).toBeCloseTo(600);
  });
});

describe('computeLowSlopeRoofZones — very small building, corner legs also clamp', () => {
  // h = 10 -> dEdge = 6, legW = 2 (nominal). L=8, W=8 -> L/2=W/2=4 < 6,
  // so dX=dY clamp to 4. legW clamps to min(2,4,4)=2 (unaffected).
  // Corner square becomes 4x4 (clamped), still bigger than legW=2, so each
  // corner still has a valid L and a valid far-corner Zone 2 remainder.
  const building = flatRoofBuilding({ length: 8, width: 8, eaveHeight: 10 });
  const result = computeLowSlopeRoofZones(building, 'boundingRect');

  it('clamps dX/dY to half the footprint dimension (4) rather than producing negative geometry', () => {
    // Zone 3 per corner with clamped d=4, w=2: 2*4*2 - 2^2 = 16-4=12; x4 = 48
    expect(sumArea(result.pieces, '3')).toBeCloseTo(48);
  });

  it('Zone 2 + Zone 3 fully tile the 8x8=64 footprint with no Zone 1', () => {
    expect(sumArea(result.pieces, '1')).toBeCloseTo(0);
    expect(sumArea(result.pieces, "1'")).toBeCloseTo(0);
    const total = sumArea(result.pieces, '2') + sumArea(result.pieces, '3');
    expect(total).toBeCloseTo(64);
  });
});

describe('computeLowSlopeRoofZones — square footprint', () => {
  const building = flatRoofBuilding({ length: 50, width: 50, eaveHeight: 10 });
  const result = computeLowSlopeRoofZones(building, 'boundingRect');

  it('produces symmetric zone areas (all 4 corners equal, Lmin well-defined)', () => {
    // Lmin=50 <= wideThreshold(24)? No, 50 > 24 -> Zone 1' applies.
    expect(result.hasZone1Prime).toBe(true);
    const total =
      sumArea(result.pieces, '1') +
      sumArea(result.pieces, "1'") +
      sumArea(result.pieces, '2') +
      sumArea(result.pieces, '3');
    expect(total).toBeCloseTo(2500);
  });
});

describe('computeLowSlopeRoofZones — parapet corner credit (Table 3.2.2a, note 2)', () => {
  // Same 100x80/h=10 building as the first describe block: uncredited Zone 3
  // = 80, uncredited Zone 2 = 1936. A qualifying parapet folds Zone 3 into
  // Zone 2 (same total, different split) without touching any other zone.
  it('below the 3 ft threshold: no change, Zone 3 still 80', () => {
    const building = flatRoofBuilding({ length: 100, width: 80, eaveHeight: 10, parapetHeight: 2.9 });
    const result = computeLowSlopeRoofZones(building, 'boundingRect');
    expect(result.parapetCreditsCorners).toBe(false);
    expect(sumArea(result.pieces, '3')).toBeCloseTo(80);
    expect(sumArea(result.pieces, '2')).toBeCloseTo(1936);
  });

  it('at exactly 3 ft (boundary — "minimum height of 3 ft" is inclusive): credit applies', () => {
    const building = flatRoofBuilding({ length: 100, width: 80, eaveHeight: 10, parapetHeight: 3 });
    const result = computeLowSlopeRoofZones(building, 'boundingRect');
    expect(result.parapetCreditsCorners).toBe(true);
    expect(sumArea(result.pieces, '3')).toBeCloseTo(0);
    expect(sumArea(result.pieces, '2')).toBeCloseTo(1936 + 80);
  });

  it('above the threshold: credit applies, same as exactly at threshold', () => {
    const building = flatRoofBuilding({ length: 100, width: 80, eaveHeight: 10, parapetHeight: 6 });
    const result = computeLowSlopeRoofZones(building, 'boundingRect');
    expect(result.parapetCreditsCorners).toBe(true);
    expect(sumArea(result.pieces, '3')).toBeCloseTo(0);
    expect(sumArea(result.pieces, '2')).toBeCloseTo(2016);
  });

  it('credit does not change Zone 1/1\' or the total footprint area', () => {
    const uncredited = computeLowSlopeRoofZones(
      flatRoofBuilding({ length: 100, width: 80, eaveHeight: 10, parapetHeight: 0 }),
      'boundingRect'
    );
    const credited = computeLowSlopeRoofZones(
      flatRoofBuilding({ length: 100, width: 80, eaveHeight: 10, parapetHeight: 5 }),
      'boundingRect'
    );
    expect(sumArea(credited.pieces, '1')).toBeCloseTo(sumArea(uncredited.pieces, '1'));
    expect(sumArea(credited.pieces, "1'")).toBeCloseTo(sumArea(uncredited.pieces, "1'"));
    const totalUncredited =
      sumArea(uncredited.pieces, '1') +
      sumArea(uncredited.pieces, "1'") +
      sumArea(uncredited.pieces, '2') +
      sumArea(uncredited.pieces, '3');
    const totalCredited =
      sumArea(credited.pieces, '1') +
      sumArea(credited.pieces, "1'") +
      sumArea(credited.pieces, '2') +
      sumArea(credited.pieces, '3');
    expect(totalCredited).toBeCloseTo(totalUncredited);
  });
});

describe('computeLowSlopeRoofZones — pitch guard', () => {
  it('throws for roof slopes above 7 degrees (Algorithm B / Phase 2 territory)', () => {
    const building = flatRoofBuilding({ length: 60, width: 40, eaveHeight: 12 });
    building.roofType = 'monoslope';
    building.roof.pitchDegrees = 7.5;
    expect(() => computeLowSlopeRoofZones(building, 'boundingRect')).toThrow(/7°/);
  });
});
