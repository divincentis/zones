import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { RoofType } from '@zones/engine';
import { isPlainNumber, parseFeet } from '../lib/feetInches';
import { formatLength, type LengthUnits } from '../lib/lengthFormat';
import { WALL_NAMES } from '../lib/terms';
import type {
  FormState,
  MonoslopeHighSideChoice,
  RidgeAxisChoice,
  StepEdgeChoice,
} from '../lib/buildModel';

interface Props {
  form: FormState;
  onChange: (form: FormState) => void;
  units: LengthUnits;
  onUnitsChange: (units: LengthUnits) => void;
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

/** The four walls in the order the plan is read, and how each is offered in a list. */
const WALL_ORDER = ['widthNear', 'widthFar', 'lengthNear', 'lengthFar'] as const;
const WALL_OPTION_LABELS: Record<(typeof WALL_ORDER)[number], string> = {
  widthNear: `${capitalize(WALL_NAMES.widthNear)} on the plan`,
  widthFar: `${capitalize(WALL_NAMES.widthFar)} on the plan`,
  lengthNear: `${capitalize(WALL_NAMES.lengthNear)} on the plan`,
  lengthFar: `${capitalize(WALL_NAMES.lengthFar)} on the plan`,
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const FIELD_HINT_STYLE: CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 };

/**
 * A length, in feet. Takes it however it is written — 22.5, 22' 6", 22-6
 * (see parseFeet) — and hands on decimal feet, the only unit the engine
 * knows. The field keeps showing what was typed; when that is not already a
 * plain number, the line under it says what it was read as.
 */
function NumberField(props: { label: string; value: number; onChange: (v: number) => void }) {
  // Kept as local text so the field can hold an intermediate state (empty,
  // a trailing "." or "'") while typing. Rounding every keystroke through
  // the numeric `value` prop is what left a stuck leading zero behind when
  // the field was cleared: value snapped to 0, the input re-rendered showing
  // "0", and the next digit typed landed after it.
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
    const parsed = parseFeet(raw);
    if (parsed !== null) {
      lastEmitted.current = parsed;
      props.onChange(parsed);
    }
  };

  const parsed = parseFeet(text);
  const unreadable = text.trim() !== '' && parsed === null;

