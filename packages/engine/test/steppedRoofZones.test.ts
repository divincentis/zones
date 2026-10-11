import { describe, expect, it } from 'vitest';
import { computeLowSlopeRoofZones } from '../src/lowSlopeRoofZones.js';
import { computeTallRoofZones } from '../src/tallRoofZones.js';
import {
  computeSteppedRoofZones,
  STEP_SEPARATE_TREATMENT_THRESHOLD_FT,
} from '../src/steppedRoofZones.js';
import { sumArea, type ZonePiece } from '../src/zoneTypes.js';
import { flatRoofBuilding, flatRoofSection } from './fixtures.js';

// Fixtures for FM Global 1-28 Fig. 3.2.2b (roof elevation difference >= 10 ft
// -> two independently zoned roofs) and Fig. 3.2.2c (< 10 ft -> one roof over
// the union footprint). See the transcription note in steppedRoofZones.ts.
//
// All fixtures are flat roofs, so h = eave height (meanRoofHeight returns eave
// height below 10 degrees) and roof elevation = eave height too.

function totalArea(pieces: ZonePiece[]): number {
  return pieces.reduce((sum, p) => sum + p.area, 0);
}

/** Every zone id present, with its total area — the shape-independent summary a fixture can pin. */
function areasByZone(pieces: ZonePiece[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pieces) out[p.zoneId] = (out[p.zoneId] ?? 0) + p.area;
  return out;
}

/**
 * Two sections side by side along x, sharing the full length of one wall:
 *
 *      +--------+--------+
 *      | lower  | upper  |      lower: 100 x 80 at (0,0)
 *      +--------+--------+      upper:  60 x 80 at (100,0)
 */
function fullWidthStep(lowerEave: number, upperEave: number) {
  return [
    flatRoofSection({ id: 'lower', x: 0, y: 0, length: 100, width: 80, eaveHeight: lowerEave }),
    flatRoofSection({ id: 'upper', x: 100, y: 0, length: 60, width: 80, eaveHeight: upperEave }),
  ] as const;
}

/**
 * The offset arrangement the source figures actually draw — the shared wall
 * covers only part of the lower section's edge, leaving a genuine step corner:
 *
 *      +--------+
 *      | lower  |----+           lower: 100 x 80 at (0,0)
 *      |        | up |           upper:  60 x 50 at (100,0)
 *      +--------+----+
 */
function offsetStep(lowerEave: number, upperEave: number) {
  return [
    flatRoofSection({ id: 'lower', x: 0, y: 0, length: 100, width: 80, eaveHeight: lowerEave }),
    flatRoofSection({ id: 'upper', x: 100, y: 0, length: 60, width: 50, eaveHeight: upperEave }),
  ] as const;
}

describe('computeSteppedRoofZones — treatment selection (Table 3.2.2a note, p.21)', () => {
  it('uses separate (Fig. 3.2.2b) treatment at exactly 10 ft — the note says "greater than or equal to"', () => {
    const result = computeSteppedRoofZones(fullWidthStep(20, 30), 'boundingRect');
    expect(result.heightDifference).toBeCloseTo(STEP_SEPARATE_TREATMENT_THRESHOLD_FT);
    expect(result.treatment).toBe('separate');
    expect(result.regions.map((r) => r.role)).toEqual(['lower', 'upper']);
  });

  it('uses combined (Fig. 3.2.2c) treatment just below 10 ft', () => {
    const result = computeSteppedRoofZones(fullWidthStep(20, 29.9), 'boundingRect');
    expect(result.treatment).toBe('combined');
    expect(result.regions.map((r) => r.role)).toEqual(['combined']);
    expect(result.hBasis).toBe('tallerSection');
  });

  it('identifies lower/upper from elevation regardless of argument order', () => {
    const [lower, upper] = fullWidthStep(20, 40);
    const forward = computeSteppedRoofZones([lower, upper], 'boundingRect');
    const reversed = computeSteppedRoofZones([upper, lower], 'boundingRect');
    expect(forward.lower.id).toBe('lower');
    expect(reversed.lower.id).toBe('lower');
    expect(forward.upper.elevation).toBeCloseTo(40);
    expect(reversed.upper.elevation).toBeCloseTo(40);
    expect(areasByZone(reversed.pieces)).toEqual(
      Object.fromEntries(
        Object.entries(areasByZone(forward.pieces)).map(([k, v]) => [k, expect.closeTo(v, 6)])
      )
    );
  });
});

