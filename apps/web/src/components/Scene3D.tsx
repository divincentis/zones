import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import type { ComputationResult } from '../lib/buildModel';
import type { AnyZoneId } from '../lib/zoneColors';
import { useZoneColors } from '../lib/zoneColors';
import { describeRoofHover, describeWallHover, type HoverInfo } from '../lib/hoverInfo';
import { roofPieceCorners, wallPieceCorners, type Vec3 } from '../lib/vec3';
import { ZoneQuad } from './ZoneQuad';

interface Props {
  result: ComputationResult;
  onHover: (info: HoverInfo | null) => void;
  hovered: HoverInfo | null;
}

type Quad = [Vec3, Vec3, Vec3, Vec3];

function sumPieceArea(pieces: { zoneId: string; area: number }[], zoneId: string): number {
  return pieces.filter((p) => p.zoneId === zoneId).reduce((s, p) => s + p.area, 0);
}

/**
 * Canvas's `camera={{ position }}` shorthand does not orient the camera
 * toward the scene — it's created with the default (0,0,-1) forward vector,
 * and only gets pointed at the building once OrbitControls runs its first
 * update. Set it explicitly so the first frame is never blank.
 */
function CameraAim({ target }: { target: Vec3 }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.lookAt(...target);
  }, [camera, target]);
  return null;
}

export function Scene3D({ result, onHover, hovered }: Props) {
  const colors = useZoneColors();
  const { building, roof, walls } = result;

  const maxSpan = Math.max(
    ...building.vertices.map((v) => Math.hypot(v[0], v[1])),
    building.eaveHeight
  );
  const center: Vec3 = [
    building.vertices[2]![0] / 2,
    building.eaveHeight / 2,
    building.vertices[2]![1] / 2,
  ];

  return (
    <Canvas camera={{ position: [maxSpan * 0.9, maxSpan * 0.75, maxSpan * 1.1], fov: 40 }}>
      <CameraAim target={center} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[maxSpan, maxSpan * 1.5, maxSpan]} intensity={1.1} />
      <directionalLight position={[-maxSpan, maxSpan, -maxSpan]} intensity={0.3} />

      <gridHelper args={[maxSpan * 3, 24, '#666', '#333']} />

      {roof.pieces.map((piece, i) => {
        const zoneId = piece.zoneId as AnyZoneId;
        const corners = roofPieceCorners(piece.vertices, building.eaveHeight) as Quad;
        const isHovered = hovered?.source === 'roof' && hovered.zoneId === zoneId;
        return (
          <ZoneQuad
            key={`roof-${i}`}
            corners={corners}
            color={colors[zoneId] ?? '#999'}
            hovered={isHovered}
            onHoverStart={() =>
              onHover(describeRoofHover(zoneId, sumPieceArea(roof.pieces, zoneId), roof))
            }
            onHoverEnd={() => onHover(null)}
          />
        );
      })}

      {walls.pieces.map((piece, i) => {
        const zoneId = piece.zoneId as AnyZoneId;
        const start = building.vertices[piece.edgeIndex]!;
        const end = building.vertices[(piece.edgeIndex + 1) % building.vertices.length]!;
        const corners = wallPieceCorners(piece, start, end) as Quad;
        const isHovered = hovered?.source === 'wall' && hovered.zoneId === zoneId;
        return (
          <ZoneQuad
            key={`wall-${i}`}
            corners={corners}
            color={colors[zoneId] ?? '#999'}
            hovered={isHovered}
            onHoverStart={() =>
              onHover(describeWallHover(zoneId, sumPieceArea(walls.pieces, zoneId), walls))
            }
            onHoverEnd={() => onHover(null)}
          />
        );
      })}

      <OrbitControls makeDefault target={center} />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport />
      </GizmoHelper>
    </Canvas>
  );
}
