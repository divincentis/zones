import {
  resolveMonoslopeGeometry,
  resolveRidgeGeometry,
  type FootprintNode,
  type Vec2,
  type WallZoneResult,
  type ZonePiece,
} from '@zones/engine';
import { isMonoslopeRoofResult, isSteepRoofResult, type ComputationResult } from './buildModel';
import type { AnyZoneId } from './zoneColors';
import { ZONE_LABELS } from './zoneColors';
import type { ZoneTable } from './zoneDimensions';

/**
 * The roof plan as a drawing: the zones in plan, dimensioned, with the walls'
 * zones marked along the perimeter.
 *
 * This module produces a PLAN SHEET — a flat list of primitives in points on
 * a page, y down — and knows nothing about SVG or PDF. PlanView2D draws the
 * primitives on screen and planSheetPdf.ts writes the same ones into the
 * export, so the two cannot disagree, and a test can assert that a 13.2 ft
 * band came out 13.2 ft wide without parsing either output. Anything else
 * that ever needs to draw the plan should consume a sheet the same way
 * rather than walking the zone pieces itself.
 *
 * Like the rest of the web layer (steppedSections.ts, Scene3D's call-outs),
 * it assumes what BuildingForm guarantees: every footprint is a rectangle
 * square to the world axes.
 */

// --- plan geometry, in feet -------------------------------------------------

export interface PlanRectFt {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface CellLabel {
  zoneId: AnyZoneId;
  /** Roof-plane elevation — only set on a stepped building, where it tells the two roofs apart. */
  elevation?: number;
}

export interface PlanGrid {
  xs: number[];
  ys: number[];
  /** cells[i][j] covers xs[i]..xs[i+1] by ys[j]..ys[j+1]; null is outside the roof. */
  cells: (CellLabel | null)[][];
}

const TOL = 1e-6;

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1]! > TOL);
}

