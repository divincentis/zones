import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Html } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  localRectToWorld,
  localToWorld,
  resolveMonoslopeGeometry,
  resolveRidgeGeometry,
  worldToLocal,
  type RectFrame,
  type Vec2,
} from '@zones/engine';
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

// Dimension-line colors, saturated enough to read clearly against the
// app's off-white 3D-view ground — the original pastel tints (e.g.
// #ffcc66, #66ccff) washed out there.
const AMBER = '#b8720d';
const BLUE = '#1170a8';
const RED = '#c23b3b';
const GREEN = '#2f8f4f';

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
    camera.position.set(maxSpan * 1.08, maxSpan * 0.9, maxSpan * 1.32);
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

/** Which plan-space side (+x/-x, +y/-y) the camera currently sits on, relative to the building center — the "user side" the annotations should anchor to. Since every footprint is an axis-aligned rectangle (see rectFrame), this also gives the sign along a RectFrame's u/v axes directly. */
interface Facing {
  sx: 1 | -1;
  sy: 1 | -1;
}

const DEFAULT_FACING: Facing = { sx: 1, sy: 1 };

function sameFacing(a: Facing, b: Facing): boolean {
  return a.sx === b.sx && a.sy === b.sy;
}

/**
 * Tracks which side of the building the camera is currently on (plan x/y
 * sign relative to center) so dimension annotations can stay anchored to
 * the "user side" as the user orbits, instead of defaulting to a fixed
 * corner that can end up facing away from the viewer. Only calls back when
 * the side actually flips, so orbiting doesn't force a re-render every
 * frame.
 */
function FacingTracker({ center, onChange }: { center: Vec3; onChange: (facing: Facing) => void }) {
  const camera = useThree((state) => state.camera);
  const lastRef = useRef<Facing>(DEFAULT_FACING);

  useFrame(() => {
    const next: Facing = {
      sx: camera.position.x >= center[0] ? 1 : -1,
      sy: camera.position.z >= center[2] ? 1 : -1,
    };
    if (!sameFacing(next, lastRef.current)) {
      lastRef.current = next;
      onChange(next);
    }
  });

  return null;
}

/**
 * Roof zone widths — Zone 3 leg (0.2h), Zone 2/3 edge band (0.6h), Zone 1
 * interior boundary (1.2h). Drawn inside the roof plan (on the actual zone
 * they measure) rather than floating outside the building footprint, so
 * each dimension reads next to the zone it describes. The leg dimension
 * only applies when Zone 3 actually exists — a parapet >= 3 ft credits the
 * corner to Zone 2, at which point the leg/far-corner split inside that
 * corner square is no longer a real zone boundary.
 */
