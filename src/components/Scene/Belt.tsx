'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { BeltConfig } from '@/types';
import { useSimulationStore } from '@/store';
import { beltShaderTimeDays, generateBeltParticles } from '@/utils/belts';
import { SCENE_UNITS_PER_AU, trapezoidWeight } from '@/utils/scale';

interface BeltProps {
  config: BeltConfig;
}

/**
 * 粒子带（小行星带 / 柯伊伯带，需求 3.1.1）
 *
 * 每个粒子沿各自开普勒轨道公转（顶点着色器逐帧推进），
 * 内圈角速度大于外圈（开普勒剪切）——禁止静态环或整体刚性旋转。
 * 着色器公式与 utils/belts.ts 的 CPU 参考实现一致（低离心率二阶近似，已登记）。
 *
 * 轨道基矢在 CPU 端已从黄道坐标转换为场景坐标（含 1 AU = 10 单位缩放），
 * 着色器直接输出场景位置。
 */
export function Belt({ config }: BeltProps): JSX.Element {
  const { geometry, material } = useMemo(() => {
    const arrays = generateBeltParticles(config);
    const n = arrays.count;

    // 黄道坐标基矢 → 场景坐标（x→x, z→y, y→-z），并预乘场景缩放
    const basisP = new Float32Array(n * 3);
    const basisQ = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      basisP[i * 3] = arrays.basisP[i * 3] * SCENE_UNITS_PER_AU;
      basisP[i * 3 + 1] = arrays.basisP[i * 3 + 2] * SCENE_UNITS_PER_AU;
      basisP[i * 3 + 2] = -arrays.basisP[i * 3 + 1] * SCENE_UNITS_PER_AU;
      basisQ[i * 3] = arrays.basisQ[i * 3] * SCENE_UNITS_PER_AU;
      basisQ[i * 3 + 1] = arrays.basisQ[i * 3 + 2] * SCENE_UNITS_PER_AU;
      basisQ[i * 3 + 2] = -arrays.basisQ[i * 3 + 1] * SCENE_UNITS_PER_AU;
    }

    const geo = new THREE.BufferGeometry();
    // position 属性仅作占位（实际位置由着色器计算）
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSemiMajor', new THREE.BufferAttribute(arrays.semiMajorAu, 1));
    geo.setAttribute('aEccentricity', new THREE.BufferAttribute(arrays.eccentricity, 1));
    geo.setAttribute('aMeanAnomaly0', new THREE.BufferAttribute(arrays.meanAnomaly0, 1));
    geo.setAttribute('aMeanMotion', new THREE.BufferAttribute(arrays.meanMotionRadPerDay, 1));
    geo.setAttribute('aBasisP', new THREE.BufferAttribute(basisP, 3));
    geo.setAttribute('aBasisQ', new THREE.BufferAttribute(basisQ, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(arrays.colors, 3));
    // 视锥剔除包围球：带外缘半径
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      config.outerAu * (1 + config.maxEccentricity) * SCENE_UNITS_PER_AU * 1.2,
    );

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSimDays: { value: 0 },
        uOpacity: { value: 1 },
        uSize: { value: config.particleSize },
      },
      vertexShader: /* glsl */ `
        attribute float aSemiMajor;
        attribute float aEccentricity;
        attribute float aMeanAnomaly0;
        attribute float aMeanMotion;
        attribute vec3 aBasisP;
        attribute vec3 aBasisQ;
        attribute vec3 aColor;
        uniform float uSimDays;
        uniform float uSize;
        varying vec3 vColor;

        void main() {
          // 开普勒剪切：M = M0 + n·t（n 随半长轴减小而增大）
          float M = aMeanAnomaly0 + aMeanMotion * uSimDays;
          // 低离心率二阶近似（与 utils/belts.ts 一致）
          float E = M + aEccentricity * sin(M) * (1.0 + aEccentricity * cos(M));
          float xOrb = aSemiMajor * (cos(E) - aEccentricity);
          float yOrb = aSemiMajor * sqrt(1.0 - aEccentricity * aEccentricity) * sin(E);
          vec3 pos = aBasisP * xOrb + aBasisQ * yOrb;
          vColor = aColor;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = uSize * (320.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;

        void main() {
          // 圆形粒子（丢弃四角）
          vec2 c = gl_PointCoord - vec2(0.5);
          if (dot(c, c) > 0.25) discard;
          gl_FragColor = vec4(vColor, uOpacity * 0.85);
        }
      `,
    });
    return { geometry: geo, material: mat };
  }, [config]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(() => {
    const state = useSimulationStore.getState();
    // 时间回卷（bug 修复）：银河系/宇宙视角时间压缩后 simDays 可达 10⁹⁺ 天，
    // float32 下 n·t ~ 10⁷ 弧度使 GPU sin/cos 失效、粒子坍缩成贴日团块；
    // 按固定窗口取模后粒子仍沿各自轨道运动（统计近似登记于 utils/belts.ts）
    material.uniforms.uSimDays.value = beltShaderTimeDays(state.simDays);
    // LOD 渐变：太阳系层内容（L1 起可见），银河系层淡出（需求 3.2.2）
    material.uniforms.uOpacity.value = trapezoidWeight(state.continuousLevel, 0.5, 0.9, 2.6, 3.2);
  });

  return <points geometry={geometry} material={material} />;
}
