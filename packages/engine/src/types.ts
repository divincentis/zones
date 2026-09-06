/**
 * Core data model. Internal units are always feet and degrees — see scope §3.1.
 * Conversion to/from other unit systems happens only at the UI boundary.
 */

export type Vec2 = readonly [number, number];

export type RoofType = 'flat' | 'gable' | 'hip' | 'monoslope';

export interface RoofPlane {
  /** Required for gable/hip; defines eave vs. rake edges. Undefined for flat/monoslope. */
  ridgeLine?: readonly [Vec2, Vec2];
  /** Canonical pitch representation. */
  pitchDegrees: number;
  /** x:12 convenience, derived from pitchDegrees. Display only — never read by the engine. */
  pitchRise?: number;
  /** Horizontal distance from wall face to roof edge. 0 if none. */
  overhangDepth: number;
  /** 0 if none. */
  parapetHeight: number;
}

export interface FootprintNode {
  id: string;
  /** Closed loop, counter-clockwise, wall-face centerline. */
  vertices: Vec2[];
  eaveHeight: number;
  roofType: RoofType;
  roof: RoofPlane;
}

/**
 * How the least-horizontal-dimension basis is resolved for non-rectangular
 * footprints, where ASCE gives no direct guidance. See scope §4.3.
 */
export type ABasis = 'boundingRect' | 'shortestEdge' | 'perWing';

export interface ProjectMetadata {
  // Reserved for forward-compatibility with pressure calculation, should it
  // ever be added. Not read anywhere in the engine. Do not surface in UI —
  // collecting inputs the tool ignores implies a capability it lacks.
  exposureCategory?: string;
  riskCategory?: string;
  enclosureClassification?: string;
}

export interface BuildingModel {
  structures: FootprintNode[];
  aBasis: ABasis;
  metadata?: ProjectMetadata;
}
