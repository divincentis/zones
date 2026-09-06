import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Html } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { localRectToWorld, resolveMonoslopeGeometry, resolveRidgeGeometry, type RectFrame, type Vec2 } from '@zones/engine';
import { isMonoslopeRoofResult, isSteepRoofResult, type ComputationResult } from '../lib/buildModel';
import type { AnyZoneId } from '../lib/zoneColors';
import { useZoneColors } from '../lib/zoneColors';
import { describeRoofHover, describeWallHover, type HoverInfo } from '../lib/hoverInfo';
import {
  gableEndTriangle,
  gableRoofHeight,
  gableRoofPieceCorners,
  monoslopeRoofHeight,
  monoslopeRoofPieceCorners,
  planToWorld,
  roofPieceCorners,
  wallPieceCorners,
  type Vec3,
} from '../lib/vec3';
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
  if (isSteepRoofResult(roof) || isMonoslopeRoofResult(roof)) return null;
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

/** Gable roof band widths — rake band and ridge/eave band, both `a` — dimensioned off one rake corner. Both are plan dimensions, so drawn at a fixed height just above the eave line rather than on the sloped surface (mirrors the flat-roof RoofDimensions treatment). */
function SteepRoofDimensions({ result, maxSpan }: { result: ComputationResult; maxSpan: number }) {
  const { building, roof } = result;
  if (!isSteepRoofResult(roof) || !building.roof.ridgeLine) return null;
  const { frame, ridgeAxis } = resolveRidgeGeometry(building);

  const toWorld = (rakeCoord: number, ridgeCoord: number): Vec2 => {
    const u = ridgeAxis === 'u' ? rakeCoord : ridgeCoord;
    const v = ridgeAxis === 'u' ? ridgeCoord : rakeCoord;
    return [
      frame.origin[0] + u * frame.u[0] + v * frame.v[0],
      frame.origin[1] + u * frame.u[1] + v * frame.v[1],
    ];
  };

  const y = building.eaveHeight + Math.max(0.3, maxSpan * 0.004);
  const at = (rakeCoord: number, ridgeCoord: number): Vec3 => planToWorld(toWorld(rakeCoord, ridgeCoord), y);

  return (
    <group>
      <DimensionLine
        from={at(0, 0)}
        to={at(roof.rakeBand, 0)}
        label={`a (rake band) = ${roof.rakeBand.toFixed(2)} ft`}
        color="#ffcc66"
      />
      <DimensionLine
        from={at(0, 0)}
        to={at(0, roof.ridgeOrEaveBand)}
        label={`a (${roof.pitchBand === '7-27' ? 'ridge' : 'eave'} band) = ${roof.ridgeOrEaveBand.toFixed(2)} ft`}
        color="#66ccff"
      />
    </group>
  );
}

/** Monoslope band widths — high band/corner and low band/corner (or wrap band above 10°), both `a`-multiples — dimensioned off one corner, at a fixed height above the low eave (plan dimensions, not on the sloped surface). */
function MonoslopeRoofDimensions({ result, maxSpan }: { result: ComputationResult; maxSpan: number }) {
  const { building, roof } = result;
  if (!isMonoslopeRoofResult(roof) || !building.roof.highEdge) return null;
  const { frame, slopeAxis, highSide } = resolveMonoslopeGeometry(building);
  const slopeExtent = slopeAxis === 'u' ? frame.length : frame.width;

  // Local (x, y): x = distance from the high edge, y = ridge-parallel position.
  const toWorld = (x: number, y: number): Vec2 => {
    const alongSlope = highSide === 'near' ? x : slopeExtent - x;
    const u = slopeAxis === 'u' ? alongSlope : y;
    const v = slopeAxis === 'u' ? y : alongSlope;
    return [
      frame.origin[0] + u * frame.u[0] + v * frame.v[0],
      frame.origin[1] + u * frame.u[1] + v * frame.v[1],
    ];
  };

  const y = building.eaveHeight + Math.max(0.3, maxSpan * 0.004);
  const at = (x: number, planY: number): Vec3 => planToWorld(toWorld(x, planY), y);

  return (
    <group>
      <DimensionLine
        from={at(0, 0)}
        to={at(0, roof.highCornerBand)}
        label={`4a (high corner) = ${roof.highCornerBand.toFixed(2)} ft`}
        color="#ffcc66"
      />
      <DimensionLine
        from={at(0, 0)}
        to={at(roof.highBand, 0)}
        label={`2a (high band) = ${roof.highBand.toFixed(2)} ft`}
        color="#66ccff"
      />
    </group>
  );
}

/**
 * Monoslope envelope infill: the engine's wall zones (unchanged from the
 * rectangular-footprint formula) use a flat `eaveHeight` for all four
 * walls, but a real monoslope building's high-edge wall is taller and its
 * two side walls slope diagonally to meet it. Not wind-zone data — plain
 * neutral fill, purely so the 3D view doesn't show through to the roof
 * underside at the high edge. See scope doc §10.5.
 */
