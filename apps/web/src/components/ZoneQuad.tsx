import { useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { Vec3 } from '../lib/vec3';

interface Props {
  corners: [Vec3, Vec3, Vec3, Vec3];
  color: string;
  hovered: boolean;
  onHoverStart: (e: ThreeEvent<PointerEvent>) => void;
  onHoverEnd: () => void;
}

/** A flat quad mesh from 4 world-space corners (roof pieces and wall panels are always rectangles). */
export function ZoneQuad({ corners, color, hovered, onHoverStart, onHoverEnd }: Props) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(corners.flat());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    return geo;
  }, [corners]);

  return (
    <mesh
      geometry={geometry}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHoverStart(e);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHoverEnd();
      }}
    >
      <meshStandardMaterial
        color={color}
        side={THREE.DoubleSide}
        emissive={hovered ? color : '#000000'}
        emissiveIntensity={hovered ? 0.35 : 0}
      />
    </mesh>
  );
}
