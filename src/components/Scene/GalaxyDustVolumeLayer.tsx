'use client';

import type { JSX, MutableRefObject, RefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GalaxyData } from '@/types';
import { clampVolumeSteps } from '@/utils/volume';
import {
  buildDustDiskDensityData,
  DUST_VOLUME_BASE_STEPS,
  DUST_VOLUME_TEX_SIZE_XZ,
  DUST_VOLUME_TEX_SIZE_Y,
  dustVolumeFadeTarget,
  dustWorldStepScale,
  galaxyDustVolumeBoxUnits,
  galaxyDustVolumeDetailLayerSpec,
  galaxyDustVolumeParams,
  isDustVolumeGalaxy,
} from '@/utils/galaxyDustVolume';
import type { GalaxyImageMaps } from '@/utils/galaxyNearView';
import { galaxyNearViewOrientation } from '@/utils/galaxyNearView';
import { galaxyPlaneSizeUnits } from '@/utils/universe';
import {
  advanceQualityBlend,
  createAdaptiveQuality,
  createQualityBlend,
  formatQualityLabel,
  moveToward,
  recordQualityFrame,
  slidingWindowFps,
} from '@/utils/adaptiveQuality';
import { DETAIL_LAYER_TRANSITION_SECONDS } from '@/utils/detailLayer';
import { qualityTierSpec } from '@/utils/qualityTier';
import { useSimulationStore } from '@/store';
import { useDetailLayer } from '@/hooks/useDetailLayer';
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
 * 星系体积尘埃盘层（R5-2，IMPROVEMENT_REQUIREMENTS_5 §R5-2 / §0.3 方案 F）
 *
 * 复用 R4-3 体积框架的**纯吸收路径**（VolumeMaterial uIntensity=0：发射
 * 恒零，输出 rgb=0 + alpha=1-T，预乘合成 C_out = T·C_bg 仅衰减后方
 * 颜色）。密度 = R5-1 尘埃通道 2D 图 × z 向指数薄层（伪 3D，纯逻辑
 * utils/galaxyDustVolume，方案 a/b 差异与各向异性光程登记见该文件头）。
 *
 * 渲染路径沿用 R4-4/R4-8（NebulaVolumeLayer 同款）：独立子场景 + 半分
 * 辨率 RT + 全屏三角形合成（renderOrder=VOLUME_RENDER_ORDER，晚于星光
 * 粒子层——方案 a"体积层置于星光粒子之后按透过率调制"）；自适应质量
 * （R4-4）状态机逐帧写 uSteps/uQuality + RT 动态视口。与星云体积层差异：
 * - 密度纹理为可分离乘积同步构建（128×32×128 ≈ 0.5M 次乘法 ≪100ms
 *   卡顿约束，登记免分帧烘焙）；
 * - 包围盒非均匀缩放（宽×薄×宽），经 uWorldStepScale 校正光程——
 *   斜视/侧视消光强于正视（§R5-2 验收特征）；
 * - 无内嵌星点 sprite（星光由主场景近观粒子层承载）。
 *
 * 深度合成差异登记（R4-8 结论沿用）：合成三角形 depthTest=false，体积
 * 仅在跟随/飞往本星系近观时激活（volume 池容量 1），盒足印内的近侧
 * 粒子同被压暗为方案 a 已登记近似。
 *
 * 互斥（§0.3 方案 F）：fadeRef 输出体积视觉淡入权重，宿主
 * GalaxyNearViewLayer 以 (1 - fade) 淡出 R4-10 dust 暗粒子；本组件
 * 卸载时复位 0（暗粒子恢复，降级零回退）。
 */

/** 体积 RT pass 优先级（NebulaVolumeLayer 同值：晚于默认 0、早于 Composer） */
const VOLUME_RT_PASS_PRIORITY = 0.7;

/** raycast 空实现：全屏合成三角形不拦截点击（raycastGate 兼容） */
const NOOP_RAYCAST = (): void => {};

/**
 * 构建薄盘 3D 密度纹理（非立方 R8；参数与 utils/volume.buildDensityTexture
 * 同口径：UnsignedByte/Linear/ClampToEdge/unpackAlignment=1）。
 * 持有权归调用方（卸载时 dispose，附录 A §6）。
 */
function createDustDiskDensityTexture(
  data: Uint8Array<ArrayBuffer>,
  sizeXZ: number,
  sizeY: number,
): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(data, sizeXZ, sizeY, sizeXZ);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** 预览页滑杆覆写（主场景不传 = 登记值驱动） */
export interface DustVolumeOverrides {
  /** 消光系数 σ 覆写 */
  extinctionSigma?: number;
  /** 尘埃盒全厚（光年）覆写 */
  boxThicknessLy?: number;
}

