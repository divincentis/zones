import { createContext, useContext, useId, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';

interface Registry {
  register: (id: string, el: HTMLDivElement) => void;
  unregister: (id: string) => void;
}

const LabelCollisionContext = createContext<Registry | null>(null);

/**
 * Dimension labels are positioned in 3D and projected to screen space by
 * drei's `Html`, so two labels whose anchors are far apart in plan can still
 * land on top of each other on screen from some camera angles (see
 * docs/reference/overlap.png). Rather than trying to hand-tune every
 * dimension's anchor for every possible angle, this runs a small per-frame
 * pass over every registered label: measure actual screen rects, and nudge
 * any that overlap (in the same horizontal band) downward until they clear.
 * Wrap the whole dimension-label tree in one Provider; each label registers
 * its rendered div via `useCollidableLabelRef`.
 */
export function LabelCollisionProvider({ children }: { children: ReactNode }) {
  const elsRef = useRef(new Map<string, HTMLDivElement>());

  const register = (id: string, el: HTMLDivElement) => {
    elsRef.current.set(id, el);
  };
  const unregister = (id: string) => {
    elsRef.current.delete(id);
  };

  useFrame(() => {
    const entries: Array<{
      id: string;
      el: HTMLDivElement;
      top: number;
      bottom: number;
      left: number;
      right: number;
    }> = [];

    elsRef.current.forEach((el, id) => {
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      // Zero-size (or hidden) labels aren't actually visible on screen —
      // skip them so an occluded/collapsed label can't shove a real one.
      if (r.width === 0 || r.height === 0) return;
      entries.push({ id, el, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    });

    entries.sort((a, b) => a.top - b.top);
    const shiftById = new Map<string, number>();

    for (let i = 0; i < entries.length; i++) {
      const a = entries[i]!;
      let shift = 0;
      for (let j = 0; j < i; j++) {
        const b = entries[j]!;
        const bShift = shiftById.get(b.id) ?? 0;
        const horizontallyOverlaps = a.left < b.right && a.right > b.left;
        if (!horizontallyOverlaps) continue;
        const overlap = b.bottom + bShift - (a.top + shift);
        if (overlap > 0) shift += overlap + 3;
      }
      if (shift > 0) {
        shiftById.set(a.id, shift);
        a.el.style.transform = `translateY(${shift}px)`;
      }
    }
  });

  return <LabelCollisionContext.Provider value={{ register, unregister }}>{children}</LabelCollisionContext.Provider>;
}

/** Returns a ref callback that registers/unregisters a label's div with the nearest LabelCollisionProvider. No-op (renders unaffected) if used outside one. */
export function useCollidableLabelRef() {
  const ctx = useContext(LabelCollisionContext);
  const id = useId();

  return (el: HTMLDivElement | null) => {
    if (!ctx) return;
    if (el) ctx.register(id, el);
    else ctx.unregister(id);
  };
}
