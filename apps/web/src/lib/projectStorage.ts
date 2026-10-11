import {
  AUTOSAVE_KEY,
  DEFAULT_PROJECT,
  parseProject,
  projectFromFragment,
  projectToFragment,
  serializeProject,
  type Project,
} from './project';

/**
 * The browser side of a project: where the open building comes from when the
 * page loads, and where it is kept between visits. project.ts decides what a
 * valid project is; nothing here trusts what it reads until that has.
 */

export interface InitialProject {
  project: Project;
  /** Something to tell the user about how the page opened, if there is anything. */
  notice?: { text: string; error?: boolean };
  /** The address carried a building, good or bad, which should now come off it. */
  hadLink: boolean;
}

/**
 * A link wins over the autosave: whoever followed one meant to see that
 * building. Failing either, the default building.
 */
export function loadInitialProject(): InitialProject {
  const linked = projectFromFragment(window.location.hash);
  if (linked?.ok) {
    return { project: linked.project, notice: { text: 'Opened the building from the link.' }, hadLink: true };
  }
  const notice = linked
    ? { text: `The link's building could not be read (${linked.error}).`, error: true }
    : undefined;

  const saved = readAutosave();
  return { project: saved ?? DEFAULT_PROJECT, notice, hadLink: linked !== null };
}

function readAutosave(): Project | null {
  try {
    const text = window.localStorage.getItem(AUTOSAVE_KEY);
    const read = text ? parseProject(text) : null;
    return read?.ok ? read.project : null;
  } catch {
    // Storage switched off, or private browsing: there is simply no autosave.
    return null;
  }
}

export function writeAutosave(project: Project): void {
  try {
    window.localStorage.setItem(AUTOSAVE_KEY, serializeProject(project));
  } catch {
    // Same: nothing to be done, and nothing lost that was promised.
  }
}

/**
 * Takes a followed link's building off the address once it has been opened.
 * Left there, it would go stale with the first edit and then reopen the old
 * building over the autosave on the next reload.
 */
export function clearLinkFromAddress(): void {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** The address that opens this building for whoever is sent it. */
export function shareUrl(project: Project): string {
  const fragment = projectToFragment(project);
  return window.location.origin + window.location.pathname + (fragment ? `#${fragment}` : '');
}
