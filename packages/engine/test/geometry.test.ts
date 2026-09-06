import { describe, expect, it } from 'vitest';
import { area, leastHorizontalDimension, minimumBoundingRect } from '../src/geometry.js';
import { rectangle, rotatedRectangle } from './fixtures.js';

describe('minimumBoundingRect', () => {
  it('recovers L and B for an axis-aligned rectangle', () => {
    const { short, long } = minimumBoundingRect(rectangle(100, 60));
    expect(short).toBeCloseTo(60);
    expect(long).toBeCloseTo(100);
  });

  it('recovers L and B regardless of world-frame rotation', () => {
    const { short, long } = minimumBoundingRect(rotatedRectangle(100, 60, 37));
    expect(short).toBeCloseTo(60);
    expect(long).toBeCloseTo(100);
  });
});

describe('area', () => {
  it('computes rectangle area via shoelace', () => {
    expect(area(rectangle(100, 60))).toBeCloseTo(6000);
  });
});

describe('leastHorizontalDimension — aBasis agreement on a true rectangle', () => {
  it.each(['boundingRect', 'shortestEdge', 'perWing'] as const)('%s -> 60', (basis) => {
    expect(leastHorizontalDimension(rectangle(100, 60), basis)).toBeCloseTo(60);
  });

  it.each(['boundingRect', 'shortestEdge', 'perWing'] as const)(
    '%s -> 60, rotated',
    (basis) => {
      expect(leastHorizontalDimension(rotatedRectangle(100, 60, 52), basis)).toBeCloseTo(60);
    }
  );
});