describe('computeSteppedRoofZones — area conservation', () => {
  const cases = [
    { name: 'separate, full-width abutment', sections: fullWidthStep(20, 40) },
    { name: 'combined, full-width abutment', sections: fullWidthStep(20, 25) },
    { name: 'separate, offset abutment', sections: offsetStep(20, 40) },
    { name: 'combined, offset abutment', sections: offsetStep(20, 25) },
  ];

  for (const { name, sections } of cases) {
    it(`${name}: zone pieces tile the whole footprint exactly`, () => {
      const result = computeSteppedRoofZones(sections, 'boundingRect');
      const expected =
        (sections[0].vertices[1]![0] - sections[0].vertices[0]![0]) *
          (sections[0].vertices[3]![1] - sections[0].vertices[0]![1]) +
        (sections[1].vertices[1]![0] - sections[1].vertices[0]![0]) *
          (sections[1].vertices[3]![1] - sections[1].vertices[0]![1]);
      expect(totalArea(result.pieces)).toBeCloseTo(expected, 6);
    });

    it(`${name}: every piece carries the elevation of the section it sits on`, () => {
      const result = computeSteppedRoofZones(sections, 'boundingRect');
      const elevations = new Set(result.pieces.map((p) => p.elevation));
      expect([...elevations].sort((a, b) => a! - b!)).toEqual([
        result.lower.elevation,
        result.upper.elevation,
      ]);
    });
  }
});

describe('computeSteppedRoofZones — reduces to Fig. 3.2.2a for a free-standing rectangle', () => {
  // The strongest guard on the classifier: with a >= 10 ft step the upper
  // section is zoned as a stand-alone roof with every edge free, which is
  // exactly what computeLowSlopeRoofZones computes from Fig. 3.2.2a. If the
  // Chebyshev-distance / free-corner formulation is right, the two must agree
  // zone for zone, not just in total.
  const upperOnly = flatRoofBuilding({ length: 60, width: 80, eaveHeight: 40 });
  const reference = computeLowSlopeRoofZones(upperOnly, 'boundingRect');

  const stepped = computeSteppedRoofZones(fullWidthStep(20, 40), 'boundingRect');
  const upperPieces = stepped.pieces.filter((p) => p.elevation === 40);

  it('matches Fig. 3.2.2a areas for every zone', () => {
    for (const zoneId of ['1', "1'", '2', '3']) {
      expect(sumArea(upperPieces, zoneId)).toBeCloseTo(sumArea(reference.pieces, zoneId), 6);
    }
  });

  it('matches Fig. 3.2.2a band dimensions', () => {
    const upperRegion = stepped.regions.find((r) => r.role === 'upper')!;
    expect(upperRegion.h).toBeCloseTo(reference.h);
    expect(upperRegion.dEdge).toBeCloseTo(reference.dEdge);
    expect(upperRegion.dInterior).toBeCloseTo(reference.dInterior);
    expect(upperRegion.legWidth).toBeCloseTo(reference.legWidth);
    expect(upperRegion.hasZone1Prime).toBe(reference.hasZone1Prime);
  });

  it('holds across a range of proportions and heights', () => {
    const shapes = [
      { length: 40, width: 40, eave: 30 }, // square, Zone 1' absent (Lmin 40 < 2.4h = 72)
      { length: 200, width: 150, eave: 25 }, // wide, Zone 1' present
      { length: 20, width: 18, eave: 45 }, // bands collide past the centerline
    ];
    for (const shape of shapes) {
      const ref = computeLowSlopeRoofZones(
        flatRoofBuilding({ length: shape.length, width: shape.width, eaveHeight: shape.eave }),
        'boundingRect'
      );
      const step = computeSteppedRoofZones(
        [
          flatRoofSection({ id: 'lower', x: -100, y: 0, length: 100, width: shape.width, eaveHeight: 1 }),
          flatRoofSection({ id: 'upper', x: 0, y: 0, length: shape.length, width: shape.width, eaveHeight: shape.eave }),
        ],
        'boundingRect'
      );
      expect(step.treatment).toBe('separate');
      const pieces = step.pieces.filter((p) => p.elevation === shape.eave);
      for (const zoneId of ['1', "1'", '2', '3']) {
        expect(
          sumArea(pieces, zoneId),
          `${shape.length}x${shape.width} h=${shape.eave} zone ${zoneId}`
        ).toBeCloseTo(sumArea(ref.pieces, zoneId), 6);
      }
    }
  });
});

