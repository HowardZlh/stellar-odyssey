'use client';

import type { JSX, RefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  buildDensityTexture,
  clampVolumeSteps,
  makeSphericalFbmCloudSampler,
  volumeSeed,
} from '@/utils/volume';
import {
  createAdaptiveQuality,
  createQualityBlend,
  advanceQualityBlend,
  forcedTierFromSlider,
  formatQualityLabel,
  recordQualityFrame,
  slidingWindowFps,
} from '@/utils/adaptiveQuality';
import {
  createVolumeMaterial,
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
 * 体积渲染框架测试体（R4-3 框架 + R4-4 半分辨率/抖动/自适应降级，
 * `/dev/preview?body=volume-test`）
 *
 * 渲染路径（R4-4 起）：体积 mesh 置于独立子场景，每帧渲染到半分辨率 RT
 * （动态视口，比例随质量档位 0.5–1 连续插值），主场景内以全屏三角形合成
 * （预乘 alpha，落入 EffectComposer 输入缓冲 → Bloom/ToneMapping 等效）。
 * 步进起点蓝噪声抖动（VolumeMaterial 内置，uJitter 滑杆可关做 A/B 对比）。
 *
 * 自适应质量：`utils/adaptiveQuality` 状态机（3s 滑动窗 FPS，降档 <55 即时、
 * 升档 ≥58 连续 5s，切档 ≤0.5s 插值）；「质量档」滑杆 0=自动 / 1=低 / 2=中 /
 * 3=高（强制档时状态机后台继续采样，回自动即接管）。当前档位/步数/RT 比例
 * 经 qualityLabelRef 每帧直写 HUD（不走 React state）。
 *
 * 仅 dev 预览页动态 import 加载（主 bundle 零增大）；本阶段不接主场景。
 */

/** 密度纹理边长（≤128 附录 A §1；96³ 兼顾细节与构建耗时） */
const VOLUME_TEST_TEXTURE_SIZE = 96;

/** 体积盒世界边长（单位盒经 mesh.scale 放大） */
const VOLUME_TEST_BOX_SIZE = 2.4;

/** 与 PreviewScene 一致：预览层 uniform 覆写排在默认订阅者后、Composer 前 */
const PREVIEW_OVERRIDE_PRIORITY = 0.5;

/** 体积 RT pass 优先级：晚于 uniform 覆写（0.5）、早于 EffectComposer 渲染（1） */
const VOLUME_RT_PASS_PRIORITY = 0.7;

export interface VolumeTestPreviewProps {
  /** 当前滑杆值映射（key → value） */
  values: Record<string, number>;
  /** HUD 虚拟时钟读数节点（每帧直写 textContent，不走 React state） */
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
  /** HUD 体积质量档位读数节点（每帧直写 textContent，不走 React state） */
  qualityLabelRef?: RefObject<HTMLSpanElement | null>;
}

export function VolumeTestPreview({
  values,
  clockLabelRef,
  qualityLabelRef,
}: VolumeTestPreviewProps): JSX.Element {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');
  const qualityTextRef = useRef('');
  // 自适应质量状态 + 平滑混合（就地推进，渲染循环零分配）
  const adaptiveRef = useRef(createAdaptiveQuality(0));
  const blendRef = useRef(createQualityBlend('high'));
  const nowMsRef = useRef(0);

  // 密度纹理 + 材质 + 体积子场景 + RT/合成资源：挂载时构建一次
  // （确定性种子），卸载即 dispose（附录 A §6）
  const resources = useMemo(() => {
    const sampler = makeSphericalFbmCloudSampler({ seed: volumeSeed('volume-test') });
    const texture = buildDensityTexture(VOLUME_TEST_TEXTURE_SIZE, sampler);
    const material = createVolumeMaterial({ map: texture });
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const volumeMesh = new THREE.Mesh(boxGeometry, material);
    volumeMesh.scale.setScalar(VOLUME_TEST_BOX_SIZE);
    const volumeScene = new THREE.Scene();
    volumeScene.add(volumeMesh);
    const rt = createVolumeRenderTarget(2, 2); // 首帧按实际缓冲尺寸同步
    const compositeMaterial = createVolumeCompositeMaterial(rt);
    const compositeGeometry = createFullscreenTriangleGeometry();
    return {
      texture,
      material,
      boxGeometry,
      volumeScene,
      rt,
      compositeMaterial,
      compositeGeometry,
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
      resources.boxGeometry.dispose();
      disposeVolumeMaterial(resources.material);
      resources.texture.dispose();
    };
  }, [resources]);

  // ① uniform 覆写 + 自适应质量推进（优先级 0.5）
  useFrame((_, delta) => {
    virtualTimeRef.current += delta;
    nowMsRef.current += delta * 1000;

    // 状态机：每帧采样（强制档时后台继续采样，回自动立即可决策）
    const state = recordQualityFrame(adaptiveRef.current, nowMsRef.current);
    const forced = forcedTierFromSlider(values.quality ?? 0);
    const targetTier = forced ?? state.tier;
    const blend = advanceQualityBlend(blendRef.current, targetTier, delta);

    const baseSteps = clampVolumeSteps(values.steps ?? 64);
    const steps = clampVolumeSteps(baseSteps * blend.stepScale);

    const u = resources.material.uniforms;
    u.uTime.value = virtualTimeRef.current; // 预留 uniform（R4-7 流动）
    u.uSteps.value = steps;
    u.uQuality.value = blend.stepScale;
    u.uJitter.value = (values.jitter ?? 1) >= 0.5 ? 1 : 0;
    u.uDensityScale.value = values.density ?? 2.2;
    u.uAbsorption.value = values.absorption ?? 5;
    u.uIntensity.value = values.intensity ?? 1.2;
    // 双色：色相滑杆 → HSL（就地 setHSL，零分配）
    (u.uColorA.value as THREE.Color).setHSL(((values.hueA ?? 352) % 360) / 360, 0.9, 0.55);
    (u.uColorB.value as THREE.Color).setHSL(((values.hueB ?? 172) % 360) / 360, 0.85, 0.6);

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

  // ② 体积 RT pass（优先级 0.7：uniform 覆写后、EffectComposer 渲染前）
  useFrame(() => {
    const { rt, volumeScene, compositeMaterial, drawSize, savedClearColor } = resources;
    // RT 常驻满分辨率（画布缩放才 setSize），档位仅改动态视口（零重分配）
    gl.getDrawingBufferSize(drawSize);
    if (rt.width !== drawSize.x || rt.height !== drawSize.y) {
      rt.setSize(Math.max(1, drawSize.x), Math.max(1, drawSize.y));
    }
    const info = updateVolumeRtViewport(rt, blendRef.current.resolutionScale);
    writeCompositeUniforms(compositeMaterial, rt, info);

    // 渲染体积子场景到 RT（透明黑清屏；保存/恢复渲染器清屏色）
    gl.getClearColor(savedClearColor);
    const savedClearAlpha = gl.getClearAlpha();
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0);
    // 显式清屏（bug 修复，与 OrionNebulaPreview 同源）：EffectComposer
    // （postprocessing）把 renderer.autoClear 永久置 false，隐式自动清屏
    // 失效 → RT 帧间累积成拖影；gl.clear 遵循当前剪裁子区域
    gl.clear(true, false, false);
    gl.render(volumeScene, camera);
    gl.setRenderTarget(null);
    gl.setClearColor(savedClearColor, savedClearAlpha);
  }, VOLUME_RT_PASS_PRIORITY);

  // 主场景仅挂合成全屏三角形（体积 mesh 在独立子场景经 RT pass 绘制）
  return (
    <mesh
      geometry={resources.compositeGeometry}
      material={resources.compositeMaterial}
      renderOrder={VOLUME_RENDER_ORDER}
      frustumCulled={false}
    />
  );
}

export default VolumeTestPreview;
