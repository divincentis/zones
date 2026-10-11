import { describe, expect, it } from 'vitest';
import {
  assignLanes,
  buildPlanSheet,
  chainBreaks,
  formatFeet,
  planGrid,
  zoneBoundaries,
  zoneRegions,
  type BoundarySegment,
  type PlanPrim,
} from '../src/lib/planSheet';
import { pdfSafe } from '../src/lib/pdfText';
import { computeZoneTables } from '../src/lib/zoneDimensions';
import { BUILDINGS, zonesFor } from './fixtures';

// The default building is 120 x 80 ft at h = 22 ft, flat: Fig. 3.2.2a gives
// a 0.2h = 4.4 ft corner leg, a 0.6h = 13.2 ft band and a 1.2h = 26.4 ft
// Zone 1 boundary.

const close = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));
};

/** True if the segment passes through the plan point (which must not be one of its ends). */
const passesThrough = (s: BoundarySegment, x: number, y: number) =>
  Math.abs(s.x1 - s.x2) < 1e-9
    ? Math.abs(s.x1 - x) < 1e-6 && y > Math.min(s.y1, s.y2) && y < Math.max(s.y1, s.y2)
    : Math.abs(s.y1 - y) < 1e-6 && x > Math.min(s.x1, s.x2) && x < Math.max(s.x1, s.x2);

describe('plan geometry — the default flat roof', () => {
  const result = zonesFor();
  const grid = planGrid(result.roof.pieces);
  const boundaries = zoneBoundaries(grid);

  it('breaks the dimension strings at every zone line, and nowhere else', () => {
    const breaks = chainBreaks(boundaries);
    close(breaks.x, [0, 4.4, 13.2, 26.4, 93.6, 106.8, 115.6, 120]);
    close(breaks.y, [0, 4.4, 13.2, 26.4, 53.6, 66.8, 75.6, 80]);
  });

  it('draws the roof edge as four whole lines, not one per piece along it', () => {
    const outline = boundaries.filter((s) => s.kind === 'outline');
    expect(outline).toHaveLength(4);
    close(outline.map((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)).sort((a, b) => a - b), [80, 80, 120, 120]);
  });

  it('draws no line along a seam between two pieces of the same zone', () => {
    // At x = 13.2 the corner's Zone 2 remainder meets the Zone 2 edge strip
    // over y = 4.4..13.2: two engine pieces, one zone, no line.
    expect(boundaries.some((s) => passesThrough(s, 13.2, 8.8))).toBe(false);
    // Just below, the same x separates the Zone 3 leg from that strip.
    expect(boundaries.some((s) => passesThrough(s, 13.2, 2.2))).toBe(true);
    // And just above, Zone 2 from Zone 1.
    expect(boundaries.some((s) => passesThrough(s, 13.2, 20))).toBe(true);
  });

  it('finds each zone as the regions a person would count', () => {
    const regions = zoneRegions(grid);
    const count = (zoneId: string) => regions.filter((r) => r.zoneId === zoneId).length;
    expect(count('3')).toBe(4); // four corners
    expect(count('2')).toBe(1); // one ring, though the engine cut it into twelve pieces
    expect(count('1')).toBe(1);
    expect(count("1'")).toBe(1);
    const inner = regions.find((r) => r.zoneId === "1'")!;
    close([inner.box.x0, inner.box.x1, inner.box.y0, inner.box.y1], [26.4, 93.6, 26.4, 53.6]);
    expect(inner.area).toBeCloseTo(67.2 * 27.2);
  });

  it('region areas add up to the roof', () => {
    expect(zoneRegions(grid).reduce((sum, r) => sum + r.area, 0)).toBeCloseTo(120 * 80);
  });
});

