import type { ComputationResult } from '../lib/buildModel';
import type { AnyZoneId } from '../lib/zoneColors';
import { useZoneColors } from '../lib/zoneColors';
import { describeRoofHover, type HoverInfo } from '../lib/hoverInfo';

interface Props {
  result: ComputationResult;
  onHover: (info: HoverInfo | null) => void;
  hovered: HoverInfo | null;
}

const PADDING = 20;

/** A simple CAD-style overall dimension for the 2D plan: a line with end ticks and a text label. */
function PlanDimension({
  x1,
  y1,
  x2,
  y2,
  label,
  tickSize,
  fontSize,
  labelSide = 1,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  tickSize: number;
  fontSize: number;
  labelSide?: 1 | -1;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const perpX = (-dy / len) * tickSize;
  const perpY = (dx / len) * tickSize;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const isHorizontal = Math.abs(dx) >= Math.abs(dy);

  return (
    <g stroke="#5ec9ff" strokeWidth={1.5}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1 - perpX} y1={y1 - perpY} x2={x1 + perpX} y2={y1 + perpY} />
      <line x1={x2 - perpX} y1={y2 - perpY} x2={x2 + perpX} y2={y2 + perpY} />
      <text
        x={midX + (isHorizontal ? 0 : labelSide * fontSize * 0.6)}
        y={midY + (isHorizontal ? labelSide * fontSize * 1.1 : 0)}
        fontSize={fontSize}
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#5ec9ff"
        stroke="none"
        style={{ pointerEvents: 'none' }}
      >
        {label}
      </text>
    </g>
  );
}

export function PlanView2D({ result, onHover, hovered }: Props) {
  const colors = useZoneColors();
  const { roof, building } = result;
  const pieces = roof.pieces;

  const xs = pieces.flatMap((p) => p.vertices.map((v) => v[0]));
  const ys = pieces.flatMap((p) => p.vertices.map((v) => v[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const dimMargin = Math.max(width, height) * 0.1 + 4;
  const viewBox = `${minX - PADDING - dimMargin} ${minY - PADDING - dimMargin} ${
    width + PADDING * 2 + dimMargin * 2
  } ${height + PADDING * 2 + dimMargin * 2}`;

  // Plan Y should read "up" on screen; SVG Y grows down. Flip explicitly per
  // point rather than via a group transform, so text stays upright.
  const flipY = (y: number) => minY + maxY - y;
  const fontSize = Math.min(width, height) / 40;
  const labelAreaThreshold = (width * height) / 400;

  // Overall building footprint (not the roof's overhang-extended bbox), so
  // these read as the building's actual length/width.
  const bv0 = building.vertices[0]!;
  const bv1 = building.vertices[1]!;
  const bv3 = building.vertices[3]!;
  const buildingLength = Math.hypot(bv1[0] - bv0[0], bv1[1] - bv0[1]);
  const buildingWidth = Math.hypot(bv3[0] - bv0[0], bv3[1] - bv0[1]);
  const dimTick = fontSize * 0.5;

  return (
    <svg viewBox={viewBox} style={{ width: '100%', height: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <PlanDimension
        x1={bv0[0]}
        y1={flipY(minY) + dimMargin}
        x2={bv1[0]}
        y2={flipY(minY) + dimMargin}
        label={`L = ${buildingLength.toFixed(1)} ft`}
        tickSize={dimTick}
        fontSize={fontSize}
        labelSide={1}
      />
      <PlanDimension
        x1={minX - dimMargin}
        y1={flipY(bv0[1])}
        x2={minX - dimMargin}
        y2={flipY(bv3[1])}
        label={`B = ${buildingWidth.toFixed(1)} ft`}
        tickSize={dimTick}
        fontSize={fontSize}
        labelSide={-1}
      />
      {pieces.map((piece, i) => {
        const zoneId = piece.zoneId as AnyZoneId;
        const isHovered = hovered?.source === 'roof' && hovered.zoneId === zoneId;
        const points = piece.vertices.map((v) => `${v[0]},${flipY(v[1])}`).join(' ');
        const cx = piece.vertices.reduce((s, v) => s + v[0], 0) / piece.vertices.length;
        const cy = flipY(piece.vertices.reduce((s, v) => s + v[1], 0) / piece.vertices.length);
        return (
          <g
            key={i}
            onMouseEnter={() => onHover(describeRoofHover(zoneId, sumPieceArea(pieces, zoneId), roof))}
            onMouseLeave={() => onHover(null)}
            style={{ cursor: 'pointer' }}
          >
            <polygon
              points={points}
              fill={colors[zoneId] ?? '#999'}
              fillOpacity={isHovered ? 0.95 : 0.75}
              stroke="var(--surface-1)"
              strokeWidth={0.5}
            />
            {piece.area > labelAreaThreshold && (
              <text
                x={cx}
                y={cy}
                fontSize={fontSize}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#fff"
                style={{ pointerEvents: 'none', fontWeight: 600 }}
              >
                {zoneId}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function sumPieceArea(pieces: ComputationResult['roof']['pieces'], zoneId: string): number {
  return pieces.filter((p) => p.zoneId === zoneId).reduce((s, p) => s + p.area, 0);
}
