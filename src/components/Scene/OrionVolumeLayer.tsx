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
  M42_TEXTURE_SIZE,
  makeM42Sampler,
} from '@/utils/nebulaVolume';
import {
  ORION_SCENE_VOLUME_PARAMS,
  ORION_VOLUME_STAR_SPRITE_FACTOR,
  orionVolumeBoxEdgeUnits,
  orionVolumeFadeTarget,
} from '@/utils/nebulaVolumeScene';
import {
  advanceQualityBlend,
  createAdaptiveQuality,
  createQualityBlend,
  moveToward,
  recordQualityFrame,
} from '@/utils/adaptiveQuality';
import { DETAIL_LAYER_TRANSITION_SECONDS } from '@/utils/detailLayer';
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
  addTrapeziumSprites,
  buildStarSpriteTexture,
} from '@/components/Scene/volumetric/TrapeziumSprites';

/**
 * 猎户座星云 M42 主场景体积层（R4-8，IMPROVEMENT_REQUIREMENTS_4 §R4-8）
 *
 * 由 SpecialBodies.EmissionNebula 经 useDetailLayer({kind:'volume'}) 门控
 * 挂载（release-on-exit：退出淡出完成即卸载，本组件卸载时纹理/RT/材质
 * 全部 dispose——附录 A §6）。渲染路径沿用 R4-4/R4-7 预览页：
 * - 分帧烘焙：每帧 ≤22ms 预算推进 128³ RG 密度场 z 切片（单块 <100ms
 *   卡顿约束）；构建完成前体积淡入目标为 0（billboard 保持，交叉过渡
 *   无空档，`orionVolumeFadeTarget` 登记）；
 * - 半分辨率 RT + 全屏三角形合成（自适应质量状态机主场景生效：
 *   high 64 步/full → mid 48 步/half → low 32 步/half，§R4-8 第 4 条）；
 * - 位姿对齐（§R4-8 第 2 条）：体积容器逐帧复制星云组世界矩阵
 *   （useGalacticPlacement 银河系组变换 + sun-relative 偏移），包围盒
 *   边长 = 视觉尺寸 × 2.6（utils/nebulaVolumeScene 登记）；
 * - Trapezium 四亮星 sprite 内嵌体积子场景（先于体积 mesh 绘制，按
 *   透射率压暗，与预览页一致；主场景原 youngStars sprite 经 volDim
 *   交叉淡出移交）。
 *
 * 深度合成差异登记（R4-4 遗留归本阶段处理）：合成三角形 depthTest=false
 * ——体积层不被主场景实体逐像素遮挡。M42 体积仅在跟随/飞往本目标近观时
 * 激活（volume 池容量 1），视野内无其他前景实体穿插（星云组内 billboard
 * /星点经交叉淡出移交），实测无遮挡穿帮，故维持无深度合成方案（避免
 * 深度附件 + 上采样深度检验的额外带宽）。
 *
 * 交叉淡出实现差异登记：detailLayer opacity01（0.5s）之上叠加"构建就绪"
 * 门控的二次平滑（advanceFrameTransition 同时长）——首次进入若烘焙晚于
 * 门控就绪，有效过渡时长 0.5–1s；再次进入（纹理已随组件卸载释放，重新
 * 烘焙 ~20 帧）同理。
 */

/** 分帧构建每帧时间预算 ms（与 R4-7 预览页一致，单块 ≪100ms） */
const BUILD_BUDGET_MS = 22;

/** 体积 RT pass 优先级：晚于默认 useFrame（0）、早于 EffectComposer（1） */
const VOLUME_RT_PASS_PRIORITY = 0.7;

/** raycast 空实现：全屏合成三角形不拦截点击（raycastGate 兼容） */
const NOOP_RAYCAST = (): void => {};

