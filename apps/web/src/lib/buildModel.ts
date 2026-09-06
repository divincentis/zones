import {
  computeLowSlopeRoofZones,
  computeWallZones,
  type ABasis,
  type FootprintNode,
  type LowSlopeRoofZoneResult,
  type WallZoneResult,
} from '@zones/engine';

export interface FormState {
  length: number;
  width: number;
  eaveHeight: number;
  parapetHeight: number;
  overhangDepth: number;
  aBasis: ABasis;
}

export const DEFAULT_FORM_STATE: FormState = {
  length: 120,
  width: 80,
  eaveHeight: 22,
  parapetHeight: 0,
  overhangDepth: 0,
  aBasis: 'boundingRect',
};

export function buildFootprint(form: FormState): FootprintNode {
  return {
    id: 'building-1',
    vertices: [
      [0, 0],
      [form.length, 0],
      [form.length, form.width],
      [0, form.width],
    ],
    eaveHeight: form.eaveHeight,
    roofType: 'flat',
    roof: {
      pitchDegrees: 0,
      overhangDepth: form.overhangDepth,
      parapetHeight: form.parapetHeight,
    },
  };
}

export interface ComputationResult {
  building: FootprintNode;
  roof: LowSlopeRoofZoneResult;
  walls: WallZoneResult;
}

export type ComputationOutcome =
  | { ok: true; result: ComputationResult }
  | { ok: false; error: string };

export function computeZones(form: FormState): ComputationOutcome {
  try {
    const building = buildFootprint(form);
    const roof = computeLowSlopeRoofZones(building, form.aBasis);
    const walls = computeWallZones(building, form.aBasis);
    return { ok: true, result: { building, roof, walls } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
