import * as THREE from 'three';
import { Line, Html } from '@react-three/drei';
import type { Vec3 } from '../lib/vec3';

interface DimensionLineProps {
  from: Vec3;
  to: Vec3;
  label?: string;
  color?: string;
}

/** A CAD-style dimension line: a segment with perpendicular end ticks and an optional floating label. */
export function DimensionLine({ from, to, label, color = '#e8e8e8' }: DimensionLineProps) {
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

  return (
    <group>
      <Line points={[start, end]} color={color} lineWidth={1.25} />
      <Line points={[start.clone().add(tick), start.clone().sub(tick)]} color={color} lineWidth={1.25} />
      <Line points={[end.clone().add(tick), end.clone().sub(tick)]} color={color} lineWidth={1.25} />
      {label && (
        <Html position={mid} center style={{ pointerEvents: 'none' }}>
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
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}
