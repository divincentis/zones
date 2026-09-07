import type { ABasis, FootprintNode, Vec2 } from './types.js';
import {
  leastHorizontalDimension,
  localRectToWorld,
  localToWorld,
  rectFrame,
  worldToLocal,
  type RectFrame,
} from './geometry.js';
import { meanRoofHeight } from './meanRoofHeight.js';
import type { ZonePiece } from './zoneTypes.js';

/**
 * Stepped (abutting / adjoining) buildings — two building sections whose
 * low-slope roofs meet at different elevations. Per FM Global Property Loss
 * Prevention Data Sheet 1-28, "Wind Design":
 *
 *   Table 3.2.2a NOTE (p.21): "Where the difference in roof elevations
 *   between abutting buildings or building sections is greater than or equal
 *   to 10 ft (3.0 m), treat abutting areas of the higher building as
 *   perimeter and corner areas in accordance with Figure 3.2.2b. If the
 *   difference in roof elevations between abutting buildings is less than 10
 *   ft (3.0 m), follow guidance in Figure 3.2.2c. The buildings have to be
 *   abutting for Figure 3.2.2c to apply, and they do not abut if there is
 *   any horizontal separation."
 *
 * See also §2.5.1.D (p.14): "Where roof elevation differences exist between
 * abutting roofs, see Figures 3.2.2b and 3.2.2c."
 *
 * Both figures are titled "Adjoining LOW-SLOPED roofs" and both carry the
 * note "For roof slopes <=7, Zone 3 is L-shaped" — so this module is scoped
 * to low-slope roofs and reuses Fig. 3.2.2a's dimensions verbatim (Zone 2
 * band 0.6h, L-shaped Zone 3 with 0.6h legs 0.2h thick, Zone 1 to 1.2h,
 * Zone 1' beyond that when the least horizontal dimension exceeds 2.4h).
 * No figure covers a stepped building with a pitched roof, so those throw.
 *
 * ---------------------------------------------------------------------------
 * TRANSCRIPTION — what the two figures actually draw
 * ---------------------------------------------------------------------------
 * Read off the source PDF's vector coordinates (pdftocairo -svg on pp.21-22
 * of FMDS0128.pdf) rather than eyeballed from the raster, the same method
 * used for the monoslope figures in scope §10.5. Both figures reduce to a
 * single rule, which is what this module implements:
 *
 *   Zone 2 = the points of a roof within 0.6h of that roof's FREE boundary
 *   Zone 3 = the L-shaped corner at each free CONVEX corner (both of the
 *            corner's adjoining wall segments must be free)
 *   Zone 1 / 1' = the field beyond, at 1.2h as usual
 *
 * where "free" means exposed to the wind, and distance is measured in the
 * max-of-axes (Chebyshev) metric — i.e. the band turns square corners, which
 * is how the figures draw it (an ordinary Euclidean buffer would round the
 * re-entrant corners of Fig. 3.2.2c, and the drawn boundary there is square).
 *
 * What differs between the two figures is only which boundary counts as free:
 *
 *  - Fig. 3.2.2c (difference < 10 ft): the two sections are ONE roof. The
 *    free boundary is the outer perimeter of the union footprint; nothing
 *    runs along the shared line. Confirmed from the figure: the drawn Zone 1
 *    field is a single connected region crossing the party line, and the two
 *    re-entrant corners of the union carry no Zone 3 — consistent with
 *    §2.5.1.A/B (p.14), which gives Zone 3 only where the interior angle
 *    between exterior walls is <135 degrees. A re-entrant corner is 270.
 *
 *  - Fig. 3.2.2b (difference >= 10 ft): the two sections are TWO roofs.
 *      * The HIGHER roof's whole rectangle is free, the abutting edge
 *        included — this is the note's operative sentence, "treat abutting
 *        areas of the higher building as perimeter and corner areas," and
 *        the figure draws a full band plus both L-corners on that edge.
 *      * The LOWER roof's abutting edge is sheltered by the taller wall: no
 *        band, and no Zone 3 at the corner buried against it. The figure
 *        draws Zone 1 running right up to the party line there.
 *    The one detail that looks like a special case is not one: on the lower
 *    roof the band continues 0.6h PAST the taller building's exposed corner
 *    before stopping (measured at 42.2 units against a 43.6-unit band in the
 *    source figure). That is just the Chebyshev band capping off at the end
 *    of the free boundary, and it falls out of the rule above rather than
 *    being coded as an exception.
 *
 * For a single rectangle with every edge free, this rule reduces exactly to
 * computeLowSlopeRoofZones (Fig. 3.2.2a) — asserted directly in the test
 * suite, which is the main guard on the classifier being right.
 *
 * ---------------------------------------------------------------------------
 * JUDGMENT CALLS — not settled by the source, surfaced rather than hidden
 * ---------------------------------------------------------------------------
 *  - `h` in the combined (<10 ft) case. The figure dimensions one "0.6h" for
 *    what it treats as one roof, but does not say whose h that is when the
 *    two levels differ. This uses the TALLER section's mean roof height,
 *    which is the conservative choice (wider bands, larger Zone 2/3). Look
 *    for `hBasis` on the result; the UI reports it.
 *  - `h` in the separate (>=10 ft) case is each section's own — they are two
 *    buildings at that point, so each gets its own mean roof height.
 *  - Zone 1' in the combined case needs a least horizontal dimension for a
 *    non-rectangular (union) footprint, which is scope §4.3's known
 *    ambiguity. It goes through the same `aBasis` the rest of the app uses,
 *    and the outline it was measured on is returned for reporting.
 */

