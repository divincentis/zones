import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BuildingForm } from './components/BuildingForm';
import { PlanView2D } from './components/PlanView2D';
import { AssumptionsPanel } from './components/AssumptionsPanel';
import { DisclaimerModal } from './components/DisclaimerModal';
import { HelpModal } from './components/HelpModal';
import { ProjectBar } from './components/ProjectBar';
import { computeZones, type FormState } from './lib/buildModel';
import type { StandardView, ViewRequest } from './components/Scene3D';
import type { HoverInfo } from './lib/hoverInfo';
import type { LengthUnits } from './lib/lengthFormat';
import type { Project } from './lib/project';
import { clearLinkFromAddress, loadInitialProject, writeAutosave } from './lib/projectStorage';
import { ZONE_LABELS } from './lib/zoneColors';
import { APP_VERSION } from './version';

type ViewMode = '3d' | '2d';

/**
 * The 3D view is most of the app's weight (three.js is over a megabyte) and
 * none of what a visitor needs first: the form, the figures and the plan all
 * work without it. So it is a chunk of its own — asked for here, as the app's
 * own script starts, rather than when the view first renders, so that it
 * downloads alongside everything else instead of after it.
 */
const scene3dModule = import('./components/Scene3D');
// Observed here so that a failed download is not also an unhandled rejection;
// the view's error boundary reports it when the view is actually wanted.
scene3dModule.catch(() => undefined);
const Scene3D = lazy(() => scene3dModule.then((module) => ({ default: module.Scene3D })));

/**
 * Catches the 3D view failing to load or to start — a dropped connection, or
 * a page left open across a deploy, whose chunk is no longer on the server —
 * and says what to do about it, where it would otherwise blank the whole app.
 */
class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-error" role="alert">
        <h2>The 3D view didn&apos;t load</h2>
        <p>
          The plan, the figures and the PDF still work — choose 2D above. Reloading the page usually brings the
          3D view back.
        </p>
        <p style={{ marginTop: 12 }}>
          <button type="button" className="view-button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      </div>
    );
  }
}

