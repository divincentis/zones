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
import {
  isMonoslopeRoofResult,
  isSteepRoofResult,
  isSteppedRoofResult,
  isTallRoofResult,
  zoneSurfaceArea,
  type ComputationResult,
} from '../lib/buildModel';
import type { AnyZoneId } from '../lib/zoneColors';
import { useZoneColors } from '../lib/zoneColors';
import { describeRoofHover, describeWallHover, type HoverInfo } from '../lib/hoverInfo';
import {
  gableRoofHeight,
  gableRoofPieceCorners,
  monoslopeRoofPieceCorners,
  planToWorld,
  roofPieceCorners,
  wallPieceCorners,
  type Vec3,
} from '../lib/vec3';
import { ZoneQuad } from './ZoneQuad';
import { DimensionLine } from './Dimension3D';
import { LabelCollisionProvider, useCollidableLabelRef } from './LabelCollision';
import { steppedSections, type PlanRect } from '../lib/steppedSections';
import { fmt, fmtDoubledWidth, fmtWidth, roundUpToBoard } from '../lib/zoneDimensions';

interface Props {
  result: ComputationResult;
  onHover: (info: HoverInfo | null) => void;
  hovered: HoverInfo | null;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /** Board width (ft) to round zone-width call-outs up to, mirroring the "Zone areas" table. null/undefined = off. */
  boardSize?: number | null;
}

type Quad = [Vec3, Vec3, Vec3, Vec3];

// Dimension-line colors, saturated enough to read clearly against the
// app's off-white 3D-view ground — the original pastel tints (e.g.
// #ffcc66, #66ccff) washed out there.
const AMBER = '#b8720d';
const BLUE = '#1170a8';
const RED = '#c23b3b';
const GREEN = '#2f8f4f';

/**
 * Which call-out keeps its anchor when two labels overlap on screen (lower
 * wins; LabelCollisionProvider nudges the loser clear). Ordered by how much
 * the figure drives the work: Zone 3 and Zone 2 are the bands that actually
 * get laid out from the edge, Zone 1 is the field between them, and Zone 1'
 * — a residual of a residual, read off last — yields to all of them.
 *
 * The overall building dimensions rank last: they're drawn outside the
 * footprint already, so nudging them further out costs nothing, whereas
 * letting them hold their anchor drags the whole zone stack off the roof
 * and out over the ground plane.
 */
const DIM_PRIORITY = {
  zone3: 0,
  zone2: 1,
  zone1: 2,
  zone1Prime: 3,
  building: 9,
} as const;

