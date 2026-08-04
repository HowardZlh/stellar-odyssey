'use client';

import type { JSX, RefObject } from 'react';
/**
 * 伽马射线暴 GRB 221009A 近观预览（R5-5 B，`/dev/preview?body=grb`）
 *
 * 与主场景共用 `Scene/GrbNearView.GrbNearCore`（相对论双喷流 + 余辉
 * 膨胀壳，观感同源）+ 极亮闪光 sprite（`grbFlashState` FRED 光变主场景
 * 同源）——近观两层结构在预览页整体目验（时间流速加速可两帧对比膨胀
 * 减暗演化）。滑杆（时间流速/喷流开角/喷流亮度/余辉强度）经帧读
 * getter 直达 uniform（开角变化触发锥体几何重建，仅交互期登记）；
 * 时间经虚拟时钟驱动（闪光/喷流/余辉相位同步）。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GrbNearCore } from '@/components/Scene/GrbNearView';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';
import { grbFlashState } from '@/utils/specialBodies';
import { GRB_NEAR_JET_FULL_ANGLE_DEG } from '@/utils/grbNearView';

/** 预览基准半径（场景单位；主场景 EXTRAGALACTIC_VIEW_RADIUS_UNITS=300 → 1） */
const PREVIEW_BASE_RADIUS_UNITS = 1;

/** 闪光 sprite 基础边长/脉冲增量（主场景 500+1800·i / 300 同比例） */
const PREVIEW_FLASH_BASE_EDGE = 500 / 300;
const PREVIEW_FLASH_PULSE_EDGE = 1800 / 300;

/** 双喷流轴姿态（主场景 GRB_JET_ROTATION_RAD 同值观感；预览取 +y 直立
 * 便于绕行目验开角，登记差异：预览不复现主场景天球姿态） */

export function GrbNearViewPreview({
  values,
  clockLabelRef,
}: {
  values: Record<string, number>;
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
}): JSX.Element {
  const flashRef = useRef<THREE.Sprite>(null);
  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');
  // 滑杆帧读 getter（组件消费 ref，滑杆变化零材质重建；开角例外登记）
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const gettersRef = useRef({
    opacity: () => 1,
    time: () => virtualTimeRef.current,
    jetGain: () => valuesRef.current.jetGain ?? 1,
    shellGain: () => valuesRef.current.shellGain ?? 1,
  });
  const jetAngleDeg = values.jetAngleDeg ?? GRB_NEAR_JET_FULL_ANGLE_DEG;
  const getJetAngleDeg = useMemo(() => () => jetAngleDeg, [jetAngleDeg]);

  const flashTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#eef6ff', 128)),
    [],
  );
  useEffect(() => () => flashTexture.dispose(), [flashTexture]);

  useFrame((_, delta) => {
    virtualTimeRef.current += delta * (valuesRef.current.timeScale ?? 1);
    const t = virtualTimeRef.current;
    if (flashRef.current) {
      const { intensity01 } = grbFlashState(t);
      const s = PREVIEW_FLASH_BASE_EDGE + PREVIEW_FLASH_PULSE_EDGE * intensity01;
      flashRef.current.scale.set(s, s, 1);
      (flashRef.current.material as THREE.SpriteMaterial).opacity = intensity01;
    }
    const label = clockLabelRef?.current;
    if (label) {
      const text = t.toFixed(1);
      if (text !== clockTextRef.current) {
        clockTextRef.current = text;
        label.textContent = text;
      }
    }
  });

  return (
    <group>
      {/* 极亮伽马闪光（FRED 光变曲线，主场景同源观感） */}
      <sprite ref={flashRef}>
        <spriteMaterial
          map={flashTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0}
        />
      </sprite>
      {/* 近观两层：相对论双喷流（~5° 蓝白更亮）+ 余辉膨胀壳（轴 = +y） */}
      <GrbNearCore
        baseRadiusUnits={PREVIEW_BASE_RADIUS_UNITS}
        getOpacity={gettersRef.current.opacity}
        getTimeSec={gettersRef.current.time}
        getJetAngleDeg={getJetAngleDeg}
        getJetGain={gettersRef.current.jetGain}
        getShellGain={gettersRef.current.shellGain}
      />
    </group>
  );
}

export default GrbNearViewPreview;