type ExportState = 'idle' | 'working' | 'done' | 'failed';

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
  const [units, setUnits] = useState<LengthUnits>(initial.project.units);
  const [disclaimerAcknowledged, setDisclaimerAcknowledged] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportState>('idle');
  // How the 3D view is looked at — not part of the building, so not saved with it.
  const [showLabels, setShowLabels] = useState(true);
  const [viewRequest, setViewRequest] = useState<ViewRequest>({ view: 'corner', id: 0 });
  const lookFrom = (next: StandardView) => setViewRequest((last) => ({ view: next, id: last.id + 1 }));

  const outcome = useMemo(() => computeZones(form, boardSize ?? undefined), [form, boardSize]);

  useEffect(() => {
    if (initial.hadLink) clearLinkFromAddress();
  }, [initial]);

  // Kept in the browser as it is typed, so a reload or a closed tab loses
  // nothing. A short wait, so a number being typed is written once, not once
  // a digit.
  useEffect(() => {
    const timer = window.setTimeout(() => writeAutosave({ form, boardSize, units }), 300);
    return () => window.clearTimeout(timer);
  }, [form, boardSize, units]);

  const openProject = (project: Project) => {
    setForm(project.form);
    setBoardSize(project.boardSize);
    setUnits(project.units);
  };

  // F1 is blocked rather than bound, as on every zbCAD tool: an accidental press
  // should cost nothing, and left alone Chrome opens its own help in a new tab.
  // Help is the button over the view.
  useEffect(() => {
    const blockF1 = (e: KeyboardEvent) => {
      if (e.key === 'F1') e.preventDefault();
    };
    window.addEventListener('keydown', blockF1);
    return () => window.removeEventListener('keydown', blockF1);
  }, []);

  // Its area is stale the moment the building changes.
  useEffect(() => setTouched(null), [outcome]);

  // The PDF writer is the other heavy piece, wanted only when asked for.
  const exportPdf = async () => {
    if (!outcome.ok) return;
    setExporting('working');
    try {
      const { exportZonePdf } = await import('./lib/pdfExport');
      // From the 3D view the PDF leads with that view as framed; from the
      // plan there is no framed view, so it leads with the plan.
      exportZonePdf(view === '3d' ? canvasEl : null, outcome.result, form, boardSize ?? undefined, units, APP_VERSION);
      setExporting('done');
    } catch {
      setExporting('failed');
    }
    window.setTimeout(() => setExporting('idle'), 5000);
  };

  const handleHover = (info: HoverInfo | null) => {
    setHovered(info);
    if (info) setTouched(info);
  };

  return (
    <div className="app">
      {!disclaimerAcknowledged && (
        <DisclaimerModal onAcknowledge={() => setDisclaimerAcknowledged(true)} />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
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
        <ProjectBar project={{ form, boardSize, units }} onOpen={openProject} initialNotice={initial.notice} />
        <BuildingForm
          form={form}
          onChange={setForm}
          boardSize={boardSize}
          onBoardSizeChange={setBoardSize}
          units={units}
          onUnitsChange={setUnits}
        />
      </aside>

      <main className="app-panel app-view" data-active={panel === 'view'}>
        <div className="view-bar">
          <div className="view-left">
            <div role="group" aria-label="View" className="view-toggle">
              {(['3d', '2d'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="view-button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
            {view === '3d' && outcome.ok && (
              <div role="group" aria-label="3D view" className="view-toggle">
                {(
                  [
                    ['corner', 'Reset'],
                    ['top', 'Top'],
                    ['front', 'Front'],
                  ] as const
                ).map(([standard, label]) => (
                  <button key={standard} type="button" className="view-button view-button-small" onClick={() => lookFrom(standard)}>
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className="view-button view-button-small"
                  aria-pressed={showLabels}
                  onClick={() => setShowLabels((on) => !on)}
                >
                  Labels
                </button>
              </div>
            )}
          </div>
          <div className="view-export">
            {outcome.ok && (
              <>
                <span role="status">
                  {exporting === 'done'
                    ? 'PDF saved'
                    : exporting === 'failed'
                      ? 'The PDF could not be made — reload and try again'
                      : ''}
                </span>
                <button
                  type="button"
                  className="view-button view-button-primary"
                  onClick={exportPdf}
                  disabled={exporting === 'working' || (view === '3d' && !canvasEl)}
                >
                  {exporting === 'working' ? 'Preparing…' : 'Export PDF'}
                </button>
              </>
            )}
            <button type="button" className="view-button" onClick={() => setHelpOpen(true)}>
              Help
            </button>
          </div>
        </div>

        {outcome.ok ? (
          view === '3d' ? (
            <ViewBoundary>
              {/* While the 3D chunk is on its way the plan stands in for it:
                  the same building, drawn by code that is already here. */}
              <Suspense
                fallback={
                  <>
                    <PlanView2D result={outcome.result} onHover={handleHover} hovered={hovered} units={units} />
                    <div className="view-loading" role="status">
                      Loading the 3D view…
                    </div>
                  </>
                }
              >
                <Scene3D
                  result={outcome.result}
                  onHover={handleHover}
                  hovered={hovered}
                  onCanvasReady={setCanvasEl}
                  boardSize={boardSize}
                  units={units}
                  showLabels={showLabels}
                  viewRequest={viewRequest}
                />
              </Suspense>
            </ViewBoundary>
          ) : (
            <PlanView2D result={outcome.result} onHover={handleHover} hovered={hovered} units={units} />
          )
        ) : (
          <div className="app-error" role="alert">
            <h2>This building can&apos;t be zoned yet</h2>
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
        {outcome.ok ? (
          <AssumptionsPanel
            result={outcome.result}
            form={form}
            hovered={hovered}
            boardSize={boardSize}
            units={units}
          />
        ) : (
          <p className="app-empty">Zone areas and figures appear here once the building can be zoned.</p>
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