  return (
    <div style={ROW_STYLE}>
      <label style={LABEL_STYLE} htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        // Text, not number: a number field refuses the marks and the dash.
        type="text"
        // Still the numeric keypad on a phone, where most entries are plain
        // numbers; a keyboard with ' and " is one key away for the rest.
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={unreadable}
        style={{ ...FIELD_STYLE, borderColor: unreadable ? 'var(--zone-1)' : undefined }}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => {
          if (parsed === null) setText(String(props.value));
        }}
      />
      {parsed !== null && !isPlainNumber(text) && <div style={FIELD_HINT_STYLE}>= {round2(parsed)} ft</div>}
      {unreadable && (
        <div style={{ ...FIELD_HINT_STYLE, color: 'var(--zone-1)' }}>
          Not a length yet — try 22.5, 22&apos; 6&quot; or 22-6
        </div>
      )}
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

export function BuildingForm({ form, onChange, boardSize, onBoardSizeChange, units, onUnitsChange }: Props) {
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
        <label style={LABEL_STYLE} htmlFor="field-project-name">Project name</label>
        <input
          id="field-project-name"
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

      <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '-6px 0 10px' }}>
        Lengths take feet and inches as well as decimals: 22.5, 22&apos; 6&quot; or 22-6.
      </div>
      <NumberField label="Length L (ft)" value={form.length} onChange={(v) => set('length', v)} />
      <NumberField label="Width B (ft)" value={form.width} onChange={(v) => set('width', v)} />
      <NumberField label="Height (ft)" value={form.eaveHeight} onChange={(v) => set('eaveHeight', v)} />

      {!stepped && (
        <div style={ROW_STYLE}>
          <label style={LABEL_STYLE} htmlFor="field-roof-type">Roof type</label>
          <select
            id="field-roof-type"
            style={FIELD_STYLE}
            value={form.roofType}
            onChange={(e) => set('roofType', e.target.value as RoofType)}
          >
            <option value="flat">Flat / low-slope</option>
            <option value="gable">Gable</option>
            <option value="hip">Hip (7° or less only)</option>
            <option value="monoslope">Monoslope</option>
          </select>
        </div>
      )}

      {stepped && (
        <>
          <div style={ROW_STYLE}>
            <label style={LABEL_STYLE} htmlFor="field-attaches-to-wall">Section 2 is against the</label>
            <select
              id="field-attaches-to-wall"
              style={FIELD_STYLE}
              value={form.stepEdge}
              onChange={(e) => set('stepEdge', e.target.value as StepEdgeChoice)}
            >
              {WALL_ORDER.map((wall) => (
                <option key={wall} value={wall}>
                  {WALL_OPTION_LABELS[wall]}
                </option>
              ))}
            </select>
          </div>
          <NumberField
            label={`Section 2 — length along that wall (ft; the wall is ${round2(sharedWallLength)})`}
            value={form.stepSpan}
            onChange={(v) => set('stepSpan', v)}
          />
          <NumberField
            label="Section 2 — distance from the wall's start (ft)"
            value={form.stepOffset}
            onChange={(v) => set('stepOffset', v)}
          />
          <NumberField
            label="Section 2 — depth, out from the wall (ft)"
            value={form.stepDepth}
            onChange={(v) => set('stepDepth', v)}
          />
          <NumberField
            label="Section 2 — height (ft)"
            value={form.stepEaveHeight}
            onChange={(v) => set('stepEaveHeight', v)}
          />
          <NumberField
            label="Parapet height — section 1 (ft)"
            value={form.parapetHeight}
            onChange={(v) => set('parapetHeight', v)}
          />
          <NumberField
            label="Parapet height — section 2 (ft)"
            value={form.stepParapetHeight}
            onChange={(v) => set('stepParapetHeight', v)}
          />
          <div style={{ ...NOTE_STYLE, marginBottom: 14 }}>
            The two roofs are{' '}
            <strong>{formatLength(Math.abs(form.stepEaveHeight - form.eaveHeight), units)}</strong> apart, so they
            are zoned as{' '}
            {Math.abs(form.stepEaveHeight - form.eaveHeight) >= 10
              ? 'two separate roofs (10 ft or more: Fig. 3.2.2b)'
              : 'one roof over the whole footprint (under 10 ft: Fig. 3.2.2c)'}
            . Both sections are flat: FM 1-28 has no figure for a pitched roof where sections meet. The sections
            have to share a length of wall, and overhangs are not modeled there.
          </div>
        </>
      )}

      {hasRidge && (
        <>
          <PitchField pitchDegrees={form.pitchDegrees} onChange={(v) => set('pitchDegrees', v)} />
          <div style={ROW_STYLE}>
            <label style={LABEL_STYLE} htmlFor="field-ridge-orientation">Ridge runs</label>
            <select
              id="field-ridge-orientation"
              style={FIELD_STYLE}
              value={form.ridgeAlong}
              onChange={(e) => set('ridgeAlong', e.target.value as RidgeAxisChoice)}
            >
              <option value="length">Along the length</option>
              <option value="width">Along the width</option>
            </select>
          </div>
          <div style={{ ...NOTE_STYLE, marginBottom: 14 }}>
            {form.roofType === 'hip'
              ? 'FM 1-28 has no figure for hip roofs, so one can only be zoned at 7° or less, where it is treated as low-slope.'
              : 'At 7° or less a gable is zoned as low-slope. Above 45° it is zoned as wall construction, Zones 4 and 5 (FM 1-28 §3.4.6).'}{' '}
            Parapets and overhangs are not modeled on pitched roofs.
          </div>
        </>
      )}

      {isMonoslope && (
        <>
          <PitchField pitchDegrees={form.pitchDegrees} onChange={(v) => set('pitchDegrees', v)} />
          <div style={ROW_STYLE}>
            <label style={LABEL_STYLE} htmlFor="field-high-side">High side is the</label>
            <select
              id="field-high-side"
              style={FIELD_STYLE}
              value={form.monoslopeHighSide}
              onChange={(e) => set('monoslopeHighSide', e.target.value as MonoslopeHighSideChoice)}
            >
              {WALL_ORDER.map((wall) => (
                <option key={wall} value={wall}>
                  {WALL_OPTION_LABELS[wall]}
                </option>
              ))}
            </select>
          </div>
          <div style={{ ...NOTE_STYLE, marginBottom: 14 }}>
            At 3° or less a monoslope is zoned as low-slope; from there to 30° it has its own figures (FM 1-28
            Fig. 3.4.1a/b), and steeper than 30° it cannot be zoned. Parapets and overhangs are not modeled on
            pitched roofs.
          </div>
        </>
      )}

      {isFlat && (
        <>
          <NumberField label="Parapet height (ft)" value={form.parapetHeight} onChange={(v) => set('parapetHeight', v)} />
          <NumberField label="Overhang depth (ft)" value={form.overhangDepth} onChange={(v) => set('overhangDepth', v)} />
        </>
      )}

      <div style={{ ...ROW_STYLE, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={boardSize !== null}
            onChange={(e) => onBoardSizeChange(e.target.checked ? 4 : null)}
          />
          <span style={{ fontSize: 12 }}>Round roof bands up to whole boards</span>
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
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>ft wide</span>
          </>
        )}
      </div>

      <div style={ROW_STYLE}>
        <label style={LABEL_STYLE} htmlFor="field-units">
          Show lengths in
        </label>
        <select
          id="field-units"
          style={FIELD_STYLE}
          value={units}
          onChange={(e) => onUnitsChange(e.target.value as LengthUnits)}
        >
          <option value="feetInches">Feet and inches</option>
          <option value="decimal">Decimal feet</option>
        </select>
      </div>
    </div>
  );
}

const NOTE_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary)',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: 8,
  lineHeight: 1.4,
};
