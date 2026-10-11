import type { jsPDF } from 'jspdf';
import { pdfSafe } from './pdfText';
import type { PlanRole, PlanSheet } from './planSheet';
import type { AnyZoneId } from './zoneColors';

/**
 * Writes a plan sheet onto the current page of a PDF, as vector line work and
 * real text — the same primitives PlanView2D draws on screen (see
 * planSheet.ts), so the printed plan is the one that was looked at. The page
 * must already be the sheet's size.
 */

const INK: Record<PlanRole, [number, number, number]> = {
  ink: [28, 27, 25],
  muted: [107, 103, 95],
  dim: [17, 112, 168],
  notice: [140, 100, 0],
  onZone: [28, 27, 25],
};

export function drawPlanSheet(doc: jsPDF, sheet: PlanSheet, zoneHex: Record<AnyZoneId, string>): void {
  const polygon = (points: Array<[number, number]>, style: 'F' | 'FD') => {
    const [first, ...rest] = points;
    if (!first) return;
    let from = first;
    const steps = rest.map((p) => {
      const step: [number, number] = [p[0] - from[0], p[1] - from[1]];
      from = p;
      return step;
    });
    doc.lines(steps, first[0], first[1], [1, 1], style, true);
  };

  for (const prim of sheet.prims) {
    if (prim.kind === 'zone') {
      // Stroked in its own colour as well as filled: two pieces of one zone
      // that merely touch would otherwise show a hairline of paper between
      // them wherever a viewer anti-aliases the shared edge.
      const hex = zoneHex[prim.zoneId];
      doc.setFillColor(hex);
      doc.setDrawColor(hex);
      doc.setLineWidth(0.3);
      doc.setLineDashPattern([], 0);
      polygon(prim.points, 'FD');
    } else if (prim.kind === 'poly') {
      doc.setFillColor(...INK[prim.role]);
      polygon(prim.points, 'F');
    } else if (prim.kind === 'line') {
      doc.setDrawColor(...INK[prim.role]);
      doc.setLineWidth(prim.weight);
      doc.setLineDashPattern(prim.dash ?? [], 0);
      doc.line(prim.x1, prim.y1, prim.x2, prim.y2);
    } else {
      const value = pdfSafe(prim.text);
      doc.setFont('helvetica', prim.bold ? 'bold' : 'normal');
      doc.setFontSize(prim.size);
      doc.setTextColor(...INK[prim.role]);
      if (prim.vertical) {
        // Rotated about its own start point, so centring is done by hand:
        // start half the text's length below the anchor, with the baseline
        // offset to put the glyphs' middle on it.
        doc.text(value, prim.x + prim.size * 0.35, prim.y + doc.getTextWidth(value) / 2, { angle: 90 });
      } else {
        doc.text(value, prim.x, prim.y, {
          align: prim.anchor === 'start' ? 'left' : prim.anchor === 'middle' ? 'center' : 'right',
          baseline: 'middle',
        });
      }
    }
  }
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
}
