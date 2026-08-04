'use client';

import type { JSX, RefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { StellarSurface } from '@/components/Scene/SpecialBodies';
import { stellarSphereSegments } from '@/utils/stellarSurface';
import {
  blackbodyRGB,
  limbDarkeningU,
  granulationCellScale,
} from '@/utils/starPhysics';
import { useStarParams } from '@/hooks/useStarParams';
import { stellarPreviewConfigForBody, type PreviewEntry } from '@/utils/devPreview';
import {
  crabVolumeLayerConfig,
  horseheadVolumeLayerConfig,
  m57VolumeLayerConfig,
  orionVolumeLayerConfig,
  wr124VolumeLayerConfig,
  WR124_VOLUME_BOX_FACTOR,
} from '@/utils/nebulaVolumeScene';
import { VolumeTestPreview } from '@/components/dev/VolumeTestPreview';
import { NebulaVolumePreview } from '@/components/dev/NebulaVolumePreview';
import { GalaxyNearViewPreview } from '@/components/dev/GalaxyNearViewPreview';
import { BlackHoleLensedPreview } from '@/components/dev/BlackHoleLensedPreview';
import { PleiadesCatalogPreview } from '@/components/dev/PleiadesCatalogPreview';
import { M13ClusterPreview } from '@/components/dev/M13ClusterPreview';
import { QuasarNearViewPreview } from '@/components/dev/QuasarNearViewPreview';
import { AntennaeNearViewPreview } from '@/components/dev/AntennaeNearViewPreview';
import { ClusterLensingPreview } from '@/components/dev/ClusterLensingPreview';
import { GrbNearViewPreview } from '@/components/dev/GrbNearViewPreview';
import { M87EnvironmentPreview } from '@/components/dev/M87EnvironmentPreview';

/**
 * 预览场景（R4-1）：按条目 componentKey 挂载对应细节组件，注入滑杆参数值。
 *
 * 本组件仅在 `/dev/preview` 动态 import 时加载（主 bundle 零增大）。不消费主
 * 场景 store / 音频 / 主循环；时间由本地 `timeScale` 参数驱动一个虚拟时钟。
 */
export interface PreviewSceneProps {
  entry: PreviewEntry;
  /** 当前滑杆值映射（key → value） */
  values: Record<string, number>;
  /** 曝光（tone mapping exposure，经 ToneMapping(ACES) 效果在帧缓冲级生效） */
  exposure: number;
  /** HUD 虚拟时钟读数节点（每帧直写 textContent，不走 React state） */
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
  /** HUD 体积质量档位读数节点（R4-4，仅体积类条目消费） */
  qualityLabelRef?: RefObject<HTMLSpanElement | null>;
}

/**
 * 预览层 useFrame 优先级：显式排在默认订阅者（0，含 StellarSurface 自身的
 * uTime 写入）之后、EffectComposer 渲染（1）之前，保证本层对 uniform 的
 * 覆写始终最后落笔——不依赖 React effect 挂载顺序的隐式行为（bug 修复）。
 */
const PREVIEW_OVERRIDE_PRIORITY = 0.5;

/** 预览自转基准角速度（rad/s，timeScale=1 档）：高于主场景观感基准，
 * 让时间流速滑杆的反馈数秒内肉眼可辨（bug 修复：原 0.05 过于缓慢） */
const PREVIEW_SPIN_RAD_PER_SEC = 0.15;

/**
 * R4-20 wr-124 组合预览的体积盒世界边长：恒星预览半径 1.4 对应主场景
 * 核心球 0.6×size → size ≡ 1.4/0.6，盒边长 = size × WR124_VOLUME_BOX_FACTOR
 * ≈ 14（壳中面世界半径 = 3× 恒星半径，与主场景比例一致）
 */
const WR124_PREVIEW_BOX_EDGE = (1.4 / 0.6) * WR124_VOLUME_BOX_FACTOR;

/** 预览恒定全可见权重（模块级常量，避免每次渲染新建函数） */
const WEIGHT_FULL = (): number => 1;

/** 曝光同步：把面板曝光写入 renderer（每帧廉价标量赋值，无对象分配） */
function ExposureSync({ exposure }: { exposure: number }): null {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    gl.toneMappingExposure = exposure;
  });
  return null;
}

