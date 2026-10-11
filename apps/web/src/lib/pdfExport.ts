import { jsPDF } from 'jspdf';
import {
  heightRegimeReason,
  isMonoslopeRoofResult,
  isSteepRoofResult,
  isSteppedRoofResult,
  isTallRoofResult,
  pitchBandLabel,
  type ComputationResult,
  type FormState,
} from './buildModel';
import { pdfSafe } from './pdfText';
import { buildPlanSheet } from './planSheet';
import { drawPlanSheet } from './planSheetPdf';
import { readZoneHexes, ZONE_LABELS, type AnyZoneId } from './zoneColors';
import { computeZoneTables } from './zoneDimensions';

const PRELIMINARY_NOTICE =
  'Preliminary — for coordination and takeoff. Not for construction. Not sealed. ' +
  'Geometry only; no pressures, no design loads.';

/**
 * The 3D viewport's dimension labels are DOM elements (drei's `Html`)
 * layered over the WebGL canvas via CSS, not pixels drawn into the canvas
 * itself — only the tick-mark lines are real WebGL geometry. So a raw
 * `canvas.toDataURL()` silently drops every dimension's text. Read the
 * labels currently on screen back out of the DOM and paint them onto the
 * flattened canvas at their projected position, matching their live styles
 * so this stays in sync with any future style change to the labels.
 */
function drawDimensionLabels(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  const canvasRect = canvas.getBoundingClientRect();
  if (canvasRect.width === 0 || canvasRect.height === 0) return;
  const scaleX = canvas.width / canvasRect.width;
  const scaleY = canvas.height / canvasRect.height;

  const labels = document.querySelectorAll<HTMLElement>('[data-pdf-dim-label]');
  labels.forEach((el) => {
    const r = el.getBoundingClientRect();
    // Zero-size labels are hidden/not currently laid out — nothing to draw.
    if (r.width === 0 || r.height === 0) return;

    const style = getComputedStyle(el);
    const x = (r.left - canvasRect.left) * scaleX;
    const y = (r.top - canvasRect.top) * scaleY;
    const w = r.width * scaleX;
    const h = r.height * scaleY;
    const radius = Math.min(3 * scaleX, w / 2, h / 2);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    ctx.fillStyle = style.backgroundColor || 'rgba(12,12,16,0.92)';
    ctx.fill();
    ctx.clip();

    const borderWidth = (parseFloat(style.borderLeftWidth) || 3) * scaleX;
    ctx.fillStyle = style.borderLeftColor || '#333333';
    ctx.fillRect(x, y, borderWidth, h);

    const fontSize = (parseFloat(style.fontSize) || 12) * scaleY;
    ctx.fillStyle = style.color || '#ffffff';
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const paddingLeft = (parseFloat(style.paddingLeft) || 7) * scaleX;
    ctx.fillText(el.textContent ?? '', x + borderWidth + paddingLeft, y + h / 2 + 1);
    ctx.restore();
  });
}

/** The 3D viewport as the user framed it, flattened to an image a PDF can hold. */
export interface CapturedView {
  dataUrl: string;
  /** Height over width. */
  aspect: number;
}

export function captureView(canvas: HTMLCanvasElement): CapturedView {
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
  drawDimensionLabels(ctx, canvas);
  return { dataUrl: flattened.toDataURL('image/jpeg', 0.85), aspect: canvas.height / canvas.width };
}

export interface ZonePdfInput {
  result: ComputationResult;
  form: FormState;
  boardSize?: number;
  /** The framed 3D view, or null when there isn't one to show (exporting from the plan). */
  view: CapturedView | null;
  zoneHexes: Record<AnyZoneId, string>;
  /** Which page comes first — the one the user was looking at when they exported. */
  lead: 'view' | 'plan';
  version: string;
}

const LETTER = { short: 612, long: 792 };

/** One line describing the building, for the plan sheet's title block. */
function buildingSummary(form: FormState, result: ComputationResult): string {
  if (result.step) {
    return (
      `Stepped building: ${form.length} × ${form.width} ft at ${form.eaveHeight} ft, ` +
      `and ${form.stepSpan} × ${form.stepDepth} ft at ${form.stepEaveHeight} ft`
    );
  }
  const size = `${form.length} × ${form.width} ft`;
  const roof = result.roof;
  if (isSteepRoofResult(roof) || isMonoslopeRoofResult(roof)) {
    return `${size}, eave height ${form.eaveHeight} ft, ${result.building.roofType} roof at ${Math.round(form.pitchDegrees * 100) / 100}°`;
  }
  return `${size}, height ${form.eaveHeight} ft, flat / low-slope roof`;
}