export type SteppedRoofZoneId = '1' | "1'" | '2' | '3';

/** FM 1-28 Table 3.2.2a note (p.21): the roof-elevation difference that splits Fig. 3.2.2b from Fig. 3.2.2c. */
export const STEP_SEPARATE_TREATMENT_THRESHOLD_FT = 10;

/** Matches PARAPET_CORNER_CREDIT_THRESHOLD_FT in lowSlopeRoofZones.ts (Table 3.2.2a, note 2). */
const PARAPET_CORNER_CREDIT_THRESHOLD_FT = 3;

/** Scope §3.3: coincident edges are detected within 0.01 ft. */
const ABUT_TOLERANCE_FT = 0.01;

const EPS = 1e-9;

export type SteppedTreatment = 'separate' | 'combined';

export interface SteppedSectionSummary {
  id: string;
  /** Roof-plane elevation above grade, in feet. */
  elevation: number;
  h: number;
}

export interface SteppedRegionSummary {
  /** 'combined' covers both sections as one roof (Fig. 3.2.2c). */
  role: 'lower' | 'upper' | 'combined';
  h: number;
  dEdge: number; // 0.6h — Zone 2/3 band depth and Zone 3 leg length
  dInterior: number; // 1.2h — Zone 1 / 1' boundary
  legWidth: number; // 0.2h — Zone 3 leg thickness
  wideThreshold: number; // 2.4h
  lMin: number;
  hasZone1Prime: boolean;
}

export interface SteppedRoofZoneResult {
  /** Zone pieces across both sections; each carries the `elevation` of the roof plane it sits on. */
  pieces: ZonePiece[];
  treatment: SteppedTreatment;
  /** |upper roof elevation - lower roof elevation|, in feet. */
  heightDifference: number;
  threshold: number;
  lower: SteppedSectionSummary;
  upper: SteppedSectionSummary;
  regions: SteppedRegionSummary[];
  /** Which section's h drove the band widths in 'combined' treatment. Undefined for 'separate' (each region uses its own). */
  hBasis?: 'tallerSection';
  /** Outer boundary of the combined footprint, CCW, world coordinates. */
  outline: Vec2[];
  abutment: { from: Vec2; to: Vec2; length: number };
  parapetCreditsCorners: boolean;
  source: 'FM Global 1-28 Fig 3.2.2b/c';
}

// --- local axis-aligned geometry -------------------------------------------

