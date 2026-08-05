'use client';

import type { JSX, MutableRefObject, RefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clampVolumeSteps } from '@/utils/volume';
import {
  advanceRgVolumeBuild,
  createRgDensityTexture,
  createRgVolumeBuild,
} from '@/utils/nebulaVolume';
import {
  orionVolumeFadeTarget,
  type NebulaVolumeLayerConfig,
} from '@/utils/nebulaVolumeScene';
import {
  advanceQualityBlend,
  createAdaptiveQuality,
  createQualityBlend,
  moveToward,
  recordQualityFrame,
} from '@/utils/adaptiveQuality';
import { DETAIL_LAYER_TRANSITION_SECONDS } from '@/utils/detailLayer';
import { qualityTierSpec } from '@/utils/qualityTier';
import { useSimulationStore } from '@/store';
import { createNebulaVolumeMaterial } from '@/components/Scene/volumetric/NebulaVolumeMaterial';
import {
  disposeVolumeMaterial,
  VOLUME_RENDER_ORDER,
} from '@/components/Scene/volumetric/VolumeMaterial';
import {
  createFullscreenTriangleGeometry,
  createVolumeCompositeMaterial,
  createVolumeRenderTarget,
  updateVolumeRtViewport,
  writeCompositeUniforms,
} from '@/components/Scene/volumetric/VolumeHalfRes';
import {
  addVolumeStarSprites,
  buildStarSpriteTexture,
} from '@/components/Scene/volumetric/TrapeziumSprites';

/**
 * 星云主场景体积层（R4-8 首建为 OrionVolumeLayer，R4-14 泛化：M42/M57
 * 共用同一接线，密度场/材质参数/内嵌星点经 `NebulaVolumeLayerConfig`
 * 注入——IMPROVEMENT_REQUIREMENTS_4 §R4-8/§R4-14）
 *
 * 由 SpecialBodies 各星云组件经 useDetailLayer({kind:'volume'}) 门控
 * 挂载（release-on-exit：退出淡出完成即卸载，本组件卸载时纹理/RT/材质
 * 全部 dispose——附录 A §6；volume 池容量 1，M42↔M57 切换时 LRU 逐出）。
 * 渲染路径沿用 R4-4/R4-7 预览页：
 * - 分帧烘焙：每帧 ≤22ms 预算推进 RG 密度场 z 切片（单块 <100ms 卡顿
 *   约束）；构建完成前体积淡入目标为 0（billboard 保持，交叉过渡无空档，
 *   `orionVolumeFadeTarget` 通用登记）；
 * - 半分辨率 RT + 全屏三角形合成（自适应质量状态机主场景生效：
 *   high 基准步数/full → mid ×0.75/half → low ×0.5/half）；
 * - 位姿对齐：体积容器逐帧复制 groupRef 世界矩阵（M42 = 星云组，
 *   M57 = 环壳缩放组——倾斜姿态 + 膨胀动画随动），包围盒边长由调用方
 *   按 `*VolumeBoxEdgeUnits` 计算注入；
 * - 内嵌星点 sprite（M42 Trapezium 四星 / M57 中心白矮星色档）先于体积
 *   mesh 绘制，按透射率压暗。
 *
 * 深度合成差异登记（R4-8 结论沿用）：合成三角形 depthTest=false——体积
 * 仅在跟随/飞往本目标近观时激活（volume 池容量 1），视野内无其他前景
 * 实体穿插（组内 billboard/星点经交叉淡出移交），维持无深度合成方案。
 *
 * 交叉淡出实现差异登记：detailLayer opacity01（0.5s）之上叠加"构建就绪"
 * 门控的二次平滑（moveToward 同时长）——首次进入若烘焙晚于门控就绪，
 * 有效过渡时长 0.5–1s；再次进入（纹理已随组件卸载释放，重新烘焙）同理。
 */

/** 分帧构建每帧时间预算 ms（与 R4-7 预览页一致，单块 ≪100ms） */
const BUILD_BUDGET_MS = 22;

/** 体积 RT pass 优先级：晚于默认 useFrame（0）、早于 EffectComposer（1） */
const VOLUME_RT_PASS_PRIORITY = 0.7;

/** raycast 空实现：全屏合成三角形不拦截点击（raycastGate 兼容） */
const NOOP_RAYCAST = (): void => {};