function MonoslopeEnvelopeInfill({ building }: { building: ComputationResult['building'] }) {
  const highEdge = building.roof.highEdge;
  if (building.roofType !== 'monoslope' || !highEdge) return null;
  const { frame, slopeAxis, highSide, span } = resolveMonoslopeGeometry(building);
  const highTop = monoslopeRoofHeight(
    frame,
    slopeAxis,
    highSide,
    building.roof.pitchDegrees,
    building.eaveHeight,
    span,
    highEdge[0]
  );
  const n = building.vertices.length;

  const isHighEdge = (s: Vec2, e: Vec2) => {
    const matches = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05;
    return (matches(s, highEdge[0]) && matches(e, highEdge[1])) || (matches(s, highEdge[1]) && matches(e, highEdge[0]));
  };

  const highRect: Vec3[] = [];
  const sideTriangles: Vec3[][] = [];
  for (let i = 0; i < n; i++) {
    const s = building.vertices[i]!;
    const e = building.vertices[(i + 1) % n]!;
    if (isHighEdge(s, e)) {
      highRect.push(
        planToWorld(s, building.eaveHeight),
        planToWorld(e, building.eaveHeight),
        planToWorld(e, highTop),
        planToWorld(s, highTop)
      );
      continue;
    }
    const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
    if (Math.abs(len - span) > 0.05) continue; // ridge-parallel (low) edge, not a side wall
    // Orient the triangle so its apex sits at whichever endpoint is nearer the high edge.
    const distToHigh = (p: Vec2) =>
      Math.min(Math.hypot(p[0] - highEdge[0][0], p[1] - highEdge[0][1]), Math.hypot(p[0] - highEdge[1][0], p[1] - highEdge[1][1]));
    const [low, high] = distToHigh(s) < distToHigh(e) ? [e, s] : [s, e];
    sideTriangles.push(gableEndTriangle(low, high, building.eaveHeight, high, highTop));
  }

  return (
    <group>
      {highRect.length === 4 && <EnvelopeQuad corners={highRect as Quad} />}
      {sideTriangles.map((corners, i) => (
        <EnvelopeTriangle key={i} corners={corners} />
      ))}
    </group>
  );
}

function EnvelopeQuad({ corners }: { corners: Quad }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(corners.flat());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    return geo;
  }, [corners]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#8a8a8a" side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Gable-end wall infill: the triangular envelope between the flat-topped
 * wall zone mesh (rectangular, up to eaveHeight — matching the engine's
 * wall-zone geometry exactly) and the sloped roof surface above it. Not a
 * wind zone — no engine data backs it, so it's rendered in a plain neutral
 * color with no hover interaction, purely so gable ends don't show through
 * to the roof underside.
 */
function GableEndInfill({ building }: { building: ComputationResult['building'] }) {
  const ridgeLine = building.roof.ridgeLine;
  if (building.roofType !== 'gable' || !ridgeLine) return null;
  const { perpExtent } = resolveRidgeGeometry(building);
  const n = building.vertices.length;

  const triangles: { start: Vec2; end: Vec2; apex: Vec2 }[] = [];
  for (let i = 0; i < n; i++) {
    const s = building.vertices[i]!;
    const e = building.vertices[(i + 1) % n]!;
    const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
    if (Math.abs(len - perpExtent) > 0.05) continue; // eave wall, not a rake (gable-end) wall
    const mid: Vec2 = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
    const apex = ridgeLine.reduce((closest, p) =>
      Math.hypot(p[0] - mid[0], p[1] - mid[1]) < Math.hypot(closest[0] - mid[0], closest[1] - mid[1])
        ? p
        : closest
    );
    triangles.push({ start: s, end: e, apex });
  }

  return (
    <group>
      {triangles.map((t, i) => {
        const apexHeight = gableRoofHeight(
          ridgeLine,
          building.roof.pitchDegrees,
          building.eaveHeight,
          perpExtent,
          t.apex
        );
        const corners = gableEndTriangle(t.start, t.end, building.eaveHeight, t.apex, apexHeight);
        return <EnvelopeTriangle key={i} corners={corners} />;
      })}
    </group>
  );
}

/**
 * A gable roof zone piece is an axis-aligned rectangle in the wall frame's
 * local (u, v) coordinates. Its 4 corners get correct heights from
 * gableRoofPieceCorners, but if the piece straddles the ridge (local
 * "ridge axis" coordinate crossing perpExtent/2), the true roof surface
 * peaks in the middle — a single flat quad through the 4 (lower) corners
 * would cut that peak off, rendering a warped, non-planar patch. Split any
 * straddling piece into two sub-rectangles at the ridge so every rendered
 * quad is an exactly planar slice of one roof pitch.
 */
