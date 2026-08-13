'use client';

/**
 * 地平山脊剪影带（M3.8-3，决策 ③）：一圈程序化低多边形山脊/树线剪影——
 * 半径 30 km 三角带环（256 段 × 2 顶点索引化单 mesh），底 y 与地面盘同高、
 * 顶 = 底 + ridgeHeightProfile（正弦叠加整数频率随机剖面，周期连续无接缝，
 * 高度域 [0.05, 0.9] km → 仰角 ~0.1–1.7° 真实山脊线量级）。
 *
 * 剪影色 = labGroundColor × RIDGE_DARKEN_FACTOR（每帧同步天光，暗于地面盘）；
 * depthWrite 开（真实遮挡近地平星点/流星）。
 *
 * 渲染归属（登记）：仅地面档且非跟随（与 GroundDisk 同门控，父级挂载
 * 控制）；+1 draw call（仅地面档）。M2"禁止地景细节工作量"登记已由用户
 * 确认解除（仅限轻量剪影带，仍禁地景建模——需求 §M3.8 决策 ③）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EPOCH_LOCAL_HOURS, EPOCH_SUN_DECLINATION_DEG } from '@/utils/meteorShower';
import {
  RIDGE_DARKEN_FACTOR,
  RIDGE_RADIUS_KM,
  RIDGE_SEGMENTS,
  emptyLabSkyColors,
  labGroundColor,
  labSkyColors,
  labSunAltitudeRad,
  ridgeHeightProfile,
} from '@/utils/labSky';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

/** 山脊剖面烘焙种子（确定性，跨会话一致） */
const RIDGE_PROFILE_SEED = 0x5eed17;

interface HorizonRidgeProps {
  refs: LabFrameRefs;
  /** 底边 y（场景单位；与地面盘同高——GROUND_DISK_Y_UNITS 由父级传入） */
  baseY: number;
}

/** 地平山脊剪影环（单 mesh；几何烘焙一次，每帧只写材质色） */
export function HorizonRidge({ refs, baseY }: HorizonRidgeProps): JSX.Element {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  const geometry = useMemo(() => {
    const profile = ridgeHeightProfile(RIDGE_SEGMENTS, RIDGE_PROFILE_SEED);
    const positions = new Float32Array(RIDGE_SEGMENTS * 2 * 3);
    const indices = new Uint16Array(RIDGE_SEGMENTS * 6);
    for (let i = 0; i < RIDGE_SEGMENTS; i += 1) {
      const theta = (i / RIDGE_SEGMENTS) * Math.PI * 2;
      const x = Math.cos(theta) * RIDGE_RADIUS_KM;
      const z = Math.sin(theta) * RIDGE_RADIUS_KM;
      // 偶下标 = 底边顶点、奇下标 = 山脊线顶点
      positions[i * 6] = x;
      positions[i * 6 + 1] = baseY;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x;
      positions[i * 6 + 4] = baseY + profile[i];
      positions[i * 6 + 5] = z;
      // 环向回绕索引（周期剖面首尾闭合无接缝）
      const next = (i + 1) % RIDGE_SEGMENTS;
      indices[i * 6] = i * 2;
      indices[i * 6 + 1] = i * 2 + 1;
      indices[i * 6 + 2] = next * 2;
      indices[i * 6 + 3] = next * 2;
      indices[i * 6 + 4] = i * 2 + 1;
      indices[i * 6 + 5] = next * 2 + 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, [baseY]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  // 帧临时对象（挂载期复用，渲染循环零 GC——契约 C2.1 口径）
  const tmp = useMemo(
    () => ({ sky: emptyLabSkyColors(), ground: [0, 0, 0] as [number, number, number] }),
    []
  );

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    const sunAlt = labSunAltitudeRad(
      EPOCH_LOCAL_HOURS[shower.id],
      EPOCH_SUN_DECLINATION_DEG[shower.id],
      s.hourOffset,
      refs.timeSecRef.current / 3600,
      s.observerLat
    );
    labSkyColors(s.limitingMag, sunAlt, tmp.sky);
    labGroundColor(tmp.sky, tmp.ground);
    material.color.setRGB(
      tmp.ground[0] * RIDGE_DARKEN_FACTOR,
      tmp.ground[1] * RIDGE_DARKEN_FACTOR,
      tmp.ground[2] * RIDGE_DARKEN_FACTOR
    );
  });

  // 相机在环内 → 面朝内侧；DoubleSide 免去环向绕序心智负担。
  // depthWrite 默认开——真实遮挡近地平星点/流星（M3.8-3 口径）
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial ref={materialRef} color="#010203" side={THREE.DoubleSide} />
    </mesh>
  );
}