function boundsOf(vertices: readonly Vec2[]): PlanRectFt {
  const xs = vertices.map((v) => v[0]);
  const ys = vertices.map((v) => v[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * The roof as a grid of cells, each wholly inside one zone piece. The engine
 * hands back pieces — however its algorithm happened to cut a zone up — and a
 * drawing wants zones, so everything below works on this grid, where two
 * pieces of the same zone are indistinguishable.
 */
export function planGrid(pieces: ZonePiece[]): PlanGrid {
  const rects = pieces.map((p) => boundsOf(p.vertices));
  const xs = uniqueSorted(rects.flatMap((r) => [r.x0, r.x1]));
  const ys = uniqueSorted(rects.flatMap((r) => [r.y0, r.y1]));
  const cells: (CellLabel | null)[][] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const column: (CellLabel | null)[] = [];
    const cx = (xs[i]! + xs[i + 1]!) / 2;
    for (let j = 0; j + 1 < ys.length; j++) {
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      const k = rects.findIndex((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1);
      const piece = k < 0 ? undefined : pieces[k];
      column.push(piece ? { zoneId: piece.zoneId as AnyZoneId, elevation: piece.elevation } : null);
    }
    cells.push(column);
  }
  return { xs, ys, cells };
}

/** What a line on the plan separates: the roof from open air, one roof level from another, or two zones. */
export type BoundaryKind = 'outline' | 'step' | 'zone';

export interface BoundarySegment {
  kind: BoundaryKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function boundaryKind(a: CellLabel | null, b: CellLabel | null): BoundaryKind | null {
  if (!a && !b) return null;
  if (!a || !b) return 'outline';
  if (a.elevation !== b.elevation) return 'step';
  return a.zoneId === b.zoneId ? null : 'zone';
}

/**
 * Every line the plan needs, each as long as it can be: grid edges whose two
 * sides differ, with collinear runs of one kind joined. A seam between two
 * pieces of the same zone is not a line and does not appear.
 */
export function zoneBoundaries(grid: PlanGrid): BoundarySegment[] {
  const { xs, ys, cells } = grid;
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? null : cells[i]![j]!);
  const out: BoundarySegment[] = [];

  const sweep = (
    lines: number,
    steps: number,
    kindAt: (line: number, step: number) => BoundaryKind | null,
    emit: (kind: BoundaryKind, line: number, from: number, to: number) => void
  ) => {
    for (let line = 0; line <= lines; line++) {
      let run: { kind: BoundaryKind; from: number } | null = null;
      for (let step = 0; step <= steps; step++) {
        const kind = step < steps ? kindAt(line, step) : null;
        if (run && run.kind !== kind) {
          emit(run.kind, line, run.from, step);
          run = null;
        }
        if (kind && !run) run = { kind, from: step };
      }
    }
  };

  sweep(
    nx,
    ny,
    (i, j) => boundaryKind(at(i - 1, j), at(i, j)),
    (kind, i, from, to) => out.push({ kind, x1: xs[i]!, y1: ys[from]!, x2: xs[i]!, y2: ys[to]! })
  );
  sweep(
    ny,
    nx,
    (j, i) => boundaryKind(at(i, j - 1), at(i, j)),
    (kind, j, from, to) => out.push({ kind, x1: xs[from]!, y1: ys[j]!, x2: xs[to]!, y2: ys[j]! })
  );
  return out;
}

export interface ZoneRegion {
  zoneId: AnyZoneId;
  elevation?: number;
  /** Plan area of the whole connected region, ft². */
  area: number;
  /** The roomiest rectangle inside it — where a label can go. */
  box: PlanRectFt;
}

/**
 * Connected regions of one zone on one roof level. A ring (Zone 2 round the
 * perimeter) is one region; four corners are four.
 */
export function zoneRegions(grid: PlanGrid): ZoneRegion[] {
  const { xs, ys, cells } = grid;
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const same = (a: CellLabel | null, b: CellLabel | null) =>
    !!a && !!b && a.zoneId === b.zoneId && a.elevation === b.elevation;
  const seen = Array.from({ length: nx }, () => new Array<boolean>(ny).fill(false));
  const regions: ZoneRegion[] = [];

  for (let i0 = 0; i0 < nx; i0++) {
    for (let j0 = 0; j0 < ny; j0++) {
      const label = cells[i0]![j0]!;
      if (!label || seen[i0]![j0]) continue;

      const member = Array.from({ length: nx }, () => new Array<boolean>(ny).fill(false));
      const stack: Array<[number, number]> = [[i0, j0]];
      const own: Array<[number, number]> = [];
      seen[i0]![j0] = true;
      while (stack.length) {
        const [i, j] = stack.pop()!;
        member[i]![j] = true;
        own.push([i, j]);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || seen[ni]![nj]) continue;
          if (!same(label, cells[ni]![nj]!)) continue;
          seen[ni]![nj] = true;
          stack.push([ni, nj]);
        }
      }

      // The roomiest rectangle: grow one from every cell, across then down
      // and down then across, and keep the one with the largest short side.
      const best: { box: PlanRectFt | null; score: number } = { box: null, score: -1 };
      const consider = (i: number, j: number, iEnd: number, jEnd: number) => {
        const box = { x0: xs[i]!, x1: xs[iEnd]!, y0: ys[j]!, y1: ys[jEnd]! };
        const w = box.x1 - box.x0;
        const h = box.y1 - box.y0;
        const score = Math.min(w, h) * 1e6 + w * h;
        if (score > best.score) {
          best.score = score;
          best.box = box;
        }
      };
      for (const [i, j] of own) {
        let iEnd = i + 1;
        while (iEnd < nx && member[iEnd]![j]) iEnd++;
        let jEnd = j + 1;
        while (jEnd < ny && member.slice(i, iEnd).every((col) => col[jEnd])) jEnd++;
        consider(i, j, iEnd, jEnd);

        jEnd = j + 1;
        while (jEnd < ny && member[i]![jEnd]) jEnd++;
        iEnd = i + 1;
        while (iEnd < nx && member[iEnd]!.slice(j, jEnd).every(Boolean)) iEnd++;
        consider(i, j, iEnd, jEnd);
      }

      regions.push({
        zoneId: label.zoneId,
        elevation: label.elevation,
        area: own.reduce((sum, [i, j]) => sum + (xs[i + 1]! - xs[i]!) * (ys[j + 1]! - ys[j]!), 0),
        box: best.box!,
      });
    }
  }
  return regions;
}

/**
 * Where the dimension strings break: every x at which some boundary runs up
 * the plan, and every y at which one runs across. The first and last are the
 * roof's own edges, so each string spans the whole roof.
 */
export function chainBreaks(segments: BoundarySegment[]): { x: number[]; y: number[] } {
  return {
    x: uniqueSorted(segments.filter((s) => Math.abs(s.x1 - s.x2) < TOL).map((s) => s.x1)),
    y: uniqueSorted(segments.filter((s) => Math.abs(s.y1 - s.y2) < TOL).map((s) => s.y1)),
  };
}

// --- the sheet, in points ----------------------------------------------------

/** What a mark is for; each writer decides what colour that is. */
export type PlanRole = 'ink' | 'muted' | 'dim' | 'notice' | 'onZone';

export type PlanPrim =
  | {
      kind: 'zone';
      points: Array<[number, number]>;
      zoneId: AnyZoneId;
      /** Set on the marks a pointer can ask about: the roof zones and the wall bars. */
      hover?: { source: 'roof' | 'wall'; section: number };
    }
  | { kind: 'poly'; points: Array<[number, number]>; role: PlanRole }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; weight: number; role: PlanRole; dash?: number[] }
  | {
      kind: 'text';
      /** The point the text is centred on vertically, and anchored to horizontally. */
      x: number;
      y: number;
      text: string;
      size: number;
      anchor: 'start' | 'middle' | 'end';
      role: PlanRole;
      bold?: boolean;
      /** Reads bottom to top, as a dimension up the side of a drawing does. */
      vertical?: boolean;
    };

