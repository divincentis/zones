import { useEffect, useMemo, useRef, useState } from 'react';
import { zoneSurfaceArea, type ComputationResult } from '../lib/buildModel';
import { describeRoofHover, describeWallHover, type HoverInfo } from '../lib/hoverInfo';
import { buildPlanSheet, type PlanPrim, type PlanRole } from '../lib/planSheet';
import { useZoneColors } from '../lib/zoneColors';

interface Props {
  result: ComputationResult;
  onHover: (info: HoverInfo | null) => void;
  hovered: HoverInfo | null;
}

/**
 * What each kind of mark is drawn in on screen. The plan sheet says what a
 * mark is for and leaves the colour to its writer (see planSheet.ts); here
 * that follows the app's theme, where the PDF writer uses fixed print inks.
 * Marks drawn over a zone's fill stay dark in both themes, because the fills
 * themselves do.
 */
const ROLE_COLOR: Record<PlanRole, string> = {
  ink: 'var(--text-primary)',
  muted: 'var(--text-secondary)',
  dim: 'var(--dimension)',
  notice: 'var(--zone-3)',
  onZone: '#1c1b19',
};

/**
 * Screen pixels per sheet point. The sheet's lettering is sized for paper
 * (6.5 pt dimension figures); on screen that wants to be nearer 10 px.
 */
const PIXELS_PER_POINT = 1.5;

const pointList = (points: Array<[number, number]>) => points.map((p) => `${p[0]},${p[1]}`).join(' ');

/**
 * The roof plan on screen: the same plan sheet the PDF export writes, drawn
 * as SVG. Everything about what the plan shows — zone outlines, the numbers,
 * the dimension strings, the wall bars — is decided in buildPlanSheet; this
 * only paints it and wires up hover.
 */
export function PlanView2D({ result, onHover, hovered }: Props) {
  const colors = useZoneColors();
  // The sheet is laid out for the space it actually has, so the plan fills a
  // tall pane as well as a wide one and the lettering never scales with it.
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const sheet = useMemo(
    () =>
      buildPlanSheet(result, {
        mode: 'screen',
        page: frame
          ? { width: frame.width / PIXELS_PER_POINT, height: frame.height / PIXELS_PER_POINT }
          : undefined,
      }),
    [result, frame]
  );

  const hoverFor = (prim: Extract<PlanPrim, { kind: 'zone' }>): HoverInfo | null => {
    if (!prim.hover) return null;
    const area = zoneSurfaceArea(result, prim.zoneId);
    if (prim.hover.source === 'roof') return describeRoofHover(prim.zoneId, area, result.roof);
    const upper = prim.hover.section === 1 && result.step;
    return describeWallHover(
      prim.zoneId,
      area,
      upper ? upper.upperWalls : result.walls,
      result.step ? (upper ? 'upper section' : 'lower section') : undefined
    );
  };

  return (
    <div ref={frameRef} style={{ width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${sheet.width} ${sheet.height}`}
        style={{ width: '100%', height: '100%', display: 'block', fontFamily: 'var(--font-sans)' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {sheet.prims.map((prim, i) => {
          if (prim.kind === 'zone') {
            const fill = colors[prim.zoneId] ?? '#999';
            const lit = !!prim.hover && hovered?.source === prim.hover.source && hovered.zoneId === prim.zoneId;
            return (
              <polygon
                key={i}
                points={pointList(prim.points)}
                fill={fill}
                // Stroked in its own colour so pieces of one zone that merely
                // touch don't show a hairline of background between them.
                stroke={fill}
                strokeWidth={0.4}
                style={{ cursor: prim.hover ? 'pointer' : undefined, filter: lit ? 'brightness(1.18)' : undefined }}
                onMouseEnter={prim.hover ? () => onHover(hoverFor(prim)) : undefined}
              // For a finger, which lands without ever having hovered.
              onClick={prim.hover ? () => onHover(hoverFor(prim)) : undefined}
                onMouseLeave={prim.hover ? () => onHover(null) : undefined}
              />
            );
          }
          if (prim.kind === 'poly') {
            return (
              <polygon
                key={i}
                points={pointList(prim.points)}
                fill={ROLE_COLOR[prim.role]}
                style={{ pointerEvents: 'none' }}
              />
            );
          }
          if (prim.kind === 'line') {
            return (
              <line
                key={i}
                x1={prim.x1}
                y1={prim.y1}
                x2={prim.x2}
                y2={prim.y2}
                stroke={ROLE_COLOR[prim.role]}
                strokeWidth={prim.weight}
                strokeDasharray={prim.dash?.join(' ')}
                style={{ pointerEvents: 'none' }}
              />
            );
          }
          return (
            <text
              key={i}
              x={prim.x}
              y={prim.y}
              fontSize={prim.size}
              fontWeight={prim.bold ? 700 : 400}
              textAnchor={prim.anchor}
              dominantBaseline="central"
              transform={prim.vertical ? `rotate(-90 ${prim.x} ${prim.y})` : undefined}
              fill={ROLE_COLOR[prim.role]}
              style={{ pointerEvents: 'none' }}
            >
              {prim.text}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
