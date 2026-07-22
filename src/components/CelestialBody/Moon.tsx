'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { MoonData, OrbitalElements } from '@/types';
import { useSimulationStore } from '@/store';
import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  normalizeAngle,
  orbitPositionWithPeriod,
  sampleOrbitPoints,
} from '@/utils/physics';
import {
  satelliteBodyDisplayRadius,
  satelliteOrbitDisplayRadius,
  tidalLockedRotationAngle,
} from '@/utils/satellites';
import { rateClampFactor, timeCompressionForContinuousLevel } from '@/utils/time';
import { createBodyTextureCanvas } from '@/components/CelestialBody/proceduralTextures';

interface MoonProps {
  data: MoonData;
  /** 所属行星真实半径（km），用于分层缩放 */
  parentRadiusKm: number;
}

/**
 * 卫星（自然/人造，需求 3.1.1）：
 * - 广义开普勒轨道绕行星运动（周期来自真实数据）
 * - 潮汐锁定卫星（月球等）自转与公转同步，始终同一面朝向行星
 * - 快周期人造卫星（ISS 92 分钟）在高时间压缩比下做速率钳制（需求 3.3），
 *   钳制时向 store 上报"运动已减速显示"提示
 * - 轨道线可显示/隐藏（行星视角下默认显示）
 *
 * 参考平面：本组件渲染于行星的参考平面组内（赤道面或黄道面，
 * 由父组件按 data.referencePlane 决定挂载位置）。
 */