describe('plan sheet — print', () => {
  const sheet = buildPlanSheet(zonesFor(), { mode: 'print', tables: computeZoneTables(zonesFor()) });

  it('is a landscape letter page at a standard scale', () => {
    expect([sheet.width, sheet.height]).toEqual([792, 612]);
    // The 120 ft length is 432 pt at 1 in = 20 ft, which just fits between
    // the dimension strings and the zone tables; 1 in = 10 ft would not.
    expect(sheet.feetPerInch).toBe(20);
    expect(sheet.pointsPerFoot).toBeCloseTo(3.6);
  });

  it('draws to that scale: the 13.2 ft band is 13.2 ft wide on the sheet', () => {
    const [x0, y0] = sheet.toSheet(0, 0);
    const [x1, y1] = sheet.toSheet(13.2, 13.2);
    expect((x1 - x0) / sheet.pointsPerFoot).toBeCloseTo(13.2);
    // Plan y runs up the sheet.
    expect((y0 - y1) / sheet.pointsPerFoot).toBeCloseTo(13.2);
  });

  it('labels every interval of both dimension strings, and they add up', () => {
    expect(sheet.chains.x[0]!.labels).toEqual(['4.4', '8.8', '13.2', '67.2', '13.2', '8.8', '4.4']);
    expect(sheet.chains.y[0]!.labels).toEqual(['4.4', '8.8', '13.2', '27.2', '13.2', '8.8', '4.4']);
    expect(sheet.chains.x[0]!.labels.reduce((sum, v) => sum + Number(v), 0)).toBeCloseTo(120);
  });

  it('carries the overall dimensions as well', () => {
    const texts = sheet.prims.filter((p): p is Extract<PlanPrim, { kind: 'text' }> => p.kind === 'text');
    expect(texts.some((t) => t.text === '120' && t.bold && !t.vertical)).toBe(true);
    expect(texts.some((t) => t.text === '80' && t.bold && t.vertical)).toBe(true);
  });

  it('numbers each zone region that has room for it', () => {
    const numbers = sheet.prims.filter(
      (p): p is Extract<PlanPrim, { kind: 'text' }> => p.kind === 'text' && p.role === 'onZone' && !!p.bold
    );
    expect(numbers.map((t) => t.text).sort()).toEqual(['1', "1'", '2', '3', '3', '3', '3']);
  });

  it('marks the wall zones with one bar per wall piece', () => {
    const bars = sheet.prims.filter((p) => p.kind === 'zone' && p.hover?.source === 'wall');
    expect(bars).toHaveLength(zonesFor().walls.pieces.length);
  });
});

describe('plan sheet — every kind of building', () => {
  for (const [name, overrides] of Object.entries(BUILDINGS)) {
    for (const mode of ['print', 'screen'] as const) {
      it(`${name} (${mode}): everything lands on the page`, () => {
        const sheet = buildPlanSheet(zonesFor(overrides), { mode, title: 'Test', subtitle: 'Sub', notice: 'Notice' });
        for (const prim of sheet.prims) {
          const points: Array<[number, number]> =
            prim.kind === 'line'
              ? [
                  [prim.x1, prim.y1],
                  [prim.x2, prim.y2],
                ]
              : prim.kind === 'text'
                ? [[prim.x, prim.y]]
                : prim.points;
          for (const [x, y] of points) {
            expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(sheet.width);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(sheet.height);
          }
        }
      });
    }

    it(`${name}: no text needs a glyph the PDF font lacks`, () => {
      const sheet = buildPlanSheet(zonesFor(overrides), { mode: 'print' });
      for (const prim of sheet.prims) {
        if (prim.kind === 'text') expect(pdfSafe(prim.text)).toMatch(/^[\x20-\x7E -ÿ—]*$/);
      }
    });
  }
});

