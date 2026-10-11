import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildZonePdf } from '../src/lib/pdfExport';
import type { AnyZoneId } from '../src/lib/zoneColors';
import { BUILDINGS, formWith, zonesFor } from './fixtures';

// The light theme's zone colours (theme.css) — the app reads them from the
// page, which a headless run doesn't have.
const ZONE_HEX: Record<AnyZoneId, string> = {
  "1'": '#2a78d6',
  '1': '#eb6834',
  '2': '#1baf7a',
  '3': '#eda100',
  '4': '#e87ba4',
  '5': '#008300',
};

// Set ZONES_PDF_DUMP to a directory to keep the PDFs these build, for looking
// at: e.g. ZONES_PDF_DUMP=/tmp/zones-pdf npm test --workspace=apps/web
const dumpDir = process.env.ZONES_PDF_DUMP;

describe('buildZonePdf — builds headlessly for every kind of building', () => {
  for (const [name, overrides] of Object.entries(BUILDINGS)) {
    it(name, () => {
      const form = formWith({ ...overrides, projectName: `Fixture: ${name}` });
      const doc = buildZonePdf({
        result: zonesFor(overrides),
        form,
        // Alternated, so both ways of writing a length go through the writer.
        units: Object.keys(BUILDINGS).indexOf(name) % 2 ? 'decimal' : 'feetInches',
        view: null,
        zoneHexes: ZONE_HEX,
        lead: 'plan',
        version: 'test',
      });
      // The plan sheet, then at least one report page.
      expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
      const bytes = doc.output('arraybuffer');
      expect(bytes.byteLength).toBeGreaterThan(2000);
      if (dumpDir) {
        mkdirSync(dumpDir, { recursive: true });
        writeFileSync(path.join(dumpDir, `${name}.pdf`), Buffer.from(bytes));
      }
    });
  }

  it('leads with the plan, landscape, when exported from the plan view', () => {
    const doc = buildZonePdf({ result: zonesFor(), form: formWith(), units: 'feetInches', view: null, zoneHexes: ZONE_HEX, lead: 'plan', version: 'test' });
    doc.setPage(1);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(792);
    doc.setPage(2);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(612);
  });

  it('leads with the report, portrait, when exported from the 3D view, and ends on the plan', () => {
    const doc = buildZonePdf({ result: zonesFor(), form: formWith(), units: 'feetInches', view: null, zoneHexes: ZONE_HEX, lead: 'view', version: 'test' });
    doc.setPage(1);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(612);
    doc.setPage(doc.getNumberOfPages());
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(792);
  });
});
