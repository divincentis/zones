import { useMemo, useState } from 'react';
import { BuildingForm } from './components/BuildingForm';
import { PlanView2D } from './components/PlanView2D';
import { Scene3D } from './components/Scene3D';
import { ZoneLegend } from './components/ZoneLegend';
import { AssumptionsPanel } from './components/AssumptionsPanel';
import { computeZones, DEFAULT_FORM_STATE, type FormState } from './lib/buildModel';
import type { HoverInfo } from './lib/hoverInfo';

type ViewMode = '3d' | '2d';

export function App() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM_STATE);
  const [view, setView] = useState<ViewMode>('3d');
  const [hovered, setHovered] = useState<HoverInfo | null>(null);

  const outcome = useMemo(() => computeZones(form), [form]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 260px', height: '100%' }}>
      <aside
        style={{
          borderRight: '1px solid var(--border)',
          padding: 16,
          overflowY: 'auto',
          background: 'var(--surface-1)',
        }}
      >
        <h1 style={{ fontSize: 15, margin: '0 0 16px' }}>Wind Zone Visualizer</h1>
        <BuildingForm form={form} onChange={setForm} />
        <h3
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'var(--text-secondary)',
            margin: '20px 0 8px',
          }}
        >
          Legend
        </h3>
        <ZoneLegend hovered={hovered} />
      </aside>

      <main style={{ position: 'relative', background: 'var(--surface-0)' }}>
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1, display: 'flex', gap: 4 }}>
          {(['3d', '2d'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: view === mode ? 'var(--surface-2)' : 'var(--surface-1)',
                color: 'var(--text-primary)',
                fontWeight: view === mode ? 700 : 400,
                cursor: 'pointer',
              }}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>

        {outcome.ok ? (
          view === '3d' ? (
            <Scene3D result={outcome.result} onHover={setHovered} hovered={hovered} />
          ) : (
            <PlanView2D result={outcome.result} onHover={setHovered} hovered={hovered} />
          )
        ) : (
          <div style={{ padding: 40, color: 'var(--zone-1)', maxWidth: 480 }}>
            <h2 style={{ fontSize: 14 }}>Cannot compute zones</h2>
            <p>{outcome.error}</p>
          </div>
        )}
      </main>

      <aside
        style={{
          borderLeft: '1px solid var(--border)',
          padding: 16,
          overflowY: 'auto',
          background: 'var(--surface-1)',
        }}
      >
        {outcome.ok && <AssumptionsPanel result={outcome.result} form={form} hovered={hovered} />}
      </aside>
    </div>
  );
}
