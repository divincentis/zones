import {
  computeLowSlopeRoofZones,
  computeMonoslopeRoofZones,
  computeSteepRoofZones,
  computeWallZones,
  type ABasis,
  type FootprintNode,
  type LowSlopeRoofZoneResult,
  type MonoslopeRoofZoneResult,
  type RoofType,
  type SteepRoofZoneResult,
  type Vec2,
  type WallZoneResult,
} from '@zones/engine';

export type RidgeAxisChoice = 'length' | 'width';
export type MonoslopeHighSideChoice = 'lengthNear' | 'lengthFar' | 'widthNear' | 'widthFar';

export interface FormState {
  projectName: string;
  length: number;
  width: number;
  eaveHeight: number;
  parapetHeight: number;
  overhangDepth: number;
  aBasis: ABasis;
  roofType: RoofType;
  pitchDegrees: number;
  ridgeAlong: RidgeAxisChoice;
  monoslopeHighSide: MonoslopeHighSideChoice;
}

export const DEFAULT_FORM_STATE: FormState = {
  projectName: '',
  length: 120,
  width: 80,
  eaveHeight: 22,
  parapetHeight: 0,
  overhangDepth: 0,
  aBasis: 'boundingRect',
  roofType: 'flat',
  pitchDegrees: 20,
  ridgeAlong: 'length',
  monoslopeHighSide: 'lengthFar',
};

export function buildFootprint(form: FormState): FootprintNode {
  const vertices: Vec2[] = [
    [0, 0],
    [form.length, 0],
    [form.length, form.width],
    [0, form.width],
  ];

  if (form.roofType === 'gable' || form.roofType === 'hip') {
    const ridgeLine: [Vec2, Vec2] =
      form.ridgeAlong === 'length'
        ? [
            [0, form.width / 2],
            [form.length, form.width / 2],
          ]
        : [
            [form.length / 2, 0],
            [form.length / 2, form.width],
          ];
    return {
      id: 'building-1',
      vertices,
      eaveHeight: form.eaveHeight,
      roofType: form.roofType,
      // Overhang and parapet are not yet modeled for gable/hip roofs
      // (engine limitation — see scope doc §10.1) — kept at 0 regardless of
      // form state so the UI never implies they're applied.
      roof: {
        ridgeLine,
        pitchDegrees: form.pitchDegrees,
        overhangDepth: 0,
        parapetHeight: 0,
      },
    };
  }

  if (form.roofType === 'monoslope') {
    const highEdge: [Vec2, Vec2] =
      form.monoslopeHighSide === 'lengthNear'
        ? [
            [0, 0],
            [form.length, 0],
          ]
        : form.monoslopeHighSide === 'lengthFar'
          ? [
              [0, form.width],
              [form.length, form.width],
            ]
          : form.monoslopeHighSide === 'widthNear'
            ? [
                [0, 0],
                [0, form.width],
              ]
            : [
                [form.length, 0],
                [form.length, form.width],
              ];
    return {
      id: 'building-1',
      vertices,
      eaveHeight: form.eaveHeight,
      roofType: 'monoslope',
      roof: {
        highEdge,
        pitchDegrees: form.pitchDegrees,
        overhangDepth: 0,
        parapetHeight: 0,
      },
    };
  }

  return {
    id: 'building-1',
    vertices,
    eaveHeight: form.eaveHeight,
    roofType: 'flat',
    roof: {
      pitchDegrees: 0,
      overhangDepth: form.overhangDepth,
      parapetHeight: form.parapetHeight,
    },
  };
}

export type RoofZoneResult = LowSlopeRoofZoneResult | SteepRoofZoneResult | MonoslopeRoofZoneResult;

export function isSteepRoofResult(roof: RoofZoneResult): roof is SteepRoofZoneResult {
  return 'rakeBand' in roof;
}

export function isMonoslopeRoofResult(roof: RoofZoneResult): roof is MonoslopeRoofZoneResult {
  return 'highBand' in roof;
}

export interface ComputationResult {
  building: FootprintNode;
  roof: RoofZoneResult;
  walls: WallZoneResult;
}

export type ComputationOutcome =
  | { ok: true; result: ComputationResult }
  | { ok: false; error: string };

export function computeZones(form: FormState): ComputationOutcome {
  try {
    const building = buildFootprint(form);
    const pitch = building.roof.pitchDegrees;
    let roof: RoofZoneResult;
    if (building.roofType === 'monoslope') {
      // §3.4.1.A: monoslope ≤3° is treated the same as low-slope gable;
      // 3°-30° uses its own figures (Fig 3.4.1a/b) — a narrower low-slope
      // cutoff than gable/hip's 7°.
      roof =
        pitch <= 3 ? computeLowSlopeRoofZones(building, form.aBasis) : computeMonoslopeRoofZones(building, form.aBasis);
    } else {
      roof = pitch <= 7 ? computeLowSlopeRoofZones(building, form.aBasis) : computeSteepRoofZones(building, form.aBasis);
    }
    const walls = computeWallZones(building, form.aBasis);
    return { ok: true, result: { building, roof, walls } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