// Multiplier on the camera's default distance from the building, so the
// initial framing sits back from the model a bit rather than crowding it.
const CAMERA_DISTANCE_SCALE = 1.2;

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
  // The field of view is fixed vertically, so a portrait viewport — a phone —
  // sees less from side to side and the default distance crops the building.
  // Stand back in proportion. Stepped in tenths, and left at 1 for anything
  // landscape, so dragging a desktop window's edge never refits the camera
  // and throws away the angle the user had turned it to.
  const pullBack = useThree((state) => {
    const aspect = state.size.height > 0 ? state.size.width / state.size.height : 1;
    return aspect >= 1 ? 1 : Math.min(2.2, Math.round((1 / aspect) * 10) / 10);
  });

  useEffect(() => {
    const distance = maxSpan * CAMERA_DISTANCE_SCALE * pullBack;
    camera.position.set(distance * 1.08, distance * 0.9, distance * 1.32);
    camera.near = 0.1;
    camera.far = Math.max(1000, maxSpan * 8 * pullBack);
    camera.updateProjectionMatrix();
    camera.lookAt(center[0], center[1], center[2]);

    if (controls) {
      controls.target.set(center[0], center[1], center[2]);
      controls.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls, maxSpan, pullBack, center[0], center[1], center[2]]);

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
 * Roof zone widths for the two low-slope figures, which share one layout and
 * differ only in their numbers: Fig. 3.2.2a (Zone 3 leg 0.2h thick and 0.6h
 * long, Zone 2 band 0.6h, Zone 1 boundary 1.2h) and, on a tall building,
 * Fig. 3.2.2f (leg a thick and 2a long, band a, no Zone 1'). Drawn inside the roof plan (on the actual zone
 * they measure) rather than floating outside the building footprint, so
 * each dimension reads next to the zone it describes. The leg dimension
 * only applies when Zone 3 actually exists — a parapet >= 3 ft credits the
 * corner to Zone 2, at which point the leg/far-corner split inside that
 * corner square is no longer a real zone boundary.
 */
function RoofDimensions({
  result,
  maxSpan,
  facing,
  boardSize,
}: {
  result: ComputationResult;
  maxSpan: number;
  facing: Facing;
  boardSize?: number | null;
}) {
  const { building, roof } = result;
  if (isSteepRoofResult(roof) || isMonoslopeRoofResult(roof) || isSteppedRoofResult(roof)) return null;
  const roofXs = roof.pieces.flatMap((p) => p.vertices.map((v) => v[0]));
  const roofYs = roof.pieces.flatMap((p) => p.vertices.map((v) => v[1]));
  if (roofXs.length === 0) return null;
  const roofMinX = Math.min(...roofXs);
  const roofMaxX = Math.max(...roofXs);
  const roofMinY = Math.min(...roofYs);
  const roofMaxY = Math.max(...roofYs);

  const tall = isTallRoofResult(roof);
  const band = tall ? roof.a : roof.dEdge;
  const legLength = tall ? roof.cornerLeg : roof.dEdge;
  const legThickness = tall ? roof.a : roof.legWidth;
  const interior = tall ? 0 : roof.dInterior;
  const hasZone1Prime = !tall && roof.hasZone1Prime;

  // Exact (unrounded) clamped distances — used only as the "(min ...)"
  // figure inside fmtWidth's label text, never for a line position or a
  // residual, so board-rounding can't leak into them the wrong way.
  const dEdgeXExact = Math.min(band, (roofMaxX - roofMinX) / 2);
  const dEdgeYExact = Math.min(band, (roofMaxY - roofMinY) / 2);
  const legLenXExact = Math.min(legLength, (roofMaxX - roofMinX) / 2);
  const legWExact = Math.min(legThickness, dEdgeXExact, dEdgeYExact);

  // Board-rounded (when boardSize is set) clamped distances — these drive
  // every dimension LINE's position and the Zone 1/1' residual, so the
  // call-outs stay aligned with the actual (also board-rounded) 3D pieces.
  const round = (n: number) => (boardSize ? roundUpToBoard(n, boardSize) : n);
  const dEdgeX = Math.min(round(band), (roofMaxX - roofMinX) / 2);
  const dEdgeY = Math.min(round(band), (roofMaxY - roofMinY) / 2);
  const legLenX = Math.min(round(legLength), (roofMaxX - roofMinX) / 2);
  const legW = Math.min(round(legThickness), dEdgeX, dEdgeY);
  const dIntX = Math.min(round(interior), (roofMaxX - roofMinX) / 2);
  const dIntY = Math.min(round(interior), (roofMaxY - roofMinY) / 2);
  // When Zone 1' exists, it's a rectangular field beyond both 1.2h interior
  // boundaries — a plan shape, not a band, so a foreman needs both its
  // length and width to lay it out (they aren't equal unless the roof is
  // square). When it doesn't, Zone 1 itself continues all the way in from
  // the 0.6h edge band on every side (there's no further inset), so its one
  // width call-out covers the whole inner residual.
  //
  // Zone 1/1' is a residual (roof dimension minus the edge band(s)), never a
  // width in its own right — board-rounding only ever grows the edge band,
  // so this can only shrink in response. It must never be rounded up on its
  // own (that would grow it instead), so it's derived from the already-
  // rounded edge distances above and shown as a plain exact figure.
  const zone1PrimeWidth = Math.max(0, roofMaxY - roofMinY - 2 * dIntY);
  const zone1PrimeLength = Math.max(0, roofMaxX - roofMinX - 2 * dIntX);
  // Zone 1 with no Zone 1' beyond it is the whole inner residual; with one,
  // it's the ring band between the 0.6h and 1.2h lines, which is the figure
  // a foreman lays out from — so Zone 1 gets its own call-out either way.
  const zone1Width = Math.max(0, roofMaxY - roofMinY - 2 * dEdgeY);
  const zone1BandWidth = Math.max(0, dIntY - dEdgeY);
  // On small buildings the inner bands can collapse entirely — Zone 1
  // vanishes when the 0.6h edge bands meet at the center, and Zone 2 can
  // vanish in turn when the corner legs consume the whole perimeter. Gate
  // each band's call-out on the *next* zone in still existing, since a
  // dimension for a boundary nothing sits on either side of isn't useful.
  const zone1Exists = roof.pieces.some((p) => p.zoneId === '1' || p.zoneId === "1'");
  const zone2Exists = roof.pieces.some((p) => p.zoneId === '2');
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
    Math.min(Math.max(x, roofMinX + legLenX + gap * 0.3), roofMaxX - legLenX - gap * 0.3);
  const midX = (roofMinX + roofMaxX) / 2;
  const bandX = clampX(midX - gap / 2);
  const interiorX = clampX(midX + gap / 2);
  // Zone 1' length's row is offset away from dead-center so its label doesn't
  // land on top of the width dimension's label — both would otherwise sit at
  // almost the same point, since the width line's own midpoint (at
  // interiorX) is only "gap" away from true center. The offset goes to the
  // FAR half of Zone 1', away from the camera: offsetting toward the near
  // edge walks the label out over Zones 2 and 3, where it reads as theirs.
  const zone1PrimeMinY = roofMinY + dIntY;
  const zone1PrimeMaxY = roofMaxY - dIntY;
  const lengthRowY =
    sy > 0 ? zone1PrimeMinY + zone1PrimeWidth * 0.25 : zone1PrimeMaxY - zone1PrimeWidth * 0.25;
  // Leg length is drawn just outside the roof edge (rather than inset on the
  // roof surface, like leg width) so it reads as an edge-run dimension —
  // clear of the leg-width tick and of the roof surface itself.
  const legLenOutset = Math.max(1, maxSpan * 0.02);

  return (
    <group>
      {zone3Exists && zone2Exists && legW > 1e-6 && (
        <>
          <DimensionLine
            from={at(nearX, nearY + (dirY * legW) / 2)}
            to={at(nearX + dirX * legW, nearY + (dirY * legW) / 2)}
            label={`Zone 3 leg W = ${fmtWidth(legWExact, boardSize ?? undefined)}`}
            color={AMBER}
            priority={DIM_PRIORITY.zone3}
            retreat
          />
          <DimensionLine
            from={at(nearX, nearY - dirY * legLenOutset)}
            to={at(nearX + dirX * legLenX, nearY - dirY * legLenOutset)}
            label={`Zone 3 leg L = ${fmtWidth(legLenXExact, boardSize ?? undefined)}`}
            color={AMBER}
            priority={DIM_PRIORITY.zone3}
            retreat
          />
        </>
      )}
      {zone1Exists && (
        <DimensionLine
          from={at(bandX, nearY)}
          to={at(bandX, nearY + dirY * dEdgeY)}
          label={`Zone 2 = ${fmtWidth(dEdgeYExact, boardSize ?? undefined)}`}
          color={AMBER}
          priority={DIM_PRIORITY.zone2}
          retreat
        />
      )}
      {zone1Exists &&
        (hasZone1Prime ? (
          <>
            {/* Zone 1 is the ring between the two inset lines here, so its
                dimension continues straight on from the Zone 2 band in the
                same column — each band drawn inside the zone it measures. */}
            <DimensionLine
              from={at(bandX, nearY + dirY * dEdgeY)}
              to={at(bandX, nearY + dirY * dIntY)}
              label={`Zone 1 = ${fmt(zone1BandWidth)}`}
              color={BLUE}
              priority={DIM_PRIORITY.zone1}
              retreat
            />
            <DimensionLine
              from={at(interiorX, zone1PrimeMinY)}
              to={at(interiorX, zone1PrimeMaxY)}
              label={`Zone 1' W = ${fmt(zone1PrimeWidth)}`}
              color={BLUE}
              priority={DIM_PRIORITY.zone1Prime}
              retreat
            />
            <DimensionLine
              from={at(roofMinX + dIntX, lengthRowY)}
              to={at(roofMaxX - dIntX, lengthRowY)}
              label={`Zone 1' L = ${fmt(zone1PrimeLength)}`}
              color={BLUE}
              priority={DIM_PRIORITY.zone1Prime}
              retreat
            />
          </>
        ) : (
          <DimensionLine
            from={at(interiorX, roofMinY + dEdgeY)}
            to={at(interiorX, roofMaxY - dEdgeY)}
            label={`Zone 1 = ${fmt(zone1Width)}`}
            color={BLUE}
            priority={DIM_PRIORITY.zone1}
            retreat
          />
        ))}
    </group>
  );
}

/** Gable roof band widths — rake band and ridge/eave band, both `a` — dimensioned off one rake corner. Both are plan dimensions, so drawn at a fixed height just above the eave line rather than on the sloped surface (mirrors the flat-roof RoofDimensions treatment). */
function SteepRoofDimensions({
  result,
  maxSpan,
  facing,
  boardSize,
}: {
  result: ComputationResult;
  maxSpan: number;
  facing: Facing;
  boardSize?: number | null;
}) {
  const { building, roof } = result;
  if (!isSteepRoofResult(roof) || !building.roof.ridgeLine) return null;
  const { frame, ridgeAxis, perpExtent } = resolveRidgeGeometry(building);

  // Board-rounded band distances drive line positions (matching the actual,
  // also-rounded 3D pieces); fmtWidth is still given the exact roof.*Band
  // value for its own "(min ...)" figure.
  // Above 45° the roof is wall construction and nothing is board-rounded
  // (see steepRoofZones.ts), so its call-outs stay exact too.
  const asWall = roof.pitchBand === '45+';
  const boards = asWall ? undefined : (boardSize ?? undefined);
  const round = (n: number) => (boards ? roundUpToBoard(n, boards) : n);
  const rakeBand = round(roof.rakeBand);
  const ridgeOrEaveBand = round(roof.ridgeOrEaveBand);

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
  // Two different offsets (not one shared "gap") so the two labels' anchor
  // points land clearly apart — with a single shared offset both dimensions'
  // midpoints sit almost on top of each other near the corner and their
  // pill labels overlap illegibly from most camera angles.
  const gap = Math.min(rakeBand, ridgeOrEaveBand, maxSpan * 0.03);
  const gap2 = Math.min(rakeBand, ridgeOrEaveBand, maxSpan * 0.09);
  // At 7°-27°, Zone 3 sits centered on the ridge, not at the true corner
  // (see steepRoofZones.ts) — its across-ridge width is the full 2a straddling
  // the ridge centerline, not the a-from-corner span the old single dimension
  // showed (which measured empty Zone 2 near the corner, not Zone 3 at all).
  const ridgeCenter = perpExtent / 2;
  const peakHeight = gableRoofHeight(
    building.roof.ridgeLine,
    building.roof.pitchDegrees,
    building.eaveHeight,
    perpExtent,
    toWorld(0, ridgeCenter)
  );

  return (
    <group>
      <DimensionLine
        from={at(0, gap)}
        to={at(rakeBand, gap)}
        label={`${asWall ? 'Zone 5' : 'Zone 2/3'} (rake) = ${fmtWidth(roof.rakeBand, boards)}`}
        color={AMBER}
      />
      {asWall ? (
        // Fig. 3.4.6a dimensions the peak band as a vertical drop, so it is
        // drawn as one: straight down the gable end from the peak.
        <DimensionLine
          from={planToWorld(toWorld(0, ridgeCenter), peakHeight)}
          to={planToWorld(toWorld(0, ridgeCenter), peakHeight - (roof.ridgeBandDrop ?? 0))}
          label={`Zone 5 (peak) = ${fmt(roof.ridgeBandDrop ?? 0)}`}
          color={BLUE}
        />
      ) : roof.pitchBand === '7-27' ? (
        <DimensionLine
          from={at(gap2, ridgeCenter - ridgeOrEaveBand)}
          to={at(gap2, ridgeCenter + ridgeOrEaveBand)}
          label={`Zone 3 (ridge) = ${fmtDoubledWidth(roof.ridgeOrEaveBand, boardSize ?? undefined)}`}
          color={BLUE}
        />
      ) : (
        <DimensionLine
          from={at(gap2, 0)}
          to={at(gap2, ridgeOrEaveBand)}
          label={`Zone 3 (eave) = ${fmtWidth(roof.ridgeOrEaveBand, boardSize ?? undefined)}`}
          color={BLUE}
        />
      )}
    </group>
  );
}

/** Monoslope band widths — high band/corner and low band/corner (or wrap band above 10°), both `a`-multiples — dimensioned off one corner, at a fixed height above the low eave (plan dimensions, not on the sloped surface). */
function MonoslopeRoofDimensions({
  result,
  maxSpan,
  facing,
  boardSize,
}: {
  result: ComputationResult;
  maxSpan: number;
  facing: Facing;
  boardSize?: number | null;
}) {
  const { building, roof } = result;
  if (!isMonoslopeRoofResult(roof) || !building.roof.highEdge) return null;
  const { frame, slopeAxis, highSide } = resolveMonoslopeGeometry(building);
  const slopeExtent = slopeAxis === 'u' ? frame.length : frame.width;
  const ridgeParallelExtent = slopeAxis === 'u' ? frame.width : frame.length;

  // Board-rounded band distances drive line positions (matching the actual,
  // also-rounded 3D pieces); fmtWidth is still given the exact roof.* value
  // for its own "(min ...)" figure.
  const round = (n: number) => (boardSize ? roundUpToBoard(n, boardSize) : n);
  const highBand = round(roof.highBand);
  const highCornerBand = round(roof.highCornerBand);
  const lowBand = round(roof.lowBand);
  const lowCornerBand = roof.lowCornerBand > 1e-6 ? round(roof.lowCornerBand) : 0;

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

  const gap = Math.min(highBand, highCornerBand, maxSpan * 0.03);
  const lowGap = Math.min(lowBand, lowCornerBand || lowBand, maxSpan * 0.06);
  // The depth dimension's row is pushed past the corner square entirely
  // (rather than nudged by a small multiplier) so it lands in the open
  // Zone 2' field beyond, clear of the width dimension's column regardless
  // of viewing angle — this roof is often viewed nearly edge-on to its
  // high wall, which can flatten small offsets down to nothing on screen.
  const depthRow = Math.min(highCornerBand + gap, ridgeParallelExtent / 2);

  return (
    <group>
      <DimensionLine
        from={at(gap, 0)}
        to={at(gap, highCornerBand)}
        label={`Zone 3 (high corner) = ${fmtWidth(roof.highCornerBand, boardSize ?? undefined)}`}
        color={AMBER}
      />
      <DimensionLine
        from={at(0, depthRow)}
        to={at(highBand, depthRow)}
        label={`Zone 2/3 (high side) = ${fmtWidth(roof.highBand, boardSize ?? undefined)}`}
        color={BLUE}
      />
      {/* Drawn at mid-edge (not near the corner) so it can't overlap the
          low-corner dimension below — a small offset from the corner isn't
          reliable here since this roof is often viewed nearly edge-on. */}
      <DimensionLine
        from={at(slopeExtent - lowBand, ridgeParallelExtent / 2)}
        to={at(slopeExtent, ridgeParallelExtent / 2)}
        label={`Zone 2 (low side) = ${fmtWidth(roof.lowBand, boardSize ?? undefined)}`}
        color={AMBER}
      />
      {lowCornerBand > 1e-6 && (
        <DimensionLine
          from={at(slopeExtent - lowCornerBand, lowGap)}
          to={at(slopeExtent, lowGap)}
          label={`Zone 3 (low corner, sq.) = ${fmtWidth(roof.lowCornerBand, boardSize ?? undefined)}`}
          color={BLUE}
        />
      )}
    </group>
  );
}

/**
 * Stepped-building call-outs, drawn per physical section — under the separate
 * (>= 10 ft) treatment the two sections have different `h`, so a single band
 * width would be wrong for one of them, and even under the combined
 * treatment, where one `h` covers both, the two roof planes sit at different
 * elevations and each needs its figures over its own rectangle. Plus the step
 * height itself, drawn on the shared wall, which is the dimension that
 * decides which figure governs in the first place.
 *
 * Two things make this more than RoofDimensions per section: the edge against
 * the other section carries no band (so the call-outs anchor on a free edge),
 * and the field zones are not a plain inset of the footprint (so Zone 1/1'
 * are measured off the built pieces — see steppedSections).
 */
function SteppedRoofDimensions({
  result,
  maxSpan,
  facing,
  boardSize,
}: {
  result: ComputationResult;
  maxSpan: number;
  facing: Facing;
  boardSize?: number | null;
}) {
  const { roof, step } = result;
  if (!isSteppedRoofResult(roof) || !step) return null;

  const sections = steppedSections(result);
  const { sx, sy } = facing;
  const abutMidX = (roof.abutment.from[0] + roof.abutment.to[0]) / 2;
  const abutMidY = (roof.abutment.from[1] + roof.abutment.to[1]) / 2;

  return (
    <group>
      {sections.map((section) => {
        const { rect, region, extents, role } = section;
        const spanX = rect.x1 - rect.x0;
        const spanY = rect.y1 - rect.y0;

        const dEdgeXExact = Math.min(region.dEdge, spanX / 2);
        const dEdgeYExact = Math.min(region.dEdge, spanY / 2);
        // Board-rounded — drives line positions to match the actual, also-
        // rounded 3D pieces; fmtWidth below still gets the exact value.
        const round = (n: number) => (boardSize ? roundUpToBoard(n, boardSize) : n);
        const dEdgeX = Math.min(round(region.dEdge), spanX / 2);
        const dEdgeY = Math.min(round(region.dEdge), spanY / 2);
        const dIntY = Math.min(round(region.dInterior), spanY / 2);
        const legWExact = Math.min(region.legWidth, dEdgeXExact, dEdgeYExact);
        const legW = Math.min(round(region.legWidth), dEdgeX, dEdgeY);
        const y = section.elevation + Math.max(0.3, maxSpan * 0.004);
        const at = (x: number, planY: number): Vec3 => planToWorld([x, planY], y);

        // Anchor the band call-outs on a FREE edge of this section. The edge
        // against the other section carries no band at all (the lower roof is
        // sheltered by the taller wall under Fig. 3.2.2b; the shared line is
        // interior to the single roof under Fig. 3.2.2c), so dimensioning a
        // band there would draw a figure the roof doesn't have — if the
        // camera happens to face that edge, use the opposite one.
        const facingXSide = sx > 0 ? 'x1' : 'x0';
        const facingYSide = sy > 0 ? 'y1' : 'y0';
        const xSide = section.shelteredSide === facingXSide ? (sx > 0 ? 'x0' : 'x1') : facingXSide;
        const ySide = section.shelteredSide === facingYSide ? (sy > 0 ? 'y0' : 'y1') : facingYSide;
        const nearX = xSide === 'x1' ? rect.x1 : rect.x0;
        const nearY = ySide === 'y1' ? rect.y1 : rect.y0;
        const dirX = xSide === 'x1' ? -1 : 1;
        const dirY = ySide === 'y1' ? -1 : 1;

        // Zone 1/1' as BUILT, not as re-derived from the footprint: on a
        // stepped building the field is not a plain inset (no band along the
        // abutment), so only the pieces know where it actually starts and
        // stops. A field that doesn't fill its own bounding box has no honest
        // width/length, so it gets no extent call-out — see ZoneExtent.
        const zone1 = extents['1'];
        const zone1Prime = extents["1'"];
        // Zone 1 is the ring between the two inset lines when a Zone 1' sits
        // inside it, and the whole field otherwise.
        const zone1BandWidth = Math.max(0, dIntY - dEdgeY);

        // Two side-by-side columns (mirroring RoofDimensions' flat-roof
        // treatment) so the Zone 2 band and Zone 1 width dimensions land
        // inside their own zone instead of overlapping each other.
        const gap = Math.max(2, maxSpan * 0.03);
        const midX = (rect.x0 + rect.x1) / 2;
        const clampX = (x: number) => Math.min(Math.max(x, rect.x0 + dEdgeX + gap * 0.3), rect.x1 - dEdgeX - gap * 0.3);
        const bandX = clampX(zone1 ? midX - gap / 2 : midX);
        // Zone 1/1' call-outs sit on the zone's own box, offset from its
        // center so the two don't stack on one point; the length row takes
        // the far half, away from the camera (see RoofDimensions).
        const fieldColumn = (box: PlanRect) => Math.min(box.x1, Math.max(box.x0, (box.x0 + box.x1) / 2 + gap / 2));
        const fieldRow = (box: PlanRect) =>
          sy > 0 ? box.y0 + (box.y1 - box.y0) * 0.25 : box.y1 - (box.y1 - box.y0) * 0.25;

        return (
          <group key={role}>
            <DimensionLine
              from={at(bandX, nearY)}
              to={at(bandX, nearY + dirY * dEdgeY)}
              label={`Zone 2 (${role}) = ${fmtWidth(dEdgeYExact, boardSize ?? undefined)}`}
              color={AMBER}
              priority={DIM_PRIORITY.zone2}
              retreat
            />
            {legW > 1e-6 && extents['3'] && (
              <DimensionLine
                from={at(nearX, nearY + (dirY * legW) / 2)}
                to={at(nearX + dirX * legW, nearY + (dirY * legW) / 2)}
                label={`Zone 3 leg W (${role}) = ${fmtWidth(legWExact, boardSize ?? undefined)}`}
                color={BLUE}
                priority={DIM_PRIORITY.zone3}
                retreat
              />
            )}
            {zone1 && zone1Prime && (
              <DimensionLine
                from={at(bandX, nearY + dirY * dEdgeY)}
                to={at(bandX, nearY + dirY * dIntY)}
                label={`Zone 1 (${role}) = ${fmt(zone1BandWidth)}`}
                color={GREEN}
                priority={DIM_PRIORITY.zone1}
                retreat
              />
            )}
            {zone1 && !zone1Prime && zone1.rectangular && (
              <DimensionLine
                from={at(fieldColumn(zone1), zone1.y0)}
                to={at(fieldColumn(zone1), zone1.y1)}
                label={`Zone 1 (${role}) = ${fmt(zone1.width)}`}
                color={GREEN}
                priority={DIM_PRIORITY.zone1}
                retreat
              />
            )}
            {zone1Prime?.rectangular && (
              <>
                <DimensionLine
                  from={at(fieldColumn(zone1Prime), zone1Prime.y0)}
                  to={at(fieldColumn(zone1Prime), zone1Prime.y1)}
                  label={`Zone 1' W (${role}) = ${fmt(zone1Prime.width)}`}
                  color={GREEN}
                  priority={DIM_PRIORITY.zone1Prime}
                  retreat
                />
                <DimensionLine
                  from={at(zone1Prime.x0, fieldRow(zone1Prime))}
                  to={at(zone1Prime.x1, fieldRow(zone1Prime))}
                  label={`Zone 1' L (${role}) = ${fmt(zone1Prime.length)}`}
                  color={GREEN}
                  priority={DIM_PRIORITY.zone1Prime}
                  retreat
                />
              </>
            )}
          </group>
        );
      })}

      <DimensionLine
        from={planToWorld([abutMidX, abutMidY], roof.lower.elevation)}
        to={planToWorld([abutMidX, abutMidY], roof.upper.elevation)}
        label={
          `Step = ${roof.heightDifference.toFixed(1)} ft ` +
          `(${roof.treatment === 'separate' ? `>= ${roof.threshold} ft: two roofs, Fig. 3.2.2b` : `< ${roof.threshold} ft: one roof, Fig. 3.2.2c`})`
        }
        color={RED}
      />
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
function splitGableRoofPiece<P extends { zoneId: string; vertices: Vec2[] }>(
  piece: P,
  frame: RectFrame,
  ridgeAxis: 'u' | 'v',
  perpExtent: number
): P[] {
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
      { ...piece, vertices: lo },
      { ...piece, vertices: hi },
    ];
  }

  return [piece];
}

/**
 * Wall Zone 5 corner-strip width `a`, dimensioned along both walls meeting
 * at each footprint corner. Drawn at ground level for the (up to 3) corners
 * visible from the current camera side; the one corner diagonally opposite
 * the camera is fully occluded by the building's own bulk at that height, so
 * it's skipped rather than floated above the roofline — the other corners
 * already establish `a`, and the raised version used to read as a stray
 * label hovering over the building.
 */
function WallCornerDimensions({
  building,
  walls,
  maxSpan,
  facing,
}: {
  building: ComputationResult['building'];
  walls: ComputationResult['walls'];
  maxSpan: number;
  facing: Facing;
}) {
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

  // Fixed, not maxSpan-scaled: these keep the corner call-out pinned near
  // the ground and close to the corner regardless of building size — a
  // maxSpan-proportional offset used to send the line and label climbing
  // and drifting away from the building as it got larger.
  const dimY = 0.5;
  const wallOffset = 1.5;
  const labelOffset = 2;
  const at = (p: Vec2): Vec3 => planToWorld(p, dimY);

  return (
    <group>
      {vertices.map((v, k) => {
        const isFarCorner = Math.abs(v[0] - farX) < 1e-6 && Math.abs(v[1] - farY) < 1e-6;
        if (isFarCorner) return null;

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
            <CornerLabel position={at(labelPos)} color={RED} text={`a = ${walls.a.a.toFixed(2)} ft`} />
          </group>
        );
      })}
    </group>
  );
}

