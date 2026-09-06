import type { ComputationResult, FormState } from '../lib/buildModel';
import type { HoverInfo } from '../lib/hoverInfo';
import { ZONE_LABELS, type AnyZoneId } from '../lib/zoneColors';

interface Props {
  result: ComputationResult;
  form: FormState;
  hovered: HoverInfo | null;
}

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

export function AssumptionsPanel({ result, form, hovered }: Props) {
  const { roof, walls } = result;
  const areas = zoneAreas(result);

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
        <dt>a (wall zones)</dt>
        <dd>
          {walls.a.a.toFixed(2)} ft — {walls.a.governingBranch}
        </dd>
        <dt>L_min</dt>
        <dd>
          {walls.a.lMin.toFixed(2)} ft ({form.aBasis})
        </dd>
        <dt>h (roof mean height)</dt>
        <dd>{roof.h.toFixed(2)} ft</dd>
        <dt>Zone 1' threshold</dt>
        <dd>
          {roof.hasZone1Prime ? 'Applies' : 'Does not apply'} (L_min {'>'} 2.4h ={' '}
          {roof.wideThreshold.toFixed(2)} ft)
        </dd>
      </dl>

      {form.parapetHeight > 0 && (
        <div style={{ ...NOTE_STYLE, marginBottom: 12 }}>
          Parapet height ({form.parapetHeight} ft) is recorded but not yet applied to zone
          geometry — see scope doc §3.3.
        </div>
      )}

      <h3 style={SECTION_TITLE}>Zone areas</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {areas.map(({ zoneId, area }) => (
            <tr key={zoneId} style={{ borderBottom: '1px solid var(--gridline)' }}>
              <td style={{ padding: '3px 0' }}>{ZONE_LABELS[zoneId]}</td>
              <td style={{ padding: '3px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {area.toFixed(1)} ft²
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-muted)' }}>
        Sources: roof zones — FM Global 1-28 Fig. 3.2.2a. Wall zones — a-parameter formula.
        See scope doc Addendum §10.
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
