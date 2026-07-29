'use client';

import type { JSX } from 'react';
/**
 * 昴星团真实星表预览（R4-17，`/dev/preview?body=pleiades`）
 *
 * 与主场景 OpenCluster 昴星团分支共用 PleiadesCluster 三件套与
 * utils/pleiadesCatalog 纯函数（观感同源）：全部 600 颗成员星 points +
 * 9 颗命名亮星星芒（悬停显示星名）+ 蓝色反射星云分层 sprite。
 * 滑杆（粒径增益/星芒尺寸/反射星云强度）经帧读 getter 直达 uniform/
 * sprite 属性（R4-1 修复登记的调参路径，无材质重建）。
 * 数据加载失败/未就绪：显示降级占位（主场景降级为程序化分布，登记）。
 */

import { useMemo, useRef } from 'react';
import { usePleiadesCatalog } from '@/hooks/usePleiadesCatalog';
import {
  PleiadesCatalogPoints,
  PleiadesNamedStars,
  PleiadesReflectionNebula,
  pleiadesSkyViewQuaternion,
} from '@/components/Scene/PleiadesCluster';
import {
  buildPleiadesStarAttributes,
  pleiadesNamedStarPlacements,
  pleiadesReflectionNebulaLayout,
  sortPleiadesStarsByV,
} from '@/utils/pleiadesCatalog';

/** 预览簇视觉半径（场景单位；条目 cameraDistance 与之配套） */
const PREVIEW_CLUSTER_RADIUS_UNITS = 1.6;

/** 恒定全可见权重（预览页无层级淡入淡出） */
const OPACITY_FULL = (): number => 1;

export function PleiadesCatalogPreview({
  values,
}: {
  values: Record<string, number>;
}): JSX.Element {
  const catalog = usePleiadesCatalog();
  // 滑杆帧读 getter（组件消费 ref，滑杆变化零材质重建）
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const gettersRef = useRef({
    sizeGain: () => valuesRef.current.sizeGain ?? 1,
    spikeGain: () => valuesRef.current.spikeGain ?? 1,
    nebulaStrength: () => valuesRef.current.nebulaStrength ?? 1,
  });

  // 地球天空视图姿态：默认相机（+z 视向）即"从地球看"——北在上、东在左，
  // 亮星构型与公版图像可对照（§R4-17 验收 1）
  const skyView = useMemo(() => pleiadesSkyViewQuaternion(), []);

  const model = useMemo(() => {
    if (!catalog) return null;
    const sorted = sortPleiadesStarsByV(catalog.stars);
    const named = pleiadesNamedStarPlacements(sorted, PREVIEW_CLUSTER_RADIUS_UNITS);
    return {
      attributes: buildPleiadesStarAttributes(sorted, PREVIEW_CLUSTER_RADIUS_UNITS),
      named,
      nebula: pleiadesReflectionNebulaLayout(named, PREVIEW_CLUSTER_RADIUS_UNITS),
    };
  }, [catalog]);

  if (!model) {
    // 数据未就绪/加载失败：降级占位（主场景对应降级为程序化分布，登记）
    return (
      <mesh>
        <sphereGeometry args={[PREVIEW_CLUSTER_RADIUS_UNITS * 0.5, 12, 12]} />
        <meshBasicMaterial color="#445" wireframe />
      </mesh>
    );
  }
  return (
    <group quaternion={skyView}>
      <PleiadesCatalogPoints
        attributes={model.attributes}
        getOpacity={OPACITY_FULL}
        getSizeGain={gettersRef.current.sizeGain}
      />
      <PleiadesNamedStars
        placements={model.named}
        getOpacity={OPACITY_FULL}
        getSpikeGain={gettersRef.current.spikeGain}
      />
      <PleiadesReflectionNebula
        placements={model.nebula}
        getOpacity={OPACITY_FULL}
        getStrength={gettersRef.current.nebulaStrength}
      />
    </group>
  );
}
