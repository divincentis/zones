import { describe, expect, it } from 'vitest';
import { computeZones, explainFailure } from '../src/lib/buildModel';
import { buildPlanSheet } from '../src/lib/planSheet';
import { describeBranch } from '../src/lib/terms';
import { computeZoneTables, tablesToTsv } from '../src/lib/zoneDimensions';
import { BUILDINGS, formWith, zonesFor } from './fixtures';

describe('zone table totals', () => {
  it('a flat roof: roof total is the plan area, wall total is perimeter by height', () => {
    const [table] = computeZoneTables(zonesFor(), undefined, 'decimal');
    expect(table!.totals.roof).toBeCloseTo(120 * 80);
    expect(table!.totals.walls).toBeCloseTo(2 * (120 + 80) * 22);
  });

  it('totals equal the sum of the zones shown above them', () => {
    for (const [name, overrides] of Object.entries(BUILDINGS)) {
      for (const table of computeZoneTables(zonesFor(overrides), undefined, 'decimal')) {
        const zones = table.zones.reduce((sum, z) => sum + z.area, 0);
        expect(table.totals.roof + table.totals.walls, `${name} / ${table.title}`).toBeCloseTo(zones, 4);
      }
    }
  });

  it('a pitched roof is totalled on the slope', () => {
    const [table] = computeZoneTables(zonesFor(BUILDINGS.gable20!), undefined, 'decimal');
    expect(table!.totals.roof).toBeCloseTo((120 * 80) / Math.cos((20 * Math.PI) / 180));
  });

  it('a gable over 45° counts its slopes as roof, though they carry wall zones', () => {
    const [table] = computeZoneTables(zonesFor(BUILDINGS.gable60!), undefined, 'decimal');
    expect(table!.totals.roof).toBeCloseTo(120 * 80 * 2); // 1/cos(60°)
    expect(table!.zones.map((z) => z.zoneId)).toEqual(['4', '5']);
  });

  it('a stepped building is totalled per roof level', () => {
    const tables = computeZoneTables(zonesFor(BUILDINGS.steppedSeparate!), undefined, 'decimal');
    expect(tables.map((t) => t.totals.roof)).toEqual([expect.closeTo(120 * 80, 4), expect.closeTo(70 * 50, 4)]);
  });
});

describe('tablesToTsv', () => {
  const tsv = tablesToTsv(computeZoneTables(zonesFor(), undefined, 'feetInches'));
  const rows = tsv.trimEnd().split('\n').map((r) => r.split('\t'));

  it('has a heading row, a row per zone, a row per figure, and the totals', () => {
    expect(rows[0]).toEqual(['Zone areas', 'Area (sq ft)', 'Figure', 'Basis', 'Value']);
    expect(rows).toContainEqual(['Zone 2', '4195.8']);
    expect(rows).toContainEqual(['', '', 'Width', '0.6h', `13'-3"`]);
    expect(rows.slice(-2)).toEqual([
      ['Roof total', '9600.0'],
      ['Wall total', '8800.0'],
    ]);
  });

  it('never puts a tab or a line break inside a cell', () => {
    for (const row of rows) for (const cell of row) expect(cell).not.toMatch(/[\t\n]/);
  });

  it('separates a stepped building’s levels with a blank row', () => {
    const stepped = tablesToTsv(computeZoneTables(zonesFor(BUILDINGS.steppedSeparate!), undefined, 'decimal'));
    expect(stepped).toMatch(/\n\nUpper roof\t/);
  });
});

describe('lengths in the tables and on the plan', () => {
  it('feet and inches, rounded up, in the table figures', () => {
    const [table] = computeZoneTables(zonesFor(), undefined, 'feetInches');
    const zone3 = table!.zones.find((z) => z.zoneId === '3')!;
    expect(zone3.rows.map((r) => r.value)).toEqual([`4'-5"`, `13'-3"`]); // 4.4 ft and 13.2 ft
  });

  it('board rounding shows the board figure and the exact one, both in the chosen units', () => {
    const [table] = computeZoneTables(zonesFor({}, 4), 4, 'feetInches');
    expect(table!.zones.find((z) => z.zoneId === '2')!.rows[0]!.value).toBe(`16'-0" (min 13'-3")`);
  });

  it('feet and inches on the plan’s dimension strings, and a note saying how they were rounded', () => {
    const sheet = buildPlanSheet(zonesFor(), { mode: 'print', units: 'feetInches' });
    expect(sheet.chains.x[0]!.labels).toEqual([`4'-5"`, `8'-10"`, `13'-3"`, `67'-3"`, `13'-3"`, `8'-10"`, `4'-5"`]);
    const texts = sheet.prims.flatMap((p) => (p.kind === 'text' ? [p.text] : []));
    expect(texts).toContain(`120'-0"`);
    expect(texts.some((t) => t.includes('rounded up to the whole inch'))).toBe(true);
  });
});

describe('explainFailure — what the form is told when a building cannot be zoned', () => {
  const explain = (overrides: Parameters<typeof formWith>[0]) => {
    const outcome = computeZones(formWith(overrides));
    if (outcome.ok) throw new Error('expected a failure');
    return outcome.error;
  };

  it('a steep hip roof: says why, and what to do instead', () => {
    const text = explain({ roofType: 'hip', pitchDegrees: 20 });
    expect(text).toMatch(/Hip roofs steeper than 7°/);
    expect(text).toMatch(/Gable/);
  });

  it('a hip at 7° or less is not a failure at all', () => {
    expect(computeZones(formWith({ roofType: 'hip', pitchDegrees: 7 })).ok).toBe(true);
  });

  it('a monoslope past 30°', () => {
    expect(explain({ roofType: 'monoslope', pitchDegrees: 31 })).toMatch(/stop at 30°/);
  });

  it('a missing dimension is named', () => {
    expect(explain({ width: 0 })).toBe('Width has to be more than zero.');
    expect(explain({ stepEnabled: true, stepDepth: 0 })).toMatch(/^Section 2 depth/);
  });

  it('a section slid off the end of its wall', () => {
    expect(explain({ stepEnabled: true, stepOffset: 80 })).toMatch(/has to touch the wall/);
  });

  it('never leads with a function name', () => {
    for (const overrides of [{ roofType: 'hip', pitchDegrees: 20 }, { width: 0 }, { roofType: 'gable', pitchDegrees: 95 }] as const) {
      expect(explain(overrides)).not.toMatch(/^[a-z]+[A-Z]\w*:/);
    }
    expect(explainFailure(formWith(), new Error('computeSomething: the reason'))).toBe('the reason');
  });
});

describe('describeBranch', () => {
  it('puts each of the engine’s limits in words', () => {
    expect(describeBranch('0.1*Lmin')).toMatch(/10%/);
    expect(describeBranch('0.4*h')).toMatch(/40%/);
    expect(describeBranch('0.04*Lmin floor')).toMatch(/4%/);
    expect(describeBranch('3ft floor')).toMatch(/3 ft/);
  });
});