function splitGableRoofPiece(
  piece: { zoneId: string; vertices: Vec2[] },
  frame: RectFrame,
  ridgeAxis: 'u' | 'v',
  perpExtent: number
): { zoneId: string; vertices: Vec2[] }[] {
  const toLocal = (p: Vec2) => {
    const dx = p[0] - frame.origin[0];
    const dy = p[1] - frame.origin[1];
    return { u: dx * frame.u[0] + dy * frame.u[1], v: dx * frame.v[0] + dy * frame.v[1] };
  };
  const locals = piece.vertices.map(toLocal);
  const uMin = Math.min(...locals.map((l) => l.u));
  const uMax = Math.max(...locals.map((l) => l.u));
  const vMin = Math.min(...locals.map((l) => l.v));
  const vMax = Math.max(...locals.map((l) => l.v));

  const ridgeMin = ridgeAxis === 'u' ? vMin : uMin;
  const ridgeMax = ridgeAxis === 'u' ? vMax : uMax;
  const ridgeCenter = perpExtent / 2;

  if (ridgeMin < ridgeCenter - 1e-6 && ridgeMax > ridgeCenter + 1e-6) {
    const lo =
      ridgeAxis === 'u'
        ? localRectToWorld(frame, uMin, uMax, vMin, ridgeCenter)
        : localRectToWorld(frame, uMin, ridgeCenter, vMin, vMax);
    const hi =
      ridgeAxis === 'u'
        ? localRectToWorld(frame, uMin, uMax, ridgeCenter, vMax)
        : localRectToWorld(frame, ridgeCenter, uMax, vMin, vMax);
    return [
      { zoneId: piece.zoneId, vertices: lo },
      { zoneId: piece.zoneId, vertices: hi },
    ];
  }

  return [{ zoneId: piece.zoneId, vertices: piece.vertices }];
}

function EnvelopeTriangle({ corners }: { corners: Vec3[] }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(corners.flat());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    return geo;
  }, [corners]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#8a8a8a" side={THREE.DoubleSide} />
    </mesh>
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
  const isSteep = isSteepRoofResult(roof);
  const isMonoslope = isMonoslopeRoofResult(roof);
  const ridgeLine = building.roof.ridgeLine;
  const highEdge = building.roof.highEdge;

  const maxSpan = Math.max(
    ...building.vertices.map((v) => Math.hypot(v[0], v[1])),
    building.eaveHeight
  );
  const center: Vec3 = [
    building.vertices[2]![0] / 2,
    building.eaveHeight / 2,
    building.vertices[2]![1] / 2,
  ];

  const gableGeom = useMemo(
    () => (isSteep && ridgeLine ? resolveRidgeGeometry(building) : null),
    [isSteep, ridgeLine, building]
  );
  const perpExtent = gableGeom?.perpExtent ?? 0;

  const monoslopeGeom = useMemo(
    () => (isMonoslope && highEdge ? resolveMonoslopeGeometry(building) : null),
    [isMonoslope, highEdge, building]
  );

  const renderedRoofPieces = useMemo(() => {
    if (!isSteep || !gableGeom) {
      return roof.pieces;
    }
    return roof.pieces.flatMap((p) =>
      splitGableRoofPiece(p, gableGeom.frame, gableGeom.ridgeAxis, gableGeom.perpExtent)
    );
  }, [isSteep, gableGeom, roof.pieces]);

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

      {renderedRoofPieces.map((piece, i) => {
        const zoneId = piece.zoneId as AnyZoneId;
        const corners = (
          isSteep && ridgeLine
            ? gableRoofPieceCorners(
                piece.vertices,
                ridgeLine,
                building.roof.pitchDegrees,
                building.eaveHeight,
                perpExtent
              )
            : isMonoslope && monoslopeGeom
              ? monoslopeRoofPieceCorners(
                  piece.vertices,
                  monoslopeGeom.frame,
                  monoslopeGeom.slopeAxis,
                  monoslopeGeom.highSide,
                  building.roof.pitchDegrees,
                  building.eaveHeight,
                  monoslopeGeom.span
                )
              : roofPieceCorners(piece.vertices, building.eaveHeight)
        ) as Quad;
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

      <GableEndInfill building={building} />
      <MonoslopeEnvelopeInfill building={building} />

      {isSteep ? (
        <SteepRoofDimensions result={result} maxSpan={maxSpan} />
      ) : isMonoslope ? (
        <MonoslopeRoofDimensions result={result} maxSpan={maxSpan} />
      ) : (
        <RoofDimensions result={result} maxSpan={maxSpan} />
      )}
      <WallCornerDimensions result={result} maxSpan={maxSpan} />

      <OrbitControls makeDefault target={center} />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport />
      </GizmoHelper>
    </Canvas>
  );
}