interface LocalRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * An axis-aligned boundary segment in the shared local frame. `horizontal`
 * segments are y = c over x in [t0, t1]; vertical ones are x = c over
 * y in [t0, t1].
 */
interface Seg {
  horizontal: boolean;
  c: number;
  t0: number;
  t1: number;
}

/** Chebyshev (max-of-axes) distance from a point to an axis-aligned segment. */
function linfDistanceToSeg(seg: Seg, px: number, py: number): number {
  const along = seg.horizontal ? px : py;
  const across = seg.horizontal ? py : px;
  const overshoot = along < seg.t0 ? seg.t0 - along : along > seg.t1 ? along - seg.t1 : 0;
  return Math.max(overshoot, Math.abs(across - seg.c));
}

function dedupeSorted(values: number[], tol = 1e-7): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1]! > tol) out.push(v);
  }
  return out;
}

/**
 * Grid lines for one axis. Every zone boundary this algorithm can produce
 * sits at a base coordinate (a section edge, or an end of the sheltered
 * abutment) offset by one of the figure's dimensions, so putting all of those
 * in the grid makes every resulting cell homogeneous — one zone, exactly.
 */
function buildAxisCoords(base: number[], offsets: number[], lo: number, hi: number): number[] {
  const raw: number[] = [lo, hi];
  for (const b of base) {
    for (const o of offsets) {
      for (const v of [b - o, b + o]) {
        if (v > lo && v < hi) raw.push(v);
      }
    }
  }
  return dedupeSorted(raw);
}

// --- region zoning ----------------------------------------------------------

interface RegionRect {
  rect: LocalRect;
  elevation: number;
}

interface RegionInput {
  role: SteppedRegionSummary['role'];
  rects: RegionRect[];
  h: number;
  /** Boundary stretches sheltered by an abutting taller section — excluded from the free boundary. */
  sheltered: Seg[];
  /** Extra coordinates that must land on grid lines (the abutment's ends). */
  extraX: number[];
  extraY: number[];
  parapetCreditsCorners: boolean;
  aBasis: ABasis;
}

interface FreeCorner {
  x: number;
  y: number;
  /** Inward direction along each axis, +1 or -1. */
  sx: number;
  sy: number;
}

interface RegionOutput {
  pieces: ZonePiece[];
  summary: SteppedRegionSummary;
  /** CCW outer boundary in the shared local frame. */
  outline: Array<[number, number]>;
}

