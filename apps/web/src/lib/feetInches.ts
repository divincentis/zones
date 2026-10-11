/**
 * Reads a length the way it gets written on a drawing or said on a roof, and
 * returns it in decimal feet — the only unit the rest of the app works in
 * (scope §3.1: conversion happens at the UI boundary and nowhere else).
 *
 *   22.5   22   .5          decimal feet
 *   22'    22 ft            feet
 *   22' 6"   22'-6"   22'6  feet and inches
 *   22-6   22 6             feet and inches, the marks left off
 *   22' 6 1/2"   22-6 1/2   with a fraction of an inch
 *   6"   6 1/2"   3/4 in    inches alone
 *   22 1/2                  a mixed number, in feet
 *
 * A dash between two numbers is the feet-inches dash, never a minus sign:
 * "22-6" is twenty-two foot six. Nothing here is negative; a length that
 * reads as less than zero does not read at all.
 *
 * Returns null for anything it cannot read, so the caller can leave the
 * last good value in place while someone is half-way through typing.
 */
export function parseFeet(input: string): number | null {
  const s = input
    .trim()
    .toLowerCase()
    // The marks as a phone or a word processor types them.
    .replace(/[′’‘`]/g, "'")
    .replace(/[″”“]/g, '"')
    .replace(/''/g, '"')
    // Unit words, with or without a space before them: "22ft", "6 in."
    .replace(/(feet|foot|ft)\.?(?![a-z])/g, "'")
    .replace(/(inches|inch|in)\.?(?![a-z])/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  const NUM = String.raw`(\d+(?:\.\d*)?|\.\d+)`;
  const FRAC = String.raw`(\d+) ?\/ ?(\d+)`;
  // A count of inches: a number, a number and a fraction, or a fraction.
  const INCHES = `(?:${NUM}(?:[ -]${FRAC})?|${FRAC})`;

  const fraction = (top: string | undefined, bottom: string | undefined): number | null => {
    if (top === undefined || bottom === undefined) return 0;
    const d = Number(bottom);
    return d === 0 ? null : Number(top) / d;
  };
  /** Groups as INCHES captures them: whole, its fraction, or a fraction alone. */
  const inches = (m: (string | undefined)[], at: number): number | null => {
    const withWhole = fraction(m[at + 1], m[at + 2]);
    const alone = fraction(m[at + 3], m[at + 4]);
    if (withWhole === null || alone === null) return null;
    return (m[at] === undefined ? 0 : Number(m[at])) + withWhole + alone;
  };
  const finish = (feet: number | null): number | null =>
    feet !== null && Number.isFinite(feet) && feet >= 0 ? feet : null;

  let m: RegExpMatchArray | null;

  // Feet marked, inches optional:  22'   22' 6"   22'-6 1/2"
  if ((m = s.match(new RegExp(`^${NUM} ?'(?: ?-? ?${INCHES} ?"?)?$`)))) {
    const inch = inches(m, 2);
    return finish(inch === null ? null : Number(m[1]) + inch / 12);
  }
  // Inches alone, which have to say so:  6"   6 1/2"   3/4"
  if ((m = s.match(new RegExp(`^${INCHES} ?"$`)))) {
    const inch = inches(m, 1);
    return finish(inch === null ? null : inch / 12);
  }
  // No marks. One number, perhaps with a fraction, is feet:  22.5   22 1/2
  if ((m = s.match(new RegExp(`^${NUM}(?:[ -]${FRAC})?$`)))) {
    const part = fraction(m[2], m[3]);
    return finish(part === null ? null : Number(m[1]) + part);
  }
  // Two numbers are feet then inches:  22-6   22 6   22-6 1/2
  if ((m = s.match(new RegExp(`^${NUM}[ -]${NUM}(?:[ -]${FRAC})?$`)))) {
    const part = fraction(m[3], m[4]);
    return finish(part === null ? null : Number(m[1]) + (Number(m[2]) + part) / 12);
  }
  return null;
}

/** True for text that is already a plain decimal number, and so needs no translating back to the person who typed it. */
export function isPlainNumber(input: string): boolean {
  return /^\s*(\d+\.?\d*|\.\d+)\s*$/.test(input);
}