/**
 * The whole export: a report page (the framed 3D view when there is one, the
 * derived parameters, the zone tables) and the plan sheet, drawn to scale as
 * vector line work. No DOM in here — the caller captures the view and reads
 * the colours — so the document can be built, and looked at, headlessly.
 */
export function buildZonePdf(input: ZonePdfInput): jsPDF {
  const { result, form, boardSize, zoneHexes, lead } = input;
  const doc = new jsPDF({ orientation: lead === 'plan' ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });

  const plan = () => {
    const roof = result.roof;
    const sheet = buildPlanSheet(result, {
      mode: 'print',
      title: form.projectName.trim() || 'Wind zone plan',
      subtitle: `Roof and wall wind zones — ${buildingSummary(form, result)}`,
      notice: PRELIMINARY_NOTICE,
      tables: computeZoneTables(result, boardSize),
      notes: [
        boardSize && boardSize > 0
          ? `Roof bands are drawn rounded up to ${boardSize} ft boards; each exact width is shown as a minimum.`
          : undefined,
        'Coloured bars outside the roof edge show the wall zone along that side.',
        isSteepRoofResult(roof) ? 'Dash-dot line: ridge. Arrows point down the slope.' : undefined,
        isMonoslopeRoofResult(roof) ? 'The arrow points down the slope.' : undefined,
        result.building.roof.overhangDepth > 0 ? 'Dashed line: the wall face under the overhang.' : undefined,
        result.step ? 'Heavy line: the step between the two roof levels.' : undefined,
        `Sources: roof — ${roof.source}; walls — ${result.walls.source}.`,
      ].filter((note): note is string => note !== undefined),
      footer: `Wind Zone Visualizer v${input.version} · zbcad.com/zones`,
    });
    drawPlanSheet(doc, sheet, zoneHexes);
  };

  if (lead === 'plan') {
    plan();
    doc.addPage('letter', 'portrait');
  }
  drawReport(doc, input);
  if (lead !== 'plan') {
    doc.addPage('letter', 'landscape');
    plan();
  }
  return doc;
}

