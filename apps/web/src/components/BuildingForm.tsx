import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  // Kept as local text so the field can hold an intermediate state (empty,
  // a bare "-", a trailing ".") while typing. Rounding every keystroke
  // through the numeric `value` prop is what left a stuck leading zero
  // behind when the field was cleared: value snapped to 0, the input
  // re-rendered showing "0", and the next digit typed landed after it.
  const [text, setText] = useState(String(props.value));
  const lastEmitted = useRef(props.value);

  useEffect(() => {
    if (props.value !== lastEmitted.current) {
      lastEmitted.current = props.value;
      setText(String(props.value));
    }
  }, [props.value]);

  const handleChange = (raw: string) => {
    setText(raw);
    const parsed = Number(raw);
    if (raw.trim() !== '' && !Number.isNaN(parsed)) {
      lastEmitted.current = parsed;
      props.onChange(parsed);
    }
  };

  return (
    <div style={ROW_STYLE}>
      <label style={LABEL_STYLE}>{props.label}</label>
      <input
        type="number"
        style={FIELD_STYLE}
        value={text}
        min={props.min ?? 0}
        step={props.step ?? 1}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => {
          if (text.trim() === '' || Number.isNaN(Number(text))) {
            setText(String(props.value));
          }
        }}
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
