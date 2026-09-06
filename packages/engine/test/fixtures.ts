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

/** Same ridge construction as gableRoofBuilding, but roofType: 'hip' — ridge-height math is shared (see ridgeGeometry.ts); hip-specific zone geometry is not yet implemented. */
export function hipRoofBuilding(opts: {
  length: number;
  width: number;
  eaveHeight: number;
  pitchDegrees: number;
  ridgeAlong: 'length' | 'width';
}): FootprintNode {
  const building = gableRoofBuilding(opts);
  building.roofType = 'hip';
  return building;
}

/**
 * Monoslope building: single high edge, one of the footprint's own four
 * edges. `highSide: 'lengthNear'` puts the high edge at v=0 (the length-
 * direction edge nearest the origin); `'lengthFar'` at v=width; `'widthNear'`
 * at u=0; `'widthFar'` at u=length.
 */
export function monoslopeRoofBuilding(opts: {
  length: number;
  width: number;
  eaveHeight: number;
  pitchDegrees: number;
  highSide: 'lengthNear' | 'lengthFar' | 'widthNear' | 'widthFar';
}): FootprintNode {
  const highEdge: [Vec2, Vec2] =
    opts.highSide === 'lengthNear'
      ? [
          [0, 0],
          [opts.length, 0],
        ]
      : opts.highSide === 'lengthFar'
        ? [
            [0, opts.width],
            [opts.length, opts.width],
          ]
        : opts.highSide === 'widthNear'
          ? [
              [0, 0],
              [0, opts.width],
            ]
          : [
              [opts.length, 0],
              [opts.length, opts.width],
            ];
  return {
    id: 'test',
    vertices: rectangle(opts.length, opts.width),
    eaveHeight: opts.eaveHeight,
    roofType: 'monoslope',
    roof: {
      highEdge,
      pitchDegrees: opts.pitchDegrees,
      overhangDepth: 0,
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
