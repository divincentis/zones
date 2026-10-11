import { useEffect, useState } from 'react';

export type AnyZoneId = '1' | "1'" | '2' | '3' | '4' | '5';

export const ZONE_LABELS: Record<AnyZoneId, string> = {
  "1'": "Zone 1'",
  '1': 'Zone 1',
  '2': 'Zone 2',
  '3': 'Zone 3',
  '4': 'Zone 4',
  '5': 'Zone 5',
};

export const ZONE_DESCRIPTIONS: Record<AnyZoneId, string> = {
  "1'": 'Roof field (wide buildings only) — beyond 1.2h, or the ridge-adjacent far field',
  '1': 'Roof field',
  '2': 'Roof perimeter / near-ridge or near-rake band',
  '3': 'Roof corner — L-shaped (low-slope and tall buildings) or ridge/eave corner (steep)',
  '4': 'Wall field — and the field of a roof steeper than 45°, which is zoned as wall',
  '5': 'Wall corner strip, width a, full height — carried up the rakes and across the peak on a roof steeper than 45°',
};

const CSS_VAR_BY_ZONE: Record<AnyZoneId, string> = {
  "1'": '--zone-1prime',
  '1': '--zone-1',
  '2': '--zone-2',
  '3': '--zone-3',
  '4': '--zone-4',
  '5': '--zone-5',
};

/** Zone hex colors read from the page's current CSS custom properties (theme.css), light or dark. */
export function readZoneHexes(): Record<AnyZoneId, string> {
  const style = getComputedStyle(document.documentElement);
  const entries = (Object.keys(CSS_VAR_BY_ZONE) as AnyZoneId[]).map((zoneId) => [
    zoneId,
    style.getPropertyValue(CSS_VAR_BY_ZONE[zoneId]).trim() || '#999999',
  ]);
  return Object.fromEntries(entries) as Record<AnyZoneId, string>;
}

/** Zone hex colors, re-read whenever the OS color scheme flips. */
export function useZoneColors(): Record<AnyZoneId, string> {
  const [colors, setColors] = useState<Record<AnyZoneId, string>>(() =>
    typeof document !== 'undefined'
      ? readZoneHexes()
      : ({} as Record<AnyZoneId, string>)
  );

  useEffect(() => {
    setColors(readZoneHexes());
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setColors(readZoneHexes());
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return colors;
}