export interface GalaxyDustVolumeLayerProps {
  /** 星系 id（登记参数/朝向查询键） */
  galaxyId: string;
  /** 位姿参考组 ref（星系组世界矩阵逐帧复制来源） */
  groupRef: RefObject<THREE.Group | null>;
  /** 影像图组（尘埃通道 + mapRadiusLy；调用方保证非 null 才挂载） */
  maps: GalaxyImageMaps;
  /** 贴图平面全宽（场景单位；主场景 = galaxyPlaneSizeUnits，预览页同源） */
  sizeUnits: number;
  /** 盘面朝向（欧拉 XYZ；主场景 = galaxyNearViewOrientation，预览页覆写） */
  orientation: readonly [number, number, number];
  /** 读取本帧层级可见权重 */
  getWeight: () => number;
  /** 读取 detailLayer 门控淡入权重（useDetailLayer opacity01；预览页恒 1） */
  getGate01: () => number;
  /** 输出：本帧体积视觉淡入权重（dust 暗粒子互斥淡出消费） */
  fadeRef: MutableRefObject<number>;
  /** 预览页滑杆覆写（主场景不传） */
  overrides?: DustVolumeOverrides;
  /** HUD 质量档位读数（预览页专用；主场景不传） */
  qualityLabelRef?: RefObject<HTMLSpanElement | null>;
}

/** 薄盘纯吸收体积层（资源随组件卸载 dispose；附录 A §6） */
export function GalaxyDustVolumeLayer({
  galaxyId,
  groupRef,
  maps,
  sizeUnits,
  orientation,
  getWeight,
  getGate01,
  fadeRef,
  overrides,
  qualityLabelRef,
}: GalaxyDustVolumeLayerProps): JSX.Element {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  // M2-2 体积档设备起点（qualityTier.ts）：medium 起 mid；low 设备恒锁
  // low（32 步 + RT 0.5）；high 桌面起 high = 现状
  const deviceVolume = qualityTierSpec(useSimulationStore.getState().deviceTier);
  const adaptiveRef = useRef(createAdaptiveQuality(0, deviceVolume.volumeInitialTier));
  const blendRef = useRef(createQualityBlend(deviceVolume.volumeInitialTier));
  const nowMsRef = useRef(0);
  const qualityTextRef = useRef('');

  const resources = useMemo(() => {
    const params = galaxyDustVolumeParams(galaxyId);
    const sigma = overrides?.extinctionSigma ?? params.extinctionSigma;
    const box = galaxyDustVolumeBoxUnits(
      galaxyId,
      sizeUnits,
      maps.mapRadiusLy,
      overrides?.boxThicknessLy,
    );
    // 同步构建（可分离乘积 ≪100ms 登记，见组件头）
    const data = buildDustDiskDensityData(
      maps.dust,
      DUST_VOLUME_TEX_SIZE_XZ,
      DUST_VOLUME_TEX_SIZE_Y,
      params.h01,
    );
    const texture = createDustDiskDensityTexture(
      data,
      DUST_VOLUME_TEX_SIZE_XZ,
      DUST_VOLUME_TEX_SIZE_Y,
    );
    // 纯吸收：发射为零（intensity=0 → rgb 恒 0），alpha = 1 - 透过率
    const material = createVolumeMaterial({
      map: texture,
      steps: DUST_VOLUME_BASE_STEPS,
      densityScale: 1,
      absorption: sigma,
      intensity: 0,
      worldStepScale: dustWorldStepScale(box.x, box.y, box.z),
    });
    const volumeScene = new THREE.Scene();
    const volumeRoot = new THREE.Group();
    volumeRoot.matrixAutoUpdate = false;
    volumeScene.add(volumeRoot);
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.rotation.set(orientation[0], orientation[1], orientation[2]);
    mesh.scale.set(box.x, box.y, box.z);
    volumeRoot.add(mesh);
    const rt = createVolumeRenderTarget(2, 2); // 首帧按实际缓冲尺寸同步
    const compositeMaterial = createVolumeCompositeMaterial(rt);
    const compositeGeometry = createFullscreenTriangleGeometry();
    const compositeMesh = new THREE.Mesh(compositeGeometry, compositeMaterial);
    compositeMesh.renderOrder = VOLUME_RENDER_ORDER;
    compositeMesh.frustumCulled = false;
    compositeMesh.raycast = NOOP_RAYCAST;
    compositeMesh.visible = false; // 淡入前不参与合成
    return {
      baseSigmaSteps: DUST_VOLUME_BASE_STEPS,
      volumeScene,
      volumeRoot,
      boxGeometry,
      texture,
      material,
      rt,
      compositeMaterial,
      compositeGeometry,
      compositeMesh,
      // RT pass 复用的临时对象（渲染循环零分配）
      drawSize: new THREE.Vector2(),
      savedClearColor: new THREE.Color(),
    };
  }, [galaxyId, maps, sizeUnits, orientation, overrides]);

  useEffect(() => {
    const outFade = fadeRef;
    return () => {
      resources.compositeGeometry.dispose();
      resources.compositeMaterial.dispose();
      resources.rt.dispose();
      resources.boxGeometry.dispose();
      disposeVolumeMaterial(resources.material);
      resources.texture.dispose();
      // 卸载即复位互斥淡出权重（R4-10 dust 暗粒子立即恢复）
      outFade.current = 0;
    };
  }, [resources, fadeRef]);

  // ① 自适应质量 + 淡入权重（默认优先级，晚于组定位）
  useFrame((_, delta) => {
    nowMsRef.current += delta * 1000;
    // M2-2：low 设备锁定起始档不推进（恒 32 步 + RT 0.5）
    const state = deviceVolume.volumeTierLocked
      ? adaptiveRef.current
      : recordQualityFrame(adaptiveRef.current, nowMsRef.current);
    const blend = advanceQualityBlend(blendRef.current, state.tier, delta);
    const u = resources.material.uniforms;
    const steps = clampVolumeSteps(resources.baseSigmaSteps * blend.stepScale);
    u.uSteps.value = steps;
    u.uQuality.value = blend.stepScale;
    // 纹理同步构建（挂载即就绪）：淡入目标直接跟随门控权重
    fadeRef.current = moveToward(
      fadeRef.current,
      dustVolumeFadeTarget(getGate01(), true),
      delta / DETAIL_LAYER_TRANSITION_SECONDS,
    );
    // HUD 质量档位读数（预览页专用；内容变化才写 DOM）
    const qualityLabel = qualityLabelRef?.current;
    if (qualityLabel) {
      const text = formatQualityLabel(
        state.tier,
        false,
        slidingWindowFps(state.samplesMs),
        steps,
        blend.resolutionScale,
      );
      if (text !== qualityTextRef.current) {
        qualityTextRef.current = text;
        qualityLabel.textContent = text;
      }
    }
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

    // 位姿对齐：逐帧复制星系组世界矩阵（M31 接近运动/卫星轨道随动）
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
    gl.clear(true, false, false);
    gl.render(volumeScene, camera);
    gl.setRenderTarget(null);
    gl.setClearColor(savedClearColor, savedClearAlpha);
  }, VOLUME_RT_PASS_PRIORITY);

  // 主场景仅挂合成全屏三角形（体积盒在独立子场景经 RT pass 绘制）
  return <primitive object={resources.compositeMesh} />;
}

