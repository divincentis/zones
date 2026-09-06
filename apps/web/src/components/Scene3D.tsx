import { useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Html } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Vec2 } from '@zones/engine';
import type { ComputationResult } from '../lib/buildModel';
import type { AnyZoneId } from '../lib/zoneColors';
import { useZoneColors } from '../lib/zoneColors';
import { describeRoofHover, describeWallHover, type HoverInfo } from '../lib/hoverInfo';
import { planToWorld, roofPieceCorners, wallPieceCorners, type Vec3 } from '../lib/vec3';
import { ZoneQuad } from './ZoneQuad';
import { DimensionLine } from './Dimension3D';

interface Props {
  result: ComputationResult;
  onHover: (info: HoverInfo | null) => void;
  hovered: HoverInfo | null;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
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

function rotateMinus90(d: Vec2): Vec2 {
  return [d[1], -d[0]];
}

function normalize(d: Vec2): Vec2 {
  const len = Math.hypot(d[0], d[1]) || 1;
  return [d[0] / len, d[1] / len];
}

/** Roof zone widths — Zone 2/3 edge band (0.6h), Zone 3 leg (0.2h), Zone 1 interior boundary (1.2h) — dimensioned off the front-left roof corner. */
function RoofDimensions({ result, maxSpan }: { result: ComputationResult; maxSpan: number }) {
  const { building, roof } = result;
  const roofXs = roof.pieces.flatMap((p) => p.vertices.map((v) => v[0]));
  const roofYs = roof.pieces.flatMap((p) => p.vertices.map((v) => v[1]));
  if (roofXs.length === 0) return null;
  const roofMinX = Math.min(...roofXs);
  const roofMaxX = Math.max(...roofXs);
  const roofMinY = Math.min(...roofYs);
  const roofMaxY = Math.max(...roofYs);

  const dEdgeX = Math.min(roof.dEdge, (roofMaxX - roofMinX) / 2);
  const dEdgeY = Math.min(roof.dEdge, (roofMaxY - roofMinY) / 2);
  const legW = Math.min(roof.legWidth, dEdgeX, dEdgeY);
  const dIntY = Math.min(roof.dInterior, (roofMaxY - roofMinY) / 2);

  const y = building.eaveHeight + Math.max(0.3, maxSpan * 0.004);
  const outset = Math.max(0.5, maxSpan * 0.012);
  const at = (x: number, planY: number): Vec3 => planToWorld([x, planY], y);

  return (
    <group>
      <DimensionLine
        from={at(roofMinX, roofMinY - outset)}
        to={at(roofMinX + legW, roofMinY - outset)}
        label={`0.2h leg = ${legW.toFixed(2)} ft`}
        color="#ffcc66"
      />
      <DimensionLine
        from={at(roofMinX - outset, roofMinY)}
        to={at(roofMinX - outset, roofMinY + dEdgeY)}
        label={`0.6h band = ${dEdgeY.toFixed(2)} ft`}
        color="#ffcc66"
      />
      <DimensionLine
        from={at(roofMinX - outset * 2.2, roofMinY)}
        to={at(roofMinX - outset * 2.2, roofMinY + dIntY)}
        label={`1.2h interior = ${dIntY.toFixed(2)} ft`}
        color="#66ccff"
      />
    </group>
  );
}

/** Wall Zone 5 corner-strip width `a`, dimensioned along both walls meeting at each footprint corner. */
function WallCornerDimensions({ result, maxSpan }: { result: ComputationResult; maxSpan: number }) {
  const { building, walls } = result;
  const vertices = building.vertices;
  const n = vertices.length;

  const edgeLength = (i: number) => {
    const s = vertices[i]!;
    const e = vertices[(i + 1) % n]!;
    return Math.hypot(e[0] - s[0], e[1] - s[1]);
  };
  const edgeDir = (i: number): Vec2 => {
    const s = vertices[i]!;
    const e = vertices[(i + 1) % n]!;
    const len = edgeLength(i) || 1;
    return [(e[0] - s[0]) / len, (e[1] - s[1]) / len];
  };

  const dimY = Math.max(0.5, maxSpan * 0.015);
  const wallOffset = Math.max(1, maxSpan * 0.015);
  const labelOffset = Math.max(1, maxSpan * 0.02);
  const at = (p: Vec2): Vec3 => planToWorld(p, dimY);

  return (
    <group>
      {vertices.map((v, k) => {
        const inIdx = (k - 1 + n) % n;
        const outDir = edgeDir(k);
        const inDir = edgeDir(inIdx);
        const inLen = edgeLength(inIdx);

        const outPiece = walls.pieces.find(
          (p) => p.zoneId === '5' && p.edgeIndex === k && p.alongMin < 1e-6
        );
        const inPiece = walls.pieces.find(
          (p) => p.zoneId === '5' && p.edgeIndex === inIdx && Math.abs(p.alongMax - inLen) < 1e-6
        );
        if (!outPiece && !inPiece) return null;

        const outW = outPiece ? outPiece.alongMax - outPiece.alongMin : 0;
        const inW = inPiece ? inPiece.alongMax - inPiece.alongMin : 0;

        const outNormal = rotateMinus90(outDir);
        const inNormal = rotateMinus90(inDir);
        const bisector = normalize([outNormal[0] + inNormal[0], outNormal[1] + inNormal[1]]);
        const labelPos: Vec2 = [v[0] + bisector[0] * labelOffset, v[1] + bisector[1] * labelOffset];

        const outStart: Vec2 = [v[0] + outNormal[0] * wallOffset, v[1] + outNormal[1] * wallOffset];
        const inStart: Vec2 = [v[0] + inNormal[0] * wallOffset, v[1] + inNormal[1] * wallOffset];

        return (
          <group key={k}>
            {outW > 1e-6 && (
              <DimensionLine
                from={at(outStart)}
                to={at([outStart[0] + outDir[0] * outW, outStart[1] + outDir[1] * outW])}
                color="#ff9999"
              />
            )}
            {inW > 1e-6 && (
              <DimensionLine
                from={at(inStart)}
                to={at([inStart[0] - inDir[0] * inW, inStart[1] - inDir[1] * inW])}
                color="#ff9999"
              />
            )}
            <Html position={at(labelPos)} center style={{ pointerEvents: 'none' }}>
              <div
                style={{
                  background: 'rgba(20,20,24,0.85)',
                  color: '#fff',
                  fontSize: 11,
                  padding: '2px 5px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                a = {walls.a.a.toFixed(2)} ft
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

export function Scene3D({ result, onHover, hovered, onCanvasReady }: Props) {
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
    <Canvas
      gl={{ preserveDrawingBuffer: true }}
      onCreated={(state) => onCanvasReady?.(state.gl.domElement)}
      camera={{ position: [maxSpan * 0.9, maxSpan * 0.75, maxSpan * 1.1], fov: 40, far: Math.max(1000, maxSpan * 8) }}
    >
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

      <RoofDimensions result={result} maxSpan={maxSpan} />
      <WallCornerDimensions result={result} maxSpan={maxSpan} />

      <OrbitControls makeDefault target={center} />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport />
      </GizmoHelper>
    </Canvas>
  );
}
