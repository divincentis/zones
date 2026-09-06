import { describe, expect, it } from 'vitest';
import { computeMonoslopeRoofZones } from '../src/monoslopeRoofZones.js';
import { sumArea } from '../src/zoneTypes.js';
import { monoslopeRoofBuilding } from './fixtures.js';

// Building: length=100 (rakeExtent when highSide is length-direction... here
// highSide='lengthFar' means the HIGH edge runs along the length axis, so
// span (slope direction) = width, rakeExtent (ridge-parallel) = length.
// length=100 (rakeExtent), width=40 (span), eaveHeight=10.
// Lmin=40 (boundingRect) throughout.

describe('computeMonoslopeRoofZones — Fig 3.4.1a (3-10 degrees)', () => {
  // pitch=6 -> h = eaveHeight (pitch <= 10 uses eave height per scope §4.1) = 10.
  // a = min(0.1*40, 0.4*10) = min(4,4) = 4 (floored at max(1.6,3)=3, unclamped).
  const building = monoslopeRoofBuilding({
    length: 100,
    width: 40,
    eaveHeight: 10,
    pitchDegrees: 6,
    highSide: 'lengthFar',
  });
  const result = computeMonoslopeRoofZones(building, 'boundingRect');

  it('a = 4, bands unclamped (high=8, highCorner=16, low=4, lowCorner=8)', () => {
    expect(result.a.a).toBeCloseTo(4);
    expect(result.highBand).toBeCloseTo(8);
    expect(result.highCornerBand).toBeCloseTo(16);
    expect(result.lowBand).toBeCloseTo(4);
    expect(result.lowCornerBand).toBeCloseTo(8);
    expect(result.pitchBand).toBe('3-10');
  });

  it('all zone pieces sum to the full roof area (100*40=4000)', () => {
    const total = sumArea(result.pieces, '1') + sumArea(result.pieces, '2') + sumArea(result.pieces, '3');
    expect(total).toBeCloseTo(4000);
  });

  it('Zone 3 (high 2 corners 8x16 + low 2 corners 8x8) = 2*128 + 2*64 = 384', () => {
    expect(sumArea(result.pieces, '3')).toBeCloseTo(384);
  });

  it('Zone 2 (high middle 8x(100-32) + low middle 4x(100-16)) = 8*68 + 4*84 = 880', () => {
    expect(sumArea(result.pieces, '2')).toBeCloseTo(880);
  });

  it('Zone 1 = total - zone3 - zone2 = 4000-384-880 = 2736', () => {
    expect(sumArea(result.pieces, '1')).toBeCloseTo(2736);
  });
});

describe('computeMonoslopeRoofZones — Fig 3.4.1b (10-30 degrees)', () => {
  // pitch=20 -> h = eaveHeight + rise/2, rise = span(40)*tan(20deg).
  // a = min(0.1*40, 0.4*h). rise=14.56, h=10+7.28=17.28 -> 0.4h=6.9 ->
  // a = min(4,6.9) = 4 (floored at 3, unclamped).
  const building = monoslopeRoofBuilding({
    length: 100,
    width: 40,
    eaveHeight: 10,
    pitchDegrees: 20,
    highSide: 'lengthFar',
  });
  const result = computeMonoslopeRoofZones(building, 'boundingRect');

  it('a = 4, pitchBand 10-30, no low corner (lowCornerBand=0)', () => {
    expect(result.a.a).toBeCloseTo(4);
    expect(result.pitchBand).toBe('10-30');
    expect(result.highBand).toBeCloseTo(8);
    expect(result.highCornerBand).toBeCloseTo(16);
    expect(result.lowBand).toBeCloseTo(4);
    expect(result.lowCornerBand).toBe(0);
  });

  it('all zone pieces sum to the full roof area (100*40=4000)', () => {
    const total = sumArea(result.pieces, '1') + sumArea(result.pieces, '2') + sumArea(result.pieces, '3');
    expect(total).toBeCloseTo(4000);
  });

  it('Zone 3 = high corners only, 2*(8*16) = 256', () => {
    expect(sumArea(result.pieces, '3')).toBeCloseTo(256);
  });

  it('Zone 2 = high middle (8*68=544) + wrap band (top+bottom+low edge)', () => {
    // top: (span-highBand)*lowBand = (40-8)*4=128; bottom: 128;
    // low edge: lowBand*(rakeExtent-2*lowBand)=4*(100-8)=368
    // total wrap = 128+128+368=624; + high middle 544 = 1168
    expect(sumArea(result.pieces, '2')).toBeCloseTo(1168);
  });

  it('Zone 1 = total - zone3 - zone2 = 4000-256-1168 = 2576', () => {
    expect(sumArea(result.pieces, '1')).toBeCloseTo(2576);
  });
});

