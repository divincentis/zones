import { describe, expect, it } from 'vitest';
import { computeWallZones, sliceWallPiece } from '../src/wallZones.js';
import { flatRoofBuilding, gableRoofBuilding, hipRoofBuilding, monoslopeRoofBuilding } from './fixtures.js';

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
  // Wall zones only need `a` and the height of the roof above each wall —
  // both resolvable for hip (via ridgeGeometry.ts) even though its roof-zone
  // figure isn't sourced (steepRoofZones.ts still throws for it).
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
    // The roof rises 40*tan(20) across the 40 ft span: the low wall stays at
    // 10 ft, the high wall stands that much taller, and the two side walls
    // are trapezoids between them.
    const rise = 40 * Math.tan((20 * Math.PI) / 180);
    expect(total).toBeCloseTo(100 * 10 + 100 * (10 + rise) + 2 * 40 * (10 + rise / 2));
  });

  it('a monoslope at or under 3 degrees is modeled flat, walls included', () => {
    const building = monoslopeRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 3,
      highSide: 'lengthFar',
    });
    const total = computeWallZones(building, 'boundingRect').pieces.reduce((s, p) => s + p.area, 0);
    expect(total).toBeCloseTo(2 * (100 + 40) * 10);
  });
});

describe('computeWallZones — gable ends (Fig. 3.2.2e)', () => {
  // 60 x 40, eave 20, 20 degree gable with the ridge along the length, so
  // the 40 ft walls (edges 1 and 3) are the gable ends. Half-span 20, rise
  // 20*tan(20) = 7.279. h = 20 + rise/2 = 23.64 -> a = min(4, 9.46) = 4.
  const building = gableRoofBuilding({ length: 60, width: 40, eaveHeight: 20, pitchDegrees: 20, ridgeAlong: 'length' });
  const result = computeWallZones(building, 'boundingRect');
  const tan = Math.tan((20 * Math.PI) / 180);
  const rise = 20 * tan;
  const gableEnd = result.pieces.filter((p) => p.edgeIndex === 1);

  it('total wall area includes both gable triangles', () => {
    const total = result.pieces.reduce((s, p) => s + p.area, 0);
    expect(total).toBeCloseTo(2 * (60 + 40) * 20 + 2 * 0.5 * 40 * rise);
  });

  it('the corner strips run up to the rake, so their tops slope', () => {
    const strips = gableEnd.filter((p) => p.zoneId === '5');
    expect(strips).toHaveLength(2);
    for (const strip of strips) {
      expect(strip.alongMax - strip.alongMin).toBeCloseTo(4);
      expect(strip.heightMax).toBeCloseTo(20 + 4 * tan);
      expect(strip.area).toBeCloseTo(4 * (20 + (4 * tan) / 2));
    }
  });

  it('Zone 4 takes the rest of the gable end, peak included', () => {
    const field = gableEnd.filter((p) => p.zoneId === '4');
    // Cut at the ridge so each piece keeps a straight top.
    expect(field).toHaveLength(2);
    expect(Math.max(...field.map((p) => p.heightMax))).toBeCloseTo(20 + rise);
    const zone5 = 2 * 4 * (20 + (4 * tan) / 2);
    expect(field.reduce((s, p) => s + p.area, 0)).toBeCloseTo(40 * 20 + 0.5 * 40 * rise - zone5);
  });

  it('the eave walls are untouched: flat-topped at eave height', () => {
    const eaveWall = result.pieces.filter((p) => p.edgeIndex === 0);
    expect(eaveWall.every((p) => p.topAtMin === 20 && p.topAtMax === 20)).toBe(true);
    expect(eaveWall.reduce((s, p) => s + p.area, 0)).toBeCloseTo(60 * 20);
  });

  it('a gable at or under 7 degrees is modeled flat, walls included', () => {
    const low = gableRoofBuilding({ length: 60, width: 40, eaveHeight: 20, pitchDegrees: 7, ridgeAlong: 'length' });
    const total = computeWallZones(low, 'boundingRect').pieces.reduce((s, p) => s + p.area, 0);
    expect(total).toBeCloseTo(2 * (60 + 40) * 20);
  });
});

