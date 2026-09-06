import type { AnyZoneId } from '../lib/zoneColors';
import { useZoneColors, ZONE_LABELS, ZONE_DESCRIPTIONS } from '../lib/zoneColors';
import type { HoverInfo } from '../lib/hoverInfo';

const ZONE_ORDER: AnyZoneId[] = ["1'", '1', '2', '3', '4', '5'];

export function ZoneLegend({ hovered }: { hovered: HoverInfo | null }) {
  const colors = useZoneColors();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {ZONE_ORDER.map((zoneId) => (
        <div
          key={zoneId}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '4px 6px',
            borderRadius: 4,
            background: hovered?.zoneId === zoneId ? 'var(--surface-2)' : 'transparent',
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              marginTop: 2,
              borderRadius: 2,
              background: colors[zoneId],
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{ZONE_LABELS[zoneId]}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ZONE_DESCRIPTIONS[zoneId]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