export function Moon({ data, parentRadiusKm }: MoonProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const clampedRef = useRef(false);
  /** 钳制期间的累计相位（弧度），保证降速显示时运动平滑无跳变 */
  const clampedPhaseRef = useRef<number | null>(null);
  const lastSimDaysRef = useRef<number | null>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showSatelliteOrbits = useSimulationStore((s) => s.showSatelliteOrbits);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // 卫星标签仅行星视角显示（避免太阳系视角下重叠杂乱）
  const isPlanetView = useSimulationStore((s) => s.viewLevel === 'L1');
  // 真实比例模式（需求 4.1）：轨道与本体按真实距离/半径线性映射
  const realScaleMode = useSimulationStore((s) => s.realScaleMode);

  const bodyRadius = satelliteBodyDisplayRadius(data.kind, data.radiusKm, realScaleMode);
  // 视觉轨道要素：半长轴替换为分层缩放后的场景单位（登记于 utils/satellites.ts）
  const visualElements = useMemo<OrbitalElements>(
    () => ({
      semiMajorAxisAu: satelliteOrbitDisplayRadius(
        data.kind,
        parentRadiusKm,
        data.orbit.semiMajorAxisKm,
        realScaleMode,
      ),
      eccentricity: data.orbit.eccentricity,
      inclinationDeg: data.orbit.inclinationDeg,
      longitudeOfAscendingNodeDeg: data.orbit.longitudeOfAscendingNodeDeg,
      argumentOfPerihelionDeg: data.orbit.argumentOfPeriapsisDeg,
      meanAnomalyAtEpochDeg: data.orbit.meanAnomalyAtEpochDeg,
    }),
    [data, parentRadiusKm, realScaleMode],
  );

  // 渲染循环内复用的可变要素副本（避免每帧创建新对象）
  const frameElements = useMemo<OrbitalElements>(() => ({ ...visualElements }), [visualElements]);

  const texture = useMemo(() => {
    if (data.kind === 'artificial') return null;
    const canvas = createBodyTextureCanvas(data.id, data.color, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [data.id, data.color, data.kind]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  useFrame(() => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel, speedMultiplier } = state;

    // 速率钳制（需求 3.3）：视觉转速 > 0.5 圈/秒时降速显示
    const compression = timeCompressionForContinuousLevel(continuousLevel);
    const factor = rateClampFactor(data.orbit.periodDays, compression, speedMultiplier);
    // 提示仅在卫星可见的层级显示（外层视角下太阳系内容已冻结隐藏）
    const clamped = factor < 1 && continuousLevel <= 3.2;
    if (clamped !== clampedRef.current) {
      clampedRef.current = clamped;
      state.setRateClampNotice(clamped);
    }

    // 轨道相位（平近点角，弧度）：
    // - 未钳制：严格按共享模拟时间轴求值（跨层级返回时位置一致，需求 3.3）
    // - 钳制中：按降速后的角速度增量累计（平滑，无因子变化导致的跳变）
    const meanMotion = (Math.PI * 2) / data.orbit.periodDays;
    const exactPhase = normalizeAngle(
      data.orbit.meanAnomalyAtEpochDeg * DEG_TO_RAD + meanMotion * simDays,
    );
    let phase: number;
    if (!clamped) {
      phase = exactPhase;
      clampedPhaseRef.current = null;
    } else {
      const last = lastSimDaysRef.current;
      if (clampedPhaseRef.current === null || last === null) {
        clampedPhaseRef.current = exactPhase;
      } else {
        clampedPhaseRef.current = normalizeAngle(
          clampedPhaseRef.current + meanMotion * (simDays - last) * factor,
        );
      }
      phase = clampedPhaseRef.current;
    }
    lastSimDaysRef.current = simDays;

    // 以当前相位求解开普勒方程得到位置（历元时刻取 0，相位即平近点角）
    frameElements.meanAnomalyAtEpochDeg = phase * RAD_TO_DEG;
    const p = orbitPositionWithPeriod(frameElements, data.orbit.periodDays, 0);
    if (groupRef.current) {
      // 参考平面局部坐标 → three.js（x-y 平面 → x-(-z)，z → y）
      groupRef.current.position.set(p.x, p.z, -p.y);
    }
    if (bodyRef.current && data.tidallyLocked) {
      // 潮汐锁定：自转角 = 轨道相位角 + π（始终同一面朝向行星）
      bodyRef.current.rotation.y = tidalLockedRotationAngle(phase);
    }
  });

  // 卸载时清除钳制提示
  useEffect(() => {
    return () => {
      if (clampedRef.current) {
        useSimulationStore.getState().setRateClampNotice(false);
      }
    };
  }, []);

  const orbitLine = useMemo(() => {
    const points = sampleOrbitPoints(visualElements, 128).map(
      (p) => new THREE.Vector3(p.x, p.z, -p.y),
    );
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: data.kind === 'artificial' ? '#7fd4c1' : '#88AAFF',
      transparent: true,
      opacity: 0.45,
    });
    return new THREE.Line(geometry, material);
  }, [visualElements, data.kind]);

  useEffect(() => {
    return () => {
      orbitLine.geometry.dispose();
      (orbitLine.material as THREE.Material).dispose();
    };
  }, [orbitLine]);

  return (
    <group>
      {showSatelliteOrbits && <primitive object={orbitLine} />}
      <group ref={groupRef} name={data.id}>
        <mesh
          ref={bodyRef}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(data.id);
          }}
        >
          {data.kind === 'artificial' ? (
            <boxGeometry args={[bodyRadius * 2.4, bodyRadius, bodyRadius]} />
          ) : (
            <sphereGeometry args={[bodyRadius, 32, 32]} />
          )}
          {texture ? (
            <meshStandardMaterial map={texture} roughness={0.9} metalness={0.02} />
          ) : (
            <meshStandardMaterial
              color={data.color}
              roughness={0.4}
              metalness={0.6}
              emissive={data.color}
              emissiveIntensity={0.25}
            />
          )}
        </mesh>
        {showLabels && isPlanetView && (
          <Html
            position={[0, bodyRadius + 0.15, 0]}
            center
            distanceFactor={16}
            style={{ pointerEvents: 'none' }}
          >
            <span className="whitespace-nowrap text-[10px] text-gray-300/70">{data.nameZh}</span>
          </Html>
        )}
      </group>
    </group>
  );
}
