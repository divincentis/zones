import { jsPDF } from 'jspdf';
import type { ComputationResult, FormState } from './buildModel';
import { ZONE_LABELS, type AnyZoneId } from './zoneColors';

const PRELIMINARY_NOTICE =
  'Preliminary — for coordination and takeoff. Not for construction. Not sealed. ' +
  'Geometry only; no pressures, no design loads.';

function zoneAreas(result: ComputationResult): Array<{ zoneId: AnyZoneId; area: number }> {
  const ids: AnyZoneId[] = ["1'", '1', '2', '3', '4', '5'];
  return ids
    .map((zoneId) => {
      const source = zoneId === '4' || zoneId === '5' ? result.walls.pieces : result.roof.pieces;
      const area = source.filter((p) => p.zoneId === zoneId).reduce((s, p) => s + p.area, 0);
      return { zoneId, area };
    })
    .filter((z) => z.area > 0);
}

/** PDF export: the user-framed 3D view plus a tabular zone/area summary (scope §8 Phase 1, §10.2). */
export function exportZonePdf(
  canvas: HTMLCanvasElement,
  result: ComputationResult,
  form: FormState
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  doc.setFontSize(16);
  doc.text('Wind Zone Geometry Report', margin, 46);

  doc.setFontSize(9);
  doc.setTextColor(140, 100, 0);
  doc.text(PRELIMINARY_NOTICE, margin, 64, { maxWidth: pageWidth - margin * 2 });
  doc.setTextColor(0, 0, 0);

  const imgData = canvas.toDataURL('image/png');
  const imgW = pageWidth - margin * 2;
  const imgH = imgW * (canvas.height / canvas.width);
  const imgY = 92;
  doc.addImage(imgData, 'PNG', margin, imgY, imgW, imgH);

  let y = imgY + imgH + 28;

  doc.setFontSize(11);
  doc.text('Building & derived parameters', margin, y);
  y += 16;
  doc.setFontSize(9);
  const paramLines = [
    `Footprint: ${form.length} ft x ${form.width} ft, eave height ${form.eaveHeight} ft`,
    `Parapet height: ${form.parapetHeight} ft   Overhang depth: ${form.overhangDepth} ft`,
    `a basis: ${form.aBasis}   a (wall zones): ${result.walls.a.a.toFixed(2)} ft — ${result.walls.a.governingBranch}`,
    `L_min: ${result.walls.a.lMin.toFixed(2)} ft   h (roof mean height): ${result.roof.h.toFixed(2)} ft`,
    `Zone 1': ${result.roof.hasZone1Prime ? 'applies' : 'does not apply'} (threshold L_min > 2.4h = ${result.roof.wideThreshold.toFixed(2)} ft)`,
  ];
  for (const line of paramLines) {
    doc.text(line, margin, y);
    y += 13;
  }

  y += 14;
  doc.setFontSize(11);
  doc.text('Zone areas', margin, y);
  y += 16;
  doc.setFontSize(9);
  const areas = zoneAreas(result);
  const valueX = margin + 160;
  for (const { zoneId, area } of areas) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(ZONE_LABELS[zoneId], margin, y);
    doc.text(`${area.toFixed(1)} ft²`, valueX, y);
    y += 14;
  }

  y += 14;
  if (y > pageHeight - margin) {
    doc.addPage();
    y = margin;
  }
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(
    'Sources: roof zones — FM Global 1-28 Fig. 3.2.2a/d. Wall zones — a-parameter formula. See project scope doc Addendum §10.',
    margin,
    y,
    { maxWidth: pageWidth - margin * 2 }
  );

  doc.save('wind-zone-report.pdf');
}
