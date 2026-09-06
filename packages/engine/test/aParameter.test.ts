import { describe, expect, it } from 'vitest';
import { computeA } from '../src/aParameter.js';
import { flatRoofBuilding } from './fixtures.js';

// Hand-calculated fixtures per scope §6: "a governed by each of the four
// branches" and "square footprint (degenerate L_min)". Each case documents
// its arithmetic so a surprising result is diagnosable without re-deriving
// the formula from scratch.

describe('computeA — branch coverage (scope §4.1, §6)', () => {
  it('governed by 0.1*Lmin: Lmin=40, h=20 -> min(4, 8)=4 > floor max(1.6,3)=3', () => {
    const building = flatRoofBuilding({ length: 60, width: 40, eaveHeight: 20 });
    const result = computeA(building, 'boundingRect');
    expect(result.lMin).toBeCloseTo(40);
    expect(result.h).toBeCloseTo(20);
    expect(result.a).toBeCloseTo(4);
    expect(result.governingBranch).toBe('0.1*Lmin');
  });

  it('governed by 0.4*h: Lmin=100, h=20 -> min(10, 8)=8 > floor max(4,3)=4', () => {
    const building = flatRoofBuilding({ length: 150, width: 100, eaveHeight: 20 });
    const result = computeA(building, 'boundingRect');
    expect(result.lMin).toBeCloseTo(100);
    expect(result.h).toBeCloseTo(20);
    expect(result.a).toBeCloseTo(8);
    expect(result.governingBranch).toBe('0.4*h');
  });

  it('governed by the 0.04*Lmin floor: Lmin=200, h=2 -> inner min(20,0.8)=0.8 < floor max(8,3)=8', () => {
    const building = flatRoofBuilding({ length: 300, width: 200, eaveHeight: 2 });
    const result = computeA(building, 'boundingRect');
    expect(result.lMin).toBeCloseTo(200);
    expect(result.h).toBeCloseTo(2);
    expect(result.a).toBeCloseTo(8);
    expect(result.governingBranch).toBe('0.04*Lmin floor');
  });

  it('governed by the 3 ft floor: Lmin=20, h=2 -> inner min(2,0.8)=0.8 < floor max(0.8,3)=3', () => {
    const building = flatRoofBuilding({ length: 35, width: 20, eaveHeight: 2 });
    const result = computeA(building, 'boundingRect');
    expect(result.lMin).toBeCloseTo(20);
    expect(result.h).toBeCloseTo(2);
    expect(result.a).toBeCloseTo(3);
    expect(result.governingBranch).toBe('3ft floor');
  });

  it('square footprint: Lmin is well-defined and agrees across all three aBasis modes', () => {
    const building = flatRoofBuilding({ length: 50, width: 50, eaveHeight: 15 });
    for (const basis of ['boundingRect', 'shortestEdge', 'perWing'] as const) {
      const result = computeA(building, basis);
      expect(result.lMin).toBeCloseTo(50);
    }
  });

  it('eave height governs h at exactly the 10° threshold (boundary, scope §4.1)', () => {
    const building = flatRoofBuilding({ length: 100, width: 60, eaveHeight: 12 });
    building.roofType = 'gable';
    building.roof.pitchDegrees = 10;
    const result = computeA(building, 'boundingRect');
    expect(result.h).toBeCloseTo(12);
  });

  it('throws rather than guessing mean roof height above 10° for gable without a ridgeLine', () => {
    const building = flatRoofBuilding({ length: 100, width: 60, eaveHeight: 12 });
    building.roofType = 'gable';
    building.roof.pitchDegrees = 10.0001;
    expect(() => computeA(building, 'boundingRect')).toThrow(/ridgeLine/);
  });

  it('throws rather than guessing mean roof height above 10° for hip (not yet implemented)', () => {
    const building = flatRoofBuilding({ length: 100, width: 60, eaveHeight: 12 });
    building.roofType = 'hip';
    building.roof.pitchDegrees = 10.0001;
    expect(() => computeA(building, 'boundingRect')).toThrow(/not yet/);
  });
});