function computeRegionZones(frame: RectFrame, region: RegionInput): RegionOutput {
  const { rects, h } = region;
  const dEdge = 0.6 * h;
  const dInterior = 1.2 * h;
  const legWidth = 0.2 * h;
  const wideThreshold = 2.4 * h;

  const xLo = Math.min(...rects.map((r) => r.rect.x0));
  const xHi = Math.max(...rects.map((r) => r.rect.x1));
  const yLo = Math.min(...rects.map((r) => r.rect.y0));
  const yHi = Math.max(...rects.map((r) => r.rect.y1));

  const offsets = [0, legWidth, dEdge, dInterior];
  const xs = buildAxisCoords(
    [...rects.flatMap((r) => [r.rect.x0, r.rect.x1]), ...region.extraX],
    offsets,
    xLo,
    xHi
  );
  const ys = buildAxisCoords(
    [...rects.flatMap((r) => [r.rect.y0, r.rect.y1]), ...region.extraY],
    offsets,
    yLo,
    yHi
  );

  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const cellIndex = (i: number, j: number) => i * ny + j;

  // Which section rect owns each cell (-1 = outside the region).
  const owner = new Int32Array(nx * ny).fill(-1);
  for (let i = 0; i < nx; i++) {
    const cx = (xs[i]! + xs[i + 1]!) / 2;
    for (let j = 0; j < ny; j++) {
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      const k = rects.findIndex(
        (r) => cx > r.rect.x0 && cx < r.rect.x1 && cy > r.rect.y0 && cy < r.rect.y1
      );
      owner[cellIndex(i, j)] = k;
    }
  }
  const inside = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < ny && owner[cellIndex(i, j)]! >= 0;

  const isSheltered = (seg: Seg) => {
    const mid = (seg.t0 + seg.t1) / 2;
    return region.sheltered.some(
      (s) =>
        s.horizontal === seg.horizontal &&
        Math.abs(s.c - seg.c) < ABUT_TOLERANCE_FT &&
        mid > s.t0 - ABUT_TOLERANCE_FT &&
        mid < s.t1 + ABUT_TOLERANCE_FT
    );
  };

  // Boundary edges, walked CCW (region interior on the left) so they can be
  // chained into the outline; the free ones also drive the band distance.
  const freeSegs: Seg[] = [];
  const directed: Array<{ from: [number, number]; to: [number, number] }> = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!inside(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i]!, xs[i + 1]!, ys[j]!, ys[j + 1]!];
      const visit = (seg: Seg, from: [number, number], to: [number, number]) => {
        directed.push({ from, to });
        if (!isSheltered(seg)) freeSegs.push(seg);
      };
      if (!inside(i, j - 1)) visit({ horizontal: true, c: y0, t0: x0, t1: x1 }, [x0, y0], [x1, y0]);
      if (!inside(i + 1, j)) visit({ horizontal: false, c: x1, t0: y0, t1: y1 }, [x1, y0], [x1, y1]);
      if (!inside(i, j + 1)) visit({ horizontal: true, c: y1, t0: x0, t1: x1 }, [x1, y1], [x0, y1]);
      if (!inside(i - 1, j)) visit({ horizontal: false, c: x0, t0: y0, t1: y1 }, [x0, y1], [x0, y0]);
    }
  }

  // Free convex corners: grid vertices with exactly one in-region quadrant
  // (three would be a re-entrant corner, which gets no Zone 3 — §2.5.1.B),
  // where both wall segments meeting there are free.
  const corners: FreeCorner[] = [];
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const quadrants: Array<{ sx: number; sy: number; ci: number; cj: number }> = [
        { sx: 1, sy: 1, ci: i, cj: j },
        { sx: -1, sy: 1, ci: i - 1, cj: j },
        { sx: -1, sy: -1, ci: i - 1, cj: j - 1 },
        { sx: 1, sy: -1, ci: i, cj: j - 1 },
      ];
      const occupied = quadrants.filter((q) => inside(q.ci, q.cj));
      if (occupied.length !== 1) continue;
      const q = occupied[0]!;
      const xEdge: Seg = {
        horizontal: true,
        c: ys[j]!,
        t0: Math.min(xs[q.ci]!, xs[q.ci + 1]!),
        t1: Math.max(xs[q.ci]!, xs[q.ci + 1]!),
      };
      const yEdge: Seg = {
        horizontal: false,
        c: xs[i]!,
        t0: Math.min(ys[q.cj]!, ys[q.cj + 1]!),
        t1: Math.max(ys[q.cj]!, ys[q.cj + 1]!),
      };
      if (isSheltered(xEdge) || isSheltered(yEdge)) continue;
      corners.push({ x: xs[i]!, y: ys[j]!, sx: q.sx, sy: q.sy });
    }
  }

  const outlineLocal = traceOutline(directed);
  const lMin = leastHorizontalDimension(
    outlineLocal.map((p) => localToWorld(frame, p[0], p[1])),
    region.aBasis
  );
  const hasZone1Prime = lMin > wideThreshold;

  const inZone3 = (px: number, py: number) =>
    corners.some((c) => {
      const a = c.sx * (px - c.x);
      const b = c.sy * (py - c.y);
      if (a <= 0 || b <= 0 || a >= dEdge || b >= dEdge) return false;
      return a < legWidth || b < legWidth;
    });

  const labels: (SteppedRoofZoneId | null)[] = new Array(nx * ny).fill(null);
  for (let i = 0; i < nx; i++) {
    const cx = (xs[i]! + xs[i + 1]!) / 2;
    for (let j = 0; j < ny; j++) {
      if (!inside(i, j)) continue;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      let zone: SteppedRoofZoneId;
      if (inZone3(cx, cy)) {
        // Table 3.2.2a note 2: a >=3 ft perimeter parapet lets Zone 2 values
        // be used in Zone 3, which this project (geometry, not pressures)
        // implements by reclassifying the corner geometry itself.
        zone = region.parapetCreditsCorners ? '2' : '3';
      } else {
        let dist = Infinity;
        for (const seg of freeSegs) {
          const d = linfDistanceToSeg(seg, cx, cy);
          if (d < dist) dist = d;
        }
        zone = dist <= dEdge ? '2' : !hasZone1Prime || dist <= dInterior ? '1' : "1'";
      }
      labels[cellIndex(i, j)] = zone;
    }
  }

  const pieces = mergeCells(frame, xs, ys, labels, owner, rects, nx, ny);

  return {
    pieces,
    summary: { role: region.role, h, dEdge, dInterior, legWidth, wideThreshold, lMin, hasZone1Prime },
    outline: outlineLocal,
  };
}