function RoofDimensions({ result, maxSpan, facing }: { result: ComputationResult; maxSpan: number; facing: Facing }) {
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
  // When Zone 1' exists, it's the field beyond both 1.2h interior boundaries
  // — that's the span this dimension needs to report. When it doesn't, Zone
  // 1 itself continues all the way in from the 0.6h edge band (there's no
  // further inset), so the span to report is bounded by dEdgeY, not dIntY.
  const zone1PrimeWidth = Math.max(0, roofMaxY - roofMinY - 2 * dIntY);
  const zone1Width = Math.max(0, roofMaxY - roofMinY - 2 * dEdgeY);
  const zone3Exists = roof.pieces.some((p) => p.zoneId === '3');

  const y = building.eaveHeight + Math.max(0.3, maxSpan * 0.004);
  const at = (x: number, planY: number): Vec3 => planToWorld([x, planY], y);

  // Anchor the leg/band dimensions to whichever eave edge is currently
  // facing the camera, so orbiting keeps them on the user's side of the
  // roof instead of leaving them fixed to one corner that can end up on
  // the far side, out of view or read through the building.
  const { sx, sy } = facing;
  const nearX = sx > 0 ? roofMaxX : roofMinX;
  const nearY = sy > 0 ? roofMaxY : roofMinY;
  const dirX = sx > 0 ? -1 : 1;
  const dirY = sy > 0 ? -1 : 1;

  // Two side-by-side columns, clear of the corner square, so the 0.6h band
  // and Zone 1 width dimensions land inside their own zone (Zone 2, then
  // Zone 1) instead of outside the building.
  const gap = Math.max(2, maxSpan * 0.03);
  const clampX = (x: number) =>
    Math.min(Math.max(x, roofMinX + dEdgeX + gap * 0.3), roofMaxX - dEdgeX - gap * 0.3);
  const midX = (roofMinX + roofMaxX) / 2;
  const bandX = clampX(midX - gap / 2);
  const interiorX = clampX(midX + gap / 2);

  return (
    <group>
      {zone3Exists && legW > 1e-6 && (
        <DimensionLine
          from={at(nearX, nearY + (dirY * legW) / 2)}
          to={at(nearX + dirX * legW, nearY + (dirY * legW) / 2)}
          label={`0.2h leg = ${legW.toFixed(2)} ft`}
          color={AMBER}
        />
      )}
      <DimensionLine
        from={at(bandX, nearY)}
        to={at(bandX, nearY + dirY * dEdgeY)}
        label={`0.6h band = ${dEdgeY.toFixed(2)} ft`}
        color={AMBER}
      />
      {roof.hasZone1Prime ? (
        <DimensionLine
          from={at(interiorX, roofMinY + dIntY)}
          to={at(interiorX, roofMaxY - dIntY)}
          label={`Zone 1' width = ${zone1PrimeWidth.toFixed(2)} ft`}
          color={BLUE}
        />
      ) : (
        <DimensionLine
          from={at(interiorX, roofMinY + dEdgeY)}
          to={at(interiorX, roofMaxY - dEdgeY)}
          label={`Zone 1 width = ${zone1Width.toFixed(2)} ft`}
          color={BLUE}
        />
      )}
    </group>
  );
}

/** Gable roof band widths — rake band and ridge/eave band, both `a` — dimensioned off one rake corner. Both are plan dimensions, so drawn at a fixed height just above the eave line rather than on the sloped surface (mirrors the flat-roof RoofDimensions treatment). */
function SteepRoofDimensions({ result, maxSpan, facing }: { result: ComputationResult; maxSpan: number; facing: Facing }) {
  const { building, roof } = result;
  if (!isSteepRoofResult(roof) || !building.roof.ridgeLine) return null;
  const { frame, ridgeAxis } = resolveRidgeGeometry(building);

  // The footprint frame's u/v axes always align with world x/y for this
  // app's axis-aligned rectangles (see rectFrame), so the camera-facing
  // signs translate directly into which building corner to dimension from.
  const { sx, sy } = facing;
  const nearU = sx > 0 ? frame.length : 0;
  const nearV = sy > 0 ? frame.width : 0;
  const dirU = sx > 0 ? -1 : 1;
  const dirV = sy > 0 ? -1 : 1;

  const toWorld = (rakeCoord: number, ridgeCoord: number): Vec2 => {
    const u = nearU + dirU * (ridgeAxis === 'u' ? rakeCoord : ridgeCoord);
    const v = nearV + dirV * (ridgeAxis === 'u' ? ridgeCoord : rakeCoord);
    return localToWorld(frame, u, v);
  };

  const y = building.eaveHeight + Math.max(0.3, maxSpan * 0.004);
  const at = (rakeCoord: number, ridgeCoord: number): Vec3 => planToWorld(toWorld(rakeCoord, ridgeCoord), y);

  // Nudge each line off the shared corner along the other axis so they don't
  // fan out from a single point, which put their labels on top of each
  // other from some camera angles. Scaled to the viewport (not just the
  // band widths) so the separation actually reads regardless of angle.
  const gap = Math.min(roof.rakeBand, roof.ridgeOrEaveBand, maxSpan * 0.06);

  return (
    <group>
      <DimensionLine
        from={at(0, gap)}
        to={at(roof.rakeBand, gap)}
        label={`a (rake band) = ${roof.rakeBand.toFixed(2)} ft`}
        color={AMBER}
      />
      <DimensionLine
        from={at(gap, 0)}
        to={at(gap, roof.ridgeOrEaveBand)}
        label={`a (${roof.pitchBand === '7-27' ? 'ridge' : 'eave'} band) = ${roof.ridgeOrEaveBand.toFixed(2)} ft`}
        color={BLUE}
      />
    </group>
  );
}

