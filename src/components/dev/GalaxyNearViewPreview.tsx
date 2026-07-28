'use client';

import type { JSX, RefObject } from 'react';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GalaxyNearViewLayer } from '@/components/Scene/GalaxyNearView';
import { getGalaxyById } from '@/data/galaxies';
import {
  inclinedOrientationRad,
  type GalaxyCompositeOverrides,
} from '@/utils/galaxyNearView';
import { galaxyPlaneSizeUnits } from '@/utils/universe';
import { galaxyPreviewConfigForBody, type PreviewEntry } from '@/utils/devPreview';

/**
 * 星系近观多分量粒子层预览（R4-10，`/dev/preview?body=m31|lmc`）
 *
 * 复用主场景 `GalaxyNearViewLayer`（含 R4-10 dust normal 混合暗纹 /
 * HII·年轻星团加性层 / M31 尘埃环与偏黄核球），经缩放组适配预览相机
 * 尺度（贴图平面尺寸 → 直径 PREVIEW_DIAMETER_UNITS）。滑杆三件
 * （§R4-10）：dust 强度 / HII 密度（GalaxyCompositeOverrides 重新生成
 * 分量，dev 页滑杆变更重建几何可接受登记）/ 倾角覆写
 * （inclinedOrientationRad，预览视线 = 相机初始 +z 方向）。
 *
 * 仅 dev 动态 import 加载（主 bundle 零增大）；GalaxyNearViewLayer 内部
 * 已托管几何/材质 dispose。
 */

/** 预览目标直径（场景单位；相机初始距离 4.2 → 全貌 + 可推近绕行） */
const PREVIEW_DIAMETER_UNITS = 3.2;

/** 预览自转基准角速度（rad/s；与恒星预览同值，时间流速观感一致） */
const PREVIEW_SPIN_RAD_PER_SEC = 0.15;

/** 预览视线方向（相机初始位于 +z 看向原点 → 视线 = −z 的反向 +z 轴对齐） */
const PREVIEW_LOS = { x: 0, y: 0, z: 1 } as const;

/** 预览恒定全可见权重（模块级常量，避免每次渲染新建函数） */
const WEIGHT_FULL = (): number => 1;

export function GalaxyNearViewPreview({
  entry,
  values,
  clockLabelRef,
}: {
  entry: PreviewEntry;
  values: Record<string, number>;
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');

  // 注册期校验过的星系条目，配置与数据必存在
  const config = galaxyPreviewConfigForBody(entry.bodyId)!;
  const galaxy = getGalaxyById(config.galaxyId)!;

  const scale = useMemo(
    () => PREVIEW_DIAMETER_UNITS / galaxyPlaneSizeUnits(galaxy.diameterLy),
    [galaxy.diameterLy],
  );

  const overrides = useMemo<GalaxyCompositeOverrides>(
    () => ({
      dustStrength: values.dustStrength,
      hiiDensity: values.hiiDensity,
    }),
    [values.dustStrength, values.hiiDensity],
  );

  const orientation = useMemo(
    () =>
      inclinedOrientationRad(
        PREVIEW_LOS,
        values.inclinationDeg ?? 0,
        config.positionAngleDeg,
      ),
    [values.inclinationDeg, config.positionAngleDeg],
  );

  useFrame((_, delta) => {
    virtualTimeRef.current += delta;
    const group = groupRef.current;
    if (group) {
      group.rotation.y += delta * PREVIEW_SPIN_RAD_PER_SEC;
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
  });

  return (
    <group ref={groupRef}>
      <group scale={scale}>
        <GalaxyNearViewLayer
          galaxy={galaxy}
          getOpacity={WEIGHT_FULL}
          overrides={overrides}
          orientationOverride={orientation}
          pointScaleOverride={PREVIEW_DIAMETER_UNITS * 4}
        />
      </group>
    </group>
  );
}

export default GalaxyNearViewPreview;
