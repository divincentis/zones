import * as THREE from 'three';
import { Line, Html } from '@react-three/drei';
import type { Vec3 } from '../lib/vec3';

interface DimensionLineProps {
  from: Vec3;
  to: Vec3;
  label?: string;
  color?: string;
  /**
   * When true, the line and label respect normal depth testing/occlusion
   * against the model instead of always drawing on top. Use this for a
   * dimension whose anchor point can genuinely sit behind the building from
   * some camera angles, so it disappears there instead of reading as an
   * x-ray line through the model. Defaults to false (always-on-top), which
   * is correct for every dimension that's kept anchored to the camera-facing
   * side of the building.
   */
  occludable?: boolean;
}

/**
 * A CAD-style dimension line: a segment with perpendicular end ticks and an
 * optional floating label. By default drawn with `depthTest={false}` and a
 * high `renderOrder` so it always reads clearly on top of the zone/envelope
 * meshes instead of getting partially buried in them, which is what made
 * dimensions hard to see and to associate with a specific zone. Pass
 * `occludable` to opt a specific dimension out of that always-on-top
 * behavior instead.
 */
export function DimensionLine({ from, to, label, color = '#333333', occludable = false }: DimensionLineProps) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const dir = end.clone().sub(start);
  const length = dir.length();
  if (length < 1e-6) return null;
  dir.normalize();

  // Ticks perpendicular to the line, in whichever plane it lies flat on.
  const up = new THREE.Vector3(0, 1, 0);
  const perp =
    Math.abs(dir.dot(up)) > 0.99
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3().crossVectors(dir, up).normalize();
  const tickLen = Math.min(length * 0.25, 1.5);
  const tick = perp.multiplyScalar(tickLen / 2);

  const mid = start.clone().add(end).multiplyScalar(0.5);
  const lineProps = {
    color,
    lineWidth: 2.25,
    depthTest: !occludable,
    renderOrder: occludable ? 0 : 999,
  };

  return (
    <group>
      <Line points={[start, end]} {...lineProps} />
      <Line points={[start.clone().add(tick), start.clone().sub(tick)]} {...lineProps} />
      <Line points={[end.clone().add(tick), end.clone().sub(tick)]} {...lineProps} />
      {label && (
        <Html
          position={mid}
          center
          occlude={occludable ? true : undefined}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div
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
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}
