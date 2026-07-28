'use client';

import type { JSX, RefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BlackHoleLensed,
  buildStarfieldCubeTexture,
} from '@/components/Scene/volumetric/BlackHoleLensed';
import { clampDiskRadii, clampLensingSteps } from '@/utils/blackHoleLensing';

/**
 * 黑洞引力透镜预览（R4-11 原型 + R4-12 吸积盘，
 * `/dev/preview?body=blackhole-test`，人工目检检查点：光子环成形 +
 * 背景星弧状拖曳 + 盘上下缘翻折像 + 近亮远暗束流不对称）
 *
 * 星场 cubemap 同时设为 scene.background（包围球外的直射背景）与透镜
 * 材质采样源（球内弯曲后方向采样）——球轮廓处弯曲趋零，内外连续。
 * 滑杆：§R4-11 三件（质量尺度 rsWorld 缩放 / 相机距离——值变化时对相机
 * 径向重置、OrbitControls 交互不受干预 / 步数 uSteps 直写）+ §R4-12
 * 四件（盘倾角——0°=正视 face-on、90°=侧视 edge-on，经绕 x 轴旋转矩阵
 * 写 uDiskRot，倾角变化时才重算矩阵 / 盘内缘 / 盘外缘——经 clampDiskRadii
 * 防交叉 / 束流强度 uBeamStrength）。uTime 每帧推进驱动盘条纹差速流动。
 *
 * 仅 dev 预览页动态 import 加载（主 bundle 零增大）；本阶段不接主场景
 * （R4-13 范围）。
 */

/** 每 r_s 世界长度基准（massScale=1 档；包围球世界半径 = 0.5×14 = 7） */
export const BLACKHOLE_PREVIEW_RS_WORLD_BASE = 0.5;

/** 与 PreviewScene 一致：预览层 uniform 覆写排在默认订阅者后、Composer 前 */
const PREVIEW_OVERRIDE_PRIORITY = 0.5;

export interface BlackHoleLensedPreviewProps {
  /** 当前滑杆值映射（key → value） */
  values: Record<string, number>;
  /** HUD 虚拟时钟读数节点（每帧直写 textContent，不走 React state） */
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
}

export function BlackHoleLensedPreview({
  values,
  clockLabelRef,
}: BlackHoleLensedPreviewProps): JSX.Element {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');
  const lastCameraDistanceRef = useRef(Number.NaN);
  const lastInclDegRef = useRef(Number.NaN);
  const lastRadiiKeyRef = useRef(Number.NaN);

  // 星场 cubemap：挂载时构建一次（确定性种子），卸载即 dispose（附录 A §6）
  const starfield = useMemo(() => buildStarfieldCubeTexture(), []);
  useEffect(() => {
    return () => {
      starfield.dispose();
    };
  }, [starfield]);

  // scene.background 共用同一 cubemap（球外直射背景）；卸载恢复黑底
  useEffect(() => {
    const prev = scene.background;
    scene.background = starfield;
    return () => {
      scene.background = prev;
    };
  }, [scene, starfield]);

  const rsWorld = BLACKHOLE_PREVIEW_RS_WORLD_BASE * (values.massScale ?? 1);

  useFrame((_, delta) => {
    virtualTimeRef.current += delta;
    // 滑杆直写 uniform（无材质重建，渲染循环零分配）
    const mat = materialRef.current;
    if (mat) {
      mat.uniforms.uSteps.value = clampLensingSteps(values.steps ?? 64);
      mat.uniforms.uTime.value = virtualTimeRef.current;
      // 内外缘：仅值变化时重钳制（clampDiskRadii 返回对象，避免逐帧分配）
      const inner = values.diskInnerRs ?? 3;
      const outer = values.diskOuterRs ?? 12;
      const radiiKey = inner * 1000 + outer;
      if (radiiKey !== lastRadiiKeyRef.current) {
        lastRadiiKeyRef.current = radiiKey;
        const radii = clampDiskRadii(inner, outer);
        mat.uniforms.uDiskInnerRs.value = radii.innerRs;
        mat.uniforms.uDiskOuterRs.value = radii.outerRs;
      }
      mat.uniforms.uBeamStrength.value = values.beamStrength ?? 1;
      // 盘倾角（0=正视/90=侧视）：仅值变化时重算旋转矩阵（复用 Matrix3 实例）
      const inclDeg = values.diskInclDeg ?? 75;
      if (inclDeg !== lastInclDegRef.current) {
        lastInclDegRef.current = inclDeg;
        // 盘法线自 +z（正视）绕 x 轴倾斜 incl°；uDiskRot = Rx(−a)，
        // a = 90° − incl（物体空间 → 盘空间，盘平面 = 盘空间 y=0）
        const a = ((90 - inclDeg) * Math.PI) / 180;
        const c = Math.cos(a);
        const s = Math.sin(a);
        (mat.uniforms.uDiskRot.value as THREE.Matrix3).set(1, 0, 0, 0, c, s, 0, -s, c);
      }
    }
    // 相机距离滑杆：仅在值变化时对相机径向重置（不干预 OrbitControls 拖拽）
    const dist = values.cameraDistance ?? Number.NaN;
    if (Number.isFinite(dist) && dist !== lastCameraDistanceRef.current) {
      lastCameraDistanceRef.current = dist;
      if (camera.position.lengthSq() > 1e-8) {
        camera.position.setLength(dist);
      }
    }
    // HUD 虚拟时钟读数（0.1s 粒度，内容变化才写 DOM）
    const label = clockLabelRef?.current;
    if (label) {
      const text = virtualTimeRef.current.toFixed(1);
      if (text !== clockTextRef.current) {
        clockTextRef.current = text;
        label.textContent = text;
      }
    }
  }, PREVIEW_OVERRIDE_PRIORITY);

  return <BlackHoleLensed rsWorld={rsWorld} starfield={starfield} materialRef={materialRef} />;
}

export default BlackHoleLensedPreview;
