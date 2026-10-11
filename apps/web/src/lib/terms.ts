import type { AGoverningBranch } from '@zones/engine';

/**
 * The engine names things the way its formulas do. These say the same things
 * the way a person reading the panel or the PDF would.
 */

/** Which limit set the corner width `a`: the engine's branch name, in words. */
export function describeBranch(branch: AGoverningBranch | '0.1*Lmin' | '3ft floor'): string {
  switch (branch) {
    case '0.1*Lmin':
      return '10% of the least plan dimension';
    case '0.4*h':
      return '40% of the roof height';
    case '0.04*Lmin floor':
      return 'the minimum, 4% of the least plan dimension';
    case '3ft floor':
      return 'the 3 ft minimum';
  }
}

/**
 * The four walls, named by where they are on the plan (length runs left to
 * right, width bottom to top). The form's own values for them — 'lengthNear',
 * 'widthFar' — describe coordinates, which is no way to tell someone which
 * wall you mean.
 */
export const WALL_NAMES = {
  lengthNear: 'bottom wall',
  lengthFar: 'top wall',
  widthNear: 'left wall',
  widthFar: 'right wall',
} as const;
