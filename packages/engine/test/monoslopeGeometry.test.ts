import { describe, expect, it } from 'vitest';
import { resolveMonoslopeGeometry } from '../src/monoslopeGeometry.js';
import { monoslopeRoofBuilding } from './fixtures.js';

describe('resolveMonoslopeGeometry', () => {
  it('resolves highSide "far" on the v axis (length-direction edge at v=width)', () => {
    const building = monoslopeRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      highSide: 'lengthFar',
    });
    const geom = resolveMonoslopeGeometry(building);
    expect(geom.slopeAxis).toBe('v');
    expect(geom.highSide).toBe('far');
    expect(geom.span).toBeCloseTo(40);
  });

  it('resolves highSide "near" on the v axis (length-direction edge at v=0)', () => {
    const building = monoslopeRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      highSide: 'lengthNear',
    });
    const geom = resolveMonoslopeGeometry(building);
    expect(geom.slopeAxis).toBe('v');
    expect(geom.highSide).toBe('near');
    expect(geom.span).toBeCloseTo(40);
  });

  it('resolves highSide on the u axis (width-direction edges)', () => {
    const near = resolveMonoslopeGeometry(
      monoslopeRoofBuilding({ length: 100, width: 40, eaveHeight: 10, pitchDegrees: 20, highSide: 'widthNear' })
    );
    expect(near.slopeAxis).toBe('u');
    expect(near.highSide).toBe('near');
    expect(near.span).toBeCloseTo(100);

    const far = resolveMonoslopeGeometry(
      monoslopeRoofBuilding({ length: 100, width: 40, eaveHeight: 10, pitchDegrees: 20, highSide: 'widthFar' })
    );
    expect(far.slopeAxis).toBe('u');
    expect(far.highSide).toBe('far');
    expect(far.span).toBeCloseTo(100);
  });

  it('throws when highEdge is missing', () => {
    const building = monoslopeRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      highSide: 'lengthFar',
    });
    building.roof.highEdge = undefined;
    expect(() => resolveMonoslopeGeometry(building)).toThrow(/highEdge/);
  });

  it('throws when highEdge is not axis-aligned with either footprint edge', () => {
    const building = monoslopeRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      highSide: 'lengthFar',
    });
    building.roof.highEdge = [
      [0, 0],
      [100, 40],
    ];
    expect(() => resolveMonoslopeGeometry(building)).toThrow(/not parallel/);
  });

  it('throws when highEdge is parallel but not a full footprint edge (short segment)', () => {
    const building = monoslopeRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      highSide: 'lengthFar',
    });
    building.roof.highEdge = [
      [0, 40],
      [50, 40],
    ];
    expect(() => resolveMonoslopeGeometry(building)).toThrow(/does not span/);
  });

  it('throws when highEdge is parallel and full-length but offset from both footprint edges', () => {
    const building = monoslopeRoofBuilding({
      length: 100,
      width: 40,
      eaveHeight: 10,
      pitchDegrees: 20,
      highSide: 'lengthFar',
    });
    building.roof.highEdge = [
      [0, 20],
      [100, 20],
    ];
    expect(() => resolveMonoslopeGeometry(building)).toThrow(/not one of the footprint/);
  });
});
