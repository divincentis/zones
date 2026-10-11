import { computeZones, DEFAULT_FORM_STATE, type ComputationResult, type FormState } from '../src/lib/buildModel';

/** The app's default building (120 x 80 ft, 22 ft, flat) with the given fields changed. */
export function formWith(overrides: Partial<FormState> = {}): FormState {
  return { ...DEFAULT_FORM_STATE, ...overrides };
}

export function zonesFor(overrides: Partial<FormState> = {}, boardSize?: number): ComputationResult {
  const outcome = computeZones(formWith(overrides), boardSize);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result;
}

/** One of each kind of building the app can draw. */
export const BUILDINGS: Record<string, Partial<FormState>> = {
  flat: {},
  flatWithOverhangAndParapet: { overhangDepth: 3, parapetHeight: 4 },
  tall: { eaveHeight: 100 },
  gable20: { roofType: 'gable', pitchDegrees: 20 },
  gableAcross35: { roofType: 'gable', pitchDegrees: 35, ridgeAlong: 'width' },
  gable60: { roofType: 'gable', pitchDegrees: 60 },
  monoslope8: { roofType: 'monoslope', pitchDegrees: 8 },
  monoslope20: { roofType: 'monoslope', pitchDegrees: 20, monoslopeHighSide: 'widthNear' },
  steppedSeparate: { stepEnabled: true },
  steppedCombined: { stepEnabled: true, stepEaveHeight: 28 },
  podiumAndTower: { stepEnabled: true, stepEaveHeight: 120, stepOffset: 15 },
  huge: { length: 1000, width: 600, eaveHeight: 30 },
  tiny: { length: 12, width: 10, eaveHeight: 9 },
};