describe('computeWallZones — gable over 45 degrees (Fig. 3.4.6b)', () => {
  // 60 x 40, eave 20, 60 degree gable. Rise 20*tan(60) = 34.64, so
  // h = 37.32 and a = min(4, 14.9) = 4. On the gable end the Zone 5 strip
  // carries on up the rake, `a` wide horizontally, leaving Zone 4 as the
  // pentagon inset by 4 ft: 32 wide, eave-high at its shoulders, peaking
  // 16*tan(60) above them.
  const building = gableRoofBuilding({ length: 60, width: 40, eaveHeight: 20, pitchDegrees: 60, ridgeAlong: 'length' });
  const result = computeWallZones(building, 'boundingRect');
  const tan = Math.tan((60 * Math.PI) / 180);
  const gableEnd = result.pieces.filter((p) => p.edgeIndex === 1);

  it('cites the over-45 figures', () => {
    expect(result.source).toBe('FM Global 1-28 Fig 3.4.6a/b');
  });

  it('Zone 4 on the gable end is the inset pentagon', () => {
    const zone4 = gableEnd.filter((p) => p.zoneId === '4').reduce((s, p) => s + p.area, 0);
    expect(zone4).toBeCloseTo(32 * 20 + 0.5 * 32 * 16 * tan);
  });

  it('Zone 5 is everything else on that wall, up to the peak', () => {
    const zone4 = gableEnd.filter((p) => p.zoneId === '4').reduce((s, p) => s + p.area, 0);
    const zone5 = gableEnd.filter((p) => p.zoneId === '5');
    expect(zone5.reduce((s, p) => s + p.area, 0)).toBeCloseTo(40 * 20 + 0.5 * 40 * 20 * tan - zone4);
    expect(Math.max(...zone5.map((p) => p.heightMax))).toBeCloseTo(20 + 20 * tan);
  });

  it('the rake band starts where the corner strip ends, at eave height', () => {
    const band = gableEnd.find((p) => p.zoneId === '5' && Math.abs(p.alongMin - 4) < 1e-9)!;
    expect(band.baseAtMin).toBeCloseTo(20);
    expect(band.topAtMin).toBeCloseTo(20 + 4 * tan);
  });

  it('at 45 degrees exactly the gable end is still Fig. 3.2.2e: corner strips only', () => {
    const at45 = gableRoofBuilding({ length: 60, width: 40, eaveHeight: 20, pitchDegrees: 45, ridgeAlong: 'length' });
    const end = computeWallZones(at45, 'boundingRect').pieces.filter((p) => p.edgeIndex === 1 && p.zoneId === '5');
    expect(end).toHaveLength(2);
  });
});

describe('computeWallZones — source figure and piece slicing', () => {
  it('cites Fig. 3.2.2e for a low-rise building and Fig. 3.2.2f for a tall one', () => {
    const low = computeWallZones(flatRoofBuilding({ length: 60, width: 40, eaveHeight: 20 }), 'boundingRect');
    const tall = computeWallZones(flatRoofBuilding({ length: 60, width: 40, eaveHeight: 100 }), 'boundingRect');
    expect(low.source).toBe('FM Global 1-28 Fig 3.2.2e');
    expect(tall.source).toBe('FM Global 1-28 Fig 3.2.2f');
    expect(tall.regime.regime).toBe('tall');
  });

  it('slicing a sloped piece conserves its area and interpolates its top', () => {
    const gable = gableRoofBuilding({ length: 60, width: 40, eaveHeight: 20, pitchDegrees: 20, ridgeAlong: 'length' });
    const piece = computeWallZones(gable, 'boundingRect').pieces.find((p) => p.edgeIndex === 1 && p.zoneId === '4')!;
    const cut = (piece.alongMin + piece.alongMax) / 2;
    const left = sliceWallPiece(piece, piece.alongMin, cut);
    const right = sliceWallPiece(piece, cut, piece.alongMax);
    expect(left.area + right.area).toBeCloseTo(piece.area);
    expect(left.topAtMax).toBeCloseTo((piece.topAtMin + piece.topAtMax) / 2);
    expect(left.topAtMax).toBeCloseTo(right.topAtMin);
  });
});
