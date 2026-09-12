import * as THREE from 'three';
import { createContext, useContext, useId, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/** What a label tells the provider about itself when it registers. */
export interface LabelRegistration {
  /** Who yields when two labels overlap: the lower number keeps its anchor. */
  priority: number;
  /**
   * The label's anchor in world space. Only needed with `retreat`, to work
   * out which way "away from the camera" points on screen this frame.
   */
  anchor?: THREE.Vector3;
  /**
   * Nudge this label away from the camera (deeper into the scene) rather
   * than plain down-screen. For a call-out that sits inside the zone it
   * measures, down-screen means out over the zones nearer the camera — a
   * Zone 1' figure ends up between Zones 2 and 3, reading as though it
   * belonged to them. Retreating keeps it over its own zone.
   */
  retreat?: boolean;
}

interface Registry {
  register: (id: string, el: HTMLDivElement, reg: LabelRegistration) => void;
  unregister: (id: string) => void;
}

const LabelCollisionContext = createContext<Registry | null>(null);

/** Cap on the per-label settle sweeps, so a pathological arrangement can't spin. */
const MAX_SETTLE_PASSES = 4;

/** Clear space left between two labels that had to be separated, in px. */
const LABEL_GAP = 3;

/**
 * Dimension labels are positioned in 3D and projected to screen space by
 * drei's `Html`, so two labels whose anchors are far apart in plan can still
 * land on top of each other on screen from some camera angles (see
 * docs/reference/overlap.png). Rather than trying to hand-tune every
 * dimension's anchor for every possible angle, this runs a small per-frame
 * pass over every registered label: measure actual screen rects, and nudge
 * any that overlap (in the same horizontal band) until they clear. Wrap the
 * whole dimension-label tree in one Provider; each label registers its
 * rendered div via `useCollidableLabelRef`.
 *
 * Labels are placed in `priority` order (lower number = placed first, and
 * therefore never nudged on a lower-priority label's account), so the zone
 * call-outs that matter most stay put at their anchor and the ones that
 * matter least do the moving — see DIM_PRIORITY in Scene3D.
 *
 * A label that must move goes down-screen by default; one registered with
 * `retreat` goes whichever way is *away from the camera* instead, which is
 * re-derived from the live camera every frame rather than assumed to be
 * up-screen (the view can be orbited under the roof plane, which flips it).
 */
export function LabelCollisionProvider({ children }: { children: ReactNode }) {
  const elsRef = useRef(new Map<string, { el: HTMLDivElement; reg: LabelRegistration }>());
  const camera = useThree((state) => state.camera);

  const register = (id: string, el: HTMLDivElement, reg: LabelRegistration) => {
    elsRef.current.set(id, { el, reg });
  };
  const unregister = (id: string) => {
    elsRef.current.delete(id);
  };

  /**
   * +1 if stepping away from the camera (horizontally, along the ground
   * plane) moves this anchor DOWN the screen, -1 if it moves it up. Measured
   * by projecting the anchor and a point just beyond it, so it holds for any
   * orbit — including from below, where the two swap.
   */
  const retreatDirection = (anchor: THREE.Vector3): 1 | -1 => {
    const away = anchor.clone().sub(camera.position);
    away.y = 0;
    if (away.lengthSq() < 1e-12) return 1;
    const step = Math.max(1e-3, anchor.distanceTo(camera.position) * 0.01);
    const here = anchor.clone().project(camera);
    const beyond = anchor.clone().add(away.normalize().multiplyScalar(step)).project(camera);
    // NDC y runs up, screen y runs down.
    return beyond.y <= here.y ? 1 : -1;
  };

  useFrame(() => {
    const entries: Array<{
      id: string;
      el: HTMLDivElement;
      priority: number;
      dir: 1 | -1;
      top: number;
      bottom: number;
      left: number;
      right: number;
    }> = [];

    elsRef.current.forEach(({ el, reg }, id) => {
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      // Zero-size (or hidden) labels aren't actually visible on screen —
      // skip them so an occluded/collapsed label can't shove a real one.
      if (r.width === 0 || r.height === 0) return;
      entries.push({
        id,
        el,
        priority: reg.priority,
        dir: reg.retreat && reg.anchor ? retreatDirection(reg.anchor) : 1,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      });
    });

    // Highest priority first, then top-down within a priority so equal-
    // priority labels still cascade downward the way they always have.
    entries.sort((a, b) => a.priority - b.priority || a.top - b.top);
    const shiftById = new Map<string, number>();

    for (let i = 0; i < entries.length; i++) {
      const a = entries[i]!;
      let shift = 0;
      // Clearing one neighbour can push a label straight into another it has
      // already been compared against, so sweep the placed labels until the
      // position settles (bounded — a handful of labels, a few passes).
      for (let pass = 0; pass < MAX_SETTLE_PASSES; pass++) {
        let moved = false;
        for (let j = 0; j < i; j++) {
          const b = entries[j]!;
          const bShift = shiftById.get(b.id) ?? 0;
          const horizontallyOverlaps = a.left < b.right && a.right > b.left;
          if (!horizontallyOverlaps) continue;
          // Both rects, actual intersection: placement order follows
          // priority, not screen position, so `a` can sit well ABOVE an
          // already-placed `b` it doesn't touch. Testing `b.bottom - a.top`
          // alone reads that gap as an overlap and shoves `a` past `b`.
          const aTop = a.top + shift;
          const aBottom = a.bottom + shift;
          const bTop = b.top + bShift;
          const bBottom = b.bottom + bShift;
          if (aTop < bBottom && aBottom > bTop) {
            // Clear `b` on whichever side this label is allowed to move to.
            shift += a.dir === 1 ? bBottom - aTop + LABEL_GAP : -(aBottom - bTop + LABEL_GAP);
            moved = true;
          }
        }
        if (!moved) break;
      }
      if (shift !== 0) {
        shiftById.set(a.id, shift);
        a.el.style.transform = `translateY(${shift}px)`;
      }
    }
  });

  return <LabelCollisionContext.Provider value={{ register, unregister }}>{children}</LabelCollisionContext.Provider>;
}

/**
 * Returns a ref callback that registers/unregisters a label's div with the
 * nearest LabelCollisionProvider. No-op (renders unaffected) if used outside
 * one. See LabelRegistration for what the options do.
 */
export function useCollidableLabelRef(reg: LabelRegistration = { priority: 0 }) {
  const ctx = useContext(LabelCollisionContext);
  const id = useId();

  return (el: HTMLDivElement | null) => {
    if (!ctx) return;
    if (el) ctx.register(id, el, reg);
    else ctx.unregister(id);
  };
}
