import type { ABasis, FootprintNode } from './types.js';
import { leastHorizontalDimension } from './geometry.js';
import { meanRoofHeight } from './meanRoofHeight.js';

/**
 * Which family of FM Global 1-28 figures a building's height puts it in.
 *
 * The h-based low-slope roof layout (Fig. 3.2.2a: 0.6h bands, L-shaped 0.2h
 * corners, Zone 1') is not a general rule — §3.2.2 (p.19) scopes it:
 *
 *   "For low-slope roofs (≤7° and h ≤ 60 ft (18 m), or h < 90 ft (27 m) and
 *   h/w ≤1.0), the roof can be divided into four zones as a function of h"
 *
 * and Table 3.2.2a note 1 repeats it. Everything else is Fig. 3.2.2f, "Roof
 * and wall zones for buildings ≥90 ft (27 m) high, or buildings >60 ft (18 m)
 * where h/w > 1", which is dimensioned off `a` instead and has no Zone 1'.
 * The two captions are exact complements, so every building lands in one.
 *
 * `w` is the lesser plan dimension (Appendix A, p.53: "Building width, W: The
 * lesser plan dimension"), which for a non-rectangular footprint goes through
 * the same `aBasis` judgment as everything else that needs one (scope §4.3).
 *
 * Without this switch a tall building gets Fig. 3.2.2a's bands scaled by a
 * height they were never drawn for: at h = 100 ft the "0.6h" perimeter band
 * is 60 ft deep and swallows an ordinary roof whole.
 */
export type HeightRegime = 'lowRise' | 'tall';

export const LOW_RISE_MAX_HEIGHT_FT = 60;
export const TALL_MIN_HEIGHT_FT = 90;

/** The clause of the two figure captions that decided the regime — for reporting. */
export type HeightRegimeClause = 'h<=60' | 'h<90, h/w<=1' | 'h>60, h/w>1' | 'h>=90';

export interface HeightRegimeResult {
  regime: HeightRegime;
  /** Mean roof height, ft (eave height at slopes ≤ 10° — see meanRoofHeight.ts). */
  h: number;
  /** Lesser plan dimension, ft. */
  w: number;
  clause: HeightRegimeClause;
}

export function classifyHeightRegime(h: number, w: number): HeightRegimeResult {
  if (h <= LOW_RISE_MAX_HEIGHT_FT) return { regime: 'lowRise', h, w, clause: 'h<=60' };
  if (h >= TALL_MIN_HEIGHT_FT) return { regime: 'tall', h, w, clause: 'h>=90' };
  return h / w <= 1
    ? { regime: 'lowRise', h, w, clause: 'h<90, h/w<=1' }
    : { regime: 'tall', h, w, clause: 'h>60, h/w>1' };
}

export function heightRegime(node: FootprintNode, aBasis: ABasis): HeightRegimeResult {
  return classifyHeightRegime(meanRoofHeight(node), leastHorizontalDimension(node.vertices, aBasis));
}
