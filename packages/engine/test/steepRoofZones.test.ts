import { describe, expect, it } from 'vitest';
import { computeSteepRoofZones } from '../src/steepRoofZones.js';
import { meanRoofHeight } from '../src/meanRoofHeight.js';
import { sumArea } from '../src/zoneTypes.js';
import { gableRoofBuilding, hipRoofBuilding, monoslopeRoofBuilding } from './fixtures.js';

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

  it('pitch just above 45 is zoned as wall construction (Fig 3.4.6a)', () => {
    const building = gableRoofBuilding({ ...base, pitchDegrees: 45.0001 });
    const result = computeSteepRoofZones(building, 'boundingRect');
    expect(result.pitchBand).toBe('45+');
    expect(result.source).toBe('FM Global 1-28 Fig 3.4.6a');
  });

  it('a vertical "roof" is rejected', () => {
    const building = gableRoofBuilding({ ...base, pitchDegrees: 90 });
    expect(() => computeSteepRoofZones(building, 'boundingRect')).toThrow(/90°/);
  });
});

describe('computeSteepRoofZones — Fig 3.4.6a (theta > 45), roof treated as wall Zones 4 and 5', () => {
  // length=100 (rake extent), width=40 (perpExtent), eave 10, pitch 60.
  // Rise = 20*tan(60) = 34.64 -> h = 27.32 -> a = min(4, 10.9) = 4.
  //   Zone 5 up each rake: 4 wide, full 40 across        -> 2 * 160 = 320
  //   Zone 5 at the peak: a vertical drop of a = 4 is a plan run of
  //     4/tan(60) = 2.309 each side of the ridge, over the 92 ft between
  //     the rake strips                                  -> 92 * 4.619 = 424.9
  //   Zone 4: the rest                                   -> 4000 - 744.9
  const building = gableRoofBuilding({ length: 100, width: 40, eaveHeight: 10, pitchDegrees: 60, ridgeAlong: 'length' });
  const result = computeSteepRoofZones(building, 'boundingRect');
  const tan = Math.tan((60 * Math.PI) / 180);

  it('carries only wall zone ids', () => {
    expect(new Set(result.pieces.map((p) => p.zoneId))).toEqual(new Set(['4', '5']));
  });

  it('the peak band is a vertical drop of a, reported with its plan run', () => {
    expect(result.ridgeBandDrop).toBeCloseTo(4);
    expect(result.ridgeOrEaveBand).toBeCloseTo(4 / tan);
    expect(result.rakeBand).toBeCloseTo(4);
  });

  it('zone areas match the hand calculation', () => {
    const peakBand = 92 * 2 * (4 / tan);
    expect(sumArea(result.pieces, '5')).toBeCloseTo(320 + peakBand);
    expect(sumArea(result.pieces, '4')).toBeCloseTo(4000 - 320 - peakBand);
  });

  it('the slope factor turns plan area into surface area: 1/cos(60) = 2', () => {
    expect(result.slopeFactor).toBeCloseTo(2);
  });

  it('is not board-rounded, so the rake strip stays in line with the wall strip below it', () => {
    const rounded = computeSteepRoofZones(building, 'boundingRect', 8);
    expect(sumArea(rounded.pieces, '5')).toBeCloseTo(sumArea(result.pieces, '5'));
  });

  it('the peak band never outruns the roof: on a narrow building it takes the whole slope', () => {
    // width 3 -> a is the 3 ft floor, but the half-span is 1.5 and the roof
    // only rises 1.5*tan(60) = 2.6 ft, less than a. The band stops at the
    // eave rather than running past it, and no Zone 4 is left.
    const narrow = gableRoofBuilding({ length: 100, width: 3, eaveHeight: 10, pitchDegrees: 60, ridgeAlong: 'length' });
    const r = computeSteepRoofZones(narrow, 'boundingRect');
    expect(sumArea(r.pieces, '4')).toBe(0);
    expect(sumArea(r.pieces, '5')).toBeCloseTo(300);
    expect(r.ridgeBandDrop).toBeCloseTo(1.5 * tan);
  });
});

describe('computeSteepRoofZones — slope factor', () => {
  it('is 1/cos(pitch) in every band', () => {
    for (const pitchDegrees of [20, 35, 60]) {
      const building = gableRoofBuilding({ length: 100, width: 40, eaveHeight: 10, pitchDegrees, ridgeAlong: 'length' });
      expect(computeSteepRoofZones(building, 'boundingRect').slopeFactor).toBeCloseTo(
        1 / Math.cos((pitchDegrees * Math.PI) / 180)
      );
    }
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

describe('computeSteepRoofZones — very small building, rake and ridge bands both clamp', () => {
  // length=width=4 -> rakeExtent=perpExtent=4, so half-extent=2 < a's 3ft
  // floor. Both rakeBand and ridgeOrEaveBand clamp to 2, and ridgeNear
  // ([ridgeCenter-2, ridgeCenter+2]) spans the full perpExtent (0-4), so
  // every "away from ridge"/"field" piece degenerates to zero width and
  // only the two Zone 3 ridge-x-rake corners survive, fully tiling the roof.
  const building = gableRoofBuilding({
    length: 4,
    width: 4,
    eaveHeight: 3,
    pitchDegrees: 20,
    ridgeAlong: 'length',
  });
  const result = computeSteepRoofZones(building, 'boundingRect');

  it('a floors at 3, bands clamp to half the (4ft) extents', () => {
    expect(result.a.a).toBeCloseTo(3);
    expect(result.a.governingBranch).toBe('3ft floor');
    expect(result.rakeBand).toBeCloseTo(2);
    expect(result.ridgeOrEaveBand).toBeCloseTo(2);
  });

  it('Zone 3 alone fully tiles the 4x4=16 roof, no Zone 1 or Zone 2', () => {
    expect(sumArea(result.pieces, '3')).toBeCloseTo(16);
    expect(sumArea(result.pieces, '2')).toBeCloseTo(0);
    expect(sumArea(result.pieces, '1')).toBeCloseTo(0);
  });
});

describe('computeSteepRoofZones — hip and monoslope still not implemented', () => {
  // Mean roof height and wall zones are now resolvable for both (see
  // wallZones.test.ts), but roof-ZONE geometry for hip and monoslope has no
  // sourced figure yet — this must keep throwing rather than reusing the
  // gable figure, which scope §4.2 notes is a distinct figure for hip and
  // doesn't apply to monoslope's asymmetric single slope at all.
  it('rejects hip even with a valid ridgeLine', () => {
    const building = hipRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      ridgeAlong: 'length',
    });
    expect(() => computeSteepRoofZones(building, 'boundingRect')).toThrow(/gable only/);
  });

  it('rejects monoslope even with a valid highEdge', () => {
    const building = monoslopeRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      highSide: 'lengthFar',
    });
    expect(() => computeSteepRoofZones(building, 'boundingRect')).toThrow(/gable only/);
  });
});