export interface OrionVolumeLayerProps {
  /** 星云组 ref（世界矩阵位姿对齐来源） */
  groupRef: RefObject<THREE.Group | null>;
  /** 星云视觉半径场景尺寸（visualRadiusLy × SCENE_UNITS_PER_LY） */
  sizeUnits: number;
  /** 读取本帧层级可见权重（useGalacticPlacement，含聚焦提升） */
  getWeight: () => number;
  /** 读取 detailLayer 门控淡入权重（useDetailLayer opacity01） */
  getGate01: () => number;
  /** 输出：本帧体积视觉淡入权重（EmissionNebula 交叉淡出消费） */
  fadeRef: MutableRefObject<number>;
}

export function OrionVolumeLayer({
  groupRef,
  sizeUnits,
  getWeight,
  getGate01,
  fadeRef,
}: OrionVolumeLayerProps): JSX.Element {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  const adaptiveRef = useRef(createAdaptiveQuality(0));
  const blendRef = useRef(createQualityBlend('high'));
  const nowMsRef = useRef(0);
  const timeRef = useRef(0);
  const buildWallStartRef = useRef<number | null>(null);

  const boxEdge = orionVolumeBoxEdgeUnits(sizeUnits);

  // 资源：挂载时创建一次；体积纹理/材质在分帧烘焙完成后惰性创建，
  // 卸载统一 dispose（附录 A §6；useDetailLayer release-on-exit 卸载）
  const resources = useMemo(() => {
    const buildState = createRgVolumeBuild(M42_TEXTURE_SIZE, makeM42Sampler());
    const volumeScene = new THREE.Scene();
    // 位姿容器：矩阵逐帧复制星云组世界矩阵（银河系组变换对齐）
    const volumeRoot = new THREE.Group();
    volumeRoot.matrixAutoUpdate = false;
    volumeScene.add(volumeRoot);
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const starTexture = buildStarSpriteTexture();
    const starMaterial = new THREE.SpriteMaterial({
      map: starTexture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    addTrapeziumSprites(volumeRoot, starMaterial, boxEdge, ORION_VOLUME_STAR_SPRITE_FACTOR);
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
  }, [boxEdge]);

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
      // 卸载即复位交叉淡出权重（billboard/PuffCloud 立即恢复）
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
      // §R4-8 主场景烘焙打点登记（无头 Chrome 目验取证）
      console.info(
        `[R4-8] M42 主场景 128³ 分帧烘焙完成：墙钟 ${wallMs.toFixed(0)} ms、` +
          `计算 ${buildState.computeMs.toFixed(0)} ms、块数 ${buildState.chunkCount}、` +
          `最大单块 ${buildState.maxChunkMs.toFixed(1)} ms（<100ms 卡顿约束）`,
      );
      const texture = createRgDensityTexture(buildState.size, buildState.data);
      volumeMaterial = createNebulaVolumeMaterial({
        map: texture,
        steps: ORION_SCENE_VOLUME_PARAMS.baseSteps,
        densityScale: ORION_SCENE_VOLUME_PARAMS.densityScale,
        dustStrength: ORION_SCENE_VOLUME_PARAMS.dustStrength,
        weightBias: ORION_SCENE_VOLUME_PARAMS.weightBias,
        intensity: ORION_SCENE_VOLUME_PARAMS.intensity,
        colorHa: ORION_SCENE_VOLUME_PARAMS.colorHa,
        colorOIII: ORION_SCENE_VOLUME_PARAMS.colorOIII,
      });
      const mesh = new THREE.Mesh(resources.boxGeometry, volumeMaterial);
      mesh.scale.setScalar(boxEdge);
      mesh.renderOrder = 1; // 晚于星点 sprite：体积按透射率覆盖压暗
      resources.volumeRoot.add(mesh);
      resources.texture = texture;
      resources.material = volumeMaterial;
    }

    // 自适应质量状态机（§R4-8 第 4 条：主场景生效，无强制档滑杆）
    const state = recordQualityFrame(adaptiveRef.current, nowMsRef.current);
    const blend = advanceQualityBlend(blendRef.current, state.tier, delta);
    const u = volumeMaterial.uniforms;
    u.uSteps.value = clampVolumeSteps(ORION_SCENE_VOLUME_PARAMS.baseSteps * blend.stepScale);
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

    // 位姿对齐：逐帧复制星云组世界矩阵（远近景过渡无位置跳变）
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

export default OrionVolumeLayer;
