import { useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
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
 * Canvas's `camera={{ position }}` shorthand only applies once, at creation
 * (react-three-fiber never re-applies it on later renders). Left alone, the
 * camera stays frozen at the dimensions the building had on first mount, so
 * resizing the building — especially by a lot — leaves the camera pointed at
 * a target that jumped away, at a distance/near/far tuned for the old scale.
 * That's what makes the model hard to find and can clip it entirely (far
 * plane too close for the new span). Refit the camera imperatively whenever
 * the building's span or center actually changes.
 */
function CameraRig({ maxSpan, center }: { maxSpan: number; center: Vec3 }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsImpl | null;

  useEffect(() => {
    camera.position.set(maxSpan * 0.9, maxSpan * 0.75, maxSpan * 1.1);
    camera.near = 0.1;
    camera.far = Math.max(1000, maxSpan * 8);
    camera.updateProjectionMatrix();
    camera.lookAt(center[0], center[1], center[2]);

    if (controls) {
      controls.target.set(center[0], center[1], center[2]);
      controls.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls, maxSpan, center[0], center[1], center[2]]);

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
    <Canvas camera={{ position: [maxSpan * 0.9, maxSpan * 0.75, maxSpan * 1.1], fov: 40, far: Math.max(1000, maxSpan * 8) }}>
      <CameraRig maxSpan={maxSpan} center={center} />
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