describe('computeSteppedRoofZones — a tall section takes Fig. 3.2.2f’s dimensions', () => {
  // Podium and tower: a 100 x 80 podium at 20 ft with a 60 x 80 tower at
  // 120 ft against it. The tower is over Fig. 3.2.2a's height limit, so its
  // region is laid out with Fig. 3.2.2f's a-based dimensions; the podium is
  // not, and keeps 0.6h. With every edge free the tower must agree with
  // computeTallRoofZones zone for zone — the same guard as the block above.
  const stepped = computeSteppedRoofZones(fullWidthStep(20, 120), 'boundingRect');
  const reference = computeTallRoofZones(
    flatRoofBuilding({ length: 60, width: 80, eaveHeight: 120 }),
    'boundingRect'
  );
  const upperRegion = stepped.regions.find((r) => r.role === 'upper')!;
  const lowerRegion = stepped.regions.find((r) => r.role === 'lower')!;

  it('each region reports the regime its own height puts it in', () => {
    expect(upperRegion.regime.regime).toBe('tall');
    expect(lowerRegion.regime.regime).toBe('lowRise');
  });

  it('the tower matches Fig. 3.2.2f areas for every zone', () => {
    const upperPieces = stepped.pieces.filter((p) => p.elevation === 120);
    for (const zoneId of ['1', "1'", '2', '3']) {
      expect(sumArea(upperPieces, zoneId), `zone ${zoneId}`).toBeCloseTo(sumArea(reference.pieces, zoneId), 6);
    }
  });

  it('the tower matches Fig. 3.2.2f dimensions: band a, legs 2a by a, no Zone 1\'', () => {
    expect(upperRegion.dEdge).toBeCloseTo(reference.a);
    expect(upperRegion.legLength).toBeCloseTo(reference.cornerLeg);
    expect(upperRegion.legWidth).toBeCloseTo(reference.a);
    expect(upperRegion.hasZone1Prime).toBe(false);
  });

  it('the podium keeps Fig. 3.2.2a: band and leg length both 0.6h', () => {
    expect(lowerRegion.dEdge).toBeCloseTo(12);
    expect(lowerRegion.legLength).toBeCloseTo(12);
    expect(lowerRegion.legWidth).toBeCloseTo(4);
  });

  it('holds across proportions, including a slender tower on the 3 ft floor', () => {
    const shapes = [
      { length: 40, width: 40, eave: 95 },
      { length: 200, width: 150, eave: 100 },
      { length: 20, width: 18, eave: 70 }, // 60-90 ft, tall because h/w > 1
      { length: 10, width: 10, eave: 100 }, // legs collide past the centerline
    ];
    for (const shape of shapes) {
      const ref = computeTallRoofZones(
        flatRoofBuilding({ length: shape.length, width: shape.width, eaveHeight: shape.eave }),
        'boundingRect'
      );
      const step = computeSteppedRoofZones(
        [
          flatRoofSection({ id: 'lower', x: -100, y: 0, length: 100, width: shape.width, eaveHeight: 1 }),
          flatRoofSection({ id: 'upper', x: 0, y: 0, length: shape.length, width: shape.width, eaveHeight: shape.eave }),
        ],
        'boundingRect'
      );
      const pieces = step.pieces.filter((p) => p.elevation === shape.eave);
      for (const zoneId of ['1', "1'", '2', '3']) {
        expect(
          sumArea(pieces, zoneId),
          `${shape.length}x${shape.width} h=${shape.eave} zone ${zoneId}`
        ).toBeCloseTo(sumArea(ref.pieces, zoneId), 6);
      }
    }
  });

  it('two tall sections within 10 ft are one tall roof: conserved area, no Zone 1\'', () => {
    const combined = computeSteppedRoofZones(offsetStep(95, 100), 'boundingRect');
    expect(combined.treatment).toBe('combined');
    expect(combined.regions[0]!.regime.regime).toBe('tall');
    expect(totalArea(combined.pieces)).toBeCloseTo(100 * 80 + 60 * 50);
    expect(combined.pieces.some((p) => p.zoneId === "1'")).toBe(false);
    // Union is 160 x 80: a = 8, and the band is that deep on a free edge.
    expect(combined.regions[0]!.dEdge).toBeCloseTo(8);
    expect(zoneAt(combined.pieces, 50, 4)).toBe('2');
    expect(zoneAt(combined.pieces, 50, 12)).toBe('1');
  });
});

