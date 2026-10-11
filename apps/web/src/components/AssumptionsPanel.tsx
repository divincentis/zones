import { Fragment, useState } from 'react';
import {
  heightRegimeReason,
  isMonoslopeRoofResult,
  isSteepRoofResult,
  isSteppedRoofResult,
  isTallRoofResult,
  pitchBandLabel,
  type ComputationResult,
  type FormState,
} from '../lib/buildModel';
import type { HoverInfo } from '../lib/hoverInfo';
import { formatLength, lengthUnitsNote, type LengthUnits } from '../lib/lengthFormat';
import { describeBranch } from '../lib/terms';
import { computeZoneTables, tablesToTsv, type ZoneTable } from '../lib/zoneDimensions';
import { steppedSections } from '../lib/steppedSections';
import { ZONE_LABELS, ZONE_DESCRIPTIONS, useZoneColors, type AnyZoneId } from '../lib/zoneColors';

interface Props {
  result: ComputationResult;
  form: FormState;
  hovered: HoverInfo | null;
  /** Board width (ft) to round zone widths up to for takeoff. null = off. */
  boardSize: number | null;
  units: LengthUnits;
}

export function AssumptionsPanel({ result, form, hovered, boardSize, units }: Props) {
  const { roof, walls, step } = result;
  const stepped = isSteppedRoofResult(roof);
  const tables = computeZoneTables(result, boardSize ?? undefined, units);
  const len = (feet: number) => formatLength(feet, units);
  const cornerWidth = (w: typeof walls) => `${len(w.a.a)} — ${describeBranch(w.a.governingBranch)}`;
  // Field zones that can't be given a width/length because they don't fill
  // their own bounding box — they wrap the abutment, so only an area is
  // honest. Named here rather than left as a silent gap in the table.
  const unmeasurableFields = (stepped ? steppedSections(result) : []).flatMap((section) => {
    const zone1 = section.extents['1'];
    const zone1Prime = section.extents["1'"];
    const out: string[] = [];
    if (zone1 && !zone1Prime && !zone1.rectangular) out.push(`Zone 1 (${section.role})`);
    if (zone1Prime && !zone1Prime.rectangular) out.push(`Zone 1' (${section.role})`);
    return out;
  });
  const colors = useZoneColors();
  const [expandedZone, setExpandedZone] = useState<ExpandedZone | null>(null);
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null);

  const copyTables = async () => {
    try {
      await navigator.clipboard.writeText(tablesToTsv(tables));
      setCopied('done');
    } catch {
      setCopied('failed');
    }
    window.setTimeout(() => setCopied(null), 4000);
  };

  return (
    <div className="results">
      <div className="results-notice">
        Preliminary — for coordination and takeoff. Not for construction. Not sealed. Geometry only; no
        pressures, no design loads.
      </div>

      {/* A fixed place for the zone under the pointer: sized for the usual
          case whether or not anything is in it, so pointing at a zone does
          not shove the figures below it down the panel. */}
      <div className="results-hover" data-empty={hovered ? undefined : true}>
        {hovered ? (
          <>
            <div style={{ fontWeight: 700 }}>
              {ZONE_LABELS[hovered.zoneId]} ({hovered.source}) — {hovered.area.toFixed(1)} ft²
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>{hovered.note}</div>
          </>
        ) : (
          'Hover over a zone, or tap one, for details.'
        )}
      </div>

      <h3 style={SECTION_TITLE}>Key figures</h3>
      <dl className="results-figures">
        {stepped ? (
          <>
            <dt>Roof levels</dt>
            <dd>
              {len(roof.lower.elevation)} and {len(roof.upper.elevation)}, {len(roof.heightDifference)} apart
            </dd>
            <dt>Zoned as</dt>
            <dd>
              {roof.treatment === 'separate'
                ? `Two roofs — the step is ${roof.threshold} ft or more (Fig. 3.2.2b)`
                : `One roof — the step is under ${roof.threshold} ft (Fig. 3.2.2c)`}
            </dd>
            {roof.regions.map((region) => (
              <Fragment key={region.role}>
                <dt>Height h, {region.role} roof</dt>
                <dd>
                  {len(region.h)}; edge band {len(region.dEdge)} ({region.regime.regime === 'tall' ? 'a' : '0.6h'})
                </dd>
                <dt>Zone 1&apos;, {region.role} roof</dt>
                <dd>
                  {region.regime.regime === 'tall'
                    ? 'None — Fig. 3.2.2f has no Zone 1\''
                    : `${region.hasZone1Prime ? 'Present' : 'None'} — least plan dimension ${len(region.lMin)} against 2.4h = ${len(region.wideThreshold)}`}
                </dd>
              </Fragment>
            ))}
            <dt>Wall corner width a</dt>
            <dd>
              {cornerWidth(walls)} (lower); {step && cornerWidth(step.upperWalls)} (upper)
            </dd>
            <dt>Shared wall</dt>
            <dd>{len(roof.abutment.length)}</dd>
          </>
        ) : isMonoslopeRoofResult(roof) ? (
          <>
            <dt>Corner width a</dt>
            <dd>{cornerWidth(walls)}</dd>
            <dt>Pitch band</dt>
            <dd>
              {pitchBandLabel(roof.pitchBand)} ({roof.source})
            </dd>
            <dt>High side</dt>
            <dd>
              band {len(roof.highBand)}, corner {len(roof.highCornerBand)}
            </dd>
            <dt>{roof.pitchBand === '3-10' ? 'Low side' : 'Low side and ends'}</dt>
            <dd>
              band {len(roof.lowBand)}
              {roof.pitchBand === '3-10' ? `, corner ${len(roof.lowCornerBand)}` : ''}
            </dd>
          </>
        ) : isSteepRoofResult(roof) ? (
          <>
            <dt>Corner width a</dt>
            <dd>{cornerWidth(walls)}</dd>
            <dt>Pitch band</dt>
            <dd>
              {pitchBandLabel(roof.pitchBand)} ({roof.source})
            </dd>
            <dt>Rake band</dt>
            <dd>{len(roof.rakeBand)}</dd>
            <dt>{roof.pitchBand === '7-27' ? 'Ridge' : roof.pitchBand === '45+' ? 'Peak' : 'Eave'} band</dt>
            <dd>
              {roof.pitchBand === '45+'
                ? `a drop of ${len(roof.ridgeBandDrop ?? 0)} (${len(roof.ridgeOrEaveBand)} in plan)`
                : len(roof.ridgeOrEaveBand)}
            </dd>
          </>
        ) : isTallRoofResult(roof) ? (
          <>
            <dt>Mean roof height h</dt>
            <dd>{len(roof.regime.h)}</dd>
            <dt>Roof figure</dt>
            <dd>Fig. 3.2.2f, tall building — {heightRegimeReason(roof.regime, units)}</dd>
            <dt>Roof a</dt>
            <dd>
              {len(roof.a)} — {describeBranch(roof.aGoverningBranch)}
            </dd>
            <dt>Zone 3 leg</dt>
            <dd>{len(roof.cornerLeg)} long (2a), a thick</dd>
            <dt>Wall corner width a</dt>
            <dd>{cornerWidth(walls)}</dd>
          </>
        ) : (
          <>
            <dt>Mean roof height h</dt>
            <dd>{len(roof.h)}</dd>
            <dt>Roof figure</dt>
            <dd>Fig. 3.2.2a — {heightRegimeReason(roof.regime, units)}</dd>
            <dt>Zone 1&apos;</dt>
            <dd>
              {roof.hasZone1Prime ? 'Present' : 'None'} — the least plan dimension {roof.hasZone1Prime ? 'exceeds' : 'is within'}{' '}
              2.4h = {len(roof.wideThreshold)}
            </dd>
            <dt>Wall corner width a</dt>
            <dd>{cornerWidth(walls)}</dd>
          </>
        )}
        {!stepped && (
          <>
            <dt>Least plan dimension</dt>
            <dd>{len(walls.a.lMin)}</dd>
          </>
        )}
      </dl>

      {stepped ? (
        <div className="results-note">
          {roof.hBasis === 'tallerSection' && (
            <>
              The two levels are within {roof.threshold} ft, so FM 1-28 Fig. 3.2.2c treats them as one roof — but
              the figure does not say whose <code>h</code> to use when the levels differ. The taller section&apos;s
              is used here, which gives the wider bands.{' '}
            </>
          )}
          {roof.treatment === 'separate' && (
            <>
              Each roof is zoned with its own <code>h</code>. The taller section&apos;s shared edge gets full
              perimeter and corner treatment; the lower section&apos;s is sheltered and gets none, except where
              the band wraps past the taller section&apos;s exposed corner.{' '}
            </>
          )}
          {roof.regions.some((r) => r.regime.regime === 'tall') && (
            <>
              {roof.regions
                .filter((r) => r.regime.regime === 'tall')
                .map((r) => `The ${r.role} roof`)
                .join(' and ')}{' '}
              is over Fig. 3.2.2a&apos;s height limit (60 ft, or 90 ft where the building is at least as wide as
              it is tall), so its bands take Fig. 3.2.2f&apos;s dimensions under the same free-edge rule. FM 1-28
              draws no abutting case for tall buildings, so this is an extrapolation, not a transcription.{' '}
            </>
          )}
          Each section keeps its own wall corner width. The lower section&apos;s buried wall is left out and the
          upper section&apos;s shared wall starts at the lower roof. Overhangs are not modeled where sections meet.
          {unmeasurableFields.length > 0 && (
            <>
              {' '}
              {unmeasurableFields.join(' and ')} {unmeasurableFields.length > 1 ? 'wrap' : 'wraps'} around the
              other section rather than sitting as a rectangle, so {unmeasurableFields.length > 1 ? 'they carry' : 'it carries'}{' '}
              an area only: no single width or length describes {unmeasurableFields.length > 1 ? 'them' : 'it'}.
            </>
          )}
          {(form.parapetHeight > 0 || form.stepParapetHeight > 0) && (
            <>
              {' '}
              {roof.parapetCreditsCorners
                ? 'Both sections have a parapet of 3 ft or more, so the Zone 3 corners are credited to Zone 2 (Table 3.2.2a, note 2).'
                : 'The Zone 3 to Zone 2 parapet credit needs 3 ft or more on both sections, which is not met here.'}
            </>
          )}
        </div>
      ) : isMonoslopeRoofResult(roof) ? (
        <div className="results-note">
          Overhang and parapet are not modeled for monoslope roofs. Walls are built up to the roof, so the taller
          high-side wall and the two sloped side walls are in the Zone 4 and 5 areas.
        </div>
      ) : isSteepRoofResult(roof) ? (
        <div className="results-note">
          Overhang and parapet are not modeled for gable roofs. Gable-end walls run up to the rake (Fig.{' '}
          {roof.pitchBand === '45+' ? '3.4.6b' : '3.2.2e'}), so the triangle above the eave line is in the Zone 4 and
          5 areas.
          {roof.pitchBand === '45+' && (
            <>
              {' '}
              Above 45° FM 1-28 §3.4.6 treats the roof as wall construction, so its slopes carry Zones 4 and 5 and
              the Zone 5 strip continues up the rakes (Fig. 3.4.6a). The band at the peak is dimensioned{' '}
              <code>a</code> on an elevation view; it is taken here as a vertical drop of <code>a</code>, the wider
              of the two ways that could be read.
            </>
          )}
        </div>
      ) : (
        form.parapetHeight > 0 && (
          <div className="results-note">
            {roof.parapetCreditsCorners
              ? `The ${len(form.parapetHeight)} parapet meets the 3 ft needed for the corner credit (FM 1-28 Table ${isTallRoofResult(roof) ? '3.2.2f' : '3.2.2a'}, note 2), so the corners are shown as Zone 2, not Zone 3.`
              : `The ${len(form.parapetHeight)} parapet is under the 3 ft needed for the corner credit (FM 1-28 Table ${isTallRoofResult(roof) ? '3.2.2f' : '3.2.2a'}, note 2), so the zones are unaffected.`}
          </div>
        )
      )}

      {/* A stepped building gets a table per level, under one section title;
          a plain building's single table is titled "Zone areas" itself. */}
      {tables.length > 1 && <h3 style={SECTION_TITLE}>Zone areas</h3>}
      {tables.map((table) => (
        <ZoneAreaTable
          key={table.title}
          table={table}
          standalone={tables.length === 1}
          hovered={hovered}
          colors={colors}
          units={units}
          expandedZone={expandedZone}
          onToggleZone={(zoneId) =>
            setExpandedZone(expandedZone?.table === table.title && expandedZone.zoneId === zoneId
              ? null
              : { table: table.title, zoneId })
          }
        />
      ))}

      <div className="results-actions">
        <button type="button" onClick={copyTables}>
          Copy table
        </button>
        <span role="status">
          {copied === 'done'
            ? 'Copied — paste it into a spreadsheet.'
            : copied === 'failed'
              ? 'This browser would not allow copying.'
              : lengthUnitsNote(units)}
        </span>
      </div>
    </div>
  );
}