/** The report pages: the framed 3D view, the derived parameters, and the zone tables (scope §8 Phase 1, §10.2). */
function drawReport(doc: jsPDF, { result, form, boardSize, view, zoneHexes }: ZonePdfInput): void {
  const pageWidth = LETTER.short;
  const pageHeight = LETTER.long;
  const margin = 40;
  // Every string goes through pdfSafe: see pdfText.ts.
  const put = (text: string, x: number, y: number, options?: { maxWidth?: number }) =>
    doc.text(pdfSafe(text), x, y, options);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);

  const title = form.projectName.trim() || 'Wind Zone Geometry Report';
  doc.setFontSize(16);
  put(title, margin, 46);

  let noticeY = 64;
  if (form.projectName.trim()) {
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    put('Wind Zone Geometry Report', margin, noticeY);
    doc.setTextColor(0, 0, 0);
    noticeY += 14;
  }

  doc.setFontSize(9);
  doc.setTextColor(140, 100, 0);
  put(PRELIMINARY_NOTICE, margin, noticeY, { maxWidth: pageWidth - margin * 2 });
  doc.setTextColor(0, 0, 0);

  let y = noticeY + 28;
  if (view) {
    const imgW = pageWidth - margin * 2;
    // A tall, narrow viewport would otherwise push everything else off the page.
    const imgH = Math.min(imgW * view.aspect, pageHeight * 0.45);
    const drawnW = imgH / view.aspect;
    doc.addImage(view.dataUrl, 'JPEG', margin + (imgW - drawnW) / 2, y, drawnW, imgH);
    y += imgH + 28;
  }

  doc.setFontSize(11);
  put('Building & derived parameters', margin, y);
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
            r.regime.regime === 'tall'
              ? `${r.role} roof: h = ${r.h.toFixed(2)} ft, over Fig. 3.2.2a's height limit — Fig. 3.2.2f dimensions by extrapolation: ` +
                `Zone 2 band a = ${r.dEdge.toFixed(2)} ft, Zone 3 legs 2a = ${r.legLength.toFixed(2)} ft by a, no Zone 1'`
              : `${r.role} roof: h = ${r.h.toFixed(2)} ft, Zone 2 band 0.6h = ${r.dEdge.toFixed(2)} ft, Zone 3 leg 0.2h = ${r.legWidth.toFixed(2)} ft, ` +
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
        `L_min: ${result.walls.a.lMin.toFixed(2)} ft   Pitch band: ${pitchBandLabel(roof.pitchBand)} (${roof.source})`,
        `High band/corner: ${roof.highBand.toFixed(2)}/${roof.highCornerBand.toFixed(2)} ft   ${roof.pitchBand === '3-10' ? `Low band/corner: ${roof.lowBand.toFixed(2)}/${roof.lowCornerBand.toFixed(2)} ft` : `Wrap band: ${roof.lowBand.toFixed(2)} ft`}`,
        'Overhang and parapet are not yet modeled for monoslope roofs. Walls are built up to the roof: the high wall and sloped side walls are in the Zone 4/5 areas.',
      ]
    : isSteepRoofResult(roof)
      ? [
          `Footprint: ${form.length} ft x ${form.width} ft, height ${form.eaveHeight} ft, roof pitch ${form.pitchDegrees}° (gable, ridge along ${form.ridgeAlong})`,
          `a basis: ${form.aBasis}   a (wall + roof bands): ${result.walls.a.a.toFixed(2)} ft — ${result.walls.a.governingBranch}`,
          `L_min: ${result.walls.a.lMin.toFixed(2)} ft   Pitch band: ${pitchBandLabel(roof.pitchBand)} (${roof.source})`,
          roof.pitchBand === '45+'
            ? `Rake band: ${roof.rakeBand.toFixed(2)} ft   Peak band: ${(roof.ridgeBandDrop ?? 0).toFixed(2)} ft vertical drop (${roof.ridgeOrEaveBand.toFixed(2)} ft in plan each side of the ridge)`
            : `Rake band: ${roof.rakeBand.toFixed(2)} ft   ${roof.pitchBand === '7-27' ? 'Ridge' : 'Eave'} band: ${roof.ridgeOrEaveBand.toFixed(2)} ft`,
          roof.pitchBand === '45+'
            ? 'Above 45 degrees the roof is zoned as wall construction (FM 1-28 section 3.4.6): its slopes carry Zones 4 and 5. The peak band is taken as a vertical drop of a.'
            : undefined,
          'Overhang and parapet are not yet modeled for gable roofs. Gable-end walls run up to the rake and are in the Zone 4/5 areas.',
        ].filter((line): line is string => line !== undefined)
      : isTallRoofResult(roof)
      ? [
          `Footprint: ${form.length} ft x ${form.width} ft, height ${form.eaveHeight} ft`,
          `Parapet height: ${form.parapetHeight} ft   Overhang depth: ${form.overhangDepth} ft`,
          `Tall building (${heightRegimeReason(roof.regime)}): roof zones per Fig. 3.2.2f, not the h-based Fig. 3.2.2a.`,
          `a (roof zones): ${roof.a.toFixed(2)} ft — ${roof.aGoverningBranch}   Zone 2 band a, Zone 3 legs 2a = ${roof.cornerLeg.toFixed(2)} ft by a. No Zone 1'.`,
          `a basis: ${form.aBasis}   a (wall zones): ${result.walls.a.a.toFixed(2)} ft — ${result.walls.a.governingBranch}   L_min: ${result.walls.a.lMin.toFixed(2)} ft`,
          roof.parapetCreditsCorners
            ? 'Parapet >= 3 ft on the full perimeter: Zone 3 corners credited to Zone 2 (FM 1-28 Table 3.2.2f, note 2).'
            : form.parapetHeight > 0
              ? 'Parapet below 3 ft: no Zone 3-to-Zone 2 corner credit (FM 1-28 Table 3.2.2f, note 2).'
              : undefined,
        ].filter((line): line is string => line !== undefined)
      : [
          `Footprint: ${form.length} ft x ${form.width} ft, height ${form.eaveHeight} ft`,
          `Parapet height: ${form.parapetHeight} ft   Overhang depth: ${form.overhangDepth} ft`,
          `a basis: ${form.aBasis}   a (wall zones): ${result.walls.a.a.toFixed(2)} ft — ${result.walls.a.governingBranch}`,
          `L_min: ${result.walls.a.lMin.toFixed(2)} ft   h (roof mean height): ${roof.h.toFixed(2)} ft (${heightRegimeReason(roof.regime)}: Fig. 3.2.2a applies)`,
          `Zone 1': ${roof.hasZone1Prime ? 'applies' : 'does not apply'} (threshold L_min > 2.4h = ${roof.wideThreshold.toFixed(2)} ft)`,
          roof.parapetCreditsCorners
            ? "Parapet >= 3 ft on the full perimeter: Zone 3 corners credited to Zone 2 (FM 1-28 Table 3.2.2a, note 2)."
            : form.parapetHeight > 0
              ? 'Parapet below 3 ft: no Zone 3-to-Zone 2 corner credit (FM 1-28 Table 3.2.2a, note 2).'
              : undefined,
        ].filter((line): line is string => line !== undefined);
  for (const line of paramLines) {
    // Wrapped: several of these run well past the page's width.
    for (const wrapped of doc.splitTextToSize(pdfSafe(line), pageWidth - margin * 2) as string[]) {
      doc.text(wrapped, margin, y);
      y += 12;
    }
    y += 1;
  }

  y += 14;
  const tables = computeZoneTables(result, boardSize);
  const swatchSize = 8;
  const labelX = margin + swatchSize + 6;
  const valueX = margin + 160;
  const pageBreak = () => {
    if (y > pageHeight - margin) {
      doc.addPage('letter', 'portrait');
      y = margin;
    }
  };

  // One block per roof — a stepped building is listed per level, matching the
  // panel, since every figure on it is per level.
  for (const table of tables) {
    pageBreak();
    doc.setFontSize(11);
    put(
      table.elevation !== undefined
        ? `${table.title} — elevation ${table.elevation.toFixed(1)} ft`
        : table.title,
      margin,
      y
    );
    y += 16;
    doc.setFontSize(9);
    if (table.areaNote) {
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      put(table.areaNote, margin, y);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
      y += 14;
    }
    if (boardSize && boardSize > 0) {
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      put(`Widths rounded up to ${boardSize} ft boards where shown (exact width shown as a minimum).`, margin, y);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
      y += 14;
    }

    for (const { zoneId, area, rows } of table.zones) {
      pageBreak();
      doc.setFillColor(zoneHexes[zoneId]);
      doc.rect(margin, y - swatchSize + 2, swatchSize, swatchSize, 'F');
      put(ZONE_LABELS[zoneId], labelX, y);
      put(`${area.toFixed(1)} ft²`, valueX, y);
      y += 12;

      // One line per figure, mirroring the panel's sub-rows: name and
      // multiplier on the left, the figure itself in the value column.
      for (const row of rows) {
        pageBreak();
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        put(row.formula ? `${row.label} — ${row.formula}` : row.label, margin + 14, y);
        put(row.value, valueX, y);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
        y += 12;
      }
      y += 4;
    }
    y += 10;
  }

  y += 14;
  if (y > pageHeight - margin) {
    doc.addPage('letter', 'portrait');
    y = margin;
  }
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  put(
    `Sources: roof zones — ${roof.source}. Wall zones — ${result.walls.source}` +
      `${result.step && result.step.upperWalls.source !== result.walls.source ? ` (lower), ${result.step.upperWalls.source} (upper)` : ''}.`,
    margin,
    y,
    { maxWidth: pageWidth - margin * 2 }
  );
}

/**
 * Builds the PDF and hands it to the browser to save. `canvas` is the 3D
 * viewport when exporting from it, and null from the plan view, where there
 * is no framed view to include.
 */
export function exportZonePdf(
  canvas: HTMLCanvasElement | null,
  result: ComputationResult,
  form: FormState,
  boardSize: number | undefined,
  version: string
): void {
  const doc = buildZonePdf({
    result,
    form,
    boardSize,
    view: canvas ? captureView(canvas) : null,
    zoneHexes: readZoneHexes(),
    lead: canvas ? 'view' : 'plan',
    version,
  });
  const fileSlug = form.projectName.trim()
    ? form.projectName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
    : 'wind-zone-report';
  doc.save(`${fileSlug || 'wind-zone-report'}.pdf`);
}
