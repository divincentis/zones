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

export function PlanView2D({ result, onHover, hovered }: Props) {
  const colors = useZoneColors();
  const { roof } = result;
  const pieces = roof.pieces;

  const xs = pieces.flatMap((p) => p.vertices.map((v) => v[0]));
  const ys = pieces.flatMap((p) => p.vertices.map((v) => v[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const viewBox = `${minX - PADDING} ${minY - PADDING} ${width + PADDING * 2} ${height + PADDING * 2}`;

  // Plan Y should read "up" on screen; SVG Y grows down. Flip explicitly per
  // point rather than via a group transform, so text stays upright.
  const flipY = (y: number) => minY + maxY - y;
  const fontSize = Math.min(width, height) / 40;
  const labelAreaThreshold = (width * height) / 400;

  return (
    <svg viewBox={viewBox} style={{ width: '100%', height: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
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
