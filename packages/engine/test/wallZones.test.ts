import { describe, expect, it } from 'vitest';
import { computeWallZones } from '../src/wallZones.js';
import { flatRoofBuilding, hipRoofBuilding, monoslopeRoofBuilding } from './fixtures.js';

describe('computeWallZones', () => {
  // L=60, W=40, h=20 -> Lmin=40: 0.1*40=4, 0.4*20=8 -> a=4 (0.1*Lmin governs;
  // floor max(1.6,3)=3 < 4, so unclamped). See aParameter.test.ts for the
  // same branch-coverage logic.
  const building = flatRoofBuilding({ length: 60, width: 40, eaveHeight: 20 });
  const result = computeWallZones(building, 'boundingRect');

  it('a = 4', () => {
    expect(result.a.a).toBeCloseTo(4);
  });

  it('each of the 4 walls gets two Zone 5 corner strips of width a, full height', () => {
    const zone5 = result.pieces.filter((p) => p.zoneId === '5');
    expect(zone5).toHaveLength(8); // 2 per wall x 4 walls
    for (const piece of zone5) {
      expect(piece.alongMax - piece.alongMin).toBeCloseTo(4);
      expect(piece.heightMax - piece.heightMin).toBeCloseTo(20);
      expect(piece.area).toBeCloseTo(80);
    }
  });

  it('Zone 4 fills the remainder of each wall', () => {
    const zone4 = result.pieces.filter((p) => p.zoneId === '4' && p.edgeIndex === 0);
    expect(zone4).toHaveLength(1);
    // Edge 0 is the 60 ft wall: 60 - 2*4 = 52 ft remainder.
    expect(zone4[0]!.alongMax - zone4[0]!.alongMin).toBeCloseTo(52);
    expect(zone4[0]!.area).toBeCloseTo(52 * 20);
  });

  it('total wall area (Zone 4 + Zone 5) equals perimeter * height', () => {
    const total = result.pieces.reduce((s, p) => s + p.area, 0);
    const perimeter = 2 * (60 + 40);
    expect(total).toBeCloseTo(perimeter * 20);
  });
});

describe('computeWallZones — short wall where corner strips collide', () => {
  // L=100, W=4, h=20 -> Lmin=4: inner min(0.4,8)=0.4 < floor max(0.16,3)=3,
  // so a=3 (3ft-floor branch). On the two 100 ft walls, cornerWidth=min(3,50)=3
  // (no collision). On the two 4 ft walls, cornerWidth=min(3, 4/2=2)=2
  // (clamped) — the strips meet at the wall's midpoint with no Zone 4 left.
  const building = flatRoofBuilding({ length: 100, width: 4, eaveHeight: 20 });
  const result = computeWallZones(building, 'boundingRect');

  it('a = 3 (3ft floor governs)', () => {
    expect(result.a.a).toBeCloseTo(3);
  });

  it('long walls (edges 0, 2) get unclamped a=3 corner strips plus a Zone 4 remainder', () => {
    const longWallPieces = result.pieces.filter((p) => p.edgeIndex === 0);
    const zone5 = longWallPieces.filter((p) => p.zoneId === '5');
    const zone4 = longWallPieces.filter((p) => p.zoneId === '4');
    expect(zone5.map((p) => p.alongMax - p.alongMin)).toEqual([3, 3]);
    expect(zone4).toHaveLength(1);
    expect(zone4[0]!.alongMax - zone4[0]!.alongMin).toBeCloseTo(94);
  });

  it('short walls (edges 1, 3) clamp corner strips to half the wall length (2) with no Zone 4', () => {
    const shortWallPieces = result.pieces.filter(
      (p) => p.edgeIndex === 1 || p.edgeIndex === 3
    );
    for (const p of shortWallPieces) {
      expect(p.zoneId).toBe('5');
      expect(p.alongMax - p.alongMin).toBeCloseTo(2);
    }
    expect(shortWallPieces).toHaveLength(4); // 2 strips each on 2 short walls
  });
});

describe('computeWallZones — hip and monoslope (wall zones don\'t depend on roof-zone figures)', () => {
  // Wall zones only need `a`, which only needs mean roof height `h` — both
  // now resolvable for hip (via ridgeGeometry.ts) and monoslope (via
  // monoslopeGeometry.ts) even though their roof-zone figures aren't
  // sourced yet (steepRoofZones.ts still throws for both roofTypes).
  it('computes wall zones for a hip building given a valid ridgeLine', () => {
    const building = hipRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      ridgeAlong: 'length',
    });
    const result = computeWallZones(building, 'boundingRect');
    const total = result.pieces.reduce((s, p) => s + p.area, 0);
    expect(total).toBeCloseTo(2 * (100 + 40) * 10);
  });

  it('computes wall zones for a monoslope building given a valid highEdge', () => {
    const building = monoslopeRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      highSide: 'lengthFar',
    });
    const result = computeWallZones(building, 'boundingRect');
    const total = result.pieces.reduce((s, p) => s + p.area, 0);
    expect(total).toBeCloseTo(2 * (100 + 40) * 10);
  });
});
