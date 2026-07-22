'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { CometData } from '@/types';
import { useSimulationStore } from '@/store';
import { heliocentricPosition } from '@/utils/physics';
import { eclipticToScene } from '@/utils/scale';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';

interface CometProps {
  data: CometData;
}

// 圆锥几何体尖端朝 +Y：将 -Y 对齐彗尾方向，使尖端位于彗核、开口朝外
const UP = new THREE.Vector3(0, -1, 0);

/**
 * 彗星（需求 3.1.1）：
 * - 高离心率椭圆轨道，位置由开普勒方程精确求解 → 匀面速度效果显著
 *   （近日点疾驰、远日点缓慢）；哈雷倾角 162° 为逆行轨道
 * - 近日点附近（日心距 < tailActivationAu）出现彗发与彗尾
 * - 彗尾始终背向太阳（尘埃尾偏黄白且略短宽、离子尾蓝色细长，可区分）
 * - 彗尾长度与亮度随日心距离变化（越近越亮越长）
 */
export function Comet({ data }: CometProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const comaRef = useRef<THREE.Sprite>(null);
  const dustTailRef = useRef<THREE.Mesh>(null);
  const ionTailRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控
  const frozen = useSimulationStore((s) => s.continuousLevel > 3.2);

  const comaTexture = useMemo(() => {
    const tex = new THREE.CanvasTexture(createGlowSpriteCanvas(data.color, 128));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [data.color]);

  useEffect(() => {
    return () => {
      comaTexture.dispose();
    };
  }, [comaTexture]);

  const tailDirection = useMemo(() => new THREE.Vector3(), []);
  const tailQuaternion = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel } = state;
    const group = groupRef.current;
    if (!group) return;

    // 外层视角退化（与行星一致）
    const frozen = continuousLevel > 3.2;
    group.visible = !frozen;
    if (frozen) return;

    const ecliptic = heliocentricPosition(data.orbit, simDays);
    const scene = eclipticToScene(ecliptic);
    group.position.set(scene.x, scene.y, scene.z);

    const distanceAu = Math.hypot(ecliptic.x, ecliptic.y, ecliptic.z);
    // 活跃度：近日点 1 → 激活阈值 0（彗尾亮度随日心距离变化）
    const activity = Math.max(
      0,
      Math.min(1, (data.tailActivationAu - distanceAu) / data.tailActivationAu),
    );

    if (comaRef.current) {
      const comaScale = 0.6 + activity * 2.2;
      comaRef.current.scale.set(comaScale, comaScale, comaScale);
      (comaRef.current.material as THREE.SpriteMaterial).opacity = 0.15 + activity * 0.8;
      comaRef.current.visible = activity > 0.01;
    }

    // 彗尾方向：始终背向太阳（太阳在场景原点）
    tailDirection.copy(group.position).normalize();
    tailQuaternion.setFromUnitVectors(UP, tailDirection);

    const tailLength = activity * 14;
    if (ionTailRef.current) {
      ionTailRef.current.visible = activity > 0.05;
      ionTailRef.current.quaternion.copy(tailQuaternion);
      // 圆锥沿 +Y 方向，平移半长使尾根在彗核处
      ionTailRef.current.scale.set(1, Math.max(tailLength, 0.01), 1);
      ionTailRef.current.position.copy(tailDirection).multiplyScalar(tailLength / 2);
      (ionTailRef.current.material as THREE.MeshBasicMaterial).opacity = activity * 0.5;
    }
    if (dustTailRef.current) {
      const dustLength = tailLength * 0.6;
      dustTailRef.current.visible = activity > 0.05;
      dustTailRef.current.quaternion.copy(tailQuaternion);
      dustTailRef.current.scale.set(1.8, Math.max(dustLength, 0.01), 1.8);
      dustTailRef.current.position.copy(tailDirection).multiplyScalar(dustLength / 2);
      (dustTailRef.current.material as THREE.MeshBasicMaterial).opacity = activity * 0.35;
    }
  });

  return (
    <group ref={groupRef} name={data.id}>
      {/* 彗核 */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          selectBody(data.id);
        }}
      >
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color="#b8c4cc" roughness={0.95} />
      </mesh>

      {/* 彗发（近日点附近出现） */}
      <sprite ref={comaRef}>
        <spriteMaterial
          map={comaTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {/* 离子尾：蓝色细长（始终背向太阳） */}
      <mesh ref={ionTailRef}>
        <coneGeometry args={[0.35, 1, 12, 1, true]} />
        <meshBasicMaterial
          color="#5fa8ff"
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 尘埃尾：黄白色略宽短 */}
      <mesh ref={dustTailRef}>
        <coneGeometry args={[0.35, 1, 12, 1, true]} />
        <meshBasicMaterial
          color="#f0e0b8"
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {showLabels && !frozen && (
        <Html position={[0, 0.8, 0]} center distanceFactor={60} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap text-xs text-cyan-200/80">{data.nameZh}</span>
        </Html>
      )}
    </group>
  );
}
