'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { getGalaxyById } from '@/data/galaxies';
import { getSpecialBodyById } from '@/data/specialBodies';
import { useSimulationStore } from '@/store';
import { cosmicDistanceToSceneUnits, trapezoidWeight } from '@/utils/scale';
import { jetFlowPhase01, quasarFlicker } from '@/utils/specialBodies';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';

/** 与 Universe.tsx 一致的宇宙级 LOD 渐变区间 */
function fadeWeight(continuousLevel: number): number {
  return trapezoidWeight(continuousLevel, 3.05, 3.6, 4.5, 5);
}

/** 喷流流动粒子节数（沿喷流方向循环流动，需求 3.1.5 流动动画） */
const JET_SEGMENTS = 5;

interface JetProps {
  /** 喷流方向（单位矢量，局部坐标） */
  direction: THREE.Vector3;
  lengthUnits: number;
  color: string;
  /** 是否双向（类星体双向 / M87 单侧可见） */
  bilateral: boolean;
  baseOpacity: number;
}

/**
 * 相对论喷流：细长锥体 + 沿喷流方向循环流动的辉光节点（流动动画）
 */
function RelativisticJet({ direction, lengthUnits, color, bilateral, baseOpacity }: JetProps): JSX.Element {
  const nodesRef = useRef<THREE.Group>(null);
  const texture = useMemo(() => new THREE.CanvasTexture(createGlowSpriteCanvas(color, 64)), [color]);
  useEffect(() => () => texture.dispose(), [texture]);

  const sides = bilateral ? [1, -1] : [1];

  // 锥体朝向：+Y 对齐 direction
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    return q;
  }, [direction]);

  useFrame(({ clock }) => {
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.visible = weight > 0.001;
    if (!nodes.visible) return;
    // 流动动画：节点沿喷流方向循环外流
    const phase = jetFlowPhase01(clock.elapsedTime, 0.25);
    let idx = 0;
    for (const side of sides) {
      for (let s = 0; s < JET_SEGMENTS; s += 1) {
        const sprite = nodes.children[idx] as THREE.Sprite | undefined;
        idx += 1;
        if (!sprite) continue;
        const t = ((s / JET_SEGMENTS + phase) % 1 + 1) % 1;
        const d = t * lengthUnits;
        sprite.position.set(direction.x * d * side, direction.y * d * side, direction.z * d * side);
        // 距核心越远越暗
        (sprite.material as THREE.SpriteMaterial).opacity =
          baseOpacity * (1 - t * 0.8) * weight;
      }
    }
  });

  return (
    <group>
      {/* 喷流锥体（细长半透明） */}
      {sides.map((side) => (
        <mesh
          key={side}
          quaternion={quaternion}
          scale={[1, side, 1]}
          position={[
            (direction.x * lengthUnits * side) / 2,
            (direction.y * lengthUnits * side) / 2,
            (direction.z * lengthUnits * side) / 2,
          ]}
        >
          <coneGeometry args={[lengthUnits * 0.03, lengthUnits, 10, 1, true]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={baseOpacity * 0.4}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* 流动节点 */}
      <group ref={nodesRef}>
        {sides.flatMap((side) =>
          Array.from({ length: JET_SEGMENTS }, (_, s) => (
            <sprite key={`${side}-${s}`} scale={[lengthUnits * 0.1, lengthUnits * 0.1, 1]}>
              <spriteMaterial
                map={texture}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </sprite>
          )),
        )}
      </group>
    </group>
  );
}

/**
 * 类星体 3C 273（需求 3.1.5 河外对象）：极亮核心 + 双向相对论喷流 + 光变闪烁
 */
export function Quasar(): JSX.Element | null {
  const body = getSpecialBodyById('quasar-3c273');
  const coreRef = useRef<THREE.Sprite>(null);
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 3.05);

  const texture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#dfeeff', 128)),
    [],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  const jetDirection = useMemo(() => new THREE.Vector3(0.35, 0.9, 0.25).normalize(), []);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    group.visible = weight > 0.001;
    if (!group.visible) return;
    if (coreRef.current) {
      // 光变闪烁（不规则光变，需求 3.1.5）
      (coreRef.current.material as THREE.SpriteMaterial).opacity =
        0.95 * quasarFlicker(clock.elapsedTime) * weight;
    }
  });

  if (!body || !body.direction) return null;
  const d = cosmicDistanceToSceneUnits(body.realDistanceLy);
  const coreScale = 900;

  return (
    <group
      ref={groupRef}
      position={[body.direction.x * d, body.direction.y * d, body.direction.z * d]}
      name={body.id}
    >
      {/* 极亮核心 */}
      <sprite
        ref={coreRef}
        scale={[coreScale, coreScale, 1]}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <spriteMaterial
          map={texture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 双向相对论喷流（含流动动画） */}
      <RelativisticJet
        direction={jetDirection}
        lengthUnits={2400}
        color="#9fd0ff"
        bilateral
        baseOpacity={0.8}
      />
      {showLabels && inRange && (
        <Html position={[0, 700, 0]} center distanceFactor={12000} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-sky-200">
            {body.nameZh}（约 24 亿光年）
          </span>
        </Html>
      )}
    </group>
  );
}

/**
 * M87 活动星系核喷流（需求 3.1.5）：与室女座星系团 M87 条目联动为同一对象
 * （附着于 Universe 中 M87 星系的静态位置），单侧可见喷流。
 */
export function M87Jet(): JSX.Element | null {
  const galaxy = getGalaxyById('m87');
  const groupRef = useRef<THREE.Group>(null);

  const jetDirection = useMemo(() => new THREE.Vector3(0.55, 0.75, -0.37).normalize(), []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    group.visible = fadeWeight(useSimulationStore.getState().continuousLevel) > 0.001;
  });

  if (!galaxy) return null;
  const d = cosmicDistanceToSceneUnits(galaxy.distanceLy);

  return (
    <group
      ref={groupRef}
      position={[galaxy.direction.x * d, galaxy.direction.y * d, galaxy.direction.z * d]}
      name="m87-jet"
    >
      <RelativisticJet
        direction={jetDirection}
        lengthUnits={1500}
        color="#bfd8ff"
        bilateral={false}
        baseOpacity={0.7}
      />
    </group>
  );
}
