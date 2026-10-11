import { describe, expect, it } from 'vitest';
import { classifyHeightRegime } from '../src/heightRegime.js';
import { computeLowSlopeRoofZones } from '../src/lowSlopeRoofZones.js';
import { computeTallRoofZones } from '../src/tallRoofZones.js';
import { sumArea } from '../src/zoneTypes.js';
import { flatRoofBuilding } from './fixtures.js';

// FM Global 1-28 §3.2.2 limits Fig. 3.2.2a to "h ≤ 60 ft, or h < 90 ft and
// h/w ≤ 1.0"; Fig. 3.2.2f covers "buildings ≥90 ft high, or buildings >60 ft
// where h/w > 1". w is the lesser plan dimension.

describe('classifyHeightRegime — the two figure captions, at their boundaries', () => {
  it('h = 60 is low-rise whatever the width', () => {
    expect(classifyHeightRegime(60, 10)).toMatchObject({ regime: 'lowRise', clause: 'h<=60' });
  });

  it('just over 60 turns on h/w', () => {
    expect(classifyHeightRegime(60.01, 60)).toMatchObject({ regime: 'tall', clause: 'h>60, h/w>1' });
    expect(classifyHeightRegime(60.01, 100)).toMatchObject({ regime: 'lowRise', clause: 'h<90, h/w<=1' });
  });

  it('h/w = 1 exactly is still low-rise (the limit is "≤ 1")', () => {
    expect(classifyHeightRegime(75, 75).regime).toBe('lowRise');
  });

  it('just under 90 with a wide plan is low-rise; 90 is tall however wide', () => {
    expect(classifyHeightRegime(89.99, 500).regime).toBe('lowRise');
    expect(classifyHeightRegime(90, 500)).toMatchObject({ regime: 'tall', clause: 'h>=90' });
  });
});

describe('computeTallRoofZones — Fig. 3.2.2f, normal case', () => {
  // 120 x 80 at h = 100: a = max(0.1 * 80, 3) = 8. Zone 2 band 8 wide; each
  // corner an L with legs 2a = 16 long and a = 8 thick.
  //   Zone 3 per corner = 16*8 + 8*8 = 192            -> 768
  //   Zone 2 = 2*(120-32)*8 + 2*(80-32)*8             -> 2176
  //   Zone 1 = (120-16) * (80-16)                     -> 6656
  //   check: 768 + 2176 + 6656 = 9600 = 120 * 80
  const building = flatRoofBuilding({ length: 120, width: 80, eaveHeight: 100 });
  const result = computeTallRoofZones(building, 'boundingRect');

  it('a = 10% of the lesser plan dimension; corner leg = 2a', () => {
    expect(result.a).toBeCloseTo(8);
    expect(result.cornerLeg).toBeCloseTo(16);
    expect(result.aGoverningBranch).toBe('0.1*Lmin');
    expect(result.source).toBe('FM Global 1-28 Fig 3.2.2f');
  });

  it('zone areas match the hand calculation', () => {
    expect(sumArea(result.pieces, '3')).toBeCloseTo(768);
    expect(sumArea(result.pieces, '2')).toBeCloseTo(2176);
    expect(sumArea(result.pieces, '1')).toBeCloseTo(6656);
  });

  it("has no Zone 1' — the figure draws none", () => {
    expect(result.pieces.some((p) => p.zoneId === "1'")).toBe(false);
  });

  it('is nothing like Fig. 3.2.2a scaled up: 0.6h here would be 60 ft, more than half the roof', () => {
    // The regression this module exists for — Zone 1 must survive.
    expect(sumArea(result.pieces, '1')).toBeGreaterThan(0.6 * 120 * 80);
  });
});

describe('computeTallRoofZones — edge cases', () => {
  it('a is floored at 3 ft on a slender tower', () => {
    const result = computeTallRoofZones(flatRoofBuilding({ length: 24, width: 20, eaveHeight: 100 }), 'boundingRect');
    expect(result.a).toBeCloseTo(3);
    expect(result.aGoverningBranch).toBe('3ft floor');
  });

  it('conserves area when the legs collide at the centerline', () => {
    // 10 x 10: a = 3, 2a = 6 > half the roof, so the legs clamp to 5.
    const result = computeTallRoofZones(flatRoofBuilding({ length: 10, width: 10, eaveHeight: 100 }), 'boundingRect');
    const total = result.pieces.reduce((s, p) => s + p.area, 0);
    expect(total).toBeCloseTo(100);
    expect(sumArea(result.pieces, '2')).toBeCloseTo(0);
  });

  it('conserves area with an overhang and with board rounding', () => {
    const building = flatRoofBuilding({ length: 120, width: 80, eaveHeight: 100, overhangDepth: 2 });
    for (const boardSize of [undefined, 4, 8]) {
      const result = computeTallRoofZones(building, 'boundingRect', boardSize);
      const total = result.pieces.reduce((s, p) => s + p.area, 0);
      expect(total, `boardSize ${boardSize}`).toBeCloseTo(124 * 84);
      // The reported figures stay exact; only the laid-out geometry rounds.
      expect(result.a).toBeCloseTo(8);
    }
  });

  it('a parapet of 3 ft or more credits the corners to Zone 2 (Table 3.2.2f, note 2)', () => {
    const without = computeTallRoofZones(
      flatRoofBuilding({ length: 120, width: 80, eaveHeight: 100, parapetHeight: 2.9 }),
      'boundingRect'
    );
    const withCredit = computeTallRoofZones(
      flatRoofBuilding({ length: 120, width: 80, eaveHeight: 100, parapetHeight: 3 }),
      'boundingRect'
    );
    expect(without.parapetCreditsCorners).toBe(false);
    expect(withCredit.parapetCreditsCorners).toBe(true);
    expect(sumArea(withCredit.pieces, '3')).toBe(0);
    expect(sumArea(withCredit.pieces, '2')).toBeCloseTo(768 + 2176);
    expect(sumArea(withCredit.pieces, '1')).toBeCloseTo(sumArea(without.pieces, '1'));
  });
});

describe('the two low-slope figures refuse each other’s buildings', () => {
  const tall = flatRoofBuilding({ length: 120, width: 80, eaveHeight: 100 });
  const squat = flatRoofBuilding({ length: 120, width: 80, eaveHeight: 22 });
  // 70 ft tall: tall when it is narrower than it is high, low-rise when not.
  const slender = flatRoofBuilding({ length: 120, width: 50, eaveHeight: 70 });
  const broad = flatRoofBuilding({ length: 120, width: 80, eaveHeight: 70 });

  it('Fig. 3.2.2a rejects a tall building instead of scaling 0.6h up it', () => {
    expect(() => computeLowSlopeRoofZones(tall, 'boundingRect')).toThrow(/3\.2\.2f/);
    expect(() => computeLowSlopeRoofZones(slender, 'boundingRect')).toThrow(/3\.2\.2f/);
  });

  it('Fig. 3.2.2f rejects a low-rise one', () => {
    expect(() => computeTallRoofZones(squat, 'boundingRect')).toThrow(/3\.2\.2a/);
    expect(() => computeTallRoofZones(broad, 'boundingRect')).toThrow(/3\.2\.2a/);
  });

  it('between 60 and 90 ft the plan width decides', () => {
    expect(computeTallRoofZones(slender, 'boundingRect').regime.clause).toBe('h>60, h/w>1');
    expect(computeLowSlopeRoofZones(broad, 'boundingRect').regime.clause).toBe('h<90, h/w<=1');
  });
});