/** The "a = X ft" pill for one wall corner — split out from WallCornerDimensions so it can call the label-collision hook (which, per the rules of hooks, can't be called directly inside that component's `.map()` callback). */
function CornerLabel({ position, color, text }: { position: Vec3; color: string; text: string }) {
  const labelRef = useCollidableLabelRef({ priority: DIM_PRIORITY.building });
  return (
    <Html position={position} center style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
      <div
        ref={labelRef}
        data-pdf-dim-label="true"
        style={{
          background: 'rgba(12,12,16,0.92)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          padding: '3px 7px',
          borderRadius: 3,
          borderLeft: `3px solid ${color}`,
          whiteSpace: 'nowrap',
          fontFamily: 'system-ui, sans-serif',
          boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
        }}
      >
        {text}
      </div>
    </Html>
  );
}

/**
 * Overall building footprint (L x B) and height, dimensioned further
 * out than the per-zone dimensions so they read as the whole-building
 * envelope rather than another zone band. Anchored to whichever two edges
 * currently face the camera, so the lines sit in open ground in front of
 * the viewer instead of behind the building on the far side.
 */
function BuildingDimensions({ result, maxSpan, facing }: { result: ComputationResult; maxSpan: number; facing: Facing }) {
  const { building, step } = result;
  // For a stepped building these are the OVERALL extents across both
  // sections, not the primary rectangle's — labelled as such below, since
  // neither section is "the building" on its own.
  const allVertices = step ? [...building.vertices, ...step.upper.vertices] : building.vertices;
  const xs = allVertices.map((v) => v[0]);
  const ys = allVertices.map((v) => v[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const length = maxX - minX;
  const width = maxY - minY;

  const outset = Math.max(3, maxSpan * 0.06);
  // Pushed further out than outset so the Height dimension doesn't stack on
  // the L/B labels.
  const cornerOutset = outset * 1.8;
  const { sx, sy } = facing;
  const lineY = sy > 0 ? maxY + outset : minY - outset;
  const lineX = sx > 0 ? maxX + outset : minX - outset;
  // L and B track which side the camera is currently on so they stay in
  // open ground in front of the viewer. Height instead stays pinned to the
  // building's minX side (the left of the viewport at the app's default
  // camera angle) regardless of orbiting — a fixed elevation convention
  // rather than one that jumps around and lands on the camera's near side.
  const cornerX = minX - cornerOutset;
  const cornerY = sy > 0 ? maxY + cornerOutset : minY - cornerOutset;

  const at = (p: Vec2, height = 0): Vec3 => planToWorld(p, height);

  return (
    <group>
      <DimensionLine
        from={at([minX, lineY])}
        to={at([maxX, lineY])}
        label={`${step ? 'L overall' : 'L'} = ${length.toFixed(1)} ft`}
        priority={DIM_PRIORITY.building}
        color={GREEN}
      />
      <DimensionLine
        from={at([lineX, minY])}
        to={at([lineX, maxY])}
        label={`${step ? 'B overall' : 'B'} = ${width.toFixed(1)} ft`}
        priority={DIM_PRIORITY.building}
        color={GREEN}
      />
      <DimensionLine
        from={at([cornerX, cornerY], 0)}
        to={at([cornerX, cornerY], building.eaveHeight)}
        label={`${step ? 'Height (lower)' : 'Height'} = ${building.eaveHeight.toFixed(1)} ft`}
        priority={DIM_PRIORITY.building}
        color={GREEN}
      />
      {step && (
        <DimensionLine
          from={at([cornerX - outset, cornerY], 0)}
          to={at([cornerX - outset, cornerY], step.upper.eaveHeight)}
          label={`Height (upper) = ${step.upper.eaveHeight.toFixed(1)} ft`}
          priority={DIM_PRIORITY.building}
          color={GREEN}
        />
      )}
    </group>
  );
}

export function Scene3D({ result, onHover, hovered, onCanvasReady, boardSize }: Props) {
  const colors = useZoneColors();
  const { building, roof, walls, step } = result;
  const isSteep = isSteepRoofResult(roof);
  const isMonoslope = isMonoslopeRoofResult(roof);
  const isStepped = isSteppedRoofResult(roof);
  const ridgeLine = building.roof.ridgeLine;
  const highEdge = building.roof.highEdge;
  const [facing, setFacing] = useState<Facing>(DEFAULT_FACING);

  // A stepped building's extents span both sections, and its tallest point is
  // the upper eave — frame the camera on all of it, not just the primary
  // rectangle, or the second section sits outside the view.
  const allVertices = step ? [...building.vertices, ...step.upper.vertices] : building.vertices;
  const topHeight = Math.max(building.eaveHeight, step?.upper.eaveHeight ?? 0);
  const maxSpan = Math.max(...allVertices.map((v) => Math.hypot(v[0], v[1])), topHeight);
  const center: Vec3 = [
    (Math.min(...allVertices.map((v) => v[0])) + Math.max(...allVertices.map((v) => v[0]))) / 2,
    topHeight / 2,
    (Math.min(...allVertices.map((v) => v[1])) + Math.max(...allVertices.map((v) => v[1]))) / 2,
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
      onCreated={(state) => {
        onCanvasReady?.(state.gl.domElement);
        // Without preventDefault() here, a lost WebGL context (GPU driver reset, tab
        // backgrounding, too many contexts across tabs) is never restored — the canvas
        // stays permanently blank while the DOM-based dimension labels keep rendering
        // on top, since those are unaffected by the GL context. Allowing restoration
        // and forcing a fresh frame afterward brings the 3D geometry back.
        const canvas = state.gl.domElement;
        const handleContextLost = (event: Event) => {
          event.preventDefault();
        };
        const handleContextRestored = () => {
          state.invalidate();
        };
        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);
      }}
      camera={{
        position: [
          maxSpan * CAMERA_DISTANCE_SCALE * 1.08,
          maxSpan * CAMERA_DISTANCE_SCALE * 0.9,
          maxSpan * CAMERA_DISTANCE_SCALE * 1.32,
        ],
        fov: 40,
        far: Math.max(1000, maxSpan * 8),
      }}
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
              : // A stepped building's pieces span two roof planes, so each
                // carries its own elevation (see ZonePiece.elevation).
                roofPieceCorners(piece.vertices, piece.elevation ?? building.eaveHeight)
        ) as Quad;
        const isHovered = hovered?.source === 'roof' && hovered.zoneId === zoneId;
        return (
          <ZoneQuad
            key={`roof-${i}`}
            corners={corners}
            color={colors[zoneId] ?? '#999'}
            hovered={isHovered}
            onHoverStart={() =>
              onHover(describeRoofHover(zoneId, zoneSurfaceArea(result, zoneId), roof))
            }
            onHoverEnd={() => onHover(null)}
          />
        );
      })}

      {/* Both sections' walls when stepped. The engine has already dropped the
          lower section's buried wall and raised the upper section's shared
          wall to the lower roof line (steppedWallZones.ts), so this renders
          exactly the exposed surface. */}
      {(step
        ? [
            { node: building, walls },
            { node: step.upper, walls: step.upperWalls },
          ]
        : [{ node: building, walls }]
      ).map((section, s) =>
        section.walls.pieces.map((piece, i) => {
          const zoneId = piece.zoneId as AnyZoneId;
          const start = section.node.vertices[piece.edgeIndex]!;
          const end = section.node.vertices[(piece.edgeIndex + 1) % section.node.vertices.length]!;
          const corners = wallPieceCorners(piece, start, end) as Quad;
          const isHovered = hovered?.source === 'wall' && hovered.zoneId === zoneId;
          return (
            <ZoneQuad
              key={`wall-${s}-${i}`}
              corners={corners}
              color={colors[zoneId] ?? '#999'}
              hovered={isHovered}
              onHoverStart={() =>
                onHover(
                  describeWallHover(
                    zoneId,
                    zoneSurfaceArea(result, zoneId),
                    section.walls,
                    step ? (s === 0 ? 'lower section' : 'upper section') : undefined
                  )
                )
              }
              onHoverEnd={() => onHover(null)}
            />
          );
        })
      )}

      <LabelCollisionProvider>
        {isSteep ? (
          <SteepRoofDimensions result={result} maxSpan={maxSpan} facing={facing} boardSize={boardSize} />
        ) : isMonoslope ? (
          <MonoslopeRoofDimensions result={result} maxSpan={maxSpan} facing={facing} boardSize={boardSize} />
        ) : isStepped ? (
          <SteppedRoofDimensions result={result} maxSpan={maxSpan} facing={facing} boardSize={boardSize} />
        ) : (
          <RoofDimensions result={result} maxSpan={maxSpan} facing={facing} boardSize={boardSize} />
        )}
        <WallCornerDimensions building={building} walls={walls} maxSpan={maxSpan} facing={facing} />
        {step && (
          <WallCornerDimensions
            building={step.upper}
            walls={step.upperWalls}
            maxSpan={maxSpan}
            facing={facing}
          />
        )}
        <BuildingDimensions result={result} maxSpan={maxSpan} facing={facing} />
      </LabelCollisionProvider>

      <OrbitControls makeDefault target={center} />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        {/* Scene "up" is three.js's Y axis, but construction convention treats
            Z as vertical, so the gizmo's up-pointing axis is relabeled Z (and
            the horizontal one Y) purely for display — no scene geometry uses
            these axes, so nothing else needs to change. */}
        <GizmoViewport labels={['X', 'Z', 'Y']} />
      </GizmoHelper>
    </Canvas>
  );
}