export interface PlanSheet {
  width: number;
  height: number;
  /** Points per foot of plan. */
  pointsPerFoot: number;
  /** Set when the plan is at a standard scale: 1 inch on the sheet is this many feet. */
  feetPerInch?: number;
  /** Sheet position of plan point (x, y), for tests and for anything overlaying the plan. */
  toSheet: (x: number, y: number) => [number, number];
  /**
   * The zone dimension strings as drawn, along each axis. One per axis, on
   * the bottom and the left — except on a stepped building, where each roof
   * level gets its own and the upper one's goes on the opposite side.
   */
  chains: { x: PlanChain[]; y: PlanChain[] };
  prims: PlanPrim[];
}

export interface PlanChain {
  /** Break positions, in plan feet, ascending. */
  breaks: number[];
  /** The label on each interval — null where there was no room for one. */
  labels: (string | null)[];
  /** The top or right of the plan rather than the bottom or left. */
  far: boolean;
  /** The roof level this string belongs to, on a stepped building. */
  elevation?: number;
}

export interface PlanSheetOptions {
  /**
   * 'print' is a letter sheet, landscape, at a standard engineering scale,
   * with a title block and the zone tables beside the plan. 'screen' is the
   * plan alone, as large as it will go — the app's own panels already carry
   * everything else.
   */
  mode: 'print' | 'screen';
  /**
   * Screen only: the size of the space the plan has, in sheet points. The
   * caller picks how many screen pixels a point is, which is what keeps the
   * lettering a readable size whatever shape the window is.
   */
  page?: { width: number; height: number };
  title?: string;
  subtitle?: string;
  notice?: string;
  tables?: ZoneTable[];
  /** Lines of small print under the tables. */
  notes?: string[];
  footer?: string;
}

/** Feet per inch, the scales an engineer's rule carries, plus enough either side to fit anything. */
const STANDARD_SCALES = [1, 2, 4, 5, 8, 10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000];

const DIM_SIZE = 6.5;

/**
 * Helvetica's advance widths, near enough. Only used to decide whether a
 * label fits and where a line of text wraps, so it errs wide.
 */
export function estimateTextWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') em += 0.56;
    else if (ch === ' ' || ch === '.' || ch === ',' || ch === "'" || ch === ':' || ch === ';') em += 0.28;
    else if (ch === 'i' || ch === 'l' || ch === 'j' || ch === 't' || ch === 'f' || ch === 'r') em += 0.3;
    else if (ch === 'm' || ch === 'w' || ch === 'M' || ch === 'W') em += 0.85;
    else if (ch >= 'A' && ch <= 'Z') em += 0.68;
    else em += 0.56;
  }
  return em * size;
}

