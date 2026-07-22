'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createSeededRandom } from '@/utils/random';

/** 恒星温度色板（O/B 蓝 → M 红，需求 4.1/4.2） */
const STAR_COLORS = ['#9bb0ff', '#aabfff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffd2a1', '#ffcc6f'];

interface StarfieldProps {
  count?: number;
  innerRadius?: number;
  outerRadius?: number;
  seed?: number;
}

/**
 * 确定性星场背景：种子化伪随机保证位置稳定（无闪屏），
 * 颜色按恒星温度分布采样，亮度含距离衰减。
 */
export function Starfield({
  count = 6000,
  innerRadius = 2000,
  outerRadius = 40000,
  seed = 20260722,
}: StarfieldProps): JSX.Element {
  const { geometry, material } = useMemo(() => {
    const rand = createSeededRandom(seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < count; i += 1) {
      // 球壳内均匀分布
      const u = rand();
      const v = rand();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = innerRadius + (outerRadius - innerRadius) * Math.cbrt(rand());
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      // 温度色板 + 距离衰减
      color.set(STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)]);
      const falloff = 1 - (0.6 * (r - innerRadius)) / (outerRadius - innerRadius);
      colors[i * 3] = color.r * falloff;
      colors[i * 3 + 1] = color.g * falloff;
      colors[i * 3 + 2] = color.b * falloff;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 12,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    return { geometry: geo, material: mat };
  }, [count, innerRadius, outerRadius, seed]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return <points geometry={geometry} material={material} />;
}
