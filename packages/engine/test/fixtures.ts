import type { FootprintNode, Vec2 } from '../src/types.js';

/** Axis-aligned rectangle, CCW, origin at one corner. */
export function rectangle(length: number, width: number): Vec2[] {
  return [
    [0, 0],
    [length, 0],
    [length, width],
    [0, width],
  ];
}

/** Same rectangle rotated by `angleDegrees` about the origin — for basis-invariance checks. */
export function rotatedRectangle(length: number, width: number, angleDegrees: number): Vec2[] {
  const theta = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return rectangle(length, width).map(([x, y]): Vec2 => [x * cos - y * sin, x * sin + y * cos]);
}

/**
 * Symmetric gable, built on `rectangle(length, width)` — vertices [[0,0],
 * [length,0],[length,width],[0,width]] (u = length axis, v = width axis).
 * `ridgeAlong: 'length'` puts the ridge parallel to the length axis
 * (rakeExtent = length, perpExtent = width, centered at width/2);
 * `'width'` puts it parallel to the width axis instead.
 */
export function gableRoofBuilding(opts: {
  length: number;
  width: number;
  eaveHeight: number;
  pitchDegrees: number;
  ridgeAlong: 'length' | 'width';
  overhangDepth?: number;
}): FootprintNode {
  const ridgeLine: [Vec2, Vec2] =
    opts.ridgeAlong === 'length'
      ? [
          [0, opts.width / 2],
          [opts.length, opts.width / 2],
        ]
      : [
          [opts.length / 2, 0],
          [opts.length / 2, opts.width],
        ];
  return {
    id: 'test',
    vertices: rectangle(opts.length, opts.width),
    eaveHeight: opts.eaveHeight,
    roofType: 'gable',
    roof: {
      ridgeLine,
      pitchDegrees: opts.pitchDegrees,
      overhangDepth: opts.overhangDepth ?? 0,
      parapetHeight: 0,
    },
  };
}

export function flatRoofBuilding(opts: {
  length: number;
  width: number;
  eaveHeight: number;
  overhangDepth?: number;
  parapetHeight?: number;
}): FootprintNode {
  return {
    id: 'test',
    vertices: rectangle(opts.length, opts.width),
    eaveHeight: opts.eaveHeight,
    roofType: 'flat',
    roof: {
      pitchDegrees: 0,
      overhangDepth: opts.overhangDepth ?? 0,
      parapetHeight: opts.parapetHeight ?? 0,
    },
  };
}