function wrapText(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && estimateTextWidth(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A length in feet as a dimension string writes it: two decimals at most, no trailing zeros. */
export function formatFeet(feet: number): string {
  return String(Math.round(feet * 100) / 100);
}

/**
 * Puts a label on each interval of a dimension string. One that fits sits in
 * lane 0, inside its interval. One that doesn't — a 4 ft corner leg on a
 * 300 ft roof — drops to an outer lane, staggered so that neighbours which
 * are each too wide for their own interval still don't land on each other.
 * Returns null for a label there is no room for at all.
 */
export function assignLanes(
  intervals: Array<{ from: number; to: number; width: number }>,
  outerLanes: number
): (number | null)[] {
  const lastEnd = new Array<number>(outerLanes).fill(-Infinity);
  return intervals.map(({ from, to, width }) => {
    if (width + 2 <= to - from) return 0;
    const center = (from + to) / 2;
    for (let lane = 0; lane < outerLanes; lane++) {
      if (center - width / 2 >= lastEnd[lane]! + 1.5) {
        lastEnd[lane] = center + width / 2;
        return lane + 1;
      }
    }
    return null;
  });
}

/** A round number of feet for the scale bar: the largest 1, 2 or 5 times a power of ten that fits. */
function niceLength(maxFeet: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(maxFeet)));
  const lead = maxFeet / power;
  return (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * power;
}

export function buildPlanSheet(result: ComputationResult, options: PlanSheetOptions): PlanSheet {
  const print = options.mode === 'print';
  const width = print ? 792 : Math.max(300, options.page?.width ?? 640);
  const height = print ? 612 : Math.max(240, options.page?.height ?? 500);
  const margin = print ? 36 : 10;
  const titleHeight = print ? 62 : 0;
  const legendWidth = print && options.tables?.length ? 190 : 0;
  const legendGap = legendWidth ? 14 : 0;
  const footerHeight = print ? 34 : 22;
  // Room outside the plan: a bar for the wall zones all round, and on the
  // bottom and left two dimension strings beyond it.
  const BAR_ROOM = 14;
  const DIM_ROOM = 62;

  const { roof, building, walls, step } = result;
  const prims: PlanPrim[] = [];
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    weight: number,
    role: PlanRole,
    dash?: number[]
  ) => prims.push({ kind: 'line', x1, y1, x2, y2, weight, role, dash });
  const text = (
    x: number,
    y: number,
    value: string,
    size: number,
    anchor: 'start' | 'middle' | 'end',
    role: PlanRole,
    extra: { bold?: boolean; vertical?: boolean } = {}
  ) => prims.push({ kind: 'text', x, y, text: value, size, anchor, role, ...extra });

  // --- scale and placement ---
  const sections: Array<{ node: FootprintNode; walls: WallZoneResult }> = step
    ? [
        { node: building, walls },
        { node: step.upper, walls: step.upperWalls },
      ]
    : [{ node: building, walls }];
  const extent = boundsOf([
    ...roof.pieces.flatMap((p) => p.vertices),
    ...sections.flatMap((s) => s.node.vertices),
  ]);
  const spanX = extent.x1 - extent.x0;
  const spanY = extent.y1 - extent.y0;
  // A stepped building carries a second dimension string on the top and
  // right (see the strings below), which needs more than the bars do.
  const farRoom = step ? 48 : BAR_ROOM;
  const availW = width - 2 * margin - legendWidth - legendGap - DIM_ROOM - farRoom;
  const availH = height - 2 * margin - titleHeight - footerHeight - DIM_ROOM - farRoom;
  const fit = Math.min(availW / spanX, availH / spanY);
  const feetPerInch = print
    ? (STANDARD_SCALES.find((s) => 72 / s <= fit) ?? STANDARD_SCALES[STANDARD_SCALES.length - 1]!)
    : undefined;
  const k = feetPerInch ? 72 / feetPerInch : fit;
  const left = margin + DIM_ROOM + (availW - spanX * k) / 2;
  const top = margin + titleHeight + farRoom + (availH - spanY * k) / 2;
  const sx = (x: number) => left + (x - extent.x0) * k;
  const sy = (y: number) => top + (extent.y1 - y) * k;
  const right = sx(extent.x1);
  const bottom = sy(extent.y0);

  // --- the roof zones ---
  const sectionOf = (piece: ZonePiece) =>
    step && piece.elevation !== undefined && Math.abs(piece.elevation - step.upper.eaveHeight) < TOL ? 1 : 0;
  for (const piece of roof.pieces) {
    const r = boundsOf(piece.vertices);
    prims.push({
      kind: 'zone',
      zoneId: piece.zoneId as AnyZoneId,
      points: [
        [sx(r.x0), sy(r.y0)],
        [sx(r.x1), sy(r.y0)],
        [sx(r.x1), sy(r.y1)],
        [sx(r.x0), sy(r.y1)],
      ],
      hover: { source: 'roof', section: sectionOf(piece) },
    });
  }

  const grid = planGrid(roof.pieces);
  const boundaries = zoneBoundaries(grid);
  const weightOf: Record<BoundaryKind, number> = { zone: 0.5, outline: 1.2, step: 1.8 };
  // Lightest first, so the roof edge and a step are never broken by a zone line meeting them.
  for (const kind of ['zone', 'outline', 'step'] as const) {
    for (const s of boundaries.filter((b) => b.kind === kind)) {
      line(sx(s.x1), sy(s.y1), sx(s.x2), sy(s.y2), weightOf[kind], 'ink');
    }
  }

  // --- wall line under an overhang, ridge, slope arrows ---
  for (const { node } of sections) {
    if (node.roof.overhangDepth <= 0) continue;
    const n = node.vertices.length;
    for (let i = 0; i < n; i++) {
      const a = node.vertices[i]!;
      const b = node.vertices[(i + 1) % n]!;
      line(sx(a[0]), sy(a[1]), sx(b[0]), sy(b[1]), 0.5, 'onZone', [3, 2]);
    }
  }

  const arrow = (from: Vec2, to: Vec2, label: string) => {
    const [x1, y1, x2, y2] = [sx(from[0]), sy(from[1]), sx(to[0]), sy(to[1])];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 14) return;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    line(x1, y1, x2 - ux * 5, y2 - uy * 5, 0.7, 'onZone');
    prims.push({
      kind: 'poly',
      role: 'onZone',
      points: [
        [x2, y2],
        [x2 - ux * 6 - uy * 2.2, y2 - uy * 6 + ux * 2.2],
        [x2 - ux * 6 + uy * 2.2, y2 - uy * 6 - ux * 2.2],
      ],
    });
    // Beside the shaft, not on it: to its right for an arrow running up or
    // down the sheet, above it for one running across.
    const vertical = Math.abs(uy) > Math.abs(ux);
    text(
      (x1 + x2) / 2 + (vertical ? 4 : 0),
      (y1 + y2) / 2 - (vertical ? 0 : 5),
      label,
      DIM_SIZE,
      vertical ? 'start' : 'middle',
      'onZone'
    );
  };
  const pitchLabel = `${formatFeet(building.roof.pitchDegrees)}° down`;

  if (isSteepRoofResult(roof) && building.roof.ridgeLine) {
    const [r0, r1] = building.roof.ridgeLine;
    line(sx(r0[0]), sy(r0[1]), sx(r1[0]), sy(r1[1]), 0.7, 'onZone', [9, 2, 1.5, 2]);
    const { perpExtent } = resolveRidgeGeometry(building);
    const len = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
    const d: Vec2 = [(r1[0] - r0[0]) / len, (r1[1] - r0[1]) / len];
    const p: Vec2 = [-d[1], d[0]];
    const at: Vec2 = [r0[0] + d[0] * len * 0.3, r0[1] + d[1] * len * 0.3];
    for (const side of [1, -1]) {
      const off = (f: number): Vec2 => [
        at[0] + p[0] * side * (perpExtent / 2) * f,
        at[1] + p[1] * side * (perpExtent / 2) * f,
      ];
      arrow(off(0.3), off(0.72), pitchLabel);
    }
  }
  if (isMonoslopeRoofResult(roof) && building.roof.highEdge) {
    const [h0, h1] = building.roof.highEdge;
    const { span } = resolveMonoslopeGeometry(building);
    const len = Math.hypot(h1[0] - h0[0], h1[1] - h0[1]);
    const d: Vec2 = [(h1[0] - h0[0]) / len, (h1[1] - h0[1]) / len];
    const centre: Vec2 = [(extent.x0 + extent.x1) / 2, (extent.y0 + extent.y1) / 2];
    const towards = (centre[0] - h0[0]) * -d[1] + (centre[1] - h0[1]) * d[0] >= 0 ? 1 : -1;
    const p: Vec2 = [-d[1] * towards, d[0] * towards];
    const at: Vec2 = [h0[0] + d[0] * len * 0.3, h0[1] + d[1] * len * 0.3];
    const off = (f: number): Vec2 => [at[0] + p[0] * span * f, at[1] + p[1] * span * f];
    arrow(off(0.3), off(0.7), pitchLabel);
  }

  // --- the wall zones, as bars outside the roof edge ---
  sections.forEach(({ node, walls: sectionWalls }, section) => {
    const n = node.vertices.length;
    for (const piece of sectionWalls.pieces) {
      // One bar per stretch of wall: the zone at its base. A rake band above
      // a steep gable end sits over another piece and has no stretch of its
      // own; the wall above a step does, because nothing is under it.
      if (piece.heightMin > TOL && !step) continue;
      const a = node.vertices[piece.edgeIndex]!;
      const b = node.vertices[(piece.edgeIndex + 1) % n]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      // Outward for a counter-clockwise footprint, in sheet terms (y down).
      const out: [number, number] = [d[1], d[0]];
      const gap = node.roof.overhangDepth * k + 3;
      const corner = (along: number, off: number): [number, number] => [
        sx(a[0] + d[0] * along) + out[0] * off,
        sy(a[1] + d[1] * along) + out[1] * off,
      ];
      prims.push({
        kind: 'zone',
        zoneId: piece.zoneId,
        points: [
          corner(piece.alongMin, gap),
          corner(piece.alongMax, gap),
          corner(piece.alongMax, gap + 5),
          corner(piece.alongMin, gap + 5),
        ],
        hover: { source: 'wall', section },
      });
    }
  });

  // --- zone numbers, and each roof's level on a stepped building ---
  const regions = zoneRegions(grid);
  const labelled: Array<{ region: ZoneRegion; cx: number; cy: number; w: number; h: number }> = [];
  const sizeThatFits = (region: ZoneRegion) => {
    const w = (region.box.x1 - region.box.x0) * k;
    const h = (region.box.y1 - region.box.y0) * k;
    return [10, 7.5, 6].find((s) => w >= estimateTextWidth(region.zoneId, s) + 3 && h >= s + 2);
  };
  // One size per zone — the smallest any of its regions needs — so four
  // corners read as four of the same thing whichever way their legs lie.
  const sizeOfZone = new Map<AnyZoneId, number>();
  for (const region of regions) {
    const size = sizeThatFits(region);
    if (size) sizeOfZone.set(region.zoneId, Math.min(size, sizeOfZone.get(region.zoneId) ?? size));
  }
  for (const region of regions) {
    const w = (region.box.x1 - region.box.x0) * k;
    const h = (region.box.y1 - region.box.y0) * k;
    const size = sizeThatFits(region) && sizeOfZone.get(region.zoneId);
    if (!size) continue;
    let cx = sx((region.box.x0 + region.box.x1) / 2);
    let cy = sy((region.box.y0 + region.box.y1) / 2);
    // A band centred on the ridge would put its number on the ridge line;
    // move it to one side when the band is deep enough to hold it there.
    if (isSteepRoofResult(roof) && building.roof.ridgeLine) {
      const [r0, r1] = building.roof.ridgeLine;
      const clear = size * 0.6 + 3;
      if (Math.abs(r0[1] - r1[1]) < TOL && Math.abs(cy - sy(r0[1])) < clear && h / 2 >= clear + size / 2) {
        cy = sy(r0[1]) - clear;
      } else if (Math.abs(r0[0] - r1[0]) < TOL && Math.abs(cx - sx(r0[0])) < clear && w / 2 >= clear + size / 2) {
        cx = sx(r0[0]) + clear;
      }
    }
    text(cx, cy, region.zoneId, size, 'middle', 'onZone', { bold: true });
    labelled.push({ region, cx, cy, w, h });
  }
  if (step) {
    for (const elevation of new Set(regions.map((r) => r.elevation))) {
      const roomiest = labelled
        .filter((l) => l.region.elevation === elevation)
        .sort((p, q) => Math.min(q.w, q.h) - Math.min(p.w, p.h))[0];
      const tag = `roof at ${formatFeet(elevation ?? 0)} ft`;
      if (!roomiest || roomiest.h < 30 || roomiest.w < estimateTextWidth(tag, DIM_SIZE) + 4) continue;
      text(roomiest.cx, roomiest.cy + 11, tag, DIM_SIZE, 'middle', 'onZone');
    }
  }

  // --- dimension strings: zone breaks, then the overall beyond them ---
  const breaks = chainBreaks(boundaries);
  const tick = (x: number, y: number) => line(x - 2.2, y + 2.2, x + 2.2, y - 2.2, 0.8, 'dim');

  /** Draws one string. `far` puts it on the top or right instead of the bottom or left. */
  const dimension = (
    axis: 'x' | 'y',
    stops: number[],
    far: boolean,
    tier: number,
    bold: boolean
  ): (string | null)[] => {
    // Along the string, in sheet points, always ascending.
    const along = (axis === 'x' ? stops.map(sx) : stops.map(sy)).slice().sort((p, q) => p - q);
    const lengths = along.slice(1).map((v, i) => (v - along[i]!) / k);
    const offset = BAR_ROOM + 12 + tier * 28;
    const edge = axis === 'x' ? (far ? sy(extent.y1) : bottom) : far ? right : left;
    // Which way the plan lies from the string, across it: +1 is down or right.
    const inward = (axis === 'x') === far ? 1 : -1;
    const at = edge - inward * offset;

    if (axis === 'x') line(along[0]!, at, along[along.length - 1]!, at, 0.5, 'dim');
    else line(at, along[0]!, at, along[along.length - 1]!, 0.5, 'dim');
    for (const stop of along) {
      // A witness line out to the string: from just clear of the wall bars
      // for the first string, and only a stub for the one beyond it, whose
      // full line would run through the first string's outer labels.
      const from = tier === 0 ? edge - inward * (BAR_ROOM - 2) : at + inward * 9;
      if (axis === 'x') line(stop, from, stop, at - inward * 3, 0.25, 'dim');
      else line(from, stop, at - inward * 3, stop, 0.25, 'dim');
      if (axis === 'x') tick(stop, at);
      else tick(at, stop);
    }

    const labels = lengths.map((v) => formatFeet(v));
    const lanes = assignLanes(
      labels.map((label, i) => ({
        from: along[i]!,
        to: along[i + 1]!,
        width: estimateTextWidth(label, DIM_SIZE) * (bold ? 1.08 : 1),
      })),
      2
    );
    labels.forEach((label, i) => {
      const lane = lanes[i];
      if (lane === null || lane === undefined) return;
      const mid = (along[i]! + along[i + 1]!) / 2;
      // Lane 0 sits on the plan side of the string; the outer lanes beyond it.
      const across = lane === 0 ? at + inward * 5.5 : at - inward * (6 + (lane - 1) * 8);
      if (axis === 'x') text(mid, across, label, DIM_SIZE, 'middle', 'dim', { bold });
      else text(across, mid, label, DIM_SIZE, 'middle', 'dim', { bold, vertical: true });
    });
    // Reported in plan order (ascending feet), whichever way the sheet runs.
    const placed = labels.map((label, i) => (lanes[i] === null ? null : label));
    return axis === 'x' ? placed : placed.reverse();
  };

  /**
   * The zone strings along one axis. A stepped building's two roofs have
   * different band widths and their breaks interleave, so one shared string
   * says nothing about which break is whose: each level gets its own, on the
   * side of the plan it actually reaches where it can.
   */
  const zoneStrings = (axis: 'x' | 'y'): Array<Omit<PlanChain, 'labels'>> => {
    const levels = [...new Set(roof.pieces.map((p) => p.elevation))].sort((p, q) => (p ?? 0) - (q ?? 0));
    if (!step || levels.length !== 2) return [{ breaks: breaks[axis], far: false }];
    const [lower, upper] = levels.map((elevation) => {
      const own = roof.pieces.filter((p) => p.elevation === elevation);
      const box = boundsOf(own.flatMap((p) => p.vertices));
      // Along x the strings sit below and above the plan, so it is the
      // level's reach in y that says which of those it is against.
      const [lo, hi, extentLo, extentHi] =
        axis === 'x' ? [box.y0, box.y1, extent.y0, extent.y1] : [box.x0, box.x1, extent.x0, extent.x1];
      return {
        elevation,
        breaks: chainBreaks(zoneBoundaries(planGrid(own)))[axis],
        near: Math.abs(lo - extentLo) < TOL,
        far: Math.abs(hi - extentHi) < TOL,
      };
    }) as [
      { elevation?: number; breaks: number[]; near: boolean; far: boolean },
      { elevation?: number; breaks: number[]; near: boolean; far: boolean },
    ];
    const asDrawn = Number(lower.near) + Number(upper.far);
    const swapped = Number(lower.far) + Number(upper.near);
    const lowerFar = swapped > asDrawn;
    return [
      { breaks: lower.breaks, far: lowerFar, elevation: lower.elevation },
      { breaks: upper.breaks, far: !lowerFar, elevation: upper.elevation },
    ];
  };

  const chains: PlanSheet['chains'] = { x: [], y: [] };
  for (const axis of ['x', 'y'] as const) {
    const overall = [breaks[axis][0]!, breaks[axis][breaks[axis].length - 1]!];
    const strings = zoneStrings(axis).filter((s) => s.breaks.length > 2 || step);
    for (const string of strings) {
      chains[axis].push({ ...string, labels: dimension(axis, string.breaks, string.far, 0, false) });
    }
    // The overall goes beyond the zone string on the bottom or left — or in
    // its place, on a roof with no zone breaks along this axis at all.
    dimension(axis, overall, false, strings.some((s) => !s.far) ? 1 : 0, true);
  }

  // --- title block ---
  if (print) {
    text(margin, margin + 9, options.title || 'Wind zone plan', 15, 'start', 'ink', { bold: true });
    if (options.subtitle) text(margin, margin + 27, options.subtitle, 9, 'start', 'muted');
    if (options.notice) text(margin, margin + 42, options.notice, 7.5, 'start', 'notice');
    line(margin, margin + titleHeight - 8, width - margin, margin + titleHeight - 8, 0.5, 'muted');
  }

  // --- the zone tables, beside the plan ---
  if (legendWidth) {
    const x0 = width - margin - legendWidth;
    const x1 = width - margin;
    let y = margin + titleHeight + 6;
    for (const table of options.tables ?? []) {
      text(
        x0,
        y,
        table.elevation === undefined ? table.title : `${table.title} — roof at ${formatFeet(table.elevation)} ft`,
        9,
        'start',
        'ink',
        { bold: true }
      );
      y += 13;
      if (table.areaNote) {
        for (const wrapped of wrapText(table.areaNote, 6.5, legendWidth)) {
          text(x0, y, wrapped, 6.5, 'start', 'muted');
          y += 8.5;
        }
        y += 2;
      }
      for (const entry of table.zones) {
        prims.push({
          kind: 'zone',
          zoneId: entry.zoneId,
          points: [
            [x0, y - 4],
            [x0 + 8, y - 4],
            [x0 + 8, y + 4],
            [x0, y + 4],
          ],
        });
        text(x0 + 13, y, ZONE_LABELS[entry.zoneId], 8.5, 'start', 'ink', { bold: true });
        text(x1, y, `${entry.area.toFixed(1)} ft²`, 8.5, 'end', 'ink');
        y += 11.5;
        for (const row of entry.rows) {
          text(x0 + 13, y, row.formula ? `${row.label} — ${row.formula}` : row.label, 6.5, 'start', 'muted');
          text(x1, y, row.value, 6.5, 'end', 'muted');
          y += 9;
        }
        y += 3;
      }
      y += 8;
    }
    for (const note of options.notes ?? []) {
      for (const wrapped of wrapText(note, 6.5, legendWidth)) {
        text(x0, y, wrapped, 6.5, 'start', 'muted');
        y += 8.5;
      }
      y += 3;
    }
  }

  // --- scale bar and footer ---
  const barFeet = niceLength(110 / k);
  const barY = height - margin - (print ? 12 : 8);
  const barX = margin + (print ? 0 : 4);
  line(barX, barY, barX + barFeet * k, barY, 0.8, 'ink');
  for (const f of [0, 0.5, 1]) line(barX + barFeet * k * f, barY - 3, barX + barFeet * k * f, barY + 3, 0.8, 'ink');
  text(barX, barY + 9, '0', 6.5, 'middle', 'muted');
  text(barX + barFeet * k, barY + 9, `${formatFeet(barFeet)} ft`, 6.5, 'middle', 'muted');
  text(
    barX + barFeet * k + 22,
    barY,
    feetPerInch
      ? `Scale 1 in = ${feetPerInch} ft, printed at 100% on letter. Dimensions in feet.`
      : 'Dimensions in feet.',
    7,
    'start',
    'muted'
  );
  if (print && options.footer) text(width - margin, barY, options.footer, 7, 'end', 'muted');

  return {
    width,
    height,
    pointsPerFoot: k,
    feetPerInch,
    toSheet: (x, y) => [sx(x), sy(y)],
    chains,
    prims,
  };
}
