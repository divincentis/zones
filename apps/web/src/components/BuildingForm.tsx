import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ABasis, RoofType } from '@zones/engine';
import type { FormState, MonoslopeHighSideChoice, RidgeAxisChoice } from '../lib/buildModel';

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

  const hasRidge = form.roofType === 'gable' || form.roofType === 'hip';
  const isMonoslope = form.roofType === 'monoslope';
  const isFlat = form.roofType === 'flat';

  return (
    <div>
      <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Building — Rectangle
      </h2>
      <NumberField label="Length L (ft)" value={form.length} min={1} onChange={(v) => set('length', v)} />
      <NumberField label="Width B (ft)" value={form.width} min={1} onChange={(v) => set('width', v)} />
      <NumberField label="Eave height (ft)" value={form.eaveHeight} min={0.1} onChange={(v) => set('eaveHeight', v)} />

      <div style={ROW_STYLE}>
        <label style={LABEL_STYLE}>Roof type</label>
        <select
          style={FIELD_STYLE}
          value={form.roofType}
          onChange={(e) => set('roofType', e.target.value as RoofType)}
        >
          <option value="flat">Flat / low-slope (θ ≤ 7°)</option>
          <option value="gable">Gable</option>
          <option value="hip">Hip</option>
          <option value="monoslope">Monoslope</option>
        </select>
      </div>

      {hasRidge && (
        <>
          <NumberField
            label="Roof pitch (degrees)"
            value={form.pitchDegrees}
            min={0}
            step={1}
            onChange={(v) => set('pitchDegrees', v)}
          />
          <div style={ROW_STYLE}>
            <label style={LABEL_STYLE}>Ridge orientation</label>
            <select
              style={FIELD_STYLE}
              value={form.ridgeAlong}
              onChange={(e) => set('ridgeAlong', e.target.value as RidgeAxisChoice)}
            >
              <option value="length">Ridge runs along Length ({form.roofType} ends on the B walls)</option>
              <option value="width">Ridge runs along Width ({form.roofType} ends on the L walls)</option>
            </select>
          </div>
          <div style={{ ...NOTE_STYLE, marginBottom: 14 }}>
            Overhang and parapet are not yet modeled for {form.roofType} roofs, so those inputs
            are hidden here. Pitch ≤ 7° falls back to the flat/low-slope algorithm automatically.
            {form.roofType === 'gable'
              ? ' Above 45° is out of scope (no source figure yet).'
              : ' Roof-zone geometry for hip roofs has no sourced figure yet (unlike gable — see scope doc §10.1/§10.3), so computing this building will show an error above 7°; wall zones and mean roof height are still correct.'}
          </div>
        </>
      )}

      {isMonoslope && (
        <>
          <NumberField
            label="Roof pitch (degrees)"
            value={form.pitchDegrees}
            min={0}
            step={1}
            onChange={(v) => set('pitchDegrees', v)}
          />
          <div style={ROW_STYLE}>
            <label style={LABEL_STYLE}>High side</label>
            <select
              style={FIELD_STYLE}
              value={form.monoslopeHighSide}
              onChange={(e) => set('monoslopeHighSide', e.target.value as MonoslopeHighSideChoice)}
            >
              <option value="lengthNear">High along Length @ B=0</option>
              <option value="lengthFar">High along Length @ B=width</option>
              <option value="widthNear">High along Width @ L=0</option>
              <option value="widthFar">High along Width @ L=length</option>
            </select>
          </div>
          <div style={{ ...NOTE_STYLE, marginBottom: 14 }}>
            Overhang and parapet are not yet modeled for monoslope roofs, so those inputs are
            hidden here. Pitch ≤ 3° falls back to the flat/low-slope algorithm automatically
            (FM 1-28 §3.4.1.A). 3°–30° uses Fig. 3.4.1a/b. Above 30° is out of scope (no source
            figure). Wall zones use a uniform eave height on all four walls — the true high-edge
            wall and sloped side walls aren&apos;t modeled there yet, only in the 3D envelope shown.
          </div>
        </>
      )}

      {isFlat && (
        <>
          <NumberField label="Parapet height (ft)" value={form.parapetHeight} min={0} onChange={(v) => set('parapetHeight', v)} />
          <NumberField label="Overhang depth (ft)" value={form.overhangDepth} min={0} onChange={(v) => set('overhangDepth', v)} />
        </>
      )}

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

const NOTE_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: 8,
  lineHeight: 1.4,
};
