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
  M42_TEXTURE_SIZE,
  makeM42Sampler,
  rgVolumeBuildDone,
  rgVolumeBuildProgress01,
  trapeziumStarBoxPositions,
} from '@/utils/nebulaVolume';
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
 * 猎户座星云 M42 体积预览（R4-7，`/dev/preview?body=orion-nebula`）
 *
 * 密度场：`utils/nebulaVolume.makeM42Sampler`（128³ RG 双通道，FNV-1a
 * 确定性种子），**分帧烘焙**（§R4-7 实现方式登记）：每帧 `useFrame` 内
 * 按 22ms 预算推进 z 切片（单块 < 100ms 卡顿约束），完成后一次性创建
 * Data3DTexture + 材质并打点登记（console.info：总墙钟/计算耗时/块数/
 * 最大单块 ms）；构建期间 HUD 显示进度，Trapezium 星点 sprite 先行可见。
 *
 * 渲染路径沿用 R4-4：体积 mesh + 星点 sprite 置独立子场景 → 半分辨率 RT
 * （动态视口）→ 主场景全屏三角形合成（预乘 alpha）；自适应质量状态机 +
 * 强制档滑杆。Trapezium 四亮星以 sprite 内嵌于体积子场景（renderOrder
 * 先于体积 mesh——体积发射-吸收按全程透射率压暗星点，近似登记：未按星点
 * 深度截断积分，空腔内密度低、偏差可忽略）。
 *
 * 仅 dev 预览页动态 import 加载；本阶段不接主场景（R4-8 范围）。
 */

/** 体积盒世界边长（单位盒经 mesh.scale 放大） */
const ORION_BOX_SIZE = 2.6;

/** 分帧构建每帧时间预算 ms（单块主线程占用 ≪100ms，卡顿约束 §R4-7） */
const BUILD_BUDGET_MS = 22;

/** 与 PreviewScene 一致：预览层 uniform 覆写排在默认订阅者后、Composer 前 */
const PREVIEW_OVERRIDE_PRIORITY = 0.5;

/** 体积 RT pass 优先级：晚于 uniform 覆写（0.5）、早于 EffectComposer 渲染（1） */
const VOLUME_RT_PASS_PRIORITY = 0.7;

/** 星点 glow sprite 纹理边长 */
const STAR_SPRITE_SIZE = 64;

/** 程序化星点 glow 纹理（径向高斯衰减 + 蓝白色调，确定性无随机） */
function buildStarSpriteTexture(): THREE.DataTexture {
  const size = STAR_SPRITE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  let ptr = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r2 = dx * dx + dy * dy;
      // 核心亮斑 + 宽晕（双高斯），蓝白（Trapezium O/B 型热星示意）
      const core = Math.exp(-r2 * 18);
      const halo = 0.35 * Math.exp(-r2 * 3.2);
      const v = Math.min(1, core + halo);
      data[ptr] = Math.round(210 * v);
      data[ptr + 1] = Math.round(225 * v);
      data[ptr + 2] = Math.round(255 * v);
      data[ptr + 3] = Math.round(255 * v);
      ptr += 4;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

export interface OrionNebulaPreviewProps {
  /** 当前滑杆值映射（key → value） */
  values: Record<string, number>;
  /** HUD 虚拟时钟读数节点（每帧直写 textContent，不走 React state） */
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
  /** HUD 体积质量档位读数节点（构建期显示进度，完成后显示档位） */
  qualityLabelRef?: RefObject<HTMLSpanElement | null>;
}

export function OrionNebulaPreview({
  values,
  clockLabelRef,
  qualityLabelRef,
}: OrionNebulaPreviewProps): JSX.Element {
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
    const buildState = createRgVolumeBuild(M42_TEXTURE_SIZE, makeM42Sampler());
    const volumeScene = new THREE.Scene();
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    // Trapezium 四亮星 sprite（位置与空腔一致：trapeziumStarBoxPositions）
    const starTexture = buildStarSpriteTexture();
    const starMaterial = new THREE.SpriteMaterial({
      map: starTexture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    for (const [x, y, z] of trapeziumStarBoxPositions()) {
      const sprite = new THREE.Sprite(starMaterial);
      sprite.position.set(x * ORION_BOX_SIZE, y * ORION_BOX_SIZE, z * ORION_BOX_SIZE);
      sprite.scale.setScalar(0.12 * ORION_BOX_SIZE);
      sprite.renderOrder = 0; // 先于体积 mesh（renderOrder 1）绘制
      volumeScene.add(sprite);
    }
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
  }, []);

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
          const text = `M42 构建中 ${(rgVolumeBuildProgress01(buildState) * 100).toFixed(0)}%`;
          if (text !== qualityTextRef.current) {
            qualityTextRef.current = text;
            label.textContent = text;
          }
        }
        return;
      }
      // 完成：创建纹理 + 材质 + 体积 mesh，打点登记（§R4-7 验收）
      const wallMs = performance.now() - (buildWallStartRef.current ?? performance.now());
      // §R4-7 构建期打点登记（无头 Chrome 目验取证）
      console.info(
        `[R4-7] M42 128³ 分帧烘焙完成：墙钟 ${wallMs.toFixed(0)} ms、` +
          `计算 ${buildState.computeMs.toFixed(0)} ms、块数 ${buildState.chunkCount}、` +
          `最大单块 ${buildState.maxChunkMs.toFixed(1)} ms（<100ms 卡顿约束）`,
      );
      const texture = createRgDensityTexture(buildState.size, buildState.data);
      volumeMaterial = createNebulaVolumeMaterial({ map: texture });
      const mesh = new THREE.Mesh(resources.boxGeometry, volumeMaterial);
      mesh.scale.setScalar(ORION_BOX_SIZE);
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

    const baseSteps = clampVolumeSteps(values.steps ?? 64);
    const steps = clampVolumeSteps(baseSteps * blend.stepScale);

    const u = volumeMaterial.uniforms;
    u.uTime.value = virtualTimeRef.current;
    u.uSteps.value = steps;
    u.uQuality.value = blend.stepScale;
    u.uJitter.value = (values.jitter ?? 1) >= 0.5 ? 1 : 0;
    u.uDensityScale.value = values.density ?? 3.2;
    u.uDustStrength.value = values.dust ?? 1;
    u.uWeightBias.value = values.weightBias ?? 0;
    u.uIntensity.value = values.intensity ?? 1.3;

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

export default OrionNebulaPreview;
