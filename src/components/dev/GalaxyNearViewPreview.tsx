'use client';

import type { JSX, RefObject } from 'react';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GalaxyNearViewLayer } from '@/components/Scene/GalaxyNearView';
import { GalaxyDustVolumeLayer } from '@/components/Scene/GalaxyDustVolumeLayer';
import { getGalaxyById } from '@/data/galaxies';
import {
  inclinedOrientationRad,
  type GalaxyCompositeOverrides,
} from '@/utils/galaxyNearView';
import { isDustVolumeGalaxy } from '@/utils/galaxyDustVolume';
import { TARANTULA_SCALE_BOOST_DEFAULT } from '@/utils/lmcStructures';
import { useGalaxyImageMaps } from '@/hooks/useGalaxyImageMaps';
import { galaxyPlaneSizeUnits } from '@/utils/universe';
import { galaxyPreviewConfigForBody, type PreviewEntry } from '@/utils/devPreview';

/**
 * 星系近观多分量粒子层预览（R4-10 交付，R5-1 影像驱动扩展，R5-2 体积
 * 尘埃盘叠挂，`/dev/preview?body=m31|m33|lmc|smc`）
 *
 * 复用主场景 `GalaxyNearViewLayer`（含 R4-10 dust normal 混合暗纹 /
 * HII·年轻星团加性层），经缩放组适配预览相机尺度（贴图平面尺寸 →
 * 直径 PREVIEW_DIAMETER_UNITS）。滑杆：R5-1 影像驱动对比开关
 * （0 = R4-9 参数化对照 / 1 = 影像驱动，目检对照用）+ R4-10 三件
 * （dust 强度 / HII 密度 / 倾角覆写，inclinedOrientationRad 预览视线
 * = 相机初始 +z 方向）+ R5-2 两件（体积消光强度 σ / 尘埃盘厚——σ=0
 * 卸载体积层 = R4-10 暗粒子对照档，A/B 目检；倾角滑杆可推 90° 侧视
 * 验证消光随倾角增强）。影像产物加载失败时开关无效果 = 参数化降级、
 * 体积层不挂载（登记）。
 *
 * 仅 dev 动态 import 加载（主 bundle 零增大）；GalaxyNearViewLayer /
 * GalaxyDustVolumeLayer 内部已托管几何/材质/RT dispose。
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
  qualityLabelRef,
}: {
  entry: PreviewEntry;
  values: Record<string, number>;
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
  qualityLabelRef?: RefObject<HTMLSpanElement | null>;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const scaledGroupRef = useRef<THREE.Group>(null);
  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');
  const dustVolumeFadeRef = useRef(0);
  const getDustDim = useMemo(() => () => dustVolumeFadeRef.current, []);
  // R5-5：30 Dor 滑杆帧读 getter（lmc 条目专用；直达 uniform 零重建）
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const tarantulaGetters = useMemo(
    () => ({
      boost: () => valuesRef.current.dor30Boost ?? 1,
      scaleBoost: () =>
        valuesRef.current.dor30Scale ?? TARANTULA_SCALE_BOOST_DEFAULT,
    }),
    [],
  );

  // R5-2：`&spin=0` 关闭自转（dev 专用；无头目验 A/B 截图需固定姿态，
  // 默认自转 0.15 rad/s 保持 R4-10 交互现状）
  const spinEnabled = useMemo(
    () =>
      typeof window === 'undefined' ||
      new URLSearchParams(window.location.search).get('spin') !== '0',
    [],
  );

  // 注册期校验过的星系条目，配置与数据必存在
  const config = galaxyPreviewConfigForBody(entry.bodyId)!;
  const galaxy = getGalaxyById(config.galaxyId)!;

  // R5-1：影像驱动对比开关（滑杆 0/1；关闭时不加载 = 参数化对照）
  const imageDriven = (values.imageDriven ?? 1) >= 0.5;
  const maps = useGalaxyImageMaps(imageDriven ? config.galaxyId : null);

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

  // R5-2 体积尘埃盘：覆盖星系 + 影像就绪 + σ>0 时挂载（σ=0 = R4-10
  // 暗粒子对照档）；滑杆覆写（消光强度/盘厚）
  const volExtinction = values.volExtinction ?? 0;
  const dustVolumeOverrides = useMemo(
    () => ({
      extinctionSigma: volExtinction,
      boxThicknessLy: values.volThicknessLy,
    }),
    [volExtinction, values.volThicknessLy],
  );
  const dustVolumeMounted =
    isDustVolumeGalaxy(config.galaxyId) && imageDriven && maps !== null && volExtinction > 0;

  useFrame((_, delta) => {
    virtualTimeRef.current += delta;
    const group = groupRef.current;
    if (group && spinEnabled) {
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
      <group ref={scaledGroupRef} scale={scale}>
        <GalaxyNearViewLayer
          galaxy={galaxy}
          getOpacity={WEIGHT_FULL}
          overrides={overrides}
          orientationOverride={orientation}
          pointScaleOverride={PREVIEW_DIAMETER_UNITS * 4}
          maps={imageDriven ? maps : null}
          getDustDim={getDustDim}
          getTarantulaBoost={tarantulaGetters.boost}
          getTarantulaScaleBoost={tarantulaGetters.scaleBoost}
        />
        {dustVolumeMounted && maps && (
          <GalaxyDustVolumeLayer
            galaxyId={config.galaxyId}
            groupRef={scaledGroupRef}
            maps={maps}
            sizeUnits={galaxyPlaneSizeUnits(galaxy.diameterLy)}
            orientation={orientation}
            getWeight={WEIGHT_FULL}
            getGate01={WEIGHT_FULL}
            fadeRef={dustVolumeFadeRef}
            overrides={dustVolumeOverrides}
            qualityLabelRef={qualityLabelRef}
          />
        )}
      </group>
    </group>
  );
}

export default GalaxyNearViewPreview;