/**
 * Greedy maximal-rectangle merge of like-labelled cells, so the output is a
 * handful of pieces rather than one quad per grid cell. Cells only merge when
 * both the zone and the owning section (hence roof elevation) match.
 */
function mergeCells(
  frame: RectFrame,
  xs: number[],
  ys: number[],
  labels: (SteppedRoofZoneId | null)[],
  owner: Int32Array,
  rects: RegionRect[],
  nx: number,
  ny: number
): ZonePiece[] {
  const cellIndex = (i: number, j: number) => i * ny + j;
  const used = new Uint8Array(nx * ny);
  const pieces: ZonePiece[] = [];

  const key = (i: number, j: number) => {
    const label = labels[cellIndex(i, j)];
    return label === null ? null : `${label}|${owner[cellIndex(i, j)]}`;
  };

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (used[cellIndex(i, j)] || key(i, j) === null) continue;
      const k = key(i, j);

      let iEnd = i + 1;
      while (iEnd < nx && !used[cellIndex(iEnd, j)] && key(iEnd, j) === k) iEnd++;

      let jEnd = j + 1;
      outer: while (jEnd < ny) {
        for (let ii = i; ii < iEnd; ii++) {
          if (used[cellIndex(ii, jEnd)] || key(ii, jEnd) !== k) break outer;
        }
        jEnd++;
      }

      for (let ii = i; ii < iEnd; ii++) {
        for (let jj = j; jj < jEnd; jj++) used[cellIndex(ii, jj)] = 1;
      }

      const [x0, x1, y0, y1] = [xs[i]!, xs[iEnd]!, ys[j]!, ys[jEnd]!];
      pieces.push({
        zoneId: labels[cellIndex(i, j)]!,
        vertices: localRectToWorld(frame, x0, x1, y0, y1),
        area: (x1 - x0) * (y1 - y0),
        elevation: rects[owner[cellIndex(i, j)]!]!.elevation,
      });
    }
  }

  return pieces;
}

/**
 * Outer boundary of a set of axis-aligned rects, CCW, in the local frame.
 * Same cell-walk as the zoning pass but on the bare rect edges — used for
 * reporting the combined footprint in the separate ('two roofs') treatment,
 * where no combined zoning pass runs.
 */
function traceRectsOutline(rects: RegionRect[]): Array<[number, number]> {
  const xs = dedupeSorted(rects.flatMap((r) => [r.rect.x0, r.rect.x1]));
  const ys = dedupeSorted(rects.flatMap((r) => [r.rect.y0, r.rect.y1]));
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const inside = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const cx = (xs[i]! + xs[i + 1]!) / 2;
    const cy = (ys[j]! + ys[j + 1]!) / 2;
    return rects.some((r) => cx > r.rect.x0 && cx < r.rect.x1 && cy > r.rect.y0 && cy < r.rect.y1);
  };

  const directed: Array<{ from: [number, number]; to: [number, number] }> = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!inside(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i]!, xs[i + 1]!, ys[j]!, ys[j + 1]!];
      if (!inside(i, j - 1)) directed.push({ from: [x0, y0], to: [x1, y0] });
      if (!inside(i + 1, j)) directed.push({ from: [x1, y0], to: [x1, y1] });
      if (!inside(i, j + 1)) directed.push({ from: [x1, y1], to: [x0, y1] });
      if (!inside(i - 1, j)) directed.push({ from: [x0, y1], to: [x0, y0] });
    }
  }
  return traceOutline(directed);
}