describe('computeMonoslopeRoofZones — very small building, bands clamp', () => {
  // length=width=10, eaveHeight=3 -> a floors at 3 (both pitches below).
  // span=rakeExtent=10, so half-extent=5 < 2a=6 and < 4a=12: highBand,
  // highCornerBand, and (3-10 only) lowCornerBand all clamp to 5 — exactly
  // half the extent. highBand(5) + lowCornerBand(5) = span(10), so the high
  // and low corner strips butt up with zero field width between them.

  it('3-10 band: high+low corners collide, Zone 3 alone tiles the whole roof', () => {
    const building = monoslopeRoofBuilding({
      length: 10,
      width: 10,
      eaveHeight: 3,
      pitchDegrees: 8,
      highSide: 'lengthFar',
    });
    const result = computeMonoslopeRoofZones(building, 'boundingRect');

    expect(result.a.a).toBeCloseTo(3);
    expect(result.a.governingBranch).toBe('3ft floor');
    expect(result.highBand).toBeCloseTo(5);
    expect(result.highCornerBand).toBeCloseTo(5);
    expect(result.lowBand).toBeCloseTo(3);
    expect(result.lowCornerBand).toBeCloseTo(5);

    expect(sumArea(result.pieces, '3')).toBeCloseTo(100);
    expect(sumArea(result.pieces, '2')).toBeCloseTo(0);
    expect(sumArea(result.pieces, '1')).toBeCloseTo(0);
  });

  it('10-30 band: high corner/band clamp but the low wrap band still fits, so Zone 1/2 survive', () => {
    const building = monoslopeRoofBuilding({
      length: 10,
      width: 10,
      eaveHeight: 3,
      pitchDegrees: 20,
      highSide: 'lengthFar',
    });
    const result = computeMonoslopeRoofZones(building, 'boundingRect');

    expect(result.a.a).toBeCloseTo(3);
    expect(result.highBand).toBeCloseTo(5);
    expect(result.highCornerBand).toBeCloseTo(5);
    expect(result.lowBand).toBeCloseTo(3);

    const total = sumArea(result.pieces, '1') + sumArea(result.pieces, '2') + sumArea(result.pieces, '3');
    expect(total).toBeCloseTo(100);
    expect(sumArea(result.pieces, '3')).toBeCloseTo(50);
  });
});

describe('computeMonoslopeRoofZones — pitch band boundaries and guards', () => {
  const base = { length: 100, width: 40, eaveHeight: 10, highSide: 'lengthFar' as const };

  it('pitch = 3 is rejected (belongs to the low-slope algorithm)', () => {
    const building = monoslopeRoofBuilding({ ...base, pitchDegrees: 3 });
    expect(() => computeMonoslopeRoofZones(building, 'boundingRect')).toThrow(/3°-30°/);
  });

  it('pitch = 10 exactly uses Fig 3.4.1a (3 < theta <= 10)', () => {
    const building = monoslopeRoofBuilding({ ...base, pitchDegrees: 10 });
    expect(computeMonoslopeRoofZones(building, 'boundingRect').pitchBand).toBe('3-10');
  });

  it('pitch just above 10 uses Fig 3.4.1b', () => {
    const building = monoslopeRoofBuilding({ ...base, pitchDegrees: 10.0001 });
    expect(computeMonoslopeRoofZones(building, 'boundingRect').pitchBand).toBe('10-30');
  });

  it('pitch = 30 exactly is still accepted', () => {
    const building = monoslopeRoofBuilding({ ...base, pitchDegrees: 30 });
    expect(computeMonoslopeRoofZones(building, 'boundingRect').pitchBand).toBe('10-30');
  });

  it('pitch above 30 is rejected (no source figure)', () => {
    const building = monoslopeRoofBuilding({ ...base, pitchDegrees: 30.0001 });
    expect(() => computeMonoslopeRoofZones(building, 'boundingRect')).toThrow(/3°-30°/);
  });

  it('rejects non-monoslope roofType', () => {
    const building = monoslopeRoofBuilding({ ...base, pitchDegrees: 6 });
    building.roofType = 'gable';
    expect(() => computeMonoslopeRoofZones(building, 'boundingRect')).toThrow(/monoslope only/);
  });
});

describe('computeMonoslopeRoofZones — high side orientation is axis-agnostic', () => {
  it('produces the same zone areas regardless of which edge is high (transposed)', () => {
    const a1 = computeMonoslopeRoofZones(
      monoslopeRoofBuilding({ length: 100, width: 40, eaveHeight: 10, pitchDegrees: 6, highSide: 'lengthFar' }),
      'boundingRect'
    );
    const a2 = computeMonoslopeRoofZones(
      monoslopeRoofBuilding({ length: 40, width: 100, eaveHeight: 10, pitchDegrees: 6, highSide: 'widthFar' }),
      'boundingRect'
    );
    expect(sumArea(a2.pieces, '3')).toBeCloseTo(sumArea(a1.pieces, '3'));
    expect(sumArea(a2.pieces, '2')).toBeCloseTo(sumArea(a1.pieces, '2'));
    expect(sumArea(a2.pieces, '1')).toBeCloseTo(sumArea(a1.pieces, '1'));
  });

  it('produces the same zone areas whether the high edge is "near" or "far"', () => {
    const near = computeMonoslopeRoofZones(
      monoslopeRoofBuilding({ length: 100, width: 40, eaveHeight: 10, pitchDegrees: 6, highSide: 'lengthNear' }),
      'boundingRect'
    );
    const far = computeMonoslopeRoofZones(
      monoslopeRoofBuilding({ length: 100, width: 40, eaveHeight: 10, pitchDegrees: 6, highSide: 'lengthFar' }),
      'boundingRect'
    );
    expect(sumArea(near.pieces, '3')).toBeCloseTo(sumArea(far.pieces, '3'));
    expect(sumArea(near.pieces, '2')).toBeCloseTo(sumArea(far.pieces, '2'));
    expect(sumArea(near.pieces, '1')).toBeCloseTo(sumArea(far.pieces, '1'));
  });
});
