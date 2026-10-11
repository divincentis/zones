import {
  computeLowSlopeRoofZones,
  computeMonoslopeRoofZones,
  computeSteepRoofZones,
  computeSteppedRoofZones,
  computeSteppedWallZones,
  computeTallRoofZones,
  computeWallZones,
  heightRegime,
  type ABasis,
  type FootprintNode,
  type HeightRegimeResult,
  type LowSlopeRoofZoneResult,
  type MonoslopeRoofZoneResult,
  type RoofType,
  type SteepRoofZoneResult,
  type SteppedRoofZoneResult,
  type TallRoofZoneResult,
  type Vec2,
  type WallZoneResult,
} from '@zones/engine';
import { formatLength, type LengthUnits } from './lengthFormat';

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
  | TallRoofZoneResult
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

/** Why a building falls under the low-slope figure it does, in the terms of FM 1-28 §3.2.2's height limit. */
export function heightRegimeReason(regime: HeightRegimeResult, units: LengthUnits): string {
  const h = `h is ${formatLength(regime.h, units)}`;
  const ratio = `h/w is ${(regime.h / regime.w).toFixed(2)}`;
  switch (regime.clause) {
    case 'h<=60':
      return `${h}, within 60 ft`;
    case 'h<90, h/w<=1':
      return `${h}, under 90 ft, and ${ratio}, within 1`;
    case 'h>60, h/w>1':
      return `${h}, over 60 ft, and ${ratio}, over 1`;
    case 'h>=90':
      return `${h}, 90 ft or more`;
  }
}

/** A steep-roof pitch band as prose: '7-27°', or 'over 45°' for the open-ended one. */
export function pitchBandLabel(band: string): string {
  return band === '45+' ? 'over 45°' : `${band}°`;
}

export function isTallRoofResult(roof: RoofZoneResult): roof is TallRoofZoneResult {
  return 'cornerLeg' in roof;
}

/**
 * Plan area × this = area on the roof surface. Roof pieces carry plan areas
 * (zones are laid out in plan), which on a pitched roof understates what
 * actually gets covered — by 6% at 20°, 41% at 45°.
 */
export function roofSlopeFactor(roof: RoofZoneResult): number {
  return isSteepRoofResult(roof) || isMonoslopeRoofResult(roof) ? roof.slopeFactor : 1;
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

/**
 * One zone's total area across the whole building, each piece measured on the
 * surface it lies on. Sums roof and walls together because a zone id is not
 * confined to one of them: a gable steeper than 45° is zoned as wall
 * construction, so its roof slopes carry Zones 4 and 5 too.
 */
export function zoneSurfaceArea(result: ComputationResult, zoneId: string): number {
  const sum = (pieces: Array<{ zoneId: string; area: number }>) =>
    pieces.filter((p) => p.zoneId === zoneId).reduce((total, p) => total + p.area, 0);
  return (
    roofSlopeFactor(result.roof) * sum(result.roof.pieces) +
    sum(result.walls.pieces) +
    (result.step ? sum(result.step.upperWalls.pieces) : 0)
  );
}

export type ComputationOutcome =
  | { ok: true; result: ComputationResult }
  | { ok: false; error: string };

export function computeZones(form: FormState, boardSize?: number): ComputationOutcome {
  try {
    const building = buildFootprint(form);

    if (form.stepEnabled) {
      const second = buildStepSection(form);
      const roof = computeSteppedRoofZones([building, second], form.aBasis, boardSize);
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
    // Which low-slope figure applies turns on height, not just slope: Fig.
    // 3.2.2a stops at 60 ft (90 ft where h/w <= 1) and Fig. 3.2.2f takes over.
    const lowSlope = (): RoofZoneResult =>
      heightRegime(building, form.aBasis).regime === 'tall'
        ? computeTallRoofZones(building, form.aBasis, boardSize)
        : computeLowSlopeRoofZones(building, form.aBasis, boardSize);
    let roof: RoofZoneResult;
    if (building.roofType === 'monoslope') {
      // §3.4.1.A: monoslope ≤3° is treated the same as low-slope gable;
      // 3°-30° uses its own figures (Fig 3.4.1a/b) — a narrower low-slope
      // cutoff than gable/hip's 7°.
      roof =
        pitch <= 3 ? lowSlope() : computeMonoslopeRoofZones(building, form.aBasis, boardSize);
    } else {
      roof =
        pitch <= 7 ? lowSlope() : computeSteepRoofZones(building, form.aBasis, boardSize);
    }
    const walls = computeWallZones(building, form.aBasis);
    return { ok: true, result: { building, roof, walls } };
  } catch (err) {
    return { ok: false, error: explainFailure(form, err) };
  }
}

/**
 * Why a building could not be zoned, for the person who entered it. The
 * engine's own messages are written for whoever is calling its functions —
 * they open with the function's name — so the cases a form can actually
 * reach are put in the form's terms here, each with what to change. Anything
 * unforeseen still gets the engine's reason, minus the function name.
 */
export function explainFailure(form: FormState, err: unknown): string {
  const lengths: Array<[string, number]> = [
    ['Length', form.length],
    ['Width', form.width],
    ['Height', form.eaveHeight],
    ...(form.stepEnabled
      ? ([
          ['Section 2 length along the wall', form.stepSpan],
          ['Section 2 depth', form.stepDepth],
          ['Section 2 height', form.stepEaveHeight],
        ] as Array<[string, number]>)
      : []),
  ];
  const zero = lengths.find(([, value]) => !(value > 0));
  if (zero) return `${zero[0]} has to be more than zero.`;

  if (form.stepEnabled) {
    const wall = form.stepEdge === 'widthFar' || form.stepEdge === 'widthNear' ? form.width : form.length;
    if (form.stepOffset >= wall) {
      return (
        'Section 2 has to touch the wall it attaches to. Its offset along that wall is as long as the ' +
        'wall itself, which puts it past the end. Reduce the offset.'
      );
    }
  } else {
    const pitch = form.pitchDegrees;
    if (form.roofType !== 'flat' && pitch >= 90) return 'A roof pitch has to be less than 90°.';
    if (form.roofType === 'hip' && pitch > 7) {
      return (
        'Hip roofs steeper than 7° can\'t be zoned: FM Global 1-28 has no figure for them. ' +
        'At 7° or less a hip roof is zoned as low-slope, or choose Gable to see a pitched roof of the same size.'
      );
    }
    if (form.roofType === 'monoslope' && pitch > 30) {
      return 'Monoslope roofs steeper than 30° can\'t be zoned: FM Global 1-28\'s figures for them stop at 30°.';
    }
  }

  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^[A-Za-z]+: /, '');
}