/** Expanded-description key: a zone within one table, since a stepped building lists the same zone twice. */
interface ExpandedZone {
  table: string;
  zoneId: AnyZoneId;
}

/**
 * One roof's zones: area per zone, with the figures that describe it beneath.
 * A stepped building gets one of these per level rather than one table with
 * every figure qualified "(lower)"/"(upper)" — the heading carries the level,
 * and a takeoff is ordered per roof anyway.
 */
function ZoneAreaTable({
  table,
  standalone,
  hovered,
  colors,
  units,
  expandedZone,
  onToggleZone,
}: {
  table: ZoneTable;
  /** The only table, so its own title is the panel's section heading. */
  standalone: boolean;
  hovered: HoverInfo | null;
  colors: Record<AnyZoneId, string>;
  units: LengthUnits;
  expandedZone: ExpandedZone | null;
  onToggleZone: (zoneId: AnyZoneId) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h4 style={standalone ? SECTION_TITLE : TABLE_TITLE}>
        {table.title}
        {table.elevation !== undefined && (
          <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
            {' '}— roof at {formatLength(table.elevation, units)}
          </span>
        )}
      </h4>
      {table.areaNote && <div style={{ ...DETAIL_CELL, paddingBottom: 6 }}>{table.areaNote}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--gridline)' }}>
            <th style={{ padding: '3px 0', textAlign: 'left', fontWeight: 600 }}>Zone</th>
            <th style={{ padding: '3px 0', textAlign: 'right', fontWeight: 600 }}>Area</th>
          </tr>
        </thead>
        <tbody>
          {table.zones.map(({ zoneId, area, rows }) => {
            const expanded = expandedZone?.table === table.title && expandedZone.zoneId === zoneId;
            return (
              <Fragment key={zoneId}>
                <tr style={{ background: hovered?.zoneId === zoneId ? 'var(--surface-2)' : 'transparent' }}>
                  <td style={{ padding: '3px 0 0' }}>
                    <button
                      type="button"
                      onClick={() => onToggleZone(zoneId)}
                      aria-expanded={expanded}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        font: 'inherit',
                        color: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      <span
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: 3,
                          background: colors[zoneId],
                          flexShrink: 0,
                        }}
                      />
                      {ZONE_LABELS[zoneId]}
                    </button>
                  </td>
                  <td
                    style={{
                      padding: '3px 0 0',
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      // A five-figure area would otherwise wrap onto a second
                      // line; the zone-name column has the room to give.
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {area.toFixed(1)} ft²
                  </td>
                </tr>
                {/* One sub-row per figure — the multipliers the 3D call-outs
                    drop for space live here, in their own column. */}
                {rows.map((row, i) => (
                  <tr
                    key={row.label}
                    style={{
                      borderBottom:
                        i === rows.length - 1 && !expanded ? '1px solid var(--gridline)' : 'none',
                    }}
                  >
                    <td style={{ ...DETAIL_CELL, paddingLeft: 21 }}>
                      {row.label}
                      {row.formula && (
                        // Kept whole, dash included, so a narrow panel wraps
                        // it onto its own line instead of leaving the dash
                        // dangling at the end of the label's line.
                        <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}> — {row.formula}</span>
                      )}
                    </td>
                    <td style={{ ...DETAIL_CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {row.value}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr style={{ borderBottom: expanded ? 'none' : '1px solid var(--gridline)' }}>
                    <td colSpan={2} style={{ ...DETAIL_CELL, height: 4 }} />
                  </tr>
                )}
                {expanded && (
                  <tr style={{ borderBottom: '1px solid var(--gridline)' }}>
                    <td
                      colSpan={2}
                      style={{ padding: '0 0 6px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)' }}
                    >
                      {ZONE_DESCRIPTIONS[zoneId]}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {/* By surface rather than by zone, and ruled off from the zones. */}
        <tfoot>
          {(
            [
              ['Roof total', table.totals.roof],
              ['Wall total', table.totals.walls],
            ] as const
          ).map(([label, area]) => (
            <tr key={label}>
              <td style={{ padding: '4px 0 0', fontWeight: 600 }}>{label}</td>
              <td style={{ padding: '4px 0 0', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {area.toFixed(1)} ft²
              </td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

/** Heading over one roof's zone table — the level a stepped building's figures belong to. */
const TABLE_TITLE = {
  fontSize: 12,
  fontWeight: 600,
  margin: '0 0 4px',
};

/** Sub-row cell under a zone's area row: the figure's name/multiplier and its value. */
const DETAIL_CELL = {
  padding: '1px 0 3px',
  fontSize: 12,
  color: 'var(--text-secondary)',
};

const SECTION_TITLE = {
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  color: 'var(--text-secondary)',
  margin: '0 0 8px',
};