/**
 * 恒星表面预览（R4-6）：6 类恒星复用物理化 `StellarSurface`
 *
 * 物理参数（Teff/光谱型/半径）经 `useStarParams` 读取（star-params.json，
 * 失败降级硬编码表）；滑杆（§R4-6：Teff 覆写/噪声频率/时间流速）路径：
 * StellarSurface 以默认物理 props 挂载一次（材质零重建），挂载时缓存其
 * ShaderMaterial 引用，随后每帧按滑杆值直写 uniform——Teff 覆写仅在值
 * 变化时重算黑体色（复用 THREE.Color 实例，渲染循环零分配），时间经
 * 虚拟时钟（timeScale 调制）覆写 uTime。
 */
function StellarSurfacePreview({
  entry,
  values,
  clockLabelRef,
}: {
  entry: PreviewEntry;
  values: Record<string, number>;
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');
  const lastTeffRef = useRef(Number.NaN);
  const colorScratchRef = useRef(new THREE.Color());
  const radius = 1.4;
  const segments = useMemo(() => stellarSphereSegments(radius * 30), [radius]);
  // 恒星配置与物理参数（config 为注册期校验过的恒星条目，必存在）
  const config = stellarPreviewConfigForBody(entry.bodyId)!;
  const star = useStarParams()[config.starKey];
  const defaults = useMemo(
    () => ({
      teffK: star.teffK,
      limbU: limbDarkeningU(star.spectralType),
      cellScale: granulationCellScale(star.radiusRsun),
    }),
    [star],
  );
  // 弥散气体壳颜色（黑体默认色，装饰层不随滑杆变化）
  const shellColor = useMemo(() => {
    const rgb = blackbodyRGB(star.teffK);
    return new THREE.Color().setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace);
  }, [star]);

  // 挂载时一次性缓存 StellarSurface 的 ShaderMaterial（材质 props 静态不重建，
  // 渲染循环零遍历/零闭包分配，附录 A §2）
  useEffect(() => {
    let found: THREE.ShaderMaterial | null = null;
    groupRef.current?.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (!found && mat && mat.uniforms && mat.uniforms.uTime) {
        found = mat;
      }
    });
    materialRef.current = found;
    return () => {
      materialRef.current = null;
    };
  }, []);

  useFrame((_, delta) => {
    const timeScale = values.timeScale ?? 1;
    virtualTimeRef.current += delta * timeScale;
    const group = groupRef.current;
    const mat = materialRef.current;
    if (group) {
      group.rotation.y += delta * PREVIEW_SPIN_RAD_PER_SEC * timeScale;
    }
    if (mat) {
      mat.uniforms.uTime.value = virtualTimeRef.current;
      mat.uniforms.uOpacity.value = 1;
      mat.uniforms.uCellScale.value = values.cellScale ?? defaults.cellScale;
      // R4-18 参宿四球谐滑杆（其余恒星条目无此滑杆，回落配置默认值）
      mat.uniforms.uShAmp.value = values.shAmplitude ?? config.shAmplitude;
      mat.uniforms.uShSpeed.value = values.shSpeed ?? 1;
      // Teff 覆写：值变化时重算黑体基色（sRGB → 线性，复用 Color 实例）
      const teff = values.teffK ?? defaults.teffK;
      if (teff !== lastTeffRef.current) {
        lastTeffRef.current = teff;
        const rgb = blackbodyRGB(teff);
        const c = colorScratchRef.current.setRGB(
          rgb.r,
          rgb.g,
          rgb.b,
          THREE.SRGBColorSpace,
        );
        (mat.uniforms.uColor.value as THREE.Vector3).set(c.r, c.g, c.b);
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

  return (
    <group ref={groupRef}>
      <StellarSurface
        getWeight={WEIGHT_FULL}
        radius={radius}
        segments={segments}
        teffK={defaults.teffK}
        limbU={defaults.limbU}
        cellScale={defaults.cellScale}
        convection={config.convection}
        rednessStrength={config.rednessStrength}
        shAmplitude={config.shAmplitude}
      />
      {/* 外层弥散气体壳（黑体默认色，观感与主场景恒星组件一致） */}
      <mesh>
        <sphereGeometry args={[radius * 1.5, 32, 32]} />
        <meshBasicMaterial
          color={shellColor}
          transparent
          opacity={0.12}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export function PreviewScene({
  entry,
  values,
  exposure,
  clockLabelRef,
  qualityLabelRef,
}: PreviewSceneProps): JSX.Element {
  // 星云体积层配置（R4-14 泛化：M42/M57/马头/蟹状共用 NebulaVolumePreview）
  const nebulaConfig = useMemo(
    () =>
      entry.componentKey === 'ring-nebula-volume'
        ? m57VolumeLayerConfig()
        : entry.componentKey === 'orion-nebula-volume'
          ? orionVolumeLayerConfig()
          : entry.componentKey === 'horsehead-nebula-volume'
            ? horseheadVolumeLayerConfig()
            : entry.componentKey === 'crab-nebula-volume'
              ? crabVolumeLayerConfig()
              : null,
    [entry.componentKey],
  );
  // R4-20 wr-124 组合预览：恒星层之外叠挂 M1-67 抛射壳体积
  const wr124Config = useMemo(
    () => (entry.bodyId === 'wr-124' ? wr124VolumeLayerConfig() : null),
    [entry.bodyId],
  );
  return (
    <>
      <ExposureSync exposure={exposure} />
      {entry.componentKey === 'stellar-surface' ? (
        /* key=bodyId：切换恒星时强制重挂载（材质引用缓存与虚拟时钟随之重置） */
        <>
          <StellarSurfacePreview
            key={entry.bodyId}
            entry={entry}
            values={values}
            clockLabelRef={clockLabelRef}
          />
          {/* R4-20：WR 124 抛射壳体积层（64³ 团块泡沫 + 径向膨胀，
              密度/膨胀滑杆 + timeScale 与恒星层同步虚拟时钟） */}
          {wr124Config && (
            <NebulaVolumePreview
              key={`${entry.bodyId}-ejecta`}
              config={wr124Config}
              values={values}
              boxEdge={WR124_PREVIEW_BOX_EDGE}
              qualityLabelRef={qualityLabelRef}
            />
          )}
        </>
      ) : entry.componentKey === 'volume-raymarch-test' ? (
        <VolumeTestPreview
          values={values}
          clockLabelRef={clockLabelRef}
          qualityLabelRef={qualityLabelRef}
        />
      ) : nebulaConfig ? (
        /* key=bodyId：M42/M57/马头切换时强制重挂载（构建状态/纹理随之重置） */
        <NebulaVolumePreview
          key={entry.bodyId}
          config={nebulaConfig}
          values={values}
          clockLabelRef={clockLabelRef}
          qualityLabelRef={qualityLabelRef}
        />
      ) : entry.componentKey === 'blackhole-lensed' ? (
        <BlackHoleLensedPreview values={values} clockLabelRef={clockLabelRef} />
      ) : entry.componentKey === 'pleiades-catalog' ? (
        <PleiadesCatalogPreview values={values} />
      ) : entry.componentKey === 'm13-king-cluster' ? (
        <M13ClusterPreview values={values} />
      ) : entry.componentKey === 'quasar-near-view' ? (
        /* R4-21：类星体近观四层结构（盘/BLR/尘埃环面/喷流） */
        <QuasarNearViewPreview values={values} clockLabelRef={clockLabelRef} />
      ) : entry.componentKey === 'antennae-near-view' ? (
        /* R4-22：触须星系 N-body 烘焙潮汐尾（快照插值演化） */
        <AntennaeNearViewPreview values={values} clockLabelRef={clockLabelRef} />
      ) : entry.componentKey === 'cluster-lensing-effect' ? (
        /* R4-23：星系团 SIS 屏幕空间引力透镜（Effect 由 harness 挂入 composer） */
        <ClusterLensingPreview values={values} />
      ) : entry.componentKey === 'grb-near-view' ? (
        /* R5-5：GRB 近观（相对论双喷流 + 余辉膨胀壳，周期时钟演化） */
        <GrbNearViewPreview values={values} clockLabelRef={clockLabelRef} />
      ) : entry.componentKey === 'm87-environment' ? (
        /* R5-4：M87 星系团中心语境（椭球近观 + 球状星团 + 成员点缀 +
           ICM + 节点喷流 + 核心推近 EHT 透镜） */
        <M87EnvironmentPreview values={values} />
      ) : entry.componentKey === 'galaxy-near-view' ? (
        /* key=bodyId：切换星系时强制重挂载（虚拟时钟与自转姿态重置）；
           R5-2：m31/m33/lmc 叠挂体积尘埃盘（qualityLabelRef 接 HUD 档位行） */
        <GalaxyNearViewPreview
          key={entry.bodyId}
          entry={entry}
          values={values}
          clockLabelRef={clockLabelRef}
          qualityLabelRef={qualityLabelRef}
        />
      ) : (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#888" wireframe />
        </mesh>
      )}
    </>
  );
}
