import type { ABasis, RoofType } from '@zones/engine';
import {
  DEFAULT_FORM_STATE,
  type FormState,
  type MonoslopeHighSideChoice,
  type RidgeAxisChoice,
  type StepEdgeChoice,
} from './buildModel';
import { DEFAULT_LENGTH_UNITS, type LengthUnits } from './lengthFormat';

/**
 * A project: everything the user has entered, and nothing derived from it.
 * Zones, areas and figures are recomputed from these inputs every time, so a
 * saved project can never disagree with the engine that opens it.
 *
 * Three things bring a project in from outside — a file, a link, and the
 * browser's autosave — and all three go through `checkProject` before
 * anything can become the open building. Add a new FormState field there
 * (its default comes from DEFAULT_FORM_STATE on its own; a choice field
 * needs its allowed values listed in CHOICES) or it is dropped on load.
 */
export interface Project {
  form: FormState;
  /** Board width (ft) that roof bands are rounded up to for takeoff; null when off. */
  boardSize: number | null;
  /** How lengths are written out. Kept with the building because the PDF and a shared link should read the same way to whoever opens them. */
  units: LengthUnits;
}

export const DEFAULT_PROJECT: Project = { form: DEFAULT_FORM_STATE, boardSize: null, units: DEFAULT_LENGTH_UNITS };

/** Marks a file as one of ours, so opening somebody's package.json says so plainly. */
const FILE_APP = 'zbcad-wind-zones';
const FILE_VERSION = 1;

export const AUTOSAVE_KEY = 'zones.autosave';

const CHOICES = {
  aBasis: ['boundingRect', 'shortestEdge', 'perWing'] satisfies ABasis[],
  roofType: ['flat', 'gable', 'hip', 'monoslope'] satisfies RoofType[],
  ridgeAlong: ['length', 'width'] satisfies RidgeAxisChoice[],
  monoslopeHighSide: ['lengthNear', 'lengthFar', 'widthNear', 'widthFar'] satisfies MonoslopeHighSideChoice[],
  stepEdge: ['lengthFar', 'lengthNear', 'widthFar', 'widthNear'] satisfies StepEdgeChoice[],
} as const;

/**
 * Wide enough for any real building and any number the form can produce —
 * half-typed values included, since the autosave records those too — and
 * narrow enough to keep out the infinities and 1e300s that would otherwise
 * reach the renderer.
 */
const MAX_NUMBER = 1e6;
const MAX_NAME_LENGTH = 200;

export type ProjectCheck = { ok: true; project: Project } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Turns something read from outside into a Project, or says why it cannot.
 * A missing field takes its default, so older files and shorter links keep
 * working; an unknown one is ignored, so newer ones do too. A field that is
 * present but wrong fails the whole thing rather than being quietly replaced
 * — a building that opens with one dimension silently changed is worse than
 * one that does not open.
 */
export function checkProject(raw: unknown): ProjectCheck {
  if (!isRecord(raw)) return { ok: false, error: 'not a project' };
  if (raw.app !== undefined && raw.app !== FILE_APP) {
    return { ok: false, error: 'not a Wind Zone Visualizer project' };
  }
  const rawForm = raw.form;
  if (!isRecord(rawForm)) return { ok: false, error: 'no building in it' };

  const form: Record<string, unknown> = { ...DEFAULT_FORM_STATE };
  for (const key of Object.keys(DEFAULT_FORM_STATE) as (keyof FormState)[]) {
    const value = rawForm[key];
    if (value === undefined) continue;
    const fallback = DEFAULT_FORM_STATE[key];

    if (typeof fallback === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_NUMBER) {
        return { ok: false, error: `${key} is not a usable number` };
      }
    } else if (typeof fallback === 'boolean') {
      if (typeof value !== 'boolean') return { ok: false, error: `${key} is not true or false` };
    } else if (key in CHOICES) {
      const allowed: readonly string[] = CHOICES[key as keyof typeof CHOICES];
      if (typeof value !== 'string' || !allowed.includes(value)) {
        return { ok: false, error: `${key} is not one of ${allowed.join(', ')}` };
      }
    } else if (typeof value !== 'string') {
      return { ok: false, error: `${key} is not text` };
    }
    form[key] = typeof value === 'string' && !(key in CHOICES) ? value.slice(0, MAX_NAME_LENGTH) : value;
  }

  const rawBoard = raw.boardSize;
  let boardSize: number | null = null;
  if (rawBoard !== undefined && rawBoard !== null) {
    if (typeof rawBoard !== 'number' || !Number.isFinite(rawBoard) || rawBoard <= 0 || rawBoard > MAX_NUMBER) {
      return { ok: false, error: 'boardSize is not a usable number' };
    }
    boardSize = rawBoard;
  }

  const rawUnits = raw.units;
  if (rawUnits !== undefined && rawUnits !== 'feetInches' && rawUnits !== 'decimal') {
    return { ok: false, error: 'units is not feetInches or decimal' };
  }

  return {
    ok: true,
    project: { form: form as unknown as FormState, boardSize, units: rawUnits ?? DEFAULT_LENGTH_UNITS },
  };
}

// --- files and the autosave: the whole project, as JSON ----------------------

export function serializeProject(project: Project): string {
  return JSON.stringify({ app: FILE_APP, version: FILE_VERSION, ...project }, null, 2) + '\n';
}

export function parseProject(text: string): ProjectCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not a project file' };
  }
  return checkProject(raw);
}

/** A file name for a saved project, from its name: letters, digits and dashes. */
export function projectFileName(project: Project): string {
  const slug = project.form.projectName
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${slug || 'wind-zones'}.zones.json`;
}

// --- links: only what differs from the default, in the URL's fragment --------

/**
 * A project as the part of a link after the `#`. The fragment, not the query
 * string, on purpose: a browser never sends the fragment to the server, so a
 * building's dimensions and its project name stay out of request logs and
 * page-view analytics, and travel only with the link itself.
 *
 * Plain `field=value` pairs under FormState's own names, listing only the
 * fields that differ from the default building — so a link is short, can be
 * read and edited by hand, and a field added later needs nothing done here.
 */
export function projectToFragment(project: Project): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_FORM_STATE) as (keyof FormState)[]) {
    if (project.form[key] !== DEFAULT_FORM_STATE[key]) params.set(key, String(project.form[key]));
  }
  if (project.boardSize !== null) params.set('boardSize', String(project.boardSize));
  if (project.units !== DEFAULT_LENGTH_UNITS) params.set('units', project.units);
  return params.toString();
}

/**
 * Reads a link's fragment. Returns null when it names none of our fields —
 * it is somebody else's anchor, or nothing — and otherwise the project, or
 * the reason it could not be read.
 */
export function projectFromFragment(fragment: string): ProjectCheck | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const form: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_FORM_STATE) as (keyof FormState)[]) {
    const text = params.get(key);
    if (text === null) continue;
    const fallback = DEFAULT_FORM_STATE[key];
    // A fragment is all text; give each field back the type its default has.
    // Anything that does not convert is left as it came, for checkProject to refuse.
    if (typeof fallback === 'number') form[key] = text.trim() === '' ? text : Number(text);
    else if (typeof fallback === 'boolean') form[key] = text === 'true' ? true : text === 'false' ? false : text;
    else form[key] = text;
  }
  const board = params.get('boardSize');
  const units = params.get('units');
  if (Object.keys(form).length === 0 && board === null && units === null) return null;
  return checkProject({ form, boardSize: board === null ? null : Number(board), units: units ?? undefined });
}
