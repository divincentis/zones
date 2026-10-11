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
import { formatLength, lengthUnitsNote, type LengthUnits } from './lengthFormat';
import { pdfSafe } from './pdfText';
import { buildPlanSheet } from './planSheet';
import { drawPlanSheet } from './planSheetPdf';
import { readZoneHexes, ZONE_LABELS, type AnyZoneId } from './zoneColors';
import { describeBranch, WALL_NAMES } from './terms';
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
  units: LengthUnits;
  /** The framed 3D view, or null when there isn't one to show (exporting from the plan). */
  view: CapturedView | null;
  zoneHexes: Record<AnyZoneId, string>;
  /** Which page comes first — the one the user was looking at when they exported. */
  lead: 'view' | 'plan';
  version: string;
}

const LETTER = { short: 612, long: 792 };

/** One line describing the building, for the plan sheet's title block. */
function buildingSummary(form: FormState, result: ComputationResult, units: LengthUnits): string {
  const len = (feet: number) => formatLength(feet, units);
  if (result.step) {
    return (
      `Stepped building: ${len(form.length)} × ${len(form.width)} at ${len(form.eaveHeight)}, ` +
      `and ${len(form.stepSpan)} × ${len(form.stepDepth)} at ${len(form.stepEaveHeight)}`
    );
  }
  const size = `${len(form.length)} × ${len(form.width)}`;
  const roof = result.roof;
  if (isSteepRoofResult(roof) || isMonoslopeRoofResult(roof)) {
    return `${size}, eave height ${len(form.eaveHeight)}, ${result.building.roofType} roof at ${Math.round(form.pitchDegrees * 100) / 100}°`;
  }
  return `${size}, height ${len(form.eaveHeight)}, flat / low-slope roof`;
}

/**
 * The whole export: a report page (the framed 3D view when there is one, the
 * derived parameters, the zone tables) and the plan sheet, drawn to scale as
 * vector line work. No DOM in here — the caller captures the view and reads
 * the colours — so the document can be built, and looked at, headlessly.
 */