/** Monoslope band widths — high band/corner and low band/corner (or wrap band above 10°), both `a`-multiples — dimensioned off one corner, at a fixed height above the low eave (plan dimensions, not on the sloped surface). */
function MonoslopeRoofDimensions({ result, maxSpan, facing }: { result: ComputationResult; maxSpan: number; facing: Facing }) {
  const { building, roof } = result;
  if (!isMonoslopeRoofResult(roof) || !building.roof.highEdge) return null;
  const { frame, slopeAxis, highSide } = resolveMonoslopeGeometry(building);
  const slopeExtent = slopeAxis === 'u' ? frame.length : frame.width;
  const ridgeParallelExtent = slopeAxis === 'u' ? frame.width : frame.length;

  // The slope-axis coordinate (x, distance from the high edge) is fixed by
  // the roof's physical geometry, not the camera. Only the ridge-parallel
  // coordinate (y) can be anchored to whichever end faces the camera.
  const ridgeParallelSign = slopeAxis === 'u' ? facing.sy : facing.sx;
  const nearRidgeCoord = ridgeParallelSign > 0 ? ridgeParallelExtent : 0;
  const dirRidge = ridgeParallelSign > 0 ? -1 : 1;

  // Local (x, y): x = distance from the high edge, y = ridge-parallel position.
  const toWorld = (x: number, y: number): Vec2 => {
    const alongSlope = highSide === 'near' ? x : slopeExtent - x;
    return slopeAxis === 'u' ? localToWorld(frame, alongSlope, y) : localToWorld(frame, y, alongSlope);
  };

  const y = building.eaveHeight + Math.max(0.3, maxSpan * 0.004);
  const at = (x: number, ridgeCoord: number): Vec3 =>
    planToWorld(toWorld(x, nearRidgeCoord + dirRidge * ridgeCoord), y);

  // Nudge each line off the shared corner along the other axis so their
  // labels don't land on top of each other from some camera angles. Scaled
  // to the viewport so the separation reads regardless of angle.
  const gap = Math.min(roof.highBand, roof.highCornerBand, maxSpan * 0.06);

  return (
    <group>
      <DimensionLine
        from={at(gap, 0)}
        to={at(gap, roof.highCornerBand)}
        label={`4a (high corner) = ${roof.highCornerBand.toFixed(2)} ft`}
        color={AMBER}
      />
      <DimensionLine
        from={at(0, gap)}
        to={at(roof.highBand, gap)}
        label={`2a (high band) = ${roof.highBand.toFixed(2)} ft`}
        color={BLUE}
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
      {highRect.length === 4 && <EnvelopeMesh corners={highRect} />}
      {sideTriangles.map((corners, i) => (
        <EnvelopeMesh key={i} corners={corners} />
      ))}
    </group>
  );
}

/** Cosmetic envelope-fill mesh (gable-end / monoslope infill) — a triangle (3 corners) or a planar quad (4, split 0-1-2/0-2-3), always in the same flat neutral gray with no hover interaction. */
function EnvelopeMesh({ corners }: { corners: Vec3[] }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(corners.flat());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(corners.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]);
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
  // At <=7° the roof itself renders flat (computeLowSlopeRoofZones takes
  // over), so a pitched gable-end cap here would rise above a roof surface
  // that isn't actually pitched. Skip it to match.
  if (building.roofType !== 'gable' || !ridgeLine || building.roof.pitchDegrees <= 7) return null;
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
        return <EnvelopeMesh key={i} corners={corners} />;
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
  const locals = piece.vertices.map((p) => worldToLocal(frame, p));
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

/**
 * Wall Zone 5 corner-strip width `a`, dimensioned along both walls meeting
 * at each footprint corner. Drawn at ground level for the (up to 3)
 * corners visible from the current camera side; the one corner diagonally
 * opposite the camera is fully occluded by the building's own bulk at that
 * height, so its dimension is raised above the roofline instead — floating
 * clear of the model rather than reading as an x-ray line through it.
 */
