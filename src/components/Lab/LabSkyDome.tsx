'use client';

/**
 * 夜天光穹壳（M3.8-1，决策 ①）：BackSide 渐变球——竖直渐变（天顶最暗 →
 * 地平带 pow 增亮）+ 朝太阳方位的晨昏辉光斑。半径 = 星穹 ×1.2 = 12000
 * （置星点深度之后，星点加性叠画其上；< far 25000）。
 *
 * 颜色/亮度全部经 utils/labSky 纯函数（labSkyColors：光害度 p 驱动夜间
 * 基色，晨昏因子随太阳高度角混向白昼色），useFrame 每帧只写 uniforms
 * （out 参数复用，渲染循环零 GC——契约 C2.1 口径）。
 *
 * 渲染归属（登记）：仅地面档且非跟随（与 GroundDisk 同门控，父级挂载
 * 控制）——太空/跟随的大气观感由 LabEarth 大气壳承担。+1 draw call
 * （仅地面档，非粒子系统，不占 §4.1 预算）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  EPOCH_LOCAL_HOURS,
  EPOCH_SUN_DECLINATION_DEG,
  STAR_DOME_RADIUS_UNITS,
  labSunDirection,
  localClockHours,
} from '@/utils/meteorShower';
import {
  SKY_DOME_RADIUS_FACTOR,
  emptyLabSkyColors,
  labSkyColors,
  labSunAltitudeRad,
} from '@/utils/labSky';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

const SKY_DOME_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 竖直渐变：band = pow(1 − |dir.y|, 3)（天顶 0 → 地平 1）混 zenith/horizon；
 * 晨昏辉光斑：朝太阳方位（xz 平面点积幂次）× 地平带 × uSunGlow 包络，
 * 暖橙色相（晨昏低空气溶胶散射口径）。
 */
const SKY_DOME_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform float uSunGlow;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float band = pow(1.0 - abs(dir.y), 3.0);
    vec3 col = mix(uZenith, uHorizon, band);
    // 朝太阳方位辉光斑（太阳在地平下时 xz 方位仍有效——晨昏光来自地平下）
    float lenD = max(length(dir.xz), 1e-5);
    float lenS = max(length(uSunDir.xz), 1e-5);
    float facing = clamp(dot(dir.xz / lenD, uSunDir.xz / lenS), 0.0, 1.0);
    col += vec3(0.9, 0.55, 0.3) * pow(facing, 6.0) * band * uSunGlow * 0.8;
    gl_FragColor = vec4(col, 1.0);
  }
`;

interface LabSkyDomeProps {
  refs: LabFrameRefs;
}

/** 夜天光穹壳（单 mesh；每帧只写 uniforms，颜色经 labSky 纯函数） */
export function LabSkyDome({ refs }: LabSkyDomeProps): JSX.Element {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: new THREE.Color(0, 0, 0) },
          uHorizon: { value: new THREE.Color(0, 0, 0) },
          uSunDir: { value: new THREE.Vector3(0, -1, 0) },
          uSunGlow: { value: 0 },
        },
        vertexShader: SKY_DOME_VERTEX_SHADER,
        fragmentShader: SKY_DOME_FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  );

  // 帧临时对象（挂载期复用，渲染循环零 GC——契约 C2.1 口径）
  const sky = useMemo(() => emptyLabSkyColors(), []);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    const elapsedHours = refs.timeSecRef.current / 3600;
    const sunAlt = labSunAltitudeRad(
      EPOCH_LOCAL_HOURS[shower.id],
      EPOCH_SUN_DECLINATION_DEG[shower.id],
      s.hourOffset,
      elapsedHours,
      s.observerLat
    );
    labSkyColors(s.limitingMag, sunAlt, sky);
    const u = material.uniforms;
    (u.uZenith.value as THREE.Color).setRGB(sky.zenith[0], sky.zenith[1], sky.zenith[2]);
    (u.uHorizon.value as THREE.Color).setRGB(sky.horizon[0], sky.horizon[1], sky.horizon[2]);
    u.uSunGlow.value = sky.sunGlow;
    // 辉光斑方位 = 实验室太阳方向（LabEarth terminator 同一公式链自洽）
    const clock = localClockHours(EPOCH_LOCAL_HOURS[shower.id], s.hourOffset, elapsedHours);
    const sunDir = labSunDirection(clock, s.observerLat, EPOCH_SUN_DECLINATION_DEG[shower.id]);
    (u.uSunDir.value as THREE.Vector3).set(sunDir[0], sunDir[1], sunDir[2]);
  });

  // 半径 12000 > 星穹 10000（星点加性叠画其上）；包围球超相机 far 的
  // 反面永远在视锥内，关剔除防整球误剔
  return (
    <mesh material={material} frustumCulled={false}>
      <sphereGeometry args={[STAR_DOME_RADIUS_UNITS * SKY_DOME_RADIUS_FACTOR, 48, 24]} />
    </mesh>
  );
}