describe('computeSteppedRoofZones — Fig. 3.2.2b, the lower roof’s sheltered edge', () => {
  // lower 100 x 80 at (0,0), h = 20 -> 0.6h = 12, 0.2h = 4, 1.2h = 24.
  // upper 60 x 50 at (100,0), h = 40. Shared wall: x = 100, y in [0, 50].
  const result = computeSteppedRoofZones(offsetStep(20, 40), 'boundingRect');
  const lowerPieces = result.pieces.filter((p) => p.elevation === 20);

  it('is the separate treatment with the expected band dimensions', () => {
    expect(result.treatment).toBe('separate');
    const lower = result.regions.find((r) => r.role === 'lower')!;
    expect(lower.dEdge).toBeCloseTo(12);
    expect(lower.legWidth).toBeCloseTo(4);
    // Lmin = 80 > 2.4h = 48, so Zone 1' develops on the lower roof.
    expect(lower.hasZone1Prime).toBe(true);
  });

  it('runs Zone 1 right up to the shared wall, away from the step corner', () => {
    // A point deep along the sheltered stretch and clear of the free edges:
    // (99, 30) is 1 ft from the party line but >= 12 ft from every free edge.
    expect(zoneAt(lowerPieces, 99, 30)).toBe('1');
  });

  it('still bands the free stretch of that same wall', () => {
    // Above the upper section (y > 50) the same wall line is exposed, so the
    // 0.6h band is present there. Sampled at y = 60, clear of the Zone 3 leg
    // that runs 0.2h = 4 ft in from the free corner at (100, 80).
    expect(zoneAt(lowerPieces, 99, 60)).toBe('2');
  });

  it('caps the band 0.6h past the taller section’s corner, then stops', () => {
    // The taller section's exposed corner is at (100, 50). The band wraps it
    // for 0.6h = 12 ft down the party line (to y = 38) and no further — the
    // detail measured off the source figure's vector coordinates.
    expect(zoneAt(lowerPieces, 99, 44)).toBe('2');
    expect(zoneAt(lowerPieces, 99, 36)).toBe('1');
  });

  it('gives Zone 3 at the free corner but not at the corner buried against the taller wall', () => {
    // (100, 80) is a free convex corner -> L-shaped Zone 3 within 4 ft of it.
    expect(zoneAt(lowerPieces, 98, 79)).toBe('3');
    // (100, 0) is the corner where the wall is sheltered on one side -> no Zone 3.
    expect(zoneAt(lowerPieces, 98, 1)).toBe('2');
  });

  it('gives the taller roof the full standard treatment on its abutting edge', () => {
    const upperPieces = result.pieces.filter((p) => p.elevation === 40);
    // h = 40 -> 0.6h = 24, 0.2h = 8. Both corners on the shared wall (x = 100)
    // are Zone 3, and the shared edge carries the usual band.
    expect(zoneAt(upperPieces, 101, 1)).toBe('3');
    expect(zoneAt(upperPieces, 101, 49)).toBe('3');
    expect(zoneAt(upperPieces, 101, 25)).toBe('2');
  });
});