function WallCornerDimensions({ result, maxSpan, facing }: { result: ComputationResult; maxSpan: number; facing: Facing }) {
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

  const xs = vertices.map((v) => v[0]);
  const ys = vertices.map((v) => v[1]);
  const farX = facing.sx > 0 ? Math.min(...xs) : Math.max(...xs);
  const farY = facing.sy > 0 ? Math.min(...ys) : Math.max(...ys);

  const dimY = Math.max(0.5, maxSpan * 0.015);
  const raisedY = building.eaveHeight + Math.max(3, maxSpan * 0.2);
  const wallOffset = Math.max(1.5, maxSpan * 0.02);
  const labelOffset = Math.max(2, maxSpan * 0.032);

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

        const isFarCorner = Math.abs(v[0] - farX) < 1e-6 && Math.abs(v[1] - farY) < 1e-6;
        const cornerHeight = isFarCorner ? raisedY : dimY;
        const at = (p: Vec2): Vec3 => planToWorld(p, cornerHeight);

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
                color={RED}
              />
            )}
            {inW > 1e-6 && (
              <DimensionLine
                from={at(inStart)}
                to={at([inStart[0] - inDir[0] * inW, inStart[1] - inDir[1] * inW])}
                color={RED}
              />
            )}
            <Html position={at(labelPos)} center style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
              <div
                style={{
                  background: 'rgba(12,12,16,0.92)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '3px 7px',
                  borderRadius: 3,
                  borderLeft: `3px solid ${RED}`,
                  whiteSpace: 'nowrap',
                  fontFamily: 'system-ui, sans-serif',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
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

/**
 * Overall building footprint (L x B) and eave height, dimensioned further
 * out than the per-zone dimensions so they read as the whole-building
 * envelope rather than another zone band. Anchored to whichever two edges
 * currently face the camera, so the lines sit in open ground in front of
 * the viewer instead of behind the building on the far side.
 */
function BuildingDimensions({ result, maxSpan, facing }: { result: ComputationResult; maxSpan: number; facing: Facing }) {
  const { building } = result;
  const xs = building.vertices.map((v) => v[0]);
  const ys = building.vertices.map((v) => v[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const length = maxX - minX;
  const width = maxY - minY;

  const outset = Math.max(3, maxSpan * 0.06);
  // Pushed further out than outset so the Eave dimension, anchored at the
  // same near corner as L/B for consistency, doesn't stack on their labels.
  const cornerOutset = outset * 1.8;
  const { sx, sy } = facing;
  const lineY = sy > 0 ? maxY + outset : minY - outset;
  const lineX = sx > 0 ? maxX + outset : minX - outset;
  const cornerX = sx > 0 ? maxX + cornerOutset : minX - cornerOutset;
  const cornerY = sy > 0 ? maxY + cornerOutset : minY - cornerOutset;

  const at = (p: Vec2, height = 0): Vec3 => planToWorld(p, height);

  return (
    <group>
      <DimensionLine
        from={at([minX, lineY])}
        to={at([maxX, lineY])}
        label={`L = ${length.toFixed(1)} ft`}
        color={GREEN}
      />
      <DimensionLine
        from={at([lineX, minY])}
        to={at([lineX, maxY])}
        label={`B = ${width.toFixed(1)} ft`}
        color={GREEN}
      />
      <DimensionLine
        from={at([cornerX, cornerY], 0)}
        to={at([cornerX, cornerY], building.eaveHeight)}
        label={`Eave = ${building.eaveHeight.toFixed(1)} ft`}
        color={GREEN}
      />
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
  const [facing, setFacing] = useState<Facing>(DEFAULT_FACING);

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
      camera={{ position: [maxSpan * 1.08, maxSpan * 0.9, maxSpan * 1.32], fov: 40, far: Math.max(1000, maxSpan * 8) }}
    >
      <CameraRig maxSpan={maxSpan} center={center} />
      <FacingTracker center={center} onChange={setFacing} />
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
        <SteepRoofDimensions result={result} maxSpan={maxSpan} facing={facing} />
      ) : isMonoslope ? (
        <MonoslopeRoofDimensions result={result} maxSpan={maxSpan} facing={facing} />
      ) : (
        <RoofDimensions result={result} maxSpan={maxSpan} facing={facing} />
      )}
      <WallCornerDimensions result={result} maxSpan={maxSpan} facing={facing} />
      <BuildingDimensions result={result} maxSpan={maxSpan} facing={facing} />

      <OrbitControls makeDefault target={center} />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport />
      </GizmoHelper>
    </Canvas>
  );
}