describe('plan sheet — what each roof type adds', () => {
  const lines = (overrides: Parameters<typeof zonesFor>[0]) =>
    buildPlanSheet(zonesFor(overrides), { mode: 'print' }).prims.filter(
      (p): p is Extract<PlanPrim, { kind: 'line' }> => p.kind === 'line'
    );
  const arrowheads = (overrides: Parameters<typeof zonesFor>[0]) =>
    buildPlanSheet(zonesFor(overrides), { mode: 'print' }).prims.filter((p) => p.kind === 'poly');

  it('a flat roof has no ridge, no arrows, no dashed wall line', () => {
    expect(lines({}).some((l) => l.dash)).toBe(false);
    expect(arrowheads({})).toHaveLength(0);
  });

  it('a gable has a ridge line and an arrow down each slope', () => {
    expect(lines(BUILDINGS.gable20!).filter((l) => l.dash)).toHaveLength(1);
    expect(arrowheads(BUILDINGS.gable20!)).toHaveLength(2);
  });

  it('a monoslope has one arrow, pointing away from the high side', () => {
    // High side is the wall at x = 0, so the arrow runs left to right.
    const sheet = buildPlanSheet(zonesFor(BUILDINGS.monoslope20!), { mode: 'print' });
    const heads = sheet.prims.filter((p): p is Extract<PlanPrim, { kind: 'poly' }> => p.kind === 'poly');
    expect(heads).toHaveLength(1);
    const [tip, ...base] = heads[0]!.points;
    expect(base.every((p) => p[0] < tip![0])).toBe(true);
  });

  it('an overhang shows the wall face as a dashed line inside the roof edge', () => {
    expect(lines(BUILDINGS.flatWithOverhangAndParapet!).filter((l) => l.dash)).toHaveLength(4);
  });

  it('a gable under 7 degrees is drawn as the flat roof it is zoned as', () => {
    expect(lines({ roofType: 'gable', pitchDegrees: 5 }).some((l) => l.dash)).toBe(false);
  });

  it('a stepped building draws the step, as long as the shared wall', () => {
    const result = zonesFor(BUILDINGS.steppedSeparate!);
    const steps = zoneBoundaries(planGrid(result.roof.pieces)).filter((s) => s.kind === 'step');
    expect(steps.reduce((sum, s) => sum + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0)).toBeCloseTo(50);
  });

  it('a stepped building dimensions each roof level on its own string', () => {
    // Lower 120 x 80 at 22 ft (0.6h = 13.2); upper 70 x 50 at 40 ft against
    // its right-hand wall (0.6h = 24, 0.2h = 8).
    const sheet = buildPlanSheet(zonesFor(BUILDINGS.steppedSeparate!), { mode: 'print' });
    expect(sheet.chains.y).toHaveLength(2);
    const [lower, upper] = sheet.chains.y;
    expect(lower!.elevation).toBe(22);
    expect(upper!.elevation).toBe(40);
    // The upper section is on the right, so its string up the side goes there.
    expect([lower!.far, upper!.far]).toEqual([false, true]);
    // Each string spans its own roof and no more.
    expect(lower!.breaks[lower!.breaks.length - 1]! - lower!.breaks[0]!).toBeCloseTo(80);
    expect(upper!.breaks[upper!.breaks.length - 1]! - upper!.breaks[0]!).toBeCloseTo(50);
    expect(upper!.breaks).toContain(8);
    expect(lower!.breaks).not.toContain(8);
  });

  it('puts the upper level\'s string on the left when that is the side it is on', () => {
    const sheet = buildPlanSheet(zonesFor({ stepEnabled: true, stepEdge: 'widthNear' }), { mode: 'print' });
    const [lower, upper] = sheet.chains.y;
    expect([lower!.far, upper!.far]).toEqual([true, false]);
  });

  it('a gable\'s ridge band is numbered beside the ridge, not on it', () => {
    const result = zonesFor(BUILDINGS.gable60!);
    const sheet = buildPlanSheet(result, { mode: 'print' });
    const ridgeY = sheet.toSheet(0, 40)[1];
    const numbers = sheet.prims.filter(
      (p): p is Extract<PlanPrim, { kind: 'text' }> => p.kind === 'text' && p.role === 'onZone' && !!p.bold
    );
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) expect(Math.abs(n.y - ridgeY)).toBeGreaterThan(n.size * 0.5);
  });

  it('a gable over 45 degrees gets one wall bar per stretch of wall, not one per piece', () => {
    // The rake band sits above another piece on the gable end; it is wall
    // area but not a stretch of wall, and the plan shows stretches.
    const result = zonesFor(BUILDINGS.gable60!);
    const sheet = buildPlanSheet(result, { mode: 'print' });
    const bars = sheet.prims.filter((p) => p.kind === 'zone' && p.hover?.source === 'wall');
    expect(bars).toHaveLength(result.walls.pieces.filter((p) => p.heightMin === 0).length);
    expect(bars.length).toBeLessThan(result.walls.pieces.length);
  });
});