describe('computeSteppedRoofZones — Fig. 3.2.2c, one roof over the union', () => {
  // Both sections within 10 ft: lower h = 20, upper h = 25 -> combined h = 25
  // (taller section), 0.6h = 15, 0.2h = 5, 1.2h = 30.
  const result = computeSteppedRoofZones(offsetStep(20, 25), 'boundingRect');

  it('uses the taller section’s h for the whole roof', () => {
    const region = result.regions[0]!;
    expect(result.treatment).toBe('combined');
    expect(region.h).toBeCloseTo(25);
    expect(region.dEdge).toBeCloseTo(15);
  });

  it('puts no band along the shared wall — Zone 1 crosses it', () => {
    // (95, 25) and (105, 25) straddle the party line at x = 100, both well
    // clear of every outer edge.
    expect(zoneAt(result.pieces, 95, 25)).toBe('1');
    expect(zoneAt(result.pieces, 105, 25)).toBe('1');
  });

  it('bands the outer perimeter of the union footprint', () => {
    expect(zoneAt(result.pieces, 159, 25)).toBe('2'); // upper section's far edge
    expect(zoneAt(result.pieces, 1, 40)).toBe('2'); // lower section's far edge
  });

  it('gives no Zone 3 at the re-entrant corner (§2.5.1.B: interior angle >= 135°)', () => {
    // The union's re-entrant corner is at (100, 50). Points just inside it on
    // the lower section are within the band but must not be Zone 3.
    expect(zoneAt(result.pieces, 98, 48)).toBe('2');
    expect(result.outline).toHaveLength(6);
  });

  it('still gives Zone 3 at the union’s convex corners', () => {
    expect(zoneAt(result.pieces, 1, 79)).toBe('3');
    expect(zoneAt(result.pieces, 159, 1)).toBe('3');
  });
});

describe('computeSteppedRoofZones — parapet corner credit', () => {
  const withParapets = (h: number) =>
    [
      flatRoofSection({ id: 'lower', x: 0, y: 0, length: 100, width: 80, eaveHeight: 20, parapetHeight: h }),
      flatRoofSection({ id: 'upper', x: 100, y: 0, length: 60, width: 50, eaveHeight: 40, parapetHeight: h }),
    ] as const;

  it('credits Zone 3 to Zone 2 when both sections carry a >= 3 ft parapet', () => {
    const result = computeSteppedRoofZones(withParapets(3), 'boundingRect');
    expect(result.parapetCreditsCorners).toBe(true);
    expect(sumArea(result.pieces, '3')).toBe(0);
  });

  it('does not credit when a section’s parapet is under 3 ft', () => {
    const result = computeSteppedRoofZones(withParapets(2.9), 'boundingRect');
    expect(result.parapetCreditsCorners).toBe(false);
    expect(sumArea(result.pieces, '3')).toBeGreaterThan(0);
  });

  it('does not credit when only one section has a qualifying parapet', () => {
    const result = computeSteppedRoofZones(
      [
        flatRoofSection({ id: 'lower', x: 0, y: 0, length: 100, width: 80, eaveHeight: 20, parapetHeight: 6 }),
        flatRoofSection({ id: 'upper', x: 100, y: 0, length: 60, width: 50, eaveHeight: 40 }),
      ],
      'boundingRect'
    );
    expect(result.parapetCreditsCorners).toBe(false);
  });
});

