'use client';


import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitalElements } from '@/types';
import { sampleOrbitPoints } from '@/utils/physics';
import { eclipticToScene } from '@/utils/scale';
import { planetVisibilityWeight } from '@/utils/freezeGate';
import { useSimulationStore } from '@/store';

interface OrbitLineProps {
  elements: OrbitalElements;
  color?: string;
  opacity?: number;
  segments?: number;
  /**
   * R2-3：随行星淡出门控同步透明度淡出（连续层级 2.6→3.0，
   * utils/freezeGate.planetVisibilityWeight）——轨道线隐藏与天体淡出同步
   */
  fadeWithPlanets?: boolean;
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
  fadeWithPlanets = false,
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

  // R2-3：淡出区间内每帧按权重调制不透明度（不可见时跳过更新）
  useFrame(() => {
    if (!fadeWithPlanets) return;
    const weight = planetVisibilityWeight(useSimulationStore.getState().continuousLevel);
    const material = line.material as THREE.LineBasicMaterial;
    if (material.opacity !== opacity * weight) {
      material.opacity = opacity * weight;
    }
    line.visible = weight > 0;
  });

  useEffect(() => {
    return () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    };
  }, [line]);

  return <primitive object={line} />;
}
