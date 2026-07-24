'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useSimulationStore } from '@/store';
import {
  OORT_PARTICLE_COUNT,
  OORT_SEED,
  OORT_SHELL_THICKNESS_01,
  OORT_VISUAL_RADIUS_UNITS,
  generateOortShellPoints,
  oortShellReferencePoint,
} from '@/utils/oort';
import { trapezoidWeight } from '@/utils/scale';
import { setObjectTreeRaycastEnabled } from '@/utils/raycastGate';
import { getSoftPointTexture } from '@/components/CelestialBody/sharedTextures';

/**
 * 奥尔特云外边界示意（可选需求 3.1.1）
 *
 * 球壳状微弱粒子层，作为太阳系视角（L2）与银河系视角（L3）之间的
 * 过渡参照物。半径为压缩示意值（视觉夸大登记于 utils/oort.ts 文件头）。
 * 仅在 L2 末端 → L3 前段的过渡区间可见。
 */
export function OortCloud(): JSX.Element {
  const pointsRef = useRef<THREE.Points>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控
  const inRange = useSimulationStore(
    (s) => s.continuousLevel > 2.15 && s.continuousLevel < 3.1,
  );

  const { geometry, material } = useMemo(() => {
    const positions = generateOortShellPoints(
      OORT_PARTICLE_COUNT,
      OORT_VISUAL_RADIUS_UNITS,
      OORT_SHELL_THICKNESS_01,
      OORT_SEED,
    );
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      OORT_VISUAL_RADIUS_UNITS * 1.1,
    );
    const mat = new THREE.PointsMaterial({
      color: '#9fb4d8',
      size: 6,
      // 圆形软边贴图（P6 全局粒子贴图修复补遗）：消除方形粒子
      map: getSoftPointTexture(),
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
    const { continuousLevel } = useSimulationStore.getState();
    // 过渡参照物：L2 末端淡入，进入 L3 后淡出
    const weight = trapezoidWeight(continuousLevel, 2.1, 2.4, 2.7, 3.1);
    material.opacity = 0.4 * weight;
    // Raycaster 不检查透明度：淡出后禁用 raycast，避免隐形粒子壳拦截点击
    if (pointsRef.current) {
      setObjectTreeRaycastEnabled(pointsRef.current, weight > 0.05);
    }
  });

  const labelPos = oortShellReferencePoint(OORT_VISUAL_RADIUS_UNITS);

  return (
    <group name="oort-cloud">
      <points
        ref={pointsRef}
        geometry={geometry}
        material={material}
        onClick={(e) => {
          e.stopPropagation();
          selectBody('oort-cloud');
        }}
      />
      {showLabels && inRange && (
        <Html
          position={[labelPos.x, labelPos.y, labelPos.z]}
          center
          distanceFactor={2600}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-slate-300/80">
            奥尔特云外边界（示意，实际 2,000–100,000 AU）
          </span>
        </Html>
      )}
    </group>
  );
}