describe('plan sheet — screen', () => {
  it('lays the plan out for the space it is given, tall or wide', () => {
    const tall = buildPlanSheet(zonesFor(), { mode: 'screen', page: { width: 320, height: 600 } });
    const wide = buildPlanSheet(zonesFor(), { mode: 'screen', page: { width: 900, height: 400 } });
    expect([tall.width, tall.height]).toEqual([320, 600]);
    expect(tall.feetPerInch).toBeUndefined();
    // Not held to a standard scale, so more room is a bigger plan.
    expect(wide.pointsPerFoot).toBeGreaterThan(tall.pointsPerFoot);
  });

  it('has no title block or tables — the app\'s panels carry those', () => {
    const sheet = buildPlanSheet(zonesFor(), { mode: 'screen', title: 'Ignored', tables: [] });
    expect(sheet.prims.some((p) => p.kind === 'text' && p.text === 'Ignored')).toBe(false);
  });
});

describe('dimension labels', () => {
  it('formats feet without padding', () => {
    expect(formatFeet(120)).toBe('120');
    expect(formatFeet(13.2)).toBe('13.2');
    expect(formatFeet(4.404)).toBe('4.4');
    expect(formatFeet(66.666)).toBe('66.67');
  });

  it('keeps a label that fits inside its interval', () => {
    expect(assignLanes([{ from: 0, to: 40, width: 20 }], 2)).toEqual([0]);
  });

  it('staggers neighbours that are each too wide for their own interval', () => {
    const intervals = [
      { from: 0, to: 8, width: 14 },
      { from: 8, to: 16, width: 14 },
      { from: 16, to: 24, width: 14 },
    ];
    // The first and third are clear of each other in one outer lane; the
    // second, which would overlap both, takes the next.
    expect(assignLanes(intervals, 2)).toEqual([1, 2, 1]);
  });

  it('gives up on a label rather than print it over another', () => {
    const intervals = Array.from({ length: 4 }, (_, i) => ({ from: i * 2, to: i * 2 + 2, width: 30 }));
    expect(assignLanes(intervals, 2)).toEqual([1, 2, null, null]);
  });

  it('gives a zone one label size, whichever way each of its regions lies', () => {
    const sheet = buildPlanSheet(zonesFor(), { mode: 'print', tables: computeZoneTables(zonesFor()) });
    const corners = sheet.prims.filter(
      (p): p is Extract<PlanPrim, { kind: 'text' }> => p.kind === 'text' && p.role === 'onZone' && p.text === '3'
    );
    expect(new Set(corners.map((t) => t.size)).size).toBe(1);
  });

  it('on a roof too big for its corner legs to be read, still places what it can', () => {
    const sheet = buildPlanSheet(zonesFor(BUILDINGS.huge!), { mode: 'print' });
    expect(sheet.feetPerInch).toBeGreaterThanOrEqual(100);
    expect(sheet.chains.x[0]!.labels.filter((l) => l !== null).length).toBeGreaterThanOrEqual(5);
  });
});
