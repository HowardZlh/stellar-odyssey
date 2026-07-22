'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { OrbitalElements } from '@/types';
import { sampleOrbitPoints } from '@/utils/physics';
import { eclipticToScene } from '@/utils/scale';

interface OrbitLineProps {
  elements: OrbitalElements;
  color?: string;
  opacity?: number;
  segments?: number;
}

/**
 * 轨道线：预计算的准确椭圆（512 分段，附录A参考），三维姿态正确（倾角+升交点）
 *
 * 轨道线与天体渲染分离（需求 4.3）；组件卸载时释放 geometry/material 内存。
 */
export function OrbitLine({
  elements,
  color = '#88AAFF',
  opacity = 0.6,
  segments = 512,
}: OrbitLineProps): JSX.Element {
  const line = useMemo(() => {
    const points = sampleOrbitPoints(elements, segments).map((p) => {
      const s = eclipticToScene(p);
      return new THREE.Vector3(s.x, s.y, s.z);
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return new THREE.Line(geometry, material);
  }, [elements, segments, color, opacity]);

  useEffect(() => {
    return () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    };
  }, [line]);

  return <primitive object={line} />;
}