/** Chains CCW boundary edges into a single simplified loop (collinear runs collapsed). */
function traceOutline(
  directed: Array<{ from: [number, number]; to: [number, number] }>
): Array<[number, number]> {
  if (directed.length === 0) return [];
  const pointKey = (p: [number, number]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const next = new Map<string, [number, number]>();
  for (const e of directed) next.set(pointKey(e.from), e.to);

  const start = directed[0]!.from;
  const loop: Array<[number, number]> = [start];
  let cursor = next.get(pointKey(start));
  while (cursor && pointKey(cursor) !== pointKey(start) && loop.length <= directed.length) {
    loop.push(cursor);
    cursor = next.get(pointKey(cursor));
  }

  // Drop vertices that sit mid-edge (the grid splits every wall into many).
  const simplified: Array<[number, number]> = [];
  for (let i = 0; i < loop.length; i++) {
    const prev = loop[(i - 1 + loop.length) % loop.length]!;
    const cur = loop[i]!;
    const nxt = loop[(i + 1) % loop.length]!;
    const cross =
      (cur[0] - prev[0]) * (nxt[1] - cur[1]) - (cur[1] - prev[1]) * (nxt[0] - cur[0]);
    if (Math.abs(cross) > EPS) simplified.push(cur);
  }
  return simplified;
}

// --- section / abutment resolution ------------------------------------------

function toLocalRect(frame: RectFrame, node: FootprintNode): LocalRect {
  if (node.vertices.length !== 4) {
    throw new Error(
      `computeSteppedRoofZones: section "${node.id}" has ${node.vertices.length} vertices; ` +
        'stepped buildings are rectangular sections only (non-rectangular footprints are Phase 3).'
    );
  }
  const locals = node.vertices.map((p) => worldToLocal(frame, p));
  const x0 = Math.min(...locals.map((l) => l.u));
  const x1 = Math.max(...locals.map((l) => l.u));
  const y0 = Math.min(...locals.map((l) => l.v));
  const y1 = Math.max(...locals.map((l) => l.v));

  for (const l of locals) {
    const onX = Math.abs(l.u - x0) < ABUT_TOLERANCE_FT || Math.abs(l.u - x1) < ABUT_TOLERANCE_FT;
    const onY = Math.abs(l.v - y0) < ABUT_TOLERANCE_FT || Math.abs(l.v - y1) < ABUT_TOLERANCE_FT;
    if (!onX || !onY) {
      throw new Error(
        `computeSteppedRoofZones: section "${node.id}" is not aligned with the other section's ` +
          'axes. Stepped buildings require both sections to share a rectilinear frame.'
      );
    }
  }
  if (x1 - x0 < ABUT_TOLERANCE_FT || y1 - y0 < ABUT_TOLERANCE_FT) {
    throw new Error(`computeSteppedRoofZones: section "${node.id}" is degenerate (zero-width side).`);
  }
  return { x0, x1, y0, y1 };
}

interface Abutment {
  /** The shared wall line as a boundary segment, in the shared local frame. */
  seg: Seg;
}

/**
 * Finds the shared wall between two axis-aligned sections. Per the Table
 * 3.2.2a note, sections "do not abut if there is any horizontal separation",
 * so a gap is an error rather than something to compute past.
 */
function resolveAbutment(a: LocalRect, b: LocalRect): Abutment {
  const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);

  if (overlapX > ABUT_TOLERANCE_FT && overlapY > ABUT_TOLERANCE_FT) {
    throw new Error(
      'computeSteppedRoofZones: the two sections overlap in plan. Stepped sections must ' +
        'abut along a shared wall, not sit on top of one another.'
    );
  }

  const touchesVertically =
    Math.abs(a.x1 - b.x0) < ABUT_TOLERANCE_FT || Math.abs(b.x1 - a.x0) < ABUT_TOLERANCE_FT;
  if (touchesVertically && overlapY > ABUT_TOLERANCE_FT) {
    const c = Math.abs(a.x1 - b.x0) < ABUT_TOLERANCE_FT ? a.x1 : a.x0;
    return {
      seg: { horizontal: false, c, t0: Math.max(a.y0, b.y0), t1: Math.min(a.y1, b.y1) },
    };
  }

  const touchesHorizontally =
    Math.abs(a.y1 - b.y0) < ABUT_TOLERANCE_FT || Math.abs(b.y1 - a.y0) < ABUT_TOLERANCE_FT;
  if (touchesHorizontally && overlapX > ABUT_TOLERANCE_FT) {
    const c = Math.abs(a.y1 - b.y0) < ABUT_TOLERANCE_FT ? a.y1 : a.y0;
    return {
      seg: { horizontal: true, c, t0: Math.max(a.x0, b.x0), t1: Math.min(a.x1, b.x1) },
    };
  }

  throw new Error(
    'computeSteppedRoofZones: the two sections do not abut. FM 1-28 Table 3.2.2a note (p.21): ' +
      '"The buildings have to be abutting ... they do not abut if there is any horizontal ' +
      'separation." Sections touching only at a corner point do not abut either.'
  );
}

