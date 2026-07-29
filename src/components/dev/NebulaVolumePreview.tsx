'use client';

import type { JSX, RefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clampVolumeSteps } from '@/utils/volume';
import {
  advanceRgVolumeBuild,
  createRgDensityTexture,
  createRgVolumeBuild,
  rgVolumeBuildProgress01,
} from '@/utils/nebulaVolume';
import type { NebulaVolumeLayerConfig } from '@/utils/nebulaVolumeScene';
import {
  addVolumeStarSprites,
  buildStarSpriteTexture,
} from '@/components/Scene/volumetric/TrapeziumSprites';
import {
  createAdaptiveQuality,
  createQualityBlend,
  advanceQualityBlend,
  forcedTierFromSlider,
  formatQualityLabel,
  recordQualityFrame,
  slidingWindowFps,
} from '@/utils/adaptiveQuality';
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

/**
 * 星云体积预览（R4-7 首建为 OrionNebulaPreview，R4-14 泛化：
 * `/dev/preview?body=orion-nebula` 与 `?body=ring-nebula` 共用——
 * 密度场/材质参数/内嵌星点经 `NebulaVolumeLayerConfig` 注入）
 *
 * 密度场：`utils/nebulaVolume.makeM42Sampler / makeM57Sampler`（RG 双通道，
 * FNV-1a 确定性种子），**分帧烘焙**（§R4-7 实现方式登记）：每帧 `useFrame`
 * 内按 22ms 预算推进 z 切片（单块 < 100ms 卡顿约束），完成后一次性创建
 * Data3DTexture + 材质并打点登记（console.info：总墙钟/计算耗时/块数/
 * 最大单块 ms）；构建期间 HUD 显示进度，星点 sprite 先行可见。
 *
 * 渲染路径沿用 R4-4：体积 mesh + 星点 sprite 置独立子场景 → 半分辨率 RT
 * （动态视口）→ 主场景全屏三角形合成（预乘 alpha）；自适应质量状态机 +
 * 强制档滑杆。星点 sprite 内嵌于体积子场景（renderOrder 先于体积 mesh
 * ——体积发射-吸收按全程透射率压暗星点，近似登记：未按星点深度截断积分，
 * M42 Trapezium 空腔 / M57 内腔密度低、偏差可忽略）。
 *
 * 仅 dev 预览页动态 import 加载。
 */

/** 体积盒世界边长（单位盒经 mesh.scale 放大；M42/M57 预览共用） */
const NEBULA_PREVIEW_BOX_EDGE = 2.6;

/** 分帧构建每帧时间预算 ms（单块主线程占用 ≪100ms，卡顿约束 §R4-7） */
const BUILD_BUDGET_MS = 22;

/** 与 PreviewScene 一致：预览层 uniform 覆写排在默认订阅者后、Composer 前 */
const PREVIEW_OVERRIDE_PRIORITY = 0.5;

/** 体积 RT pass 优先级：晚于 uniform 覆写（0.5）、早于 EffectComposer 渲染（1） */
const VOLUME_RT_PASS_PRIORITY = 0.7;

export interface NebulaVolumePreviewProps {
  /** 层配置（M42 / M57；父层 useMemo 稳定） */
  config: NebulaVolumeLayerConfig;
  /** 当前滑杆值映射（key → value） */
  values: Record<string, number>;
  /** HUD 虚拟时钟读数节点（每帧直写 textContent，不走 React state） */
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
  /** HUD 体积质量档位读数节点（构建期显示进度，完成后显示档位） */
  qualityLabelRef?: RefObject<HTMLSpanElement | null>;
}

