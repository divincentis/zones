import type { CSSProperties } from 'react';
import type { ABasis } from '@zones/engine';
import type { FormState } from '../lib/buildModel';

interface Props {
  form: FormState;
  onChange: (form: FormState) => void;
}

const FIELD_STYLE: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary)',
};

const LABEL_STYLE: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

const ROW_STYLE: CSSProperties = { marginBottom: 14 };

function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={ROW_STYLE}>
      <label style={LABEL_STYLE}>{props.label}</label>
      <input
        type="number"
        style={FIELD_STYLE}
        value={props.value}
        min={props.min ?? 0}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function BuildingForm({ form, onChange }: Props) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    onChange({ ...form, [key]: value });

  return (
    <div>
      <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Building — Low-Slope Rectangle
      </h2>
      <NumberField label="Length L (ft)" value={form.length} min={1} onChange={(v) => set('length', v)} />
      <NumberField label="Width B (ft)" value={form.width} min={1} onChange={(v) => set('width', v)} />
      <NumberField label="Eave height (ft)" value={form.eaveHeight} min={0.1} onChange={(v) => set('eaveHeight', v)} />
      <NumberField label="Parapet height (ft)" value={form.parapetHeight} min={0} onChange={(v) => set('parapetHeight', v)} />
      <NumberField label="Overhang depth (ft)" value={form.overhangDepth} min={0} onChange={(v) => set('overhangDepth', v)} />

      <div style={ROW_STYLE}>
        <label style={LABEL_STYLE}>a-basis (governs L_min for non-rectangular footprints)</label>
        <select
          style={FIELD_STYLE}
          value={form.aBasis}
          onChange={(e) => set('aBasis', e.target.value as ABasis)}
        >
          <option value="boundingRect">Bounding rectangle</option>
          <option value="shortestEdge">Shortest edge</option>
          <option value="perWing">Per wing</option>
        </select>
      </div>
    </div>
  );
}
