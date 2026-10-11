import { describe, expect, it } from 'vitest';
import { isPlainNumber, parseFeet } from '../src/lib/feetInches';

const cases: Array<[string, number]> = [
  // decimal feet
  ['22', 22],
  ['22.5', 22.5],
  ['.5', 0.5],
  ['22.', 22],
  ['  120  ', 120],
  ['0', 0],
  // feet, marked
  ["22'", 22],
  ['22 ft', 22],
  ['22ft', 22],
  ['22 feet', 22],
  ['1 foot', 1],
  ["22.5'", 22.5],
  // feet and inches
  [`22' 6"`, 22.5],
  [`22'6"`, 22.5],
  [`22'-6"`, 22.5],
  [`22' - 6"`, 22.5],
  ["22' 6", 22.5],
  ["22'6", 22.5],
  ['22ft 6in', 22.5],
  ['22 ft 6 in', 22.5],
  ['22 FT. 6 IN.', 22.5],
  [`22' 0"`, 22],
  // the marks left off
  ['22-6', 22.5],
  ['22 6', 22.5],
  ['22-0', 22],
  // fractions of an inch
  [`22' 6 1/2"`, 22 + 6.5 / 12],
  [`22'-6-1/2"`, 22 + 6.5 / 12],
  ['22-6 1/2', 22 + 6.5 / 12],
  ['22 6 1/2', 22 + 6.5 / 12],
  [`22' 6.5"`, 22 + 6.5 / 12],
  [`22' 3/4"`, 22 + 0.75 / 12],
  // inches alone
  ['6"', 0.5],
  ['6 in', 0.5],
  ['6in', 0.5],
  ['6 inches', 0.5],
  ['6 1/2"', 6.5 / 12],
  ['3/4"', 0.75 / 12],
  ['18"', 1.5],
  // a mixed number with no marks is feet
  ['22 1/2', 22.5],
  // the marks as phones and word processors type them
  ['22′ 6″', 22.5],
  ['22’ 6”', 22.5],
  ["22' 6''", 22.5],
];

describe('parseFeet', () => {
  for (const [text, feet] of cases) {
    it(`${JSON.stringify(text)} is ${feet} ft`, () => {
      expect(parseFeet(text)).toBeCloseTo(feet, 9);
    });
  }

  const unreadable = ['', '   ', 'abc', '-5', "-5'", '22 ft 6 ft', `6" 22'`, '1/0"', "22' 6 1/0\"", '22,5', '1e3', '22 6 7', '--', "'", '"', '22-', '3/4'];
  for (const text of unreadable) {
    it(`${JSON.stringify(text)} is not a length`, () => {
      expect(parseFeet(text)).toBeNull();
    });
  }

  it('takes more than twelve inches at its word', () => {
    expect(parseFeet(`2' 18"`)).toBeCloseTo(3.5);
  });
});

describe('isPlainNumber', () => {
  it('is true only for a bare decimal', () => {
    expect(isPlainNumber('22.5')).toBe(true);
    expect(isPlainNumber(' 22 ')).toBe(true);
    expect(isPlainNumber("22'")).toBe(false);
    expect(isPlainNumber('22-6')).toBe(false);
    expect(isPlainNumber('')).toBe(false);
  });
});