export function NebulaVolumePreview({
  config,
  values,
  clockLabelRef,
  qualityLabelRef,
}: NebulaVolumePreviewProps): JSX.Element {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');
  const qualityTextRef = useRef('');
  const adaptiveRef = useRef(createAdaptiveQuality(0));
  const blendRef = useRef(createQualityBlend('high'));
  const nowMsRef = useRef(0);
  const buildWallStartRef = useRef<number | null>(null);

  // 构建状态 + 子场景 + RT/合成资源：挂载时创建一次；体积纹理与材质在
  // 分帧构建完成后惰性创建（refs 持有），卸载统一 dispose（附录 A §6）
  const resources = useMemo(() => {
    const buildState = createRgVolumeBuild(config.textureSize, config.makeSampler());
    const volumeScene = new THREE.Scene();
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    // 星点 sprite（M42 Trapezium 四星 / M57 中心白矮星色档）
    const starTexture = buildStarSpriteTexture(config.starTint);
    const starMaterial = new THREE.SpriteMaterial({
      map: starTexture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    addVolumeStarSprites(volumeScene, starMaterial, NEBULA_PREVIEW_BOX_EDGE, config.stars);
    const rt = createVolumeRenderTarget(2, 2); // 首帧按实际缓冲尺寸同步
    const compositeMaterial = createVolumeCompositeMaterial(rt);
    const compositeGeometry = createFullscreenTriangleGeometry();
    return {
      buildState,
      volumeScene,
      boxGeometry,
      starTexture,
      starMaterial,
      rt,
      compositeMaterial,
      compositeGeometry,
      // 分帧构建完成后惰性创建（卸载时若存在则 dispose）
      texture: null as THREE.Data3DTexture | null,
      material: null as THREE.ShaderMaterial | null,
      // RT pass 复用的临时对象（渲染循环零分配）
      drawSize: new THREE.Vector2(),
      savedClearColor: new THREE.Color(),
    };
  }, [config]);

  useEffect(() => {
    return () => {
      resources.compositeGeometry.dispose();
      resources.compositeMaterial.dispose();
      resources.rt.dispose();
      resources.starMaterial.dispose();
      resources.starTexture.dispose();
      resources.boxGeometry.dispose();
      if (resources.material) disposeVolumeMaterial(resources.material);
      if (resources.texture) resources.texture.dispose();
    };
  }, [resources]);

  // ① 分帧构建推进 + uniform 覆写 + 自适应质量（优先级 0.5）
  useFrame((_, delta) => {
    virtualTimeRef.current += delta;
    nowMsRef.current += delta * 1000;

    const { buildState } = resources;
    let volumeMaterial = resources.material;
    if (!volumeMaterial) {
      // 分帧烘焙：每帧 ≤22ms 预算推进（打点字段随 state 累计）
      if (buildWallStartRef.current === null) {
        buildWallStartRef.current = performance.now();
      }
      const done = advanceRgVolumeBuild(buildState, BUILD_BUDGET_MS);
      const label = qualityLabelRef?.current;
      if (!done) {
        if (label) {
          const text = `${config.logTag} 构建中 ${(rgVolumeBuildProgress01(buildState) * 100).toFixed(0)}%`;
          if (text !== qualityTextRef.current) {
            qualityTextRef.current = text;
            label.textContent = text;
          }
        }
        return;
      }
      // 完成：创建纹理 + 材质 + 体积 mesh，打点登记（§R4-7/§R4-14 验收）
      const wallMs = performance.now() - (buildWallStartRef.current ?? performance.now());
      console.info(
        `[${config.logTag}] ${buildState.size}³ 分帧烘焙完成：墙钟 ${wallMs.toFixed(0)} ms、` +
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
      });
      const mesh = new THREE.Mesh(resources.boxGeometry, volumeMaterial);
      mesh.scale.setScalar(NEBULA_PREVIEW_BOX_EDGE);
      mesh.renderOrder = 1; // 晚于星点 sprite：体积按透射率覆盖压暗
      resources.volumeScene.add(mesh);
      resources.texture = texture;
      resources.material = volumeMaterial;
    }

    // 自适应质量状态机（强制档时后台继续采样，回自动即接管）
    const state = recordQualityFrame(adaptiveRef.current, nowMsRef.current);
    const forced = forcedTierFromSlider(values.quality ?? 0);
    const targetTier = forced ?? state.tier;
    const blend = advanceQualityBlend(blendRef.current, targetTier, delta);

    const baseSteps = clampVolumeSteps(values.steps ?? config.params.baseSteps);
    const steps = clampVolumeSteps(baseSteps * blend.stepScale);

    const u = volumeMaterial.uniforms;
    u.uTime.value = virtualTimeRef.current;
    u.uSteps.value = steps;
    u.uQuality.value = blend.stepScale;
    u.uJitter.value = (values.jitter ?? 1) >= 0.5 ? 1 : 0;
    u.uDensityScale.value = values.density ?? config.params.densityScale;
    u.uDustStrength.value = values.dust ?? config.params.dustStrength;
    u.uWeightBias.value = values.weightBias ?? config.params.weightBias;
    u.uIntensity.value = values.intensity ?? config.params.intensity;

    // HUD 虚拟时钟读数（0.1s 粒度，内容变化才写 DOM）
    const label = clockLabelRef?.current;
    if (label) {
      const text = virtualTimeRef.current.toFixed(1);
      if (text !== clockTextRef.current) {
        clockTextRef.current = text;
        label.textContent = text;
      }
    }
    // HUD 质量档位读数（内容变化才写 DOM）
    const qualityLabel = qualityLabelRef?.current;
    if (qualityLabel) {
      const text = formatQualityLabel(
        targetTier,
        forced !== null,
        slidingWindowFps(state.samplesMs),
        steps,
        blend.resolutionScale,
      );
      if (text !== qualityTextRef.current) {
        qualityTextRef.current = text;
        qualityLabel.textContent = text;
      }
    }
  }, PREVIEW_OVERRIDE_PRIORITY);

  // ② 体积 RT pass（优先级 0.7）：构建期间也渲染——星点 sprite 先行可见
  useFrame(() => {
    const { rt, volumeScene, compositeMaterial, drawSize, savedClearColor } = resources;
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
    // 显式清屏（bug 修复：用户反馈拖拽绕行出现残影）——postprocessing 的
    // EffectComposer.setRenderer 会把 renderer.autoClear 永久置 false，
    // 依赖 gl.render 隐式自动清屏在挂 Composer 的环境下失效 → RT 帧间累积
    // 成拖影；gl.clear 遵循当前视口/剪裁子区域（半分辨率路径不受影响）
    gl.clear(true, false, false);
    gl.render(volumeScene, camera);
    gl.setRenderTarget(null);
    gl.setClearColor(savedClearColor, savedClearAlpha);
  }, VOLUME_RT_PASS_PRIORITY);

  // 主场景仅挂合成全屏三角形（体积与星点在独立子场景经 RT pass 绘制）
  return (
    <mesh
      geometry={resources.compositeGeometry}
      material={resources.compositeMaterial}
      renderOrder={VOLUME_RENDER_ORDER}
      frustumCulled={false}
    />
  );
}

export default NebulaVolumePreview;
