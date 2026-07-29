'use client';

import type { JSX, RefObject } from 'react';
/**
 * 类星体 3C 273 近观预览（R4-21，`/dev/preview?body=quasar-3c273`）
 *
 * 与主场景共用 `Scene/QuasarNearView.QuasarNearCore`（吸积盘 + BLR 辉光 +
 * 尘埃环面，观感同源）+ 核心辉光 sprite（光变闪烁）+ 双向相对论喷流
 * （`RelativisticJet` 复用，长度比例与主场景一致 8× 基准半径）——
 * 四层结构在预览页即可整体目验。滑杆（束流强度/盘亮度/环面亮度/时间
 * 流速）经帧读 getter 直达 uniform（无材质重建）；时间经虚拟时钟驱动
 * （盘差速条纹/光变/喷流节奏联动）。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { QuasarNearCore } from '@/components/Scene/QuasarNearView';
import { RelativisticJet } from '@/components/Scene/ExtragalacticObjects';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';
import { quasarFlicker } from '@/utils/specialBodies';
import { quasarCoreNearFactor } from '@/utils/quasarNearView';

/** 预览基准半径（场景单位；主场景 EXTRAGALACTIC_VIEW_RADIUS_UNITS=300 → 1） */
const PREVIEW_BASE_RADIUS_UNITS = 1;

/** 喷流长度 = 8× 基准半径（主场景 2400/300 同比例） */
const PREVIEW_JET_LENGTH_UNITS = 8 * PREVIEW_BASE_RADIUS_UNITS;

/** 核心辉光 sprite 边长 = 3× 基准半径（主场景 900/300 同比例） */
const PREVIEW_CORE_EDGE_UNITS = 3 * PREVIEW_BASE_RADIUS_UNITS;

export function QuasarNearViewPreview({
  values,
  clockLabelRef,
}: {
  values: Record<string, number>;
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
}): JSX.Element {
  const coreRef = useRef<THREE.Sprite>(null);
  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');
  // 滑杆帧读 getter（组件消费 ref，滑杆变化零材质/几何重建）
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const gettersRef = useRef({
    opacity: () => 1,
    time: () => virtualTimeRef.current,
    beam: () => valuesRef.current.beamStrength ?? 1,
    diskGain: () => valuesRef.current.diskGain ?? 1,
    torusGain: () => valuesRef.current.torusGain ?? 1,
  });

  const jetDirection = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const coreTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#dfeeff', 128)),
    [],
  );
  useEffect(() => () => coreTexture.dispose(), [coreTexture]);

  useFrame((_, delta) => {
    virtualTimeRef.current += delta * (valuesRef.current.timeScale ?? 1);
    const t = virtualTimeRef.current;
    if (coreRef.current) {
      // 主场景同式：光变闪烁 × 近观减淡（near01=1 档，光变保留可辨）
      (coreRef.current.material as THREE.SpriteMaterial).opacity =
        0.95 * quasarFlicker(t) * quasarCoreNearFactor(1);
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
      {/* 极亮核心（光变闪烁，主场景同源观感） */}
      <sprite ref={coreRef} scale={[PREVIEW_CORE_EDGE_UNITS, PREVIEW_CORE_EDGE_UNITS, 1]}>
        <spriteMaterial
          map={coreTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 近观三层：吸积盘 + BLR 辉光 + 尘埃环面（环面轴 = +y） */}
      <QuasarNearCore
        baseRadiusUnits={PREVIEW_BASE_RADIUS_UNITS}
        getOpacity={gettersRef.current.opacity}
        getTimeSec={gettersRef.current.time}
        getBeamStrength={gettersRef.current.beam}
        getDiskGain={gettersRef.current.diskGain}
        getTorusGain={gettersRef.current.torusGain}
      />
      {/* 第四层：双向相对论喷流（主场景同比例复用） */}
      <RelativisticJet
        direction={jetDirection}
        lengthUnits={PREVIEW_JET_LENGTH_UNITS}
        color="#9fd0ff"
        bilateral
        baseOpacity={0.8}
        getWeight={gettersRef.current.opacity}
      />
    </group>
  );
}