describe('computeSteppedRoofZones — abutment validation', () => {
  it('rejects horizontally separated sections, per the note’s own wording', () => {
    expect(() =>
      computeSteppedRoofZones(
        [
          flatRoofSection({ id: 'lower', x: 0, y: 0, length: 100, width: 80, eaveHeight: 20 }),
          flatRoofSection({ id: 'upper', x: 101, y: 0, length: 60, width: 50, eaveHeight: 40 }),
        ],
        'boundingRect'
      )
    ).toThrow(/do not abut/);
  });

  it('rejects sections that touch only at a corner point', () => {
    expect(() =>
      computeSteppedRoofZones(
        [
          flatRoofSection({ id: 'lower', x: 0, y: 0, length: 100, width: 80, eaveHeight: 20 }),
          flatRoofSection({ id: 'upper', x: 100, y: 80, length: 60, width: 50, eaveHeight: 40 }),
        ],
        'boundingRect'
      )
    ).toThrow(/do not abut/);
  });

  it('rejects sections that overlap in plan', () => {
    expect(() =>
      computeSteppedRoofZones(
        [
          flatRoofSection({ id: 'lower', x: 0, y: 0, length: 100, width: 80, eaveHeight: 20 }),
          flatRoofSection({ id: 'upper', x: 90, y: 0, length: 60, width: 50, eaveHeight: 40 }),
        ],
        'boundingRect'
      )
    ).toThrow(/overlap in plan/);
  });

  it('reports the shared wall it found', () => {
    const result = computeSteppedRoofZones(offsetStep(20, 40), 'boundingRect');
    expect(result.abutment.length).toBeCloseTo(50);
    expect(result.abutment.from).toEqual([100, 0]);
    expect(result.abutment.to).toEqual([100, 50]);
  });
});

describe('computeSteppedRoofZones — unsourced configurations throw rather than guess', () => {
  it('rejects a pitched section (Fig. 3.2.2b/c are "adjoining low-sloped roofs")', () => {
    const [lower, upper] = fullWidthStep(20, 40);
    const gabled = { ...upper, roofType: 'gable' as const };
    expect(() => computeSteppedRoofZones([lower, gabled], 'boundingRect')).toThrow(/low-sloped/i);
  });

  it('rejects a low-slope section above 7 degrees', () => {
    const [lower, upper] = fullWidthStep(20, 40);
    const steep = { ...upper, roof: { ...upper.roof, pitchDegrees: 8 } };
    expect(() => computeSteppedRoofZones([lower, steep], 'boundingRect')).toThrow(/7°/);
  });

  it('rejects overhangs, which no stepped figure shows', () => {
    const [lower, upper] = fullWidthStep(20, 40);
    const overhung = { ...upper, roof: { ...upper.roof, overhangDepth: 2 } };
    expect(() => computeSteppedRoofZones([lower, overhung], 'boundingRect')).toThrow(/overhang/);
  });
});

/**
 * The zone id covering a plan point. Pieces tile the footprint without gaps
 * or overlap (asserted above), so exactly one piece contains any interior
 * point.
 */
function zoneAt(pieces: ZonePiece[], x: number, y: number): string | undefined {
  const hit = pieces.find((p) => {
    const xsOf = p.vertices.map((v) => v[0]);
    const ysOf = p.vertices.map((v) => v[1]);
    return (
      x > Math.min(...xsOf) && x < Math.max(...xsOf) && y > Math.min(...ysOf) && y < Math.max(...ysOf)
    );
  });
  return hit?.zoneId;
}
