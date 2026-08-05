'use client';

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  buildStarfieldCubeTexture,
  createBlackHoleLensedMaterial,
  disposeBlackHoleLensedMaterial,
} from '@/components/Scene/volumetric/BlackHoleLensed';
import { LENSING_DOMAIN_RADIUS_RS, clampLensingSteps } from '@/utils/blackHoleLensing';
import {
  BLACK_HOLE_LENSED_BASE_STEPS,
  blackHoleDiskRotElements,
  type BlackHoleLensedSceneConfig,
} from '@/utils/blackHoleScene';
import {
  advanceQualityBlend,
  createAdaptiveQuality,
  createQualityBlend,
  recordQualityFrame,
} from '@/utils/adaptiveQuality';
import { qualityTierSpec } from '@/utils/qualityTier';
import { useSimulationStore } from '@/store';

/**
 * 黑洞引力透镜主场景细节层（R4-13，IMPROVEMENT_REQUIREMENTS_4 §R4-13）
 *
 * 由 SpecialBodies.BlackHole 经 useDetailLayer({kind:'lensing'}) 门控挂载
 * （lensing 池容量 1，release-on-exit：退出淡出完成即卸载，本组件卸载时
 * 材质/星场 cubemap/黑体 LUT 全部 dispose——附录 A §6）。
 *
 * - 渲染体：R4-11/R4-12 交付的透镜 raymarch 包围球（物体空间 r_s 单位，
 *   世界尺寸经 mesh.scale = rsWorld = 廉价 shader 黑球半径同源，尺度
 *   压缩登记见 utils/blackHoleScene 文件头）；
 * - 交叉淡出：材质置 transparent（uFade = 门控 opacity01 × 层级权重，
 *   normal blending 随淡入逐渐接管背景）、renderOrder=2 晚于廉价盘/光环
 *   （additive）绘制；廉价层在 BlackHole 组件内按 (1 − 门控) 反向淡出；
 * - 背景弯曲采样：程序化星场 cubemap 近似（方案登记见 utils/blackHoleScene
 *   文件头；两黑洞确定性种子不同、两次进入一致——附录 A §2）；
 * - 自适应降级（§R4-13 第 4 条）：复用 R4-4 档位状态机，档位映射步数
 *   64/48/32（stepScale × 基准 64，clampLensingSteps 钳制、≤0.5s 平滑
 *   插值）；透镜为不透明全分辨率 raymarch，RT 半分辨率通道不适用（登记）；
 * - 渲染循环零分配：uniform 直写，盘姿态矩阵挂载时一次性写入。
 */

export interface BlackHoleLensedLayerProps {
  /** 两黑洞参数配置（utils/blackHoleScene 登记） */
  config: BlackHoleLensedSceneConfig;
  /** 每 r_s 世界长度（= 廉价 shader 黑球半径，blackHoleRsWorldUnits） */
  rsWorld: number;
  /** 读取本帧层级可见权重（useGalacticPlacement，含聚焦提升） */
  getWeight: () => number;
  /** 读取 detailLayer 门控淡入权重（useDetailLayer opacity01） */
  getGate01: () => number;
}

export function BlackHoleLensedLayer({
  config,
  rsWorld,
  getWeight,
  getGate01,
}: BlackHoleLensedLayerProps): JSX.Element {
  // M2-2 体积档设备起点（qualityTier.ts）：medium 起 mid；low 设备恒锁
  // low（32 步；本层无 RT 管线，仅步数）；high 桌面起 high = 现状
  const deviceVolume = qualityTierSpec(useSimulationStore.getState().deviceTier);
  const adaptiveRef = useRef(createAdaptiveQuality(0, deviceVolume.volumeInitialTier));
  const blendRef = useRef(createQualityBlend(deviceVolume.volumeInitialTier));
  const nowMsRef = useRef(0);
  const timeRef = useRef(0);

  // 星场 cubemap：挂载时构建一次（确定性种子），卸载即 dispose（附录 A §6）
  const starfield = useMemo(
    () => buildStarfieldCubeTexture(config.starfieldSeed),
    [config.starfieldSeed],
  );
  useEffect(() => () => starfield.dispose(), [starfield]);

  // 透镜材质：配置参数一次性注入；transparent + uFade 交叉淡出（文件头登记）
  const material = useMemo(() => {
    const mat = createBlackHoleLensedMaterial({
      starfield,
      steps: BLACK_HOLE_LENSED_BASE_STEPS,
      ringStrength: config.ringStrength,
      ringColor: config.ringColor,
      starIntensity: config.starIntensity,
      diskInnerRs: config.diskInnerRs,
      diskOuterRs: config.diskOuterRs,
      beamStrength: config.beamStrength,
      diskBrightness: config.diskBrightness,
      diskTempScale: config.diskTempScale,
    });
    mat.transparent = true;
    mat.uniforms.uFade.value = 0; // 首帧从全透明淡入
    (mat.uniforms.uDiskRot.value as THREE.Matrix3).set(
      ...blackHoleDiskRotElements(config.diskInclinationDeg),
    );
    return mat;
  }, [starfield, config]);
  useEffect(() => () => disposeBlackHoleLensedMaterial(material), [material]);

  // uniform 直写（零逐帧重渲染/零分配纪律；仅挂载期推进）
  useFrame((_, delta) => {
    nowMsRef.current += delta * 1000;
    timeRef.current += delta;
    // M2-2：low 设备锁定起始档不推进（恒 32 步）
    const state = deviceVolume.volumeTierLocked
      ? adaptiveRef.current
      : recordQualityFrame(adaptiveRef.current, nowMsRef.current);
    const blend = advanceQualityBlend(blendRef.current, state.tier, delta);
    const u = material.uniforms;
    u.uSteps.value = clampLensingSteps(BLACK_HOLE_LENSED_BASE_STEPS * blend.stepScale);
    u.uTime.value = timeRef.current;
    u.uFade.value = getGate01() * getWeight();
  });

  // mesh 等比缩放不额外旋转（cubemap 采样经 modelMatrix 旋转部分变换，
  // 材质挂载约定）；renderOrder=2：透明队列内晚于廉价盘/光环绘制
  return (
    <mesh scale={rsWorld} material={material} renderOrder={2}>
      <sphereGeometry args={[LENSING_DOMAIN_RADIUS_RS, 48, 24]} />
    </mesh>
  );
}

export default BlackHoleLensedLayer;
