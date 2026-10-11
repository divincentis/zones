import { describe, expect, it } from 'vitest';
import { formatLength } from '../src/lib/lengthFormat';

describe('formatLength — feet and inches', () => {
  const cases: Array<[number, string]> = [
    [13.2, `13'-3"`], // 13 ft 2.4 in: any fraction of an inch goes up
    [4.4, `4'-5"`],
    [22.5, `22'-6"`], // already whole inches: unchanged
    [120, `120'-0"`],
    [0.5, `6"`],
    [0.01, `1"`],
    [0, `0"`],
    [11.999, `12'-0"`], // rounds up across the foot
    [1 / 12, `1"`],
    [13 + 2 / 12, `13'-2"`],
  ];
  for (const [feet, text] of cases) {
    it(`${feet} ft is ${text}`, () => expect(formatLength(feet, 'feetInches')).toBe(text));
  }

  it('does not round a whole number of inches up on floating-point dust', () => {
    // 0.1 * 80 is 8.000000000000002 in binary; it is 8 ft, not 8'-1".
    expect(formatLength(0.1 * 80, 'feetInches')).toBe(`8'-0"`);
    expect(formatLength(0.6 * 22 * 2, 'feetInches')).toBe(`26'-5"`);
    expect(formatLength(0.1 + 0.2, 'feetInches')).toBe(`4"`); // 0.30000000000000004 ft = 3.6 in
  });

  it('never rounds down', () => {
    for (let i = 1; i < 500; i++) {
      const feet = i * 0.137;
      const m = formatLength(feet, 'feetInches').match(/^(?:(\d+)'-)?(\d+)"$/)!;
      const shown = Number(m[1] ?? 0) + Number(m[2]) / 12;
      expect(shown).toBeGreaterThanOrEqual(feet - 1e-7);
      expect(shown - feet).toBeLessThan(1 / 12);
    }
  });
});

describe('formatLength — decimal', () => {
  it('is two places and says its unit', () => {
    expect(formatLength(13.2, 'decimal')).toBe('13.20 ft');
    expect(formatLength(120, 'decimal')).toBe('120.00 ft');
  });
});