export function buildZonePdf(input: ZonePdfInput): jsPDF {
  const { result, form, boardSize, units, zoneHexes, lead } = input;
  const doc = new jsPDF({ orientation: lead === 'plan' ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });

  const plan = () => {
    const roof = result.roof;
    const sheet = buildPlanSheet(result, {
      mode: 'print',
      units,
      title: form.projectName.trim() || 'Wind zone plan',
      subtitle: `Roof and wall wind zones — ${buildingSummary(form, result, units)}`,
      notice: PRELIMINARY_NOTICE,
      tables: computeZoneTables(result, boardSize, units),
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
function drawReport(doc: jsPDF, { result, form, boardSize, units, view, zoneHexes }: ZonePdfInput): void {
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
  const len = (feet: number) => formatLength(feet, units);
  const cornerWidth = (walls: ComputationResult['walls']) =>
    `${len(walls.a.a)} (${describeBranch(walls.a.governingBranch)})`;
  const footprint = `${len(form.length)} long by ${len(form.width)} wide`;
  const parapetCredit = (table: string, credited: boolean) =>
    credited
      ? `Parapet of 3 ft or more all round: Zone 3 corners are credited to Zone 2 (FM 1-28 Table ${table}, note 2).`
      : form.parapetHeight > 0
        ? `Parapet under 3 ft: no Zone 3 to Zone 2 corner credit (FM 1-28 Table ${table}, note 2).`
        : undefined;

  const paramLines = (
    isSteppedRoofResult(roof)
      ? [
          `Stepped building: two abutting low-slope sections, sharing ${len(roof.abutment.length)} of wall.`,
          `Lower section: ${footprint}, roof at ${len(roof.lower.elevation)}.`,
          `Upper section: ${len(form.stepSpan)} along the ${WALL_NAMES[form.stepEdge]} by ${len(form.stepDepth)} out from it, ` +
            `starting ${len(form.stepOffset)} along that wall; roof at ${len(roof.upper.elevation)}.`,
          `The roofs differ by ${len(roof.heightDifference)}: ${
            roof.treatment === 'separate'
              ? `${roof.threshold} ft or more, so they are zoned as two roofs (Fig. 3.2.2b).`
              : `under ${roof.threshold} ft, so they are zoned as one roof over the whole footprint (Fig. 3.2.2c).`
          }`,
          ...roof.regions.map((r) =>
            r.regime.regime === 'tall'
              ? `${r.role === 'combined' ? 'The one' : r.role === 'lower' ? 'Lower' : 'Upper'} roof: h = ${len(r.h)}, over Fig. 3.2.2a's height limit, so Fig. 3.2.2f's dimensions are used by extrapolation: ` +
                `Zone 2 band a = ${len(r.dEdge)}, Zone 3 legs 2a = ${len(r.legLength)} by a, no Zone 1'.`
              : `${r.role === 'combined' ? 'The one' : r.role === 'lower' ? 'Lower' : 'Upper'} roof: h = ${len(r.h)}, Zone 2 band 0.6h = ${len(r.dEdge)}, Zone 3 leg 0.2h = ${len(r.legWidth)}. ` +
                `Zone 1' ${r.hasZone1Prime ? 'applies' : 'does not apply'}: least plan dimension ${len(r.lMin)} against 2.4h = ${len(r.wideThreshold)}.`
          ),
          `Wall corner width a: ${cornerWidth(result.walls)} lower, ${cornerWidth(result.step!.upperWalls)} upper.`,
          roof.hBasis === 'tallerSection'
            ? 'The one roof takes its h from the taller section (Fig. 3.2.2c does not say whose applies when the levels differ), which is the conservative choice.'
            : 'Each roof is zoned with its own h. The taller section keeps full perimeter and corner treatment on the shared edge; the lower section is sheltered there.',
          roof.parapetCreditsCorners
            ? 'Parapet of 3 ft or more on both sections: Zone 3 corners are credited to Zone 2 (FM 1-28 Table 3.2.2a, note 2).'
            : undefined,
          "Walls: the lower section's buried wall is left out, and the upper section's shared wall starts at the lower roof. Overhangs are not modeled where sections meet.",
        ]
      : isMonoslopeRoofResult(roof)
        ? [
            `Building: ${footprint}, ${len(form.eaveHeight)} to the low eave. Monoslope roof at ${form.pitchDegrees}°, high along the ${WALL_NAMES[form.monoslopeHighSide]}.`,
            `Corner width a (walls and roof bands): ${cornerWidth(result.walls)}. Least plan dimension ${len(result.walls.a.lMin)}.`,
            `Pitch band ${pitchBandLabel(roof.pitchBand)} (${roof.source}).`,
            `High side: band ${len(roof.highBand)}, corner ${len(roof.highCornerBand)}. ` +
              (roof.pitchBand === '3-10'
                ? `Low side: band ${len(roof.lowBand)}, corner ${len(roof.lowCornerBand)}.`
                : `Low side and both ends: band ${len(roof.lowBand)}.`),
            'Overhang and parapet are not modeled for monoslope roofs. Walls are built up to the roof: the high wall and the sloped side walls are in the Zone 4 and 5 areas.',
          ]
        : isSteepRoofResult(roof)
          ? [
              `Building: ${footprint}, ${len(form.eaveHeight)} to the eave. Gable roof at ${form.pitchDegrees}°, ridge along the ${form.ridgeAlong}.`,
              `Corner width a (walls and roof bands): ${cornerWidth(result.walls)}. Least plan dimension ${len(result.walls.a.lMin)}.`,
              `Pitch band ${pitchBandLabel(roof.pitchBand)} (${roof.source}).`,
              roof.pitchBand === '45+'
                ? `Rake band ${len(roof.rakeBand)}. Peak band: a drop of ${len(roof.ridgeBandDrop ?? 0)}, which is ${len(roof.ridgeOrEaveBand)} in plan each side of the ridge.`
                : `Rake band ${len(roof.rakeBand)}. ${roof.pitchBand === '7-27' ? 'Ridge' : 'Eave'} band ${len(roof.ridgeOrEaveBand)}.`,
              roof.pitchBand === '45+'
                ? 'Above 45° the roof is zoned as wall construction (FM 1-28 section 3.4.6): its slopes carry Zones 4 and 5. The peak band is taken as a vertical drop of a.'
                : undefined,
              'Overhang and parapet are not modeled for gable roofs. Gable-end walls run up to the rake and are in the Zone 4 and 5 areas.',
            ]
          : isTallRoofResult(roof)
            ? [
                `Building: ${footprint}, ${len(form.eaveHeight)} high. Parapet ${len(form.parapetHeight)}, overhang ${len(form.overhangDepth)}.`,
                `Tall building (${heightRegimeReason(roof.regime, units)}): roof zones follow Fig. 3.2.2f, not the h-based Fig. 3.2.2a.`,
                `Roof a: ${len(roof.a)} (${describeBranch(roof.aGoverningBranch)}). Zone 2 band a; Zone 3 legs 2a = ${len(roof.cornerLeg)} by a. No Zone 1'.`,
                `Wall corner width a: ${cornerWidth(result.walls)}. Least plan dimension ${len(result.walls.a.lMin)}.`,
                parapetCredit('3.2.2f', roof.parapetCreditsCorners),
              ]
            : [
                `Building: ${footprint}, ${len(form.eaveHeight)} high. Parapet ${len(form.parapetHeight)}, overhang ${len(form.overhangDepth)}.`,
                `Mean roof height h: ${len(roof.h)} (${heightRegimeReason(roof.regime, units)}, so Fig. 3.2.2a applies).`,
                `Wall corner width a: ${cornerWidth(result.walls)}. Least plan dimension ${len(result.walls.a.lMin)}.`,
                `Zone 1' ${roof.hasZone1Prime ? 'applies' : 'does not apply'}: the least plan dimension has to exceed 2.4h = ${len(roof.wideThreshold)}.`,
                parapetCredit('3.2.2a', roof.parapetCreditsCorners),
              ]
  ).filter((line): line is string => line !== undefined);
  paramLines.push(lengthUnitsNote(units));
  for (const line of paramLines) {
    // Wrapped: several of these run well past the page's width.
    for (const wrapped of doc.splitTextToSize(pdfSafe(line), pageWidth - margin * 2) as string[]) {
      doc.text(wrapped, margin, y);
      y += 12;
    }
    y += 1;
  }

  y += 14;
  const tables = computeZoneTables(result, boardSize, units);
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
        ? `${table.title} — roof at ${formatLength(table.elevation, units)}`
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
    for (const [label, area] of [
      ['Roof total', table.totals.roof],
      ['Wall total', table.totals.walls],
    ] as const) {
      pageBreak();
      put(label, labelX, y);
      put(`${area.toFixed(1)} ft²`, valueX, y);
      y += 12;
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
  units: LengthUnits,
  version: string
): void {
  const doc = buildZonePdf({
    result,
    form,
    boardSize,
    units,
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
