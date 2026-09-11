import { Fragment, useState } from 'react';
import {
  isMonoslopeRoofResult,
  isSteepRoofResult,
  isSteppedRoofResult,
  type ComputationResult,
  type FormState,
} from '../lib/buildModel';
import type { HoverInfo } from '../lib/hoverInfo';
import { computeZoneWidths } from '../lib/zoneWidths';
import { ZONE_LABELS, ZONE_DESCRIPTIONS, useZoneColors, type AnyZoneId } from '../lib/zoneColors';

interface Props {
  result: ComputationResult;
  form: FormState;
  hovered: HoverInfo | null;
  /** Board width (ft) to round zone widths up to for takeoff. null = off. */
  boardSize: number | null;
}

function zoneAreas(result: ComputationResult): Array<{ zoneId: AnyZoneId; area: number }> {
  const ids: AnyZoneId[] = ["1'", '1', '2', '3', '4', '5'];
  // Wall areas cover both sections of a stepped building; roof pieces already
  // do, since the stepped algorithm zones both levels in one pass.
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

export function AssumptionsPanel({ result, form, hovered, boardSize }: Props) {
  const { roof, walls, step } = result;
  const areas = zoneAreas(result);
  const stepped = isSteppedRoofResult(roof);
  const widths = computeZoneWidths(result, boardSize ?? undefined);
  const hasLegLength = areas.some(({ zoneId }) => widths[zoneId]?.legLength !== undefined);
  const colors = useZoneColors();
  const [expandedZone, setExpandedZone] = useState<AnyZoneId | null>(null);

  return (
    <div style={{ fontSize: 12 }}>
      <div
        style={{
          background: 'var(--zone-3)',
          color: '#1a1300',
          padding: '8px 10px',
          borderRadius: 4,
          fontWeight: 600,
          marginBottom: 12,
          fontSize: 11,
          lineHeight: 1.4,
        }}
      >
        Preliminary — for coordination and takeoff. Not for construction. Not sealed.
        Geometry only; no pressures, no design loads.
      </div>

      {hovered ? (
        <div style={{ marginBottom: 14, padding: 8, borderRadius: 4, border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700 }}>
            {ZONE_LABELS[hovered.zoneId]} ({hovered.source})
          </div>
          <div>Area: {hovered.area.toFixed(1)} ft²</div>
          <div style={{ color: 'var(--text-secondary)' }}>{hovered.note}</div>
        </div>
      ) : (
        <div style={{ marginBottom: 14, color: 'var(--text-muted)' }}>Hover a zone for details.</div>
      )}

      <h3 style={SECTION_TITLE}>Derived parameters</h3>
      <dl style={DL_STYLE}>
        <dt>a (wall zones{isSteepRoofResult(roof) || isMonoslopeRoofResult(roof) ? ' + roof bands' : ''})</dt>
        <dd>
          {walls.a.a.toFixed(2)} ft — {walls.a.governingBranch}
          {step && ` (lower); ${step.upperWalls.a.a.toFixed(2)} ft — ${step.upperWalls.a.governingBranch} (upper)`}
        </dd>
        <dt>L_min</dt>
        <dd>
          {walls.a.lMin.toFixed(2)} ft ({form.aBasis})
          {step && ` / ${step.upperWalls.a.lMin.toFixed(2)} ft (upper)`}
        </dd>
        {stepped ? (
          <>
            <dt>Roof elevation step</dt>
            <dd>
              {roof.heightDifference.toFixed(2)} ft ({roof.lower.elevation.toFixed(1)} →{' '}
              {roof.upper.elevation.toFixed(1)} ft)
            </dd>
            <dt>Treatment</dt>
            <dd>
              {roof.treatment === 'separate'
                ? `Two roofs (>= ${roof.threshold} ft) — Fig. 3.2.2b`
                : `One roof over the union (< ${roof.threshold} ft) — Fig. 3.2.2c`}
            </dd>
            {roof.regions.map((region) => (
              <Fragment key={region.role}>
                <dt>
                  h ({region.role}), 0.6h
                </dt>
                <dd>
                  {region.h.toFixed(2)} ft, band {region.dEdge.toFixed(2)} ft
                </dd>
                <dt>Zone 1' ({region.role})</dt>
                <dd>
                  {region.hasZone1Prime ? 'Applies' : 'Does not apply'} (L_min{' '}
                  {region.lMin.toFixed(1)} ft {'>'} 2.4h = {region.wideThreshold.toFixed(2)} ft)
                </dd>
              </Fragment>
            ))}
            <dt>Shared wall</dt>
            <dd>{roof.abutment.length.toFixed(2)} ft long</dd>
          </>
        ) : isMonoslopeRoofResult(roof) ? (
          <>
            <dt>Pitch band</dt>
            <dd>{roof.pitchBand}° ({roof.source})</dd>
            <dt>High band / corner</dt>
            <dd>{roof.highBand.toFixed(2)} ft / {roof.highCornerBand.toFixed(2)} ft</dd>
            <dt>{roof.pitchBand === '3-10' ? 'Low band / corner' : 'Wrap band (low + sides)'}</dt>
            <dd>
              {roof.lowBand.toFixed(2)} ft
              {roof.pitchBand === '3-10' ? ` / ${roof.lowCornerBand.toFixed(2)} ft` : ''}
            </dd>
          </>
        ) : isSteepRoofResult(roof) ? (
          <>
            <dt>Pitch band</dt>
            <dd>{roof.pitchBand}° ({roof.source})</dd>
            <dt>Rake band</dt>
            <dd>{roof.rakeBand.toFixed(2)} ft</dd>
            <dt>{roof.pitchBand === '7-27' ? 'Ridge' : 'Eave'} band</dt>
            <dd>{roof.ridgeOrEaveBand.toFixed(2)} ft</dd>
          </>
        ) : (
          <>
            <dt>h (roof mean height)</dt>
            <dd>{roof.h.toFixed(2)} ft</dd>
            <dt>Zone 1' threshold</dt>
            <dd>
              {roof.hasZone1Prime ? 'Applies' : 'Does not apply'} (L_min {'>'} 2.4h ={' '}
              {roof.wideThreshold.toFixed(2)} ft)
            </dd>
          </>
        )}
      </dl>

      {stepped ? (
        <div style={{ ...NOTE_STYLE, marginBottom: 12 }}>
          {roof.hBasis === 'tallerSection' && (
            <>
              The two levels are within {roof.threshold} ft, so FM 1-28 Fig. 3.2.2c treats them as
              one roof — but the figure does not say whose <code>h</code> to use when the levels
              differ. The taller section's is used here (conservative: wider bands).{' '}
            </>
          )}
          {roof.treatment === 'separate' && (
            <>
              Each roof is zoned with its own <code>h</code>. The taller section's abutting edge
              gets full perimeter and corner treatment per the Table 3.2.2a note; the lower
              section's is sheltered and gets none, except where the band wraps 0.6h past the
              taller section's exposed corner.{' '}
            </>
          )}
          Wall zones keep each section's own <code>a</code>; the lower section's buried wall is
          excluded and the upper section's shared wall starts at the lower roof. Overhangs are not
          modeled at an abutment — see scope doc §10.7.
          {(form.parapetHeight > 0 || form.stepParapetHeight > 0) && (
            <>
              {' '}
              {roof.parapetCreditsCorners
                ? 'Both sections carry a parapet of at least 3 ft, so Zone 3 corner areas are credited to Zone 2 (Table 3.2.2a, note 2).'
                : 'The Zone 3→Zone 2 parapet credit needs at least 3 ft on both sections — not met here, so zone geometry is unaffected.'}
            </>
          )}
        </div>
      ) : isMonoslopeRoofResult(roof) ? (
        <div style={{ ...NOTE_STYLE, marginBottom: 12 }}>
          Overhang and parapet are not yet modeled for monoslope roofs. Wall zones use a uniform
          eave height on all four walls — see scope doc §10.5.
        </div>
      ) : isSteepRoofResult(roof) ? (
        <div style={{ ...NOTE_STYLE, marginBottom: 12 }}>
          Overhang and parapet are not yet modeled for gable roofs — see scope doc §10.1.
        </div>
      ) : (
        form.parapetHeight > 0 && (
          <div style={{ ...NOTE_STYLE, marginBottom: 12 }}>
            {roof.parapetCreditsCorners
              ? `Parapet height (${form.parapetHeight} ft) meets the 3 ft threshold for the Zone 3→Zone 2 corner credit (FM 1-28 Table 3.2.2a, note 2) — corner areas shown here are Zone 2, not Zone 3.`
              : `Parapet height (${form.parapetHeight} ft) is below the 3 ft threshold for the Zone 3→Zone 2 corner credit (FM 1-28 Table 3.2.2a, note 2) — zone geometry unaffected.`}
          </div>
        )
      )}

      <h3 style={SECTION_TITLE}>Zone areas</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--gridline)' }}>
            <th style={{ padding: '3px 0', textAlign: 'left', fontWeight: 600 }}>Zone</th>
            <th style={{ padding: '3px 0', textAlign: 'right', fontWeight: 600 }}>Area</th>
          </tr>
        </thead>
        <tbody>
          {areas.map(({ zoneId, area }) => {
            const width = widths[zoneId];
            const detailParts = [
              width?.width && `Width ${width.width}`,
              hasLegLength && width?.legLength && `Leg length ${width.legLength}`,
            ].filter(Boolean);
            const expanded = expandedZone === zoneId;
            return (
              <Fragment key={zoneId}>
                <tr style={{ background: hovered?.zoneId === zoneId ? 'var(--surface-2)' : 'transparent' }}>
                  <td style={{ padding: '3px 0 0' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedZone(expanded ? null : zoneId)}
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
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: colors[zoneId],
                          flexShrink: 0,
                        }}
                      />
                      {ZONE_LABELS[zoneId]}
                    </button>
                  </td>
                  <td style={{ padding: '3px 0 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {area.toFixed(1)} ft²
                  </td>
                </tr>
                <tr style={{ borderBottom: expanded ? 'none' : '1px solid var(--gridline)' }}>
                  <td
                    colSpan={2}
                    style={{
                      padding: '1px 0 4px 16px',
                      textAlign: 'right',
                      fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {detailParts.length > 0 ? detailParts.join(' · ') : ' '}
                  </td>
                </tr>
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
      </table>

      <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-muted)' }}>
        Sources: roof zones —{' '}
        {isSteepRoofResult(roof) || isMonoslopeRoofResult(roof) || stepped
          ? roof.source
          : 'FM Global 1-28 Fig 3.2.2a'}
        .
        Wall zones — a-parameter formula. See scope doc Addendum §10.
      </div>
    </div>
  );
}

const SECTION_TITLE = {
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  color: 'var(--text-secondary)',
  margin: '0 0 8px',
};

const DL_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'auto auto',
  columnGap: 10,
  rowGap: 4,
  margin: '0 0 14px',
};

const NOTE_STYLE = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: 8,
};
