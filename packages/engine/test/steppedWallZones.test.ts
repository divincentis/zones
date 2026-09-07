import { describe, expect, it } from 'vitest';
import { computeSteppedRoofZones } from '../src/steppedRoofZones.js';
import { computeSteppedWallZones } from '../src/steppedWallZones.js';
import { computeWallZones } from '../src/wallZones.js';
import { flatRoofSection } from './fixtures.js';

// lower 100 x 80 at (0,0), eave 20; upper 60 x 50 at (100,0), eave 40.
// Shared wall runs along x = 100 from y = 0 to y = 50.
const lower = flatRoofSection({ id: 'lower', x: 0, y: 0, length: 100, width: 80, eaveHeight: 20 });
const upper = flatRoofSection({ id: 'upper', x: 100, y: 0, length: 60, width: 50, eaveHeight: 40 });

const roof = computeSteppedRoofZones([lower, upper], 'boundingRect');
const walls = computeSteppedWallZones(lower, upper, roof.abutment, roof.lower.elevation, 'boundingRect');

const [lowerWalls, upperWalls] = walls.sections;

function areaOf(pieces: { area: number }[]): number {
  return pieces.reduce((s, p) => s + p.area, 0);
}

describe('computeSteppedWallZones', () => {
  it('keeps each section’s own `a` — the rule is written for a single building', () => {
    expect(lowerWalls.walls.a.a).toBeCloseTo(computeWallZones(lower, 'boundingRect').a.a);
    expect(upperWalls.walls.a.a).toBeCloseTo(computeWallZones(upper, 'boundingRect').a.a);
    expect(lowerWalls.walls.a.a).not.toBeCloseTo(upperWalls.walls.a.a);
  });

  it('drops the lower section’s buried wall entirely', () => {
    // Free-standing, the lower section's 4 walls total 2*(100+80)*20 = 7200 sf.
    // The buried stretch is 50 ft of the x = 100 wall, full 20 ft height = 1000 sf.
    expect(areaOf(computeWallZones(lower, 'boundingRect').pieces)).toBeCloseTo(7200);
    expect(areaOf(lowerWalls.walls.pieces)).toBeCloseTo(7200 - 1000);
  });

  it('keeps the exposed remainder of that same wall', () => {
    const sharedEdge = lowerWalls.walls.pieces.filter((p) => p.edgeIndex === 1);
    // The x = 100 wall is edge 1 of the lower section (vertices are CCW from
    // (0,0)); 30 of its 80 ft stay exposed above the upper section's width.
    expect(sharedEdge.reduce((s, p) => s + (p.alongMax - p.alongMin), 0)).toBeCloseTo(30);
    expect(sharedEdge.every((p) => p.alongMin >= 50 - 1e-9)).toBe(true);
  });

  it('exposes the upper section’s shared wall only above the lower roof', () => {
    // Free-standing, the upper section's walls total 2*(60+50)*40 = 8800 sf.
    // Its shared wall (50 ft long) loses everything below the lower roof at
    // 20 ft: 50 * 20 = 1000 sf.
    expect(areaOf(computeWallZones(upper, 'boundingRect').pieces)).toBeCloseTo(8800);
    expect(areaOf(upperWalls.walls.pieces)).toBeCloseTo(8800 - 1000);
  });

  it('starts those pieces at the lower roof elevation, not at grade', () => {
    // The shared wall is edge 3 of the upper section (the x = 100 side, walked
    // CCW from its own origin at (100, 0)).
    const shared = upperWalls.walls.pieces.filter((p) => p.edgeIndex === 3);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((p) => p.heightMin === 20 && p.heightMax === 40)).toBe(true);
  });

  it('leaves every non-abutting wall untouched', () => {
    const reference = computeWallZones(upper, 'boundingRect').pieces.filter((p) => p.edgeIndex !== 3);
    const actual = upperWalls.walls.pieces.filter((p) => p.edgeIndex !== 3);
    expect(actual).toEqual(reference);
  });

  it('handles a full-width abutment, where the lower wall vanishes completely', () => {
    const flush = flatRoofSection({ id: 'upper', x: 100, y: 0, length: 60, width: 80, eaveHeight: 40 });
    const flushRoof = computeSteppedRoofZones([lower, flush], 'boundingRect');
    const flushWalls = computeSteppedWallZones(
      lower,
      flush,
      flushRoof.abutment,
      flushRoof.lower.elevation,
      'boundingRect'
    );
    expect(flushWalls.sections[0].walls.pieces.some((p) => p.edgeIndex === 1)).toBe(false);
    expect(areaOf(flushWalls.sections[0].walls.pieces)).toBeCloseTo(7200 - 80 * 20);
  });
});
