import { describe, expect, it } from 'vitest';
import { computeSteepRoofZones } from '../src/steepRoofZones.js';
import { meanRoofHeight } from '../src/meanRoofHeight.js';
import { sumArea } from '../src/zoneTypes.js';
import { gableRoofBuilding } from './fixtures.js';

// Hand-calculated against FM 1-28 Fig. 3.2.2d-1 / d-2. Building: length=100
// (rake extent, ridge runs along length), width=40 (perpExtent, ridge
// centered at width/2=20), eaveHeight=10.
//
// Mean roof height (gable, >10 deg): rise = (perpExtent/2)*tan(pitch),
// h = eaveHeight + rise/2. Lmin=40 (boundingRect) throughout, so
// a = min(0.1*40, 0.4*h) floored at max(1.6,3)=3; 0.1*40=4 governs whenever
// 0.4*h >= 4, i.e. h >= 10, which holds in both fixtures below -> a=4.

describe('meanRoofHeight — gable, pitch > 10 degrees', () => {
  it('matches eave + half-rise for a 20 degree pitch, width 40', () => {
    const building = gableRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      ridgeAlong: 'length',
    });
    const rise = 20 * Math.tan((20 * Math.PI) / 180);
    expect(meanRoofHeight(building)).toBeCloseTo(10 + rise / 2, 6);
  });

  it('throws for an off-center ridge (asymmetric gable not supported)', () => {
    const building = gableRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      ridgeAlong: 'length',
    });
    building.roof.ridgeLine = [
      [0, 15],
      [100, 15],
    ];
    expect(() => meanRoofHeight(building)).toThrow(/off-center/);
  });
});

describe('computeSteepRoofZones — Fig 3.2.2d-1 (7-27 degrees)', () => {
  // pitch=20 -> h ~= 13.64 -> a = min(4, 5.456) = 4 (floored at 3, unclamped).
  const building = gableRoofBuilding({
    length: 100,
    width: 40,
    eaveHeight: 10,
    pitchDegrees: 20,
    ridgeAlong: 'length',
  });
  const result = computeSteepRoofZones(building, 'boundingRect');

  it('a = 4, bands unclamped (rakeBand=4, ridgeOrEaveBand=4)', () => {
    expect(result.a.a).toBeCloseTo(4);
    expect(result.rakeBand).toBeCloseTo(4);
    expect(result.ridgeOrEaveBand).toBeCloseTo(4);
    expect(result.pitchBand).toBe('7-27');
  });

  it('Zone 3 (ridge x rake overlap): 2 corners * (4*8) = 64', () => {
    expect(sumArea(result.pieces, '3')).toBeCloseTo(64);
  });

  it('Zone 2 (rake-band-only + ridge-band-only regions) = 992', () => {
    // 2 rake bands * 2 side-strips * (4*16) = 256, plus field-near-ridge 92*8=736
    expect(sumArea(result.pieces, '2')).toBeCloseTo(992);
  });

  it('Zone 1 (field, away from both) = 2944', () => {
    expect(sumArea(result.pieces, '1')).toBeCloseTo(2944);
  });

  it('all zones sum to the full roof area (100*40=4000)', () => {
    const total =
      sumArea(result.pieces, '1') + sumArea(result.pieces, '2') + sumArea(result.pieces, '3');
    expect(total).toBeCloseTo(4000);
  });
});

describe('computeSteepRoofZones — Fig 3.2.2d-2 (27-45 degrees)', () => {
  // pitch=35 -> h ~= 17.0 -> a = min(4, 6.8) = 4 (floored at 3, unclamped).
  const building = gableRoofBuilding({
    length: 100,
    width: 40,
    eaveHeight: 10,
    pitchDegrees: 35,
    ridgeAlong: 'length',
  });
  const result = computeSteepRoofZones(building, 'boundingRect');

  it('a = 4, pitchBand is 27-45', () => {
    expect(result.a.a).toBeCloseTo(4);
    expect(result.pitchBand).toBe('27-45');
  });

  it('Zone 3 at the 4 true building corners: 4 * (4*4) = 64', () => {
    expect(sumArea(result.pieces, '3')).toBeCloseTo(64);
  });

  it('Zone 2 (rest of the rake bands, straddling the ridge) = 256', () => {
    expect(sumArea(result.pieces, '2')).toBeCloseTo(256);
  });

  it('Zone 1 (field beyond the rake bands) = 3680', () => {
    expect(sumArea(result.pieces, '1')).toBeCloseTo(3680);
  });

  it('all zones sum to the full roof area (100*40=4000)', () => {
    const total =
      sumArea(result.pieces, '1') + sumArea(result.pieces, '2') + sumArea(result.pieces, '3');
    expect(total).toBeCloseTo(4000);
  });
});

describe('computeSteepRoofZones — pitch band boundaries (7, 27, 45 degrees)', () => {
  const base = { length: 100, width: 40, eaveHeight: 10, ridgeAlong: 'length' as const };

  it('pitch = 7 is rejected (belongs to the low-slope algorithm, not this one)', () => {
    const building = gableRoofBuilding({ ...base, pitchDegrees: 7 });
    expect(() => computeSteepRoofZones(building, 'boundingRect')).toThrow(/7°/);
  });

  it('pitch = 27 exactly uses Fig 3.2.2d-1 (7 < theta <= 27)', () => {
    const building = gableRoofBuilding({ ...base, pitchDegrees: 27 });
    expect(computeSteepRoofZones(building, 'boundingRect').pitchBand).toBe('7-27');
  });

  it('pitch just above 27 uses Fig 3.2.2d-2', () => {
    const building = gableRoofBuilding({ ...base, pitchDegrees: 27.0001 });
    expect(computeSteepRoofZones(building, 'boundingRect').pitchBand).toBe('27-45');
  });

  it('pitch = 45 exactly is still accepted (27 < theta <= 45)', () => {
    const building = gableRoofBuilding({ ...base, pitchDegrees: 45 });
    expect(computeSteepRoofZones(building, 'boundingRect').pitchBand).toBe('27-45');
  });

  it('pitch above 45 is rejected (no source figure yet)', () => {
    const building = gableRoofBuilding({ ...base, pitchDegrees: 45.0001 });
    expect(() => computeSteepRoofZones(building, 'boundingRect')).toThrow(/45°/);
  });
});

describe('computeSteepRoofZones — ridge along the width axis', () => {
  // Swap which axis the ridge runs along; rakeExtent/perpExtent swap too.
  // length=40 (perpExtent now), width=100 (rakeExtent now) -> same numbers
  // as the first 7-27 fixture, just transposed.
  const building = gableRoofBuilding({
    length: 40,
    width: 100,
    eaveHeight: 10,
    pitchDegrees: 20,
    ridgeAlong: 'width',
  });
  const result = computeSteepRoofZones(building, 'boundingRect');

  it('produces the same zone areas as the length-aligned case (geometry is axis-agnostic)', () => {
    expect(sumArea(result.pieces, '3')).toBeCloseTo(64);
    expect(sumArea(result.pieces, '2')).toBeCloseTo(992);
    expect(sumArea(result.pieces, '1')).toBeCloseTo(2944);
  });
});
