import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { ABasis, RoofType } from '@zones/engine';
import type {
  FormState,
  MonoslopeHighSideChoice,
  RidgeAxisChoice,
  StepEdgeChoice,
} from '../lib/buildModel';

interface Props {
  form: FormState;
  onChange: (form: FormState) => void;
  /** Board width (ft) to round zone widths up to for takeoff. null = off. */
  boardSize: number | null;
  onBoardSizeChange: (boardSize: number | null) => void;
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
  // Ties the label to the field, so touching the label focuses it — on a
  // phone the label is a far bigger target than the box under it.
  const id = useId();

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
      <label style={LABEL_STYLE} htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        type="number"
        // Brings up the numeric keypad with a decimal point on a phone.
        inputMode="decimal"
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

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function degreesToRise12(deg: number): number {
  return Math.tan((deg * Math.PI) / 180) * 12;
}

function rise12ToDegrees(rise: number): number {
  return (Math.atan(rise / 12) * 180) / Math.PI;
}

/**
 * Roof pitch, editable as either degrees or a rise:12 ratio — whichever the
 * user is more comfortable with. `pitchDegrees` stays the one canonical
 * value (engine only ever reads degrees); the other field is just a synced
 * display of the same angle, recomputed whenever the canonical value
 * changes from outside (including from typing in the other field).
 */
function PitchField({ pitchDegrees, onChange }: { pitchDegrees: number; onChange: (v: number) => void }) {
  const [degText, setDegText] = useState(String(round2(pitchDegrees)));
  const [riseText, setRiseText] = useState(String(round2(degreesToRise12(pitchDegrees))));
  const lastEmitted = useRef(pitchDegrees);

  useEffect(() => {
    if (pitchDegrees !== lastEmitted.current) {
      lastEmitted.current = pitchDegrees;
      setDegText(String(round2(pitchDegrees)));
      setRiseText(String(round2(degreesToRise12(pitchDegrees))));
    }
  }, [pitchDegrees]);

  const handleDeg = (raw: string) => {
    setDegText(raw);
    const parsed = Number(raw);
    if (raw.trim() !== '' && !Number.isNaN(parsed)) {
      lastEmitted.current = parsed;
      setRiseText(String(round2(degreesToRise12(parsed))));
      onChange(parsed);
    }
  };

  const handleRise = (raw: string) => {
    setRiseText(raw);
    const parsed = Number(raw);
    if (raw.trim() !== '' && !Number.isNaN(parsed)) {
      const deg = rise12ToDegrees(parsed);
      lastEmitted.current = deg;
      setDegText(String(round2(deg)));
      onChange(deg);
    }
  };

  return (
    <div style={ROW_STYLE}>
      <label style={LABEL_STYLE}>Roof pitch</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <input
            type="number"
            style={FIELD_STYLE}
            value={degText}
            min={0}
            step={1}
            onChange={(e) => handleDeg(e.target.value)}
            onBlur={() => {
              if (degText.trim() === '' || Number.isNaN(Number(degText))) setDegText(String(round2(pitchDegrees)));
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>degrees</div>
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="number"
            style={FIELD_STYLE}
            value={riseText}
            min={0}
            step={0.25}
            onChange={(e) => handleRise(e.target.value)}
            onBlur={() => {
              if (riseText.trim() === '' || Number.isNaN(Number(riseText)))
                setRiseText(String(round2(degreesToRise12(pitchDegrees))));
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>rise : 12</div>
        </div>
      </div>
    </div>
  );
}

export function BuildingForm({ form, onChange, boardSize, onBoardSizeChange }: Props) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    onChange({ ...form, [key]: value });

  const stepped = form.stepEnabled;
  const hasRidge = !stepped && (form.roofType === 'gable' || form.roofType === 'hip');
  const isMonoslope = !stepped && form.roofType === 'monoslope';
  const isFlat = !stepped && form.roofType === 'flat';

  // Along which of the primary rectangle's own dimensions the shared wall
  // runs — the step's span and offset are measured along that wall.
  const sharedWallLength =
    form.stepEdge === 'widthFar' || form.stepEdge === 'widthNear' ? form.width : form.length;

  return (
    <div>
      <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Building — {stepped ? 'Stepped (two sections)' : 'Rectangle'}
      </h2>
      <div style={ROW_STYLE}>
        <label style={LABEL_STYLE}>Project name</label>
        <input
          type="text"
          style={FIELD_STYLE}
          value={form.projectName}
          placeholder="Untitled project"
          onChange={(e) => set('projectName', e.target.value)}
        />
      </div>

      <div style={{ ...ROW_STYLE, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id="stepped"
          type="checkbox"
          checked={stepped}
          onChange={(e) =>
            // FM 1-28 Fig. 3.2.2b/c are drawn for "adjoining low-sloped
            // roofs" only, so turning a step on pins both sections flat
            // rather than collecting a pitch the engine would reject.
            onChange({ ...form, stepEnabled: e.target.checked, roofType: 'flat' })
          }
        />
        <label htmlFor="stepped" style={{ ...LABEL_STYLE, margin: 0, cursor: 'pointer' }}>
          Stepped building (second section at a different roof level)
        </label>
      </div>

      <NumberField label="Length L (ft)" value={form.length} min={1} onChange={(v) => set('length', v)} />
      <NumberField label="Width B (ft)" value={form.width} min={1} onChange={(v) => set('width', v)} />
      <NumberField label="Height (ft)" value={form.eaveHeight} min={0.1} onChange={(v) => set('eaveHeight', v)} />

      {!stepped && (
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
      )}

      {stepped && (
        <>
          <div style={ROW_STYLE}>
            <label style={LABEL_STYLE}>Attaches to wall</label>
            <select
              style={FIELD_STYLE}
              value={form.stepEdge}
              onChange={(e) => set('stepEdge', e.target.value as StepEdgeChoice)}
            >
              <option value="widthFar">Width wall @ L = length</option>
              <option value="widthNear">Width wall @ L = 0</option>
              <option value="lengthFar">Length wall @ B = width</option>
              <option value="lengthNear">Length wall @ B = 0</option>
            </select>
          </div>
          <NumberField
            label={`Section 2 — along shared wall (ft, max ${round2(sharedWallLength)})`}
            value={form.stepSpan}
            min={1}
            onChange={(v) => set('stepSpan', v)}
          />
          <NumberField
            label="Section 2 — offset along that wall (ft)"
            value={form.stepOffset}
            min={0}
            onChange={(v) => set('stepOffset', v)}
          />
          <NumberField
            label="Section 2 — depth out from the wall (ft)"
            value={form.stepDepth}
            min={1}
            onChange={(v) => set('stepDepth', v)}
          />
          <NumberField
            label="Section 2 — height (ft)"
            value={form.stepEaveHeight}
            min={0.1}
            onChange={(v) => set('stepEaveHeight', v)}
          />
          <NumberField
            label="Parapet height — section 1 (ft)"
            value={form.parapetHeight}
            min={0}
            onChange={(v) => set('parapetHeight', v)}
          />
          <NumberField
            label="Parapet height — section 2 (ft)"
            value={form.stepParapetHeight}
            min={0}
            onChange={(v) => set('stepParapetHeight', v)}
          />
          <div style={{ ...NOTE_STYLE, marginBottom: 14 }}>
            Both sections are flat / low-slope — FM 1-28 Fig. 3.2.2b/c cover &ldquo;adjoining
            low-sloped roofs&rdquo; only, and no reviewed figure covers a pitched roof at an
            abutment. A roof-level difference of{' '}
            <strong>{Math.abs(form.stepEaveHeight - form.eaveHeight).toFixed(1)} ft</strong> means
            the two are zoned as{' '}
            {Math.abs(form.stepEaveHeight - form.eaveHeight) >= 10
              ? 'two separate roofs (Fig. 3.2.2b)'
              : 'one roof over the combined footprint (Fig. 3.2.2c)'}
            . The sections must actually touch: any horizontal separation, a corner-only touch, or
            an overlap in plan is reported as an error rather than computed past. Overhangs
            aren&apos;t modeled at an abutment.
          </div>
        </>
      )}

      {hasRidge && (
        <>
          <PitchField pitchDegrees={form.pitchDegrees} onChange={(v) => set('pitchDegrees', v)} />
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
              ? ' Above 45° the roof is zoned as wall construction, Zones 4 and 5 (FM 1-28 §3.4.6).'
              : ' Roof-zone geometry for hip roofs has no sourced figure yet (unlike gable — see scope doc §10.1/§10.3), so computing this building will show an error above 7°; wall zones and mean roof height are still correct.'}
          </div>
        </>
      )}

      {isMonoslope && (
        <>
          <PitchField pitchDegrees={form.pitchDegrees} onChange={(v) => set('pitchDegrees', v)} />
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
            figure).
          </div>
        </>
      )}

      {isFlat && (
        <>
          <NumberField label="Parapet height (ft)" value={form.parapetHeight} min={0} onChange={(v) => set('parapetHeight', v)} />
          <NumberField label="Overhang depth (ft)" value={form.overhangDepth} min={0} onChange={(v) => set('overhangDepth', v)} />
        </>
      )}

      <div style={{ ...ROW_STYLE, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={boardSize !== null}
            onChange={(e) => onBoardSizeChange(e.target.checked ? 4 : null)}
          />
          <span style={{ fontSize: 12 }}>Round zone widths up to boards</span>
        </label>
        {boardSize !== null && (
          <>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={boardSize}
              onChange={(e) => {
                const v = Number(e.target.value);
                onBoardSizeChange(v > 0 ? v : boardSize);
              }}
              style={{
                width: 48,
                padding: '4px 6px',
                background: 'var(--surface-2)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 3,
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>ft</span>
          </>
        )}
      </div>

      <details style={{ ...NOTE_STYLE, marginBottom: 14 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Advanced: corner-dimension basis
        </summary>
        <div style={{ marginTop: 8 }}>
          <p style={{ margin: '0 0 8px' }}>
            This building is always modeled as a rectangle, so the choices below give the exact
            same result — they only matter for non-rectangular building shapes, which this tool
            doesn&apos;t support yet. It&apos;s safe to leave this on the default.
          </p>
          <select
            style={FIELD_STYLE}
            value={form.aBasis}
            onChange={(e) => set('aBasis', e.target.value as ABasis)}
          >
            <option value="boundingRect">Bounding rectangle (default)</option>
            <option value="shortestEdge">Shortest edge</option>
            <option value="perWing">Per wing</option>
          </select>
        </div>
      </details>
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
