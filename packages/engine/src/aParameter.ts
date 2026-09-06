import type { ABasis, FootprintNode } from './types.js';
import { leastHorizontalDimension } from './geometry.js';
import { meanRoofHeight } from './meanRoofHeight.js';

export type AGoverningBranch = '0.1*Lmin' | '0.4*h' | '0.04*Lmin floor' | '3ft floor';

export interface AResult {
  a: number;
  lMin: number;
  h: number;
  /** Which of the four branches in scope §4.1 is binding, for display/reporting. */
  governingBranch: AGoverningBranch;
  aBasis: ABasis;
}

/**
 * a = min(0.1 * L_min, 0.4 * h), floored at max(0.04 * L_min, 3 ft).
 * See scope §4.1. `a` is a plan dimension — callers must not offset along
 * a sloped roof surface using this value directly (see §4.1, §9).
 */
export function computeA(node: FootprintNode, aBasis: ABasis): AResult {
  const lMin = leastHorizontalDimension(node.vertices, aBasis);
  const h = meanRoofHeight(node);

  const tenPercentL = 0.1 * lMin;
  const fortyPercentH = 0.4 * h;
  const fourPercentL = 0.04 * lMin;
  const threeFtFloor = 3;

  const innerMin = Math.min(tenPercentL, fortyPercentH);
  const outerFloor = Math.max(fourPercentL, threeFtFloor);

  const a = Math.max(innerMin, outerFloor);

  let governingBranch: AGoverningBranch;
  if (outerFloor > innerMin) {
    governingBranch = fourPercentL >= threeFtFloor ? '0.04*Lmin floor' : '3ft floor';
  } else {
    governingBranch = tenPercentL <= fortyPercentH ? '0.1*Lmin' : '0.4*h';
  }

  return { a, lMin, h, governingBranch, aBasis };
}
