'use client';

/**
 * M87 纵深与星系团环境层（R5-4，IMPROVEMENT_REQUIREMENTS_5 §R5-4）
 *
 * 两个细节层挂接（实现选择/艺术化登记见 utils/m87Environment 文件头）：
 * 1. 环境层（starCatalog 池，容量 1 与昴星团/触须星系共池，'lru-retain'
 *    L4 语义与星系近观一致）：球状星团 2,000 锐利小点（Sérsic 外包络，
 *    近观椭球同姿态）+ 室女座团成员点缀 ≤100（R5-3 目录子集，目录未
 *    加载/失败时仅无成员点缀，其余照常——降级登记）+ ICM 弥散辉光
 *    sprite；全部禁用 raycast（成员不可点选登记，不干扰 M87 热区）。
 * 2. M87* 透镜层（lensing 池，容量 1 与 Sgr A* 与 Cyg X-1 共池 LRU，
 *    release-on-exit）：跟随 M87 推近至核心阈值（900 units）激活
 *    R4-13 BlackHoleLensedLayer（M87* 参数档：盘更暗环更大倾角 17°），
 *    退出跟随/拉远即淡出卸载 dispose；跟随判据仅 followBodyId
 *    （R4-13 flyTo 不清除的 Esc 释放修复同款）。
 *
 * 位置 = Universe 中 M87 星系静态位置（与 M87Jet 同式）；几何只建一次，
 * 渲染循环仅 uniform 直写（附录 A 渲染纪律）；卸载即 dispose。
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getGalaxyById } from '@/data/galaxies';
import { useSimulationStore } from '@/store';
import { cosmicDistanceToSceneUnits } from '@/utils/scale';
import { galaxyPlaneSizeUnits, universeFadeWeight } from '@/utils/universe';
import {
  galaxyNearViewOrientation,
  nearViewReferenceRadiusLy,
} from '@/utils/galaxyNearView';
import {
  M87_CORE_LENSED_CONFIG,
  M87_CORE_RS_WORLD_UNITS,
  M87_GC_MAX_RADIUS_LY,
  M87_ICM_COLOR,
  M87_ICM_OPACITY,
  M87_ICM_RADIUS_UNITS,
  VIRGO_MEMBER_MAX_OFFSET_UNITS,
  m87CoreLensingDetailLayerSpec,
  m87EnvironmentDetailLayerSpec,
  sampleM87GlobularClusters,
  virgoMemberPoints,
} from '@/utils/m87Environment';
import { useDetailLayer } from '@/hooks/useDetailLayer';
import { useGalaxyCatalog } from '@/hooks/useGalaxyCatalog';
import {
  buildPointsGeometry,
  createSoftPointsMaterial,
} from '@/components/Scene/GalaxyNearView';
import { BlackHoleLensedLayer } from '@/components/Scene/BlackHoleLensedLayer';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';

/** 禁用 raycast（成员/星团/辉光不可点选登记） */
const NO_RAYCAST = (): null => null;

export interface M87EnvironmentContentProps {
  /** 读取本帧不透明度（层级淡入 × 门控淡入；预览恒 1 × 滑杆） */
  getOpacity: () => number;
  /** 点径缩放（主场景 = 贴图平面边长 ×4 与近观层同式；预览覆写） */
  pointScale: number;
  /** 场景单位/光年（GC 点集换算；与近观椭球同源比例） */
  unitsPerLy: number;
  /** 球状星团数覆写（预览滑杆；默认全量 2,000） */
  gcCount?: number;
  /** 成员点缀显示（预览滑杆；默认 true） */
  membersVisible?: boolean;
  /** ICM 辉光不透明度覆写（预览滑杆；默认 M87_ICM_OPACITY） */
  icmOpacity?: number;
}

/**
 * 环境层内容（GC 点 + 成员点缀 + ICM 辉光；主场景与预览页共用）
 *
 * 挂载于 M87 中心本地系（场景轴向）；GC 子层套近观椭球同姿态旋转。
 */
