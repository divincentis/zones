import { jsPDF } from 'jspdf';
import {
  isMonoslopeRoofResult,
  isSteepRoofResult,
  isSteppedRoofResult,
  type ComputationResult,
  type FormState,
} from './buildModel';
import { ZONE_LABELS, type AnyZoneId } from './zoneColors';
import { computeZoneWidths } from './zoneWidths';

const PRELIMINARY_NOTICE =
  'Preliminary — for coordination and takeoff. Not for construction. Not sealed. ' +
  'Geometry only; no pressures, no design loads.';

function zoneAreas(result: ComputationResult): Array<{ zoneId: AnyZoneId; area: number }> {
  const ids: AnyZoneId[] = ["1'", '1', '2', '3', '4', '5'];
  const wallPieces = result.step
    ? [...result.walls.pieces, ...result.step.upperWalls.pieces]
    : result.walls.pieces;
  return ids
    .map((zoneId) => {
      const source = zoneId === '4' || zoneId === '5' ? wallPieces : result.roof.pieces;
      const area = source.filter((p) => p.zoneId === zoneId).reduce((s, p) => s + p.area, 0);
      return { zoneId, area };
    })
    .filter((z) => z.area > 0);
}

/** PDF export: the user-framed 3D view plus a tabular zone/area summary (scope §8 Phase 1, §10.2). */
export function exportZonePdf(
  canvas: HTMLCanvasElement,
  result: ComputationResult,
  form: FormState,
  boardSize?: number
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  const title = form.projectName.trim() || 'Wind Zone Geometry Report';
  doc.setFontSize(16);
  doc.text(title, margin, 46);

  let noticeY = 64;
  if (form.projectName.trim()) {
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('Wind Zone Geometry Report', margin, noticeY);
    doc.setTextColor(0, 0, 0);
    noticeY += 14;
  }

  doc.setFontSize(9);
  doc.setTextColor(140, 100, 0);
  doc.text(PRELIMINARY_NOTICE, margin, noticeY, { maxWidth: pageWidth - margin * 2 });
  doc.setTextColor(0, 0, 0);

  // The 3D viewport's WebGL canvas has a transparent background; JPEG has no
  // alpha channel, so encoding it directly turns the transparent areas black.
  // Flatten onto a white backing canvas first so the PDF page reads as white.
  const flattened = document.createElement('canvas');
  flattened.width = canvas.width;
  flattened.height = canvas.height;
  const ctx = flattened.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flattened.width, flattened.height);
  ctx.drawImage(canvas, 0, 0);
  const imgData = flattened.toDataURL('image/jpeg', 0.85);
  const imgW = pageWidth - margin * 2;
  const imgH = imgW * (canvas.height / canvas.width);
  const imgY = noticeY + 28;
  doc.addImage(imgData, 'JPEG', margin, imgY, imgW, imgH);

  let y = imgY + imgH + 28;

  doc.setFontSize(11);
  doc.text('Building & derived parameters', margin, y);
  y += 16;
  doc.setFontSize(9);
  const roof = result.roof;
  const paramLines = isSteppedRoofResult(roof)
    ? [
        `Stepped building — two abutting low-slope sections. Shared wall ${roof.abutment.length.toFixed(1)} ft long.`,
        `Lower section: ${form.length} ft x ${form.width} ft, roof elevation ${roof.lower.elevation.toFixed(1)} ft`,
        `Upper section: ${form.stepSpan} ft x ${form.stepDepth} ft on the ${form.stepEdge} wall (offset ${form.stepOffset} ft), roof elevation ${roof.upper.elevation.toFixed(1)} ft`,
        `Roof elevation step: ${roof.heightDifference.toFixed(2)} ft — ${
          roof.treatment === 'separate'
            ? `>= ${roof.threshold} ft, zoned as two roofs (Fig. 3.2.2b)`
            : `< ${roof.threshold} ft, zoned as one roof over the union (Fig. 3.2.2c)`
        }`,
        ...roof.regions.map(
          (r) =>
            `${r.role} roof: h = ${r.h.toFixed(2)} ft, Zone 2 band 0.6h = ${r.dEdge.toFixed(2)} ft, Zone 3 leg 0.2h = ${r.legWidth.toFixed(2)} ft, ` +
            `Zone 1' ${r.hasZone1Prime ? 'applies' : 'does not apply'} (L_min ${r.lMin.toFixed(1)} ft vs 2.4h = ${r.wideThreshold.toFixed(2)} ft)`
        ),
        `a basis: ${form.aBasis}   a (wall zones): ${result.walls.a.a.toFixed(2)} ft lower / ${result.step!.upperWalls.a.a.toFixed(2)} ft upper`,
        roof.hBasis === 'tallerSection'
          ? "Combined-roof h taken from the taller section (Fig. 3.2.2c does not specify whose h applies when the levels differ) — conservative."
          : 'Each roof is zoned with its own h; the taller section keeps full perimeter and corner treatment on the abutting edge, the lower section is sheltered there.',
        roof.parapetCreditsCorners
          ? 'Parapet >= 3 ft on both sections: Zone 3 corners credited to Zone 2 (FM 1-28 Table 3.2.2a, note 2).'
          : undefined,
        'Wall zones: the lower section\'s buried wall is excluded; the upper section\'s shared wall starts at the lower roof. Overhangs are not modeled at an abutment.',
      ].filter((line): line is string => line !== undefined)
    : isMonoslopeRoofResult(roof)
    ? [
        `Footprint: ${form.length} ft x ${form.width} ft, height ${form.eaveHeight} ft, roof pitch ${form.pitchDegrees}° (monoslope, high side: ${form.monoslopeHighSide})`,
        `a basis: ${form.aBasis}   a (wall + roof bands): ${result.walls.a.a.toFixed(2)} ft — ${result.walls.a.governingBranch}`,
        `L_min: ${result.walls.a.lMin.toFixed(2)} ft   Pitch band: ${roof.pitchBand}° (${roof.source})`,
        `High band/corner: ${roof.highBand.toFixed(2)}/${roof.highCornerBand.toFixed(2)} ft   ${roof.pitchBand === '3-10' ? `Low band/corner: ${roof.lowBand.toFixed(2)}/${roof.lowCornerBand.toFixed(2)} ft` : `Wrap band: ${roof.lowBand.toFixed(2)} ft`}`,
        'Overhang and parapet are not yet modeled for monoslope roofs; wall zones use a uniform height on all four walls.',
      ]
    : isSteepRoofResult(roof)
      ? [
          `Footprint: ${form.length} ft x ${form.width} ft, height ${form.eaveHeight} ft, roof pitch ${form.pitchDegrees}° (gable, ridge along ${form.ridgeAlong})`,
          `a basis: ${form.aBasis}   a (wall + roof bands): ${result.walls.a.a.toFixed(2)} ft — ${result.walls.a.governingBranch}`,
          `L_min: ${result.walls.a.lMin.toFixed(2)} ft   Pitch band: ${roof.pitchBand}° (${roof.source})`,
          `Rake band: ${roof.rakeBand.toFixed(2)} ft   ${roof.pitchBand === '7-27' ? 'Ridge' : 'Eave'} band: ${roof.ridgeOrEaveBand.toFixed(2)} ft`,
          'Overhang and parapet are not yet modeled for gable roofs.',
        ]
      : [
          `Footprint: ${form.length} ft x ${form.width} ft, height ${form.eaveHeight} ft`,
          `Parapet height: ${form.parapetHeight} ft   Overhang depth: ${form.overhangDepth} ft`,
          `a basis: ${form.aBasis}   a (wall zones): ${result.walls.a.a.toFixed(2)} ft — ${result.walls.a.governingBranch}`,
          `L_min: ${result.walls.a.lMin.toFixed(2)} ft   h (roof mean height): ${roof.h.toFixed(2)} ft`,
          `Zone 1': ${roof.hasZone1Prime ? 'applies' : 'does not apply'} (threshold L_min > 2.4h = ${roof.wideThreshold.toFixed(2)} ft)`,
          roof.parapetCreditsCorners
            ? "Parapet >= 3 ft on the full perimeter: Zone 3 corners credited to Zone 2 (FM 1-28 Table 3.2.2a, note 2)."
            : form.parapetHeight > 0
              ? 'Parapet below 3 ft: no Zone 3-to-Zone 2 corner credit (FM 1-28 Table 3.2.2a, note 2).'
              : undefined,
        ].filter((line): line is string => line !== undefined);
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
  const widths = computeZoneWidths(result, boardSize);
  const hasLegLength = areas.some(({ zoneId }) => widths[zoneId]?.legLength !== undefined);
  if (boardSize && boardSize > 0) {
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Widths rounded up to ${boardSize} ft boards where shown ("exact → rounded").`, margin, y);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    y += 14;
  }
  const valueX = margin + 160;
  for (const { zoneId, area } of areas) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(ZONE_LABELS[zoneId], margin, y);
    doc.text(`${area.toFixed(1)} ft²`, valueX, y);
    y += 12;

    const width = widths[zoneId];
    const detailParts = [
      width?.width && `Width ${width.width}`,
      hasLegLength && width?.legLength && `Leg length ${width.legLength}`,
    ].filter(Boolean);
    if (detailParts.length > 0) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(detailParts.join('  ·  '), margin + 14, y);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
      y += 12;
    }
    y += 4;
  }

  y += 14;
  if (y > pageHeight - margin) {
    doc.addPage();
    y = margin;
  }
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `Sources: roof zones — ${isMonoslopeRoofResult(roof) || isSteepRoofResult(roof) || isSteppedRoofResult(roof) ? roof.source : 'FM Global 1-28 Fig 3.2.2a'}. ` +
      'Wall zones — a-parameter formula. See project scope doc Addendum §10.',
    margin,
    y,
    { maxWidth: pageWidth - margin * 2 }
  );

  const fileSlug = form.projectName.trim()
    ? form.projectName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
    : 'wind-zone-report';
  doc.save(`${fileSlug || 'wind-zone-report'}.pdf`);
}
