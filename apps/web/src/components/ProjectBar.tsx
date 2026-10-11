import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PROJECT, parseProject, projectFileName, serializeProject, type Project } from '../lib/project';
import { shareUrl } from '../lib/projectStorage';

interface Props {
  project: Project;
  /** Replaces the open building — with a file's, or with the default one. */
  onOpen: (project: Project) => void;
  /** Something to say as the page opens: that a link was followed, or could not be. */
  initialNotice?: Notice;
}

interface Notice {
  text: string;
  error?: boolean;
}

/**
 * Open, Save, Copy link and New for the building as entered. The building is
 * also kept in the browser between visits (see projectStorage.ts), so these
 * are for moving one somewhere else: a file to keep with the job, a link to
 * send to someone.
 */
export function ProjectBar({ project, onOpen, initialNotice }: Props) {
  const [notice, setNotice] = useState<Notice | null>(initialNotice ?? null);
  /** A link that could not be put on the clipboard, shown to be copied by hand instead. */
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // A notice has said what it had to after a few seconds; an error stays
  // until something else happens, since it explains why nothing did.
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const say = (text: string, error = false) => {
    setLinkToCopy(null);
    setNotice({ text, error });
  };

  const save = () => {
    const url = URL.createObjectURL(new Blob([serializeProject(project)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = projectFileName(project);
    link.click();
    // Not revoked in the same tick: the download has only been asked for.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(`Saved as ${link.download}.`);
  };

  const open = async (file: File) => {
    const read = parseProject(await file.text());
    if (read.ok) {
      onOpen(read.project);
      say(`Opened ${file.name}.`);
    } else {
      say(`${file.name} could not be opened: ${read.error}.`, true);
    }
  };

  const copyLink = async () => {
    const url = shareUrl(project);
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied. It opens this building for whoever you send it to.');
    } catch {
      // No clipboard access (an older browser, or permission refused).
      setNotice(null);
      setLinkToCopy(url);
    }
  };

  const startOver = () => {
    if (window.confirm('Start over with the default building? What is entered now will be replaced.')) {
      onOpen(DEFAULT_PROJECT);
      say('Started a new building.');
    }
  };

  return (
    <div className="project-bar">
      <div className="project-bar-buttons">
        <button type="button" onClick={() => fileInput.current?.click()}>
          Open
        </button>
        <button type="button" onClick={save}>
          Save
        </button>
        <button type="button" onClick={copyLink}>
          Copy link
        </button>
        <button type="button" onClick={startOver}>
          New
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so choosing the same file again still counts as a change.
          e.target.value = '';
          if (file) void open(file);
        }}
      />
      {notice && (
        <div className="project-bar-notice" data-error={notice.error || undefined} role="status">
          {notice.text}
        </div>
      )}
      {linkToCopy && (
        <label className="project-bar-notice">
          Copy this link:
          <input
            type="text"
            readOnly
            value={linkToCopy}
            onFocus={(e) => e.target.select()}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
      )}
    </div>
  );
}
