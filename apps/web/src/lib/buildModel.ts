import {
  computeLowSlopeRoofZones,
  computeMonoslopeRoofZones,
  computeSteepRoofZones,
  computeSteppedRoofZones,
  computeSteppedWallZones,
  computeWallZones,
  type ABasis,
  type FootprintNode,
  type LowSlopeRoofZoneResult,
  type MonoslopeRoofZoneResult,
  type RoofType,
  type SteepRoofZoneResult,
  type SteppedRoofZoneResult,
  type Vec2,
  type WallZoneResult,
} from '@zones/engine';

export type RidgeAxisChoice = 'length' | 'width';
export type MonoslopeHighSideChoice = 'lengthNear' | 'lengthFar' | 'widthNear' | 'widthFar';
/** Which wall of the primary section the stepped section abuts. */
export type StepEdgeChoice = 'lengthFar' | 'lengthNear' | 'widthFar' | 'widthNear';

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
  /** Stepped (abutting) second section — FM 1-28 Fig. 3.2.2b/c. Low-slope only. */
  stepEnabled: boolean;
  stepEdge: StepEdgeChoice;
  /** How far the stepped section projects out from the shared wall. */
  stepDepth: number;
  /** Its extent along the shared wall. */
  stepSpan: number;
  /** Offset of its near end along the shared wall, from the primary's origin corner. */
  stepOffset: number;
  stepEaveHeight: number;
  stepParapetHeight: number;
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
  stepEnabled: false,
  stepEdge: 'widthFar',
  stepDepth: 70,
  stepSpan: 50,
  stepOffset: 0,
  stepEaveHeight: 40,
  stepParapetHeight: 0,
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

/**
 * The abutting second section, placed against one wall of the primary
 * rectangle. Both sections are flat: FM 1-28 Fig. 3.2.2b/c cover "adjoining
 * low-sloped roofs" only, so the form forces roofType flat when a step is on
 * (see BuildingForm) rather than collecting a pitch the engine would reject.
 */
export function buildStepSection(form: FormState): FootprintNode {
  const { length, width, stepDepth: d, stepSpan: s, stepOffset: o } = form;
  const vertices: Vec2[] =
    form.stepEdge === 'widthFar'
      ? [
          [length, o],
          [length + d, o],
          [length + d, o + s],
          [length, o + s],
        ]
      : form.stepEdge === 'widthNear'
        ? [
            [-d, o],
            [0, o],
            [0, o + s],
            [-d, o + s],
          ]
        : form.stepEdge === 'lengthFar'
          ? [
              [o, width],
              [o + s, width],
              [o + s, width + d],
              [o, width + d],
            ]
          : [
              [o, -d],
              [o + s, -d],
              [o + s, 0],
              [o, 0],
            ];

  return {
    id: 'building-2',
    vertices,
    eaveHeight: form.stepEaveHeight,
    roofType: 'flat',
    roof: {
      pitchDegrees: 0,
      // Overhangs are rejected for stepped buildings by the engine (no source
      // figure shows one at an abutment), so never pass the primary's through.
      overhangDepth: 0,
      parapetHeight: form.stepParapetHeight,
    },
  };
}

export type RoofZoneResult =
  | LowSlopeRoofZoneResult
  | SteepRoofZoneResult
  | MonoslopeRoofZoneResult
  | SteppedRoofZoneResult;

export function isSteepRoofResult(roof: RoofZoneResult): roof is SteepRoofZoneResult {
  return 'rakeBand' in roof;
}

export function isMonoslopeRoofResult(roof: RoofZoneResult): roof is MonoslopeRoofZoneResult {
  return 'highBand' in roof;
}

export function isSteppedRoofResult(roof: RoofZoneResult): roof is SteppedRoofZoneResult {
  return 'treatment' in roof;
}

export interface StepResult {
  /** The taller section. `building` on the result is always the lower one. */
  upper: FootprintNode;
  upperWalls: WallZoneResult;
  treatment: SteppedRoofZoneResult['treatment'];
  heightDifference: number;
}

export interface ComputationResult {
  /** The only section for a plain building; the LOWER section when stepped. */
  building: FootprintNode;
  roof: RoofZoneResult;
  walls: WallZoneResult;
  step?: StepResult;
}

export type ComputationOutcome =
  | { ok: true; result: ComputationResult }
  | { ok: false; error: string };

export function computeZones(form: FormState): ComputationOutcome {
  try {
    const building = buildFootprint(form);

    if (form.stepEnabled) {
      const second = buildStepSection(form);
      const roof = computeSteppedRoofZones([building, second], form.aBasis);
      // computeSteppedRoofZones identifies lower/upper by elevation, which may
      // not be the order they were passed in — follow its answer rather than
      // assuming the primary section is the lower one.
      const lowerIsPrimary = roof.lower.id === building.id;
      const lower = lowerIsPrimary ? building : second;
      const upper = lowerIsPrimary ? second : building;
      const walls = computeSteppedWallZones(
        lower,
        upper,
        roof.abutment,
        roof.lower.elevation,
        form.aBasis
      );
      return {
        ok: true,
        result: {
          building: lower,
          roof,
          walls: walls.sections[0].walls,
          step: {
            upper,
            upperWalls: walls.sections[1].walls,
            treatment: roof.treatment,
            heightDifference: roof.heightDifference,
          },
        },
      };
    }

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
