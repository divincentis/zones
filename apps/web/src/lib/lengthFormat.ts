/**
 * How a length is written for a person to read. The engine and everything
 * between it and the screen work in decimal feet (scope §3.1); this is the
 * one place that turns a figure into text, so the 3D call-outs, the tables,
 * the plan and the PDF cannot each round it their own way.
 */
export type LengthUnits = 'feetInches' | 'decimal';

export const DEFAULT_LENGTH_UNITS: LengthUnits = 'feetInches';

/**
 * Feet and inches are given to the whole inch, rounded UP: 13.2 ft is
 * 13'-3", not 13'-2". Every figure here is either a zone boundary set out
 * from an edge or a size to be covered, and for both of those the inch to
 * err by is the one that makes the band wider or the piece longer. A figure
 * that is already a whole number of inches stays put — hence the tolerance,
 * without which 8 ft computed as 8.000000000000002 would become 8'-1".
 */
export function formatLength(feet: number, units: LengthUnits): string {
  if (units === 'decimal') return `${feet.toFixed(2)} ft`;
  const inches = Math.ceil(Math.abs(feet) * 12 - 1e-6);
  const whole = Math.floor(inches / 12);
  const text = whole === 0 ? `${inches}"` : `${whole}'-${inches % 12}"`;
  return feet < 0 && inches > 0 ? `-${text}` : text;
}

/** What a reader should know about the figures, said once near them. */
export function lengthUnitsNote(units: LengthUnits): string {
  return units === 'feetInches'
    ? 'Lengths are rounded up to the whole inch.'
    : 'Lengths are in decimal feet.';
}
