'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PlanetData } from '@/types';
import { useSimulationStore } from '@/store';
import { DEG_TO_RAD, heliocentricPosition, rotationAngleAtTime } from '@/utils/physics';
import { eclipticToScene, visualBodyRadius } from '@/utils/scale';

interface PlanetProps {
  data: PlanetData;
}

/**
 * 行星：开普勒轨道公转 + 真实轴倾角自转
 *
 * - 位置每帧由模拟时间求解开普勒方程得到（匀面速度，需求 3.1.1）
 * - 轴倾角按 NASA 数据设置；金星 177.36°、天王星 97.77° 的"翻转轴"
 *   本身就表现了逆向自转（自转角速率取周期绝对值，方向由轴的朝向决定，
 *   与 NASA Fact Sheet 的负周期标记一致，避免方向双重取反）
 */
export function Planet({ data }: PlanetProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const selectBody = useSimulationStore((s) => s.selectBody);

  const radius = visualBodyRadius(data.radiusKm);
  const tiltRad = data.rotation.axialTiltDeg * DEG_TO_RAD;

  useFrame(() => {
    const simDays = useSimulationStore.getState().simDays;
    // 公转位置：求解开普勒方程（近日点快、远日点慢）
    const ecliptic = heliocentricPosition(data.orbit, simDays);
    const scene = eclipticToScene(ecliptic);
    if (groupRef.current) {
      groupRef.current.position.set(scene.x, scene.y, scene.z);
    }
    // 自转：绕倾斜后的自身轴，周期取绝对值（逆向由轴倾角 >90° 表达）
    if (bodyRef.current) {
      bodyRef.current.rotation.y = rotationAngleAtTime(
        Math.abs(data.rotation.siderealPeriodHours),
        simDays,
      );
    }
  });

  return (
    <group ref={groupRef} name={data.id}>
      {/* 轴倾角组：绕 Z 轴倾斜（相对轨道面，此处近似相对黄道面） */}
      <group rotation={[0, 0, tiltRad]}>
        <mesh
          ref={bodyRef}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(data.id);
          }}
        >
          <sphereGeometry args={[radius, 48, 48]} />
          <meshStandardMaterial color={data.color} roughness={0.85} metalness={0.05} />
        </mesh>
      </group>
      {showLabels && (
        <Html
          position={[0, radius + 0.6, 0]}
          center
          distanceFactor={60}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-gray-200/80">{data.nameZh}</span>
        </Html>
      )}
    </group>
  );
}