export function M87EnvironmentContent({
  getOpacity,
  pointScale,
  unitsPerLy,
  gcCount,
  membersVisible = true,
  icmOpacity = M87_ICM_OPACITY,
}: M87EnvironmentContentProps): JSX.Element {
  const orientation = useMemo(() => galaxyNearViewOrientation('m87'), []);
  // R5-3 目录懒加载（挂载即请求；已缓存则即时；失败 → 无成员点缀降级登记）
  const catalog = useGalaxyCatalog(membersVisible);

  // 球状星团：锐利小点（maxSizePx 3 + 高 alphaBase，与基础云 6px 软点区分）
  const gc = useMemo(() => {
    const particles = sampleM87GlobularClusters(gcCount);
    const geometry = buildPointsGeometry(
      particles,
      unitsPerLy,
      M87_GC_MAX_RADIUS_LY * unitsPerLy,
    );
    const material = createSoftPointsMaterial({
      blending: THREE.AdditiveBlending,
      maxSizePx: 3,
      alphaBase: 0.55,
      alphaScale: 0.45,
      pointScale,
    });
    return { geometry, material };
  }, [gcCount, unitsPerLy, pointScale]);
  useEffect(
    () => () => {
      gc.geometry.dispose();
      gc.material.dispose();
    },
    [gc],
  );

  // 室女座成员点缀（目录就绪才构建；positionsUnits 已是场景单位 → unitsPerLy=1）
  const members = useMemo(() => {
    if (!catalog || !membersVisible) return null;
    const pts = virgoMemberPoints(catalog);
    if (pts.count === 0) return null;
    const geometry = buildPointsGeometry(
      { count: pts.count, positionsLy: pts.positionsUnits, colors: pts.colors, sizes: pts.sizes },
      1,
      VIRGO_MEMBER_MAX_OFFSET_UNITS,
    );
    const material = createSoftPointsMaterial({
      blending: THREE.AdditiveBlending,
      maxSizePx: 11,
      alphaBase: 0.25,
      alphaScale: 0.75,
      pointScale,
    });
    return { geometry, material };
  }, [catalog, membersVisible, pointScale]);
  useEffect(
    () => () => {
      members?.geometry.dispose();
      members?.material.dispose();
    },
    [members],
  );

  // ICM 弥散辉光 sprite（径向渐变，X 射线热气体艺术化登记）
  const icmTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas(M87_ICM_COLOR, 128)),
    [],
  );
  useEffect(() => () => icmTexture.dispose(), [icmTexture]);
  const icmRef = useRef<THREE.Sprite>(null);

  useFrame(() => {
    const opacity = getOpacity();
    gc.material.uniforms.uOpacity.value = opacity;
    if (members) members.material.uniforms.uOpacity.value = opacity;
    const icm = icmRef.current;
    if (icm) (icm.material as THREE.SpriteMaterial).opacity = opacity * icmOpacity;
  });

  return (
    <group>
      {/* 球状星团（近观椭球同姿态） */}
      <group rotation={orientation}>
        <points
          geometry={gc.geometry}
          material={gc.material}
          frustumCulled={false}
          raycast={NO_RAYCAST}
        />
      </group>
      {/* 成员点缀（场景轴向，位移已含 R5-3 旋转链） */}
      {members && (
        <points
          geometry={members.geometry}
          material={members.material}
          frustumCulled={false}
          raycast={NO_RAYCAST}
        />
      )}
      {/* ICM 弥散辉光 */}
      <sprite
        ref={icmRef}
        scale={[M87_ICM_RADIUS_UNITS * 2, M87_ICM_RADIUS_UNITS * 2, 1]}
        raycast={NO_RAYCAST}
      >
        <spriteMaterial
          map={icmTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0}
        />
      </sprite>
    </group>
  );
}

/**
 * 主场景 M87 环境（Universe.tsx 挂载）：环境细节层 + M87* 核心透镜层
 */
export function M87Environment(): JSX.Element | null {
  const galaxy = getGalaxyById('m87');
  const groupRef = useRef<THREE.Group>(null);
  const weightRef = useRef(0);

  // ---- 环境层（starCatalog 池，lru-retain L4 语义） ----
  const envSpec = useMemo(() => m87EnvironmentDetailLayerSpec(), []);
  const { active: envActive, opacity01: getEnv01 } = useDetailLayer(envSpec, {
    objectRef: groupRef,
    retention: 'lru-retain',
  });
  const getEnvOpacity = useCallback(
    () => weightRef.current * getEnv01(),
    [getEnv01],
  );

  // ---- M87* 核心透镜层（lensing 池，release-on-exit；跟随判据仅
  // followBodyId——R4-13 Esc 释放修复同款） ----
  const lensSpec = useMemo(() => m87CoreLensingDetailLayerSpec(), []);
  const getLensFocused = useCallback(
    () => useSimulationStore.getState().followBodyId === 'm87',
    [],
  );
  const { active: lensActive, opacity01: getLens01 } = useDetailLayer(lensSpec, {
    objectRef: groupRef,
    getFocused: getLensFocused,
  });
  const getWeight = useCallback(() => weightRef.current, []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const weight = universeFadeWeight(useSimulationStore.getState().continuousLevel);
    weightRef.current = weight;
    group.visible = weight > 0.001;
  });

  const scale = useMemo(() => {
    if (!galaxy) return null;
    const sizeUnits = galaxyPlaneSizeUnits(galaxy.diameterLy);
    return {
      unitsPerLy: sizeUnits / 2 / nearViewReferenceRadiusLy('m87'),
      pointScale: sizeUnits * 4,
    };
  }, [galaxy]);

  if (!galaxy || !scale) return null;
  const d = cosmicDistanceToSceneUnits(galaxy.distanceLy);

  return (
    <group
      ref={groupRef}
      position={[galaxy.direction.x * d, galaxy.direction.y * d, galaxy.direction.z * d]}
      name="m87-environment"
    >
      {envActive && (
        <M87EnvironmentContent
          getOpacity={getEnvOpacity}
          pointScale={scale.pointScale}
          unitsPerLy={scale.unitsPerLy}
        />
      )}
      {lensActive && (
        <BlackHoleLensedLayer
          config={M87_CORE_LENSED_CONFIG}
          rsWorld={M87_CORE_RS_WORLD_UNITS}
          getWeight={getWeight}
          getGate01={getLens01}
        />
      )}
    </group>
  );
}

export default M87Environment;
