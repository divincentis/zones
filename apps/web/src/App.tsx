import { useEffect, useMemo, useState } from 'react';
import { BuildingForm } from './components/BuildingForm';
import { PlanView2D } from './components/PlanView2D';
import { Scene3D } from './components/Scene3D';
import { AssumptionsPanel } from './components/AssumptionsPanel';
import { DisclaimerModal } from './components/DisclaimerModal';
import { ProjectBar } from './components/ProjectBar';
import { computeZones, type FormState } from './lib/buildModel';
import type { HoverInfo } from './lib/hoverInfo';
import { exportZonePdf } from './lib/pdfExport';
import type { Project } from './lib/project';
import { clearLinkFromAddress, loadInitialProject, writeAutosave } from './lib/projectStorage';
import { ZONE_LABELS } from './lib/zoneColors';
import { APP_VERSION } from './version';

type ViewMode = '3d' | '2d';

/**
 * The three panels. Side by side on a wide screen; on a phone only one is
 * shown at a time, picked from the tab bar. Which one is "active" is always
 * tracked, and it is the stylesheet (theme.css, "Layout") that decides
 * whether that hides the others — so nothing here asks how wide the screen is.
 */
type Panel = 'inputs' | 'view' | 'results';

const PANEL_LABELS: Record<Panel, string> = {
  inputs: 'Building',
  view: 'View',
  results: 'Zones',
};

export function App() {
  // Where the building came from is settled once, as the page opens: a
  // followed link, else what was here last time, else the default.
  const [initial] = useState(loadInitialProject);
  const [form, setForm] = useState<FormState>(initial.project.form);
  const [view, setView] = useState<ViewMode>('3d');
  const [panel, setPanel] = useState<Panel>('view');
  const [hovered, setHovered] = useState<HoverInfo | null>(null);
  /**
   * The last zone pointed at, kept after the pointer leaves. A finger has no
   * hover: it touches a zone and lifts, and on a phone the panel that would
   * have described the zone is on another tab. The view shows this instead.
   */
  const [touched, setTouched] = useState<HoverInfo | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  /** Board width (ft) to round zone widths up to for takeoff, e.g. 4 or 8 ft. null = off. */
  const [boardSize, setBoardSize] = useState<number | null>(initial.project.boardSize);
  const [disclaimerAcknowledged, setDisclaimerAcknowledged] = useState(false);

  const outcome = useMemo(() => computeZones(form, boardSize ?? undefined), [form, boardSize]);

  useEffect(() => {
    if (initial.hadLink) clearLinkFromAddress();
  }, [initial]);

  // Kept in the browser as it is typed, so a reload or a closed tab loses
  // nothing. A short wait, so a number being typed is written once, not once
  // a digit.
  useEffect(() => {
    const timer = window.setTimeout(() => writeAutosave({ form, boardSize }), 300);
    return () => window.clearTimeout(timer);
  }, [form, boardSize]);

  const openProject = (project: Project) => {
    setForm(project.form);
    setBoardSize(project.boardSize);
  };

  // Its area is stale the moment the building changes.
  useEffect(() => setTouched(null), [outcome]);

  const handleHover = (info: HoverInfo | null) => {
    setHovered(info);
    if (info) setTouched(info);
  };

  return (
    <div className="app">
      {!disclaimerAcknowledged && (
        <DisclaimerModal onAcknowledge={() => setDisclaimerAcknowledged(true)} />
      )}
      <aside className="app-panel app-inputs" data-active={panel === 'inputs'}>
        <h1 style={{ fontSize: 15, margin: '0 0 4px' }}>
          <a href="/" className="brand-link">
            zbCAD
          </a>
          <span className="brand-sep">/</span>
          Wind Zone Visualizer
        </h1>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px', opacity: 0.7 }}>
          v{APP_VERSION}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', minHeight: 15 }}>
          {form.projectName.trim()}
        </div>
        <ProjectBar project={{ form, boardSize }} onOpen={openProject} initialNotice={initial.notice} />
        <BuildingForm
          form={form}
          onChange={setForm}
          boardSize={boardSize}
          onBoardSizeChange={setBoardSize}
        />
      </aside>

      <main className="app-panel app-view" data-active={panel === 'view'}>
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
          {outcome.ok && (
            <button
              // From the 3D view the PDF leads with that view as framed; from
              // the plan there is no framed view, so it leads with the plan.
              onClick={() =>
                exportZonePdf(view === '3d' ? canvasEl : null, outcome.result, form, boardSize ?? undefined, APP_VERSION)
              }
              disabled={view === '3d' && !canvasEl}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--surface-1)',
                color: 'var(--text-primary)',
                cursor: view === '2d' || canvasEl ? 'pointer' : 'default',
                opacity: view === '2d' || canvasEl ? 1 : 0.5,
              }}
            >
              Export PDF
            </button>
          )}
        </div>

        {outcome.ok ? (
          view === '3d' ? (
            <Scene3D
              result={outcome.result}
              onHover={handleHover}
              hovered={hovered}
              onCanvasReady={setCanvasEl}
              boardSize={boardSize}
            />
          ) : (
            <PlanView2D result={outcome.result} onHover={handleHover} hovered={hovered} />
          )
        ) : (
          <div className="app-error">
            <h2 style={{ fontSize: 14 }}>Cannot compute zones</h2>
            <p>{outcome.error}</p>
          </div>
        )}

        {outcome.ok && touched && (
          <button
            type="button"
            className="zone-chip"
            aria-label="Dismiss zone details"
            onClick={() => {
              setTouched(null);
              setHovered(null);
            }}
          >
            <strong>
              {ZONE_LABELS[touched.zoneId]} ({touched.source})
            </strong>{' '}
            {touched.area.toFixed(1)} ft²
            <span aria-hidden="true" className="zone-chip-close">
              ×
            </span>
          </button>
        )}
      </main>

      <aside className="app-panel app-results" data-active={panel === 'results'}>
        {outcome.ok && (
          <AssumptionsPanel
            result={outcome.result}
            form={form}
            hovered={hovered}
            boardSize={boardSize}
          />
        )}
      </aside>

      <nav className="app-tabs" aria-label="Panels">
        {(Object.keys(PANEL_LABELS) as Panel[]).map((key) => (
          <button
            key={key}
            type="button"
            className="app-tab"
            aria-pressed={panel === key}
            onClick={() => setPanel(key)}
          >
            {PANEL_LABELS[key]}
          </button>
        ))}
      </nav>
    </div>
  );
}