// --- entry point ------------------------------------------------------------

/**
 * Zones a two-section stepped building. Section order does not matter — the
 * lower and higher roofs are identified by their own elevations.
 */
export function computeSteppedRoofZones(
  sections: readonly [FootprintNode, FootprintNode],
  aBasis: ABasis
): SteppedRoofZoneResult {
  for (const node of sections) {
    if (node.roofType !== 'flat') {
      throw new Error(
        `computeSteppedRoofZones: section "${node.id}" has roofType "${node.roofType}". ` +
          'FM 1-28 Fig. 3.2.2b/c cover "adjoining LOW-SLOPED roofs" only — no reviewed figure ' +
          'covers a stepped building with a pitched roof, so its zones are not computed.'
      );
    }
    if (node.roof.pitchDegrees > 7) {
      throw new Error(
        `computeSteppedRoofZones: section "${node.id}" pitch ${node.roof.pitchDegrees}° exceeds ` +
          'the 7° low-slope threshold that Fig. 3.2.2b/c are drawn for.'
      );
    }
    if (node.roof.overhangDepth > 0) {
      throw new Error(
        `computeSteppedRoofZones: section "${node.id}" has an overhang. Fig. 3.2.2b/c dimension ` +
          'the abutment off the wall line and show no overhang case, so overhangs are not ' +
          'modeled for stepped buildings.'
      );
    }
  }

  const frame = rectFrame(sections[0].vertices);
  const rectA = toLocalRect(frame, sections[0]);
  const rectB = toLocalRect(frame, sections[1]);

  // Roof elevation for a low-slope roof is its eave height; meanRoofHeight
  // returns exactly that below 10°, so h and the elevation coincide here.
  const elevA = meanRoofHeight(sections[0]);
  const elevB = meanRoofHeight(sections[1]);
  const aIsLower = elevA <= elevB;

  const lowerNode = aIsLower ? sections[0] : sections[1];
  const upperNode = aIsLower ? sections[1] : sections[0];
  const lowerRect = aIsLower ? rectA : rectB;
  const upperRect = aIsLower ? rectB : rectA;
  const lowerElev = aIsLower ? elevA : elevB;
  const upperElev = aIsLower ? elevB : elevA;

  const abutment = resolveAbutment(lowerRect, upperRect);
  const heightDifference = upperElev - lowerElev;
  const treatment: SteppedTreatment =
    heightDifference >= STEP_SEPARATE_TREATMENT_THRESHOLD_FT ? 'separate' : 'combined';

  // A single scalar parapet per section and no way to model a partial one, so
  // the credit only applies when BOTH sections carry a qualifying parapet —
  // otherwise "around the entire perimeter" is not satisfied for the roof as
  // a whole. Same reasoning as lowSlopeRoofZones.ts, extended to two sections.
  const parapetCreditsCorners = sections.every(
    (n) => n.roof.parapetHeight >= PARAPET_CORNER_CREDIT_THRESHOLD_FT
  );

  const lowerRegionRect: RegionRect = { rect: lowerRect, elevation: lowerElev };
  const upperRegionRect: RegionRect = { rect: upperRect, elevation: upperElev };
  const abutEnds = abutment.seg.horizontal
    ? { extraX: [abutment.seg.t0, abutment.seg.t1], extraY: [abutment.seg.c] }
    : { extraX: [abutment.seg.c], extraY: [abutment.seg.t0, abutment.seg.t1] };

  let outputs: RegionOutput[];
  let hBasis: SteppedRoofZoneResult['hBasis'];

  if (treatment === 'separate') {
    // Fig. 3.2.2b — two roofs. The higher one's abutting edge is free ("treat
    // abutting areas of the higher building as perimeter and corner areas");
    // the lower one's is sheltered by the taller wall.
    outputs = [
      computeRegionZones(frame, {
        role: 'lower',
        rects: [lowerRegionRect],
        h: meanRoofHeight(lowerNode),
        sheltered: [abutment.seg],
        ...abutEnds,
        parapetCreditsCorners,
        aBasis,
      }),
      computeRegionZones(frame, {
        role: 'upper',
        rects: [upperRegionRect],
        h: meanRoofHeight(upperNode),
        sheltered: [],
        ...abutEnds,
        parapetCreditsCorners,
        aBasis,
      }),
    ];
  } else {
    // Fig. 3.2.2c — one roof over the union footprint. The shared wall is not
    // on the union's boundary at all, so nothing needs sheltering.
    outputs = [
      computeRegionZones(frame, {
        role: 'combined',
        rects: [lowerRegionRect, upperRegionRect],
        h: meanRoofHeight(upperNode),
        sheltered: [],
        ...abutEnds,
        parapetCreditsCorners,
        aBasis,
      }),
    ];
    hBasis = 'tallerSection';
  }

  // The union outline is the same shape either way; in 'separate' treatment
  // the per-region outlines are the two rectangles, so trace it once over both
  // for reporting.
  const outlineSource =
    treatment === 'combined'
      ? outputs[0]!.outline
      : traceRectsOutline([lowerRegionRect, upperRegionRect]);

  const abutFrom: Vec2 = abutment.seg.horizontal
    ? localToWorld(frame, abutment.seg.t0, abutment.seg.c)
    : localToWorld(frame, abutment.seg.c, abutment.seg.t0);
  const abutTo: Vec2 = abutment.seg.horizontal
    ? localToWorld(frame, abutment.seg.t1, abutment.seg.c)
    : localToWorld(frame, abutment.seg.c, abutment.seg.t1);

  return {
    pieces: outputs.flatMap((o) => o.pieces),
    treatment,
    heightDifference,
    threshold: STEP_SEPARATE_TREATMENT_THRESHOLD_FT,
    lower: { id: lowerNode.id, elevation: lowerElev, h: meanRoofHeight(lowerNode) },
    upper: { id: upperNode.id, elevation: upperElev, h: meanRoofHeight(upperNode) },
    regions: outputs.map((o) => o.summary),
    hBasis,
    outline: outlineSource.map((p) => localToWorld(frame, p[0], p[1])),
    abutment: { from: abutFrom, to: abutTo, length: abutment.seg.t1 - abutment.seg.t0 },
    parapetCreditsCorners,
    source: 'FM Global 1-28 Fig 3.2.2b/c',
  };
}
