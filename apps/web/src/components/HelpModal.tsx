import { useEffect, useRef } from 'react';

interface HelpModalProps {
  onClose: () => void;
}

/**
 * The tool's documentation, in the same shape as every other zbCAD tool's
 * Help: what it is, how to use it, then files. A native <dialog> opened
 * modal, so Esc and focus trapping come from the browser; the heading takes
 * focus on open, or the browser would focus "Got it" at the bottom and open
 * the help scrolled to its end.
 */
export function HelpModal({ onClose }: HelpModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="help-dialog" aria-labelledby="help-title" onClose={onClose}>
      <form method="dialog">
        <div className="help-head">
          <h2 id="help-title" tabIndex={-1} autoFocus>
            Wind Zone Visualizer
          </h2>
          <button value="close" className="help-x" aria-label="Close">
            ×
          </button>
        </div>
        <div className="help-body">
          <p className="help-about">
            Draws roof and wall wind zones from the FM Global Data Sheet 1-28 zone figures, to the building&apos;s
            actual dimensions. It handles low-slope, gable, hip and monoslope roofs, stepped buildings and tall
            buildings, in 3D and in plan, with every zone&apos;s width and area and a PDF. It draws zone geometry
            only; it doesn&apos;t calculate pressures.
          </p>

          <h3>The building</h3>
          <ul>
            <li>
              Enter the building in the <b>Building</b> panel: length <b>L</b>, width <b>B</b> and height, the roof
              type, and any parapet or overhang. The view and the figures follow every change. If the building
              can&apos;t be zoned as entered, the view says why.
            </li>
            <li>
              <b>Gable</b> and <b>monoslope</b> roofs take a pitch in degrees or as rise in 12. A gable at 7° or less
              is zoned as low-slope, and one over 45° is zoned as wall construction (Zones 4 and 5). A <b>hip</b>{' '}
              roof is only covered at 7° or less.
            </li>
            <li>
              <b>Stepped building</b> adds a second section against one wall of the first, with its own height
              and parapet, for a building with two roof levels.
            </li>
            <li>
              Which roof figure applies depends on the mean roof height and how it compares with the building&apos;s
              width, so tall buildings are zoned differently. The <b>Zones</b> panel says which figure was used and
              why.
            </li>
            <li>
              Lengths show in <b>feet and inches</b> or <b>decimal feet</b>. <b>Round roof bands up to whole
              boards</b> widens each roof band to a whole number of boards, for takeoff; the exact width is still
              shown as the minimum.
            </li>
          </ul>

          <h3>Looking at it</h3>
          <ul>
            <li>
              <b>3D</b>: drag to turn the building, scroll to zoom, right-drag to pan. <b>Reset</b>, <b>Top</b> and{' '}
              <b>Front</b> jump to a standard view, and <b>Labels</b> turns the dimensions on and off. <b>2D</b> is
              the dimensioned plan.
            </li>
            <li>Point at a zone, or tap it, for its name, its area and a note on where it comes from.</li>
            <li>
              The <b>Zones</b> panel lists the key figures, such as the corner width <i>a</i> and the mean roof
              height, and every zone&apos;s width and area. <b>Copy table</b> copies the tables for pasting into a
              spreadsheet.
            </li>
            <li>
              On a phone, the tabs along the bottom switch between the Building, View and Zones panels.
            </li>
          </ul>

          <h3>PDF and files</h3>
          <ul>
            <li>
              <b>Export PDF</b> makes a letter-size report: the view as you&apos;ve framed it, the key figures and
              the zone tables, and a dimensioned plan sheet. From the 2D view it starts with the plan.
            </li>
            <li>
              The building is kept in this browser as you type. <b>Save</b> writes it to a .json file and{' '}
              <b>Open</b> reads one back. <b>Copy link</b> makes a link that opens this building for whoever you
              send it to. <b>New</b> starts over with the default building.
            </li>
          </ul>

          <p className="help-fine">
            For visualization only, not design. It shows zone geometry from the FM 1-28 figures and does not
            calculate pressures or cover every configuration or exception. Zone layouts must be determined and
            verified by a licensed design professional against the governing code and the project documents.
          </p>
        </div>
        <div className="help-foot">
          <button value="ok" className="view-button view-button-primary">
            Got it
          </button>
        </div>
      </form>
    </dialog>
  );
}