export interface NebulaVolumeLayerProps {
  /** 位姿参考组 ref（世界矩阵逐帧复制来源；含姿态/膨胀等父级变换） */
  groupRef: RefObject<THREE.Group | null>;
  /** 体积包围盒世界边长（场景单位；调用方按配置系数计算） */
  boxEdgeUnits: number;
  /** 层配置（密度场/材质参数/内嵌星点；调用方 useMemo 稳定） */
  config: NebulaVolumeLayerConfig;
  /** 读取本帧层级可见权重（useGalacticPlacement，含聚焦提升） */
  getWeight: () => number;
  /** 读取 detailLayer 门控淡入权重（useDetailLayer opacity01） */
  getGate01: () => number;
  /** 输出：本帧体积视觉淡入权重（宿主组件交叉淡出消费） */
  fadeRef: MutableRefObject<number>;
}

export function NebulaVolumeLayer({
  groupRef,
  boxEdgeUnits,
  config,
  getWeight,
  getGate01,
  fadeRef,
}: NebulaVolumeLayerProps): JSX.Element {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  // M2-2 体积档设备起点（qualityTier.ts）：medium 起 mid；low 设备恒锁
  // low（32 步 + RT 0.5）；high 桌面起 high = 现状
  const deviceVolume = qualityTierSpec(useSimulationStore.getState().deviceTier);
  const adaptiveRef = useRef(createAdaptiveQuality(0, deviceVolume.volumeInitialTier));
  const blendRef = useRef(createQualityBlend(deviceVolume.volumeInitialTier));
  const nowMsRef = useRef(0);
  const timeRef = useRef(0);
  const buildWallStartRef = useRef<number | null>(null);

  // 资源：挂载时创建一次；体积纹理/材质在分帧烘焙完成后惰性创建，
  // 卸载统一 dispose（附录 A §6；useDetailLayer release-on-exit 卸载）
  const resources = useMemo(() => {
    const buildState = createRgVolumeBuild(config.textureSize, config.makeSampler());
    const volumeScene = new THREE.Scene();
    // 位姿容器：矩阵逐帧复制参考组世界矩阵（姿态/膨胀变换对齐）
    const volumeRoot = new THREE.Group();
    volumeRoot.matrixAutoUpdate = false;
    volumeScene.add(volumeRoot);
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const starTexture = buildStarSpriteTexture(config.starTint);
    const starMaterial = new THREE.SpriteMaterial({
      map: starTexture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    addVolumeStarSprites(volumeRoot, starMaterial, boxEdgeUnits, config.stars);
    const rt = createVolumeRenderTarget(2, 2); // 首帧按实际缓冲尺寸同步
    const compositeMaterial = createVolumeCompositeMaterial(rt);
    const compositeGeometry = createFullscreenTriangleGeometry();
    const compositeMesh = new THREE.Mesh(compositeGeometry, compositeMaterial);
    compositeMesh.renderOrder = VOLUME_RENDER_ORDER;
    compositeMesh.frustumCulled = false;
    compositeMesh.raycast = NOOP_RAYCAST; // 全屏三角形不拦截点击
    compositeMesh.visible = false; // 淡入前不参与合成
    return {
      buildState,
      volumeScene,
      volumeRoot,
      boxGeometry,
      starTexture,
      starMaterial,
      rt,
      compositeMaterial,
      compositeGeometry,
      compositeMesh,
      texture: null as THREE.Data3DTexture | null,
      material: null as THREE.ShaderMaterial | null,
      // RT pass 复用的临时对象（渲染循环零分配）
      drawSize: new THREE.Vector2(),
      savedClearColor: new THREE.Color(),
    };
  }, [boxEdgeUnits, config]);

  useEffect(() => {
    const outFade = fadeRef;
    return () => {
      resources.compositeGeometry.dispose();
      resources.compositeMaterial.dispose();
      resources.rt.dispose();
      resources.starMaterial.dispose();
      resources.starTexture.dispose();
      resources.boxGeometry.dispose();
      if (resources.material) disposeVolumeMaterial(resources.material);
      if (resources.texture) resources.texture.dispose();
      // 卸载即复位交叉淡出权重（billboard/近观粒子立即恢复）
      outFade.current = 0;
    };
  }, [resources, fadeRef]);

  // ① 分帧烘焙推进 + 自适应质量 + uniform 直写（默认优先级；
  //    晚于 useGalacticPlacement 的组定位，附录 A 零逐帧重渲染纪律）
  useFrame((_, delta) => {
    nowMsRef.current += delta * 1000;
    timeRef.current += delta;
    let volumeMaterial = resources.material;
    if (!volumeMaterial) {
      if (buildWallStartRef.current === null) {
        buildWallStartRef.current = performance.now();
      }
      const done = advanceRgVolumeBuild(resources.buildState, BUILD_BUDGET_MS);
      if (!done) {
        // 构建期：淡入目标 0（billboard 保持原样，无过渡空档）
        fadeRef.current = moveToward(
          fadeRef.current,
          orionVolumeFadeTarget(getGate01(), false),
          delta / DETAIL_LAYER_TRANSITION_SECONDS,
        );
        return;
      }
      const wallMs = performance.now() - (buildWallStartRef.current ?? performance.now());
      const { buildState } = resources;
      // 主场景烘焙打点登记（无头 Chrome 目验取证；§R4-8/§R4-14）
      console.info(
        `[${config.logTag}] 主场景 ${buildState.size}³ 分帧烘焙完成：墙钟 ${wallMs.toFixed(0)} ms、` +
          `计算 ${buildState.computeMs.toFixed(0)} ms、块数 ${buildState.chunkCount}、` +
          `最大单块 ${buildState.maxChunkMs.toFixed(1)} ms（<100ms 卡顿约束）`,
      );
      const texture = createRgDensityTexture(buildState.size, buildState.data);
      const { params } = config;
      volumeMaterial = createNebulaVolumeMaterial({
        map: texture,
        steps: params.baseSteps,
        densityScale: params.densityScale,
        dustStrength: params.dustStrength,
        weightBias: params.weightBias,
        intensity: params.intensity,
        colorHa: params.colorHa,
        colorOIII: params.colorOIII,
        core: params.core,
        weightInnerR: params.weightInnerR,
        weightOuterR: params.weightOuterR,
        weightInvRadii: params.weightInvRadii,
        expandAmp: params.expandAmp,
        expandPeriodSec: params.expandPeriodSec,
      });
      const mesh = new THREE.Mesh(resources.boxGeometry, volumeMaterial);
      mesh.scale.setScalar(boxEdgeUnits);
      mesh.renderOrder = 1; // 晚于星点 sprite：体积按透射率覆盖压暗
      resources.volumeRoot.add(mesh);
      resources.texture = texture;
      resources.material = volumeMaterial;
    }

    // 自适应质量状态机（主场景生效，无强制档滑杆；M2-2：low 设备锁定
    // 起始档不推进——恒 32 步 + RT 0.5）
    const state = deviceVolume.volumeTierLocked
      ? adaptiveRef.current
      : recordQualityFrame(adaptiveRef.current, nowMsRef.current);
    const blend = advanceQualityBlend(blendRef.current, state.tier, delta);
    const u = volumeMaterial.uniforms;
    u.uSteps.value = clampVolumeSteps(config.params.baseSteps * blend.stepScale);
    u.uQuality.value = blend.stepScale;
    u.uTime.value = timeRef.current;

    // 体积视觉淡入权重（构建就绪门控 × detailLayer 门控，交叉淡出输出；
    // moveToward 线性逼近 0.5s 与 advanceFrameTransition 同速率语义）
    fadeRef.current = moveToward(
      fadeRef.current,
      orionVolumeFadeTarget(getGate01(), true),
      delta / DETAIL_LAYER_TRANSITION_SECONDS,
    );
  });

  // ② 体积 RT pass（优先级 0.7：晚于 ① 与组定位、早于 Composer 渲染）
  useFrame(() => {
    const group = groupRef.current;
    const fade = fadeRef.current * getWeight();
    const { compositeMesh, compositeMaterial } = resources;
    if (!group || !group.visible || fade <= 0.001) {
      compositeMesh.visible = false;
      return;
    }
    compositeMesh.visible = true;
    compositeMaterial.uniforms.uOpacity.value = fade;

    // 位姿对齐：逐帧复制参考组世界矩阵（远近景过渡无位置跳变；
    // M57 经环壳缩放组随动倾斜姿态与膨胀动画）
    group.updateWorldMatrix(true, false);
    resources.volumeRoot.matrix.copy(group.matrixWorld);

    const { rt, volumeScene, drawSize, savedClearColor } = resources;
    gl.getDrawingBufferSize(drawSize);
    if (rt.width !== drawSize.x || rt.height !== drawSize.y) {
      rt.setSize(Math.max(1, drawSize.x), Math.max(1, drawSize.y));
    }
    const info = updateVolumeRtViewport(rt, blendRef.current.resolutionScale);
    writeCompositeUniforms(compositeMaterial, rt, info);

    gl.getClearColor(savedClearColor);
    const savedClearAlpha = gl.getClearAlpha();
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0);
    // 显式清屏（R4-7 残影修复先例：Composer 环境 autoClear=false）
    gl.clear(true, false, false);
    gl.render(volumeScene, camera);
    gl.setRenderTarget(null);
    gl.setClearColor(savedClearColor, savedClearAlpha);
  }, VOLUME_RT_PASS_PRIORITY);

  // 主场景仅挂合成全屏三角形（体积与星点在独立子场景经 RT pass 绘制）
  return <primitive object={resources.compositeMesh} />;
}

export default NebulaVolumeLayer;