export interface GalaxyDustVolumeProps {
  galaxy: GalaxyData;
  /** 星系组 ref（门控距离判据 + 位姿参考） */
  groupRef: RefObject<THREE.Group | null>;
  /** 影像图组（近观层懒加载共享；null = 未就绪/失败，体积层不挂载登记） */
  maps: GalaxyImageMaps | null;
  /** 读取本帧层级可见权重（宇宙层级淡入） */
  getWeight: () => number;
  /** 输出：体积视觉淡入权重（GalaxyNearViewLayer dust 暗粒子互斥消费） */
  fadeRef: MutableRefObject<number>;
}

/**
 * 主场景门控包装：useDetailLayer({kind:'volume'}) 容量 1 与星云体积层
 * 同池（星系↔星云巡游 LRU 互逐）；release-on-exit——退出淡出完成即
 * 卸载 dispose（星云体积层同语义）。影像产物缺失/加载失败时不挂载
 * （fadeRef 恒 0 → R4-10 dust 暗粒子保持现状，降级路径登记）。
 */
export function GalaxyDustVolume({
  galaxy,
  groupRef,
  maps,
  getWeight,
  fadeRef,
}: GalaxyDustVolumeProps): JSX.Element | null {
  const spec = useMemo(() => galaxyDustVolumeDetailLayerSpec(galaxy.id), [galaxy.id]);
  const { active, opacity01: getGate01 } = useDetailLayer(spec, { objectRef: groupRef });
  const sizeUnits = galaxyPlaneSizeUnits(galaxy.diameterLy);
  const orientation = useMemo(() => galaxyNearViewOrientation(galaxy.id), [galaxy.id]);
  if (!active || !maps || !isDustVolumeGalaxy(galaxy.id)) return null;
  return (
    <GalaxyDustVolumeLayer
      galaxyId={galaxy.id}
      groupRef={groupRef}
      maps={maps}
      sizeUnits={sizeUnits}
      orientation={orientation}
      getWeight={getWeight}
      getGate01={getGate01}
      fadeRef={fadeRef}
    />
  );
}

export default GalaxyDustVolume;
