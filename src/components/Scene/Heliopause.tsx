'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useSimulationStore } from '@/store';
import {
  HELIOPAUSE_MAX_OPACITY,
  HELIOPAUSE_VISIBLE_LEVEL_MAX,
  HELIOPAUSE_VISIBLE_LEVEL_MIN,
  HELIOPAUSE_VISUAL_RADIUS_UNITS,
  heliopauseVisibilityWeight,
} from '@/utils/heliopause';
import { setObjectTreeRaycastEnabled } from '@/utils/raycastGate';

/**
 * 日球层顶示意（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-4）
 *
 * L2 太阳系视角外缘的半透明球壳 + 标注：太阳风与星际介质的边界（日球层
 * 外缘）。半径为压缩示意值（真实约 120 AU，登记于 utils/heliopause.ts），
 * 真实距离经标注/信息面板科普。仅 L2 段淡入，进入 L1/L3 淡出。
 */
export function Heliopause(): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // 飞往/跟随日球层顶期间标签与球壳保持可见（R2-1 聚焦权重提升）
  const inRange = useSimulationStore(
    (s) =>
      s.followBodyId === 'heliopause' ||
      s.flyToBodyId === 'heliopause' ||
      (s.continuousLevel > HELIOPAUSE_VISIBLE_LEVEL_MIN &&
        s.continuousLevel < HELIOPAUSE_VISIBLE_LEVEL_MAX),
  );

  const { geometry, material } = useMemo(() => {
    const geo = new THREE.SphereGeometry(HELIOPAUSE_VISUAL_RADIUS_UNITS, 48, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: '#5a9bd4',
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return { geometry: geo, material: mat };
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(() => {
    const { continuousLevel, followBodyId, flyToBodyId } = useSimulationStore.getState();
    // L2 段淡入（进入 L1 近观或 L3 银河系视角淡出）；
    // 飞往/跟随期间聚焦权重提升为满值（R2-1，防层级门控淡出）
    const focused = followBodyId === 'heliopause' || flyToBodyId === 'heliopause';
    const weight = heliopauseVisibilityWeight(continuousLevel, focused);
    material.opacity = HELIOPAUSE_MAX_OPACITY * weight;
    if (meshRef.current) {
      setObjectTreeRaycastEnabled(meshRef.current, weight > 0.05);
    }
  });

  return (
    <group name="heliopause">
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        onClick={(e) => {
          e.stopPropagation();
          selectBody('heliopause');
        }}
      />
      {showLabels && inRange && (
        <Html
          position={[0, HELIOPAUSE_VISUAL_RADIUS_UNITS * 0.82, 0]}
          center
          distanceFactor={900}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-sky-300/80">
            日球层顶（示意，实际约 120 AU）
          </span>
        </Html>
      )}
    </group>
  );
}
