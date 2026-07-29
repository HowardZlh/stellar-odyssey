'use client';

import type { JSX } from 'react';
/**
 * M13 球状星团 King 分布预览（R4-19，`/dev/preview?body=m13`）
 *
 * 与主场景 GlobularCluster 共用 `utils/m13Cluster` 纯函数与
 * `M13KingStarField` 渲染组件（观感同源）：远观基础 420 粒 + 近观增量
 * 1,200 粒两级同时挂载（近观致密核/稀疏晕密度梯度直接可辨）。
 * 滑杆（粒径增益/亮度增益）经帧读 getter 直达 PointsMaterial 标量
 * （R4-1 修复登记的调参路径，无材质重建）。
 * 数据加载失败/未就绪：显示降级占位（主场景降级为 rand² 程序化分布，登记）。
 */

import { useMemo, useRef } from 'react';
import { useM13Profile } from '@/hooks/useM13Profile';
import { M13KingStarField } from '@/components/Scene/SpecialBodies';
import {
  M13_BASE_STAR_COUNT,
  M13_NEAR_STAR_COUNT,
  buildKingRadiusTable01,
  buildM13ClusterAttributes,
  kingShapeFromProfile,
} from '@/utils/m13Cluster';

/** 预览簇视觉半径（场景单位 = 潮汐半径；条目 cameraDistance 与之配套） */
const PREVIEW_CLUSTER_RADIUS_UNITS = 1.6;

export function M13ClusterPreview({
  values,
}: {
  values: Record<string, number>;
}): JSX.Element {
  const profile = useM13Profile();
  // 滑杆帧读 getter（组件消费 ref，滑杆变化零材质/几何重建）
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const gettersRef = useRef({
    brightness: () => valuesRef.current.brightnessGain ?? 1,
  });

  const model = useMemo(() => {
    if (!profile) return null;
    const table = buildKingRadiusTable01(kingShapeFromProfile(profile.profile));
    return {
      base: buildM13ClusterAttributes({
        seed: 20260722,
        count: M13_BASE_STAR_COUNT,
        radiusUnits: PREVIEW_CLUSTER_RADIUS_UNITS,
        table,
        brightnessMin: 0.6,
        brightnessMax: 1.0,
      }),
      near: buildM13ClusterAttributes({
        seed: 20260723,
        count: M13_NEAR_STAR_COUNT,
        radiusUnits: PREVIEW_CLUSTER_RADIUS_UNITS,
        table,
        brightnessMin: 0.35,
        brightnessMax: 0.8,
      }),
    };
  }, [profile]);

  // 粒径增益：滑杆值变化仅重算 size 标量（PointsMaterial.size 为构造参数，
  // 经 key 重挂载会重建几何——此处以受控 props 直改，M13KingStarField
  // 的 useMemo 依赖 pointSizeUnits，滑杆拖动重建两份小几何可接受（≤1,620
  // 粒；预览页专用路径，主场景不受影响）
  const sizeGain = values.sizeGain ?? 1;

  if (!model) {
    // 数据未就绪/加载失败：降级占位（主场景对应降级为 rand² 分布，登记）
    return (
      <mesh>
        <sphereGeometry args={[PREVIEW_CLUSTER_RADIUS_UNITS * 0.5, 12, 12]} />
        <meshBasicMaterial color="#445" wireframe />
      </mesh>
    );
  }
  return (
    <group>
      <M13KingStarField
        attributes={model.base}
        pointSizeUnits={PREVIEW_CLUSTER_RADIUS_UNITS * 0.06 * sizeGain}
        baseOpacity={0.9}
        getOpacity={gettersRef.current.brightness}
      />
      <M13KingStarField
        attributes={model.near}
        pointSizeUnits={PREVIEW_CLUSTER_RADIUS_UNITS * 0.035 * sizeGain}
        baseOpacity={0.85}
        getOpacity={gettersRef.current.brightness}
      />
    </group>
  );
}
