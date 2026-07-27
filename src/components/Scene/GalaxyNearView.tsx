'use client';


import type { JSX } from 'react';
/**
 * L4 星系近观 3D 粒子层组件（R2-8，IMPROVEMENT_REQUIREMENTS_2 §R2-8）
 *
 * 挂载于 Universe.tsx GalaxyObject 组内（星系本地坐标系），呈现纯逻辑
 * utils/galaxyNearView 生成的确定性粒子结构（旋涡=核球+盘+旋臂 /
 * 不规则=团块云 / 椭圆=Sérsic 椭球云）。粒子静态（几何只建一次，
 * 渲染循环仅更新 uOpacity 一个 uniform，零分配零随机）；粒子层朝向
 * 沿用贴图平面时期的确定性 id 哈希朝向（galaxyOrientationFromId）。
 * 卸载即 dispose 几何与材质（LRU 挤出时由父组件卸载）。
 */

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GalaxyData } from '@/types';
import {
  galaxyOrientationFromId,
  generateGalaxyNearViewParticles,
  nearViewReferenceRadiusLy,
} from '@/utils/galaxyNearView';
import { galaxyPlaneSizeUnits } from '@/utils/universe';

interface GalaxyNearViewLayerProps {
  galaxy: GalaxyData;
  /** 读取本帧不透明度权重（宇宙层级淡入权重 × 近观激活权重） */
  getOpacity: () => number;
}

/** 近观粒子层（几何/材质随组件卸载 dispose） */
export function GalaxyNearViewLayer({
  galaxy,
  getOpacity,
}: GalaxyNearViewLayerProps): JSX.Element {
  const orientation = useMemo(() => galaxyOrientationFromId(galaxy.id), [galaxy.id]);

  const { geometry, material } = useMemo(() => {
    const particles = generateGalaxyNearViewParticles(galaxy.id);
    // 光年 → 场景单位：粒子参考半径对齐贴图平面半边长（同源公式，
    // 交叉淡出时 3D 结构与贴图平面尺寸一致无跳变）
    const sizeUnits = galaxyPlaneSizeUnits(galaxy.diameterLy);
    const unitsPerLy = sizeUnits / 2 / nearViewReferenceRadiusLy(galaxy.id);
    const positions = new Float32Array(particles.count * 3);
    for (let i = 0; i < particles.count * 3; i += 1) {
      positions[i] = particles.positionsLy[i] * unitsPerLy;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(particles.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(particles.sizes, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), sizeUnits);

    // 与 Galaxy.tsx 银盘粒子同风格的软边圆点 shader（尺寸随距离衰减）
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uOpacity: { value: 0 },
        uPointScale: { value: sizeUnits * 4 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uPointScale;
        varying vec3 vColor;

        void main() {
          vColor = aColor;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (uPointScale / -mvPosition.z), 1.0, 6.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;

        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          float falloff = 1.0 - smoothstep(0.05, 0.25, d2);
          gl_FragColor = vec4(vColor, uOpacity * (0.35 + 0.65 * falloff));
        }
      `,
    });
    return { geometry: geo, material: mat };
  }, [galaxy.id, galaxy.diameterLy]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(() => {
    material.uniforms.uOpacity.value = getOpacity();
  });

  return (
    <points
      geometry={geometry}
      material={material}
      rotation={orientation}
      frustumCulled={false}
      raycast={() => null}
    />
  );
}
