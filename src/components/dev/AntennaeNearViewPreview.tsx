'use client';

import type { JSX, RefObject } from 'react';
/**
 * 触须星系近观预览（R4-22，`/dev/preview?body=antennae`）
 *
 * 与主场景共用 `Scene/AntennaeNearView`（两核 + 双潮汐尾烘焙快照粒子，
 * 观感同源）。虚拟时钟映射为 simDays 驱动快照插值演化（时间流速滑杆
 * 可加速目验"缓慢演化 + 插值无跳变"）；粒径滑杆经帧读 getter 直达
 * uniform（无材质重建）。数据加载失败/未就绪显示降级占位（主场景
 * 对应降级为现状静态渲染，登记）。
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAntennaeSnapshots } from '@/hooks/useAntennaeSnapshots';
import { AntennaeNearView } from '@/components/Scene/AntennaeNearView';
import { ANTENNAE_SNAPSHOT_SPAN_MYR } from '@/utils/antennaeNearView';
import { DAYS_PER_MYR } from '@/utils/galaxy';

/** 预览基准半径（场景单位；主场景 EXTRAGALACTIC_VIEW_RADIUS_UNITS=300 → 1） */
const PREVIEW_BASE_RADIUS_UNITS = 1;

/** 虚拟时钟换算：1 秒（timeScale=1）= 30 Myr → 全程 600 Myr 约 20 秒扫完 */
const PREVIEW_MYR_PER_SEC = ANTENNAE_SNAPSHOT_SPAN_MYR / 20;

/** 恒定全可见权重（预览页无层级淡入淡出） */
const OPACITY_FULL = (): number => 1;

export function AntennaeNearViewPreview({
  values,
  clockLabelRef,
}: {
  values: Record<string, number>;
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
}): JSX.Element {
  const data = useAntennaeSnapshots();
  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');
  // 滑杆帧读 getter（组件消费 ref，滑杆变化零材质/几何重建）
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const gettersRef = useRef({
    simDays: () => virtualTimeRef.current * PREVIEW_MYR_PER_SEC * DAYS_PER_MYR,
    sizeGain: () => valuesRef.current.sizeGain ?? 1,
  });

  useFrame((_, delta) => {
    virtualTimeRef.current += delta * (valuesRef.current.timeScale ?? 1);
    const label = clockLabelRef?.current;
    if (label) {
      const text = virtualTimeRef.current.toFixed(1);
      if (text !== clockTextRef.current) {
        clockTextRef.current = text;
        label.textContent = text;
      }
    }
  });

  if (!data) {
    // 数据未就绪/加载失败：降级占位（主场景对应降级为现状静态渲染，登记）
    return (
      <mesh>
        <sphereGeometry args={[PREVIEW_BASE_RADIUS_UNITS * 0.5, 12, 12]} />
        <meshBasicMaterial color="#445" wireframe />
      </mesh>
    );
  }
  return (
    <AntennaeNearView
      data={data}
      baseRadiusUnits={PREVIEW_BASE_RADIUS_UNITS}
      getOpacity={OPACITY_FULL}
      getSimDays={gettersRef.current.simDays}
      getSizeGain={gettersRef.current.sizeGain}
    />
  );
}
