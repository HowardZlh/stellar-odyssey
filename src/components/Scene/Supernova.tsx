'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SupernovaEvent } from '@/types';
import { useSimulationStore } from '@/store';
import { SCENE_UNITS_PER_LY, trapezoidWeight } from '@/utils/scale';
import {
  GALACTIC_BULGE_RADIUS_LY,
  GALACTIC_DISK_RADIUS_LY,
  simDaysToMyr,
} from '@/utils/galaxy';
import {
  SN_DEFAULT_DURATION_SEC,
  randomArmPositionLy,
  remnantCompactObject,
  shouldAutoTriggerSupernova,
  supernovaVisualState,
} from '@/utils/supernova';
import { nebulaExpansionScale } from '@/utils/specialBodies';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';

/** 超新星可视范围（与银河系内容一致的 LOD 门控） */
function snFadeWeight(continuousLevel: number): number {
  return trapezoidWeight(continuousLevel, 2.05, 2.6, 4.5, 5);
}

/** 冲击波最大半径（场景单位；约 800 光年的示意尺度，已登记视觉夸大） */
const SHOCK_MAX_RADIUS_UNITS = 800 * SCENE_UNITS_PER_LY;

/** 旋臂随机位置参数（与银盘粒子生成参数一致） */
const ARM_PARAMS = {
  armCount: 4,
  spiralTightness: 1.2,
  bulgeRadiusLy: GALACTIC_BULGE_RADIUS_LY,
  diskRadiusLy: GALACTIC_DISK_RADIUS_LY,
  heightSpreadLy: 300,
} as const;

/** 生成一次随机爆发参数（位置在旋臂内 + 前身星质量 10–30 M☉） */
export function rollSupernovaParams(rand: () => number = Math.random): {
  positionLy: { x: number; y: number; z: number };
  massSun: number;
} {
  return {
    positionLy: randomArmPositionLy(rand, ARM_PARAMS),
    massSun: 10 + rand() * 20,
  };
}

/** 永久遗迹：膨胀星云 + 中心致密天体（中子星或黑洞，按前身星质量） */
function Remnant({ event }: { event: SupernovaEvent }): JSX.Element {
  const nebulaRef = useRef<THREE.Sprite>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const compact = remnantCompactObject(event.progenitorMassSun);
  const size = SHOCK_MAX_RADIUS_UNITS * 0.6;

  const texture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#9fc4ff', 128)),
    [],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(({ clock }) => {
    const weight = snFadeWeight(useSimulationStore.getState().continuousLevel);
    if (nebulaRef.current) {
      const s = size * nebulaExpansionScale(clock.elapsedTime, 120, 0.08);
      nebulaRef.current.scale.set(s, s, 1);
      (nebulaRef.current.material as THREE.SpriteMaterial).opacity = 0.35 * weight;
    }
  });

  const posUnits = [
    event.positionLy.x * SCENE_UNITS_PER_LY,
    event.positionLy.y * SCENE_UNITS_PER_LY,
    event.positionLy.z * SCENE_UNITS_PER_LY,
  ] as const;

  return (
    <group position={[posUnits[0], posUnits[1], posUnits[2]]} name={event.id}>
      {/* 遗迹星云（持续缓慢膨胀） */}
      <sprite
        ref={nebulaRef}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(event.id);
        }}
      >
        <spriteMaterial
          map={texture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 中心致密天体：中子星（蓝白）或黑洞（纯黑 + 微弱吸积辉光） */}
      {compact === 'neutron-star' ? (
        <mesh>
          <sphereGeometry args={[size * 0.05, 12, 12]} />
          <meshBasicMaterial color="#dff2ff" />
        </mesh>
      ) : (
        <group>
          <mesh>
            <sphereGeometry args={[size * 0.06, 16, 16]} />
            <meshBasicMaterial color="#000000" />
          </mesh>
          <mesh rotation={[-Math.PI / 2.4, 0, 0]}>
            <ringGeometry args={[size * 0.08, size * 0.16, 32, 1]} />
            <meshBasicMaterial
              color="#ffb36b"
              transparent
              opacity={0.5}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** 活跃事件：四阶段动画（增亮 → 冲击波扩张 → 衰减 → 遗迹交接） */
function ActiveSupernova({ event }: { event: SupernovaEvent }): JSX.Element {
  const flashRef = useRef<THREE.Sprite>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const remnantRef = useRef<THREE.Sprite>(null);
  const archivedRef = useRef(false);

  const textures = useMemo(
    () => ({
      flash: new THREE.CanvasTexture(createGlowSpriteCanvas('#fff6e8', 256)),
      remnant: new THREE.CanvasTexture(createGlowSpriteCanvas('#9fc4ff', 128)),
    }),
    [],
  );
  useEffect(
    () => () => {
      textures.flash.dispose();
      textures.remnant.dispose();
    },
    [textures],
  );

  useFrame(() => {
    const store = useSimulationStore.getState();
    const weight = snFadeWeight(store.continuousLevel);
    const elapsedSec = (Date.now() - event.startedAtMs) / 1000;
    const state = supernovaVisualState(elapsedSec, event.durationSec);

    // 动画完成：归档为永久遗迹（一次性）
    if (state.phase === 'remnant' && !archivedRef.current) {
      archivedRef.current = true;
      store.archiveSupernova();
      return;
    }

    // 1/3. 核心亮度：骤增至峰值（短暂成为视野内最亮点）→ 衰减曲线回落
    if (flashRef.current) {
      const s = SHOCK_MAX_RADIUS_UNITS * (0.5 + 1.7 * state.brightness01);
      flashRef.current.scale.set(s, s, 1);
      (flashRef.current.material as THREE.SpriteMaterial).opacity =
        state.brightness01 * weight;
    }
    // 2. 球形冲击波壳层：Sedov-Taylor 减速扩张（半透明壳体 + 外缘增亮）
    const shockRadius = Math.max(1e-3, state.shockRadius01) * SHOCK_MAX_RADIUS_UNITS;
    if (shellRef.current) {
      shellRef.current.visible = state.shockRadius01 > 0.001;
      shellRef.current.scale.setScalar(shockRadius);
      (shellRef.current.material as THREE.MeshBasicMaterial).opacity =
        state.shockOpacity01 * 0.35 * weight;
    }
    if (rimRef.current) {
      rimRef.current.visible = state.shockRadius01 > 0.001;
      rimRef.current.scale.setScalar(shockRadius);
      (rimRef.current.material as THREE.MeshBasicMaterial).opacity =
        state.shockOpacity01 * weight;
    }
    // 4. 遗迹渐显（decay 阶段）
    if (remnantRef.current) {
      const s = SHOCK_MAX_RADIUS_UNITS * 0.6;
      remnantRef.current.scale.set(s, s, 1);
      (remnantRef.current.material as THREE.SpriteMaterial).opacity =
        state.remnantOpacity01 * 0.35 * weight;
    }
  });

  return (
    <group
      position={[
        event.positionLy.x * SCENE_UNITS_PER_LY,
        event.positionLy.y * SCENE_UNITS_PER_LY,
        event.positionLy.z * SCENE_UNITS_PER_LY,
      ]}
      name={event.id}
    >
      <sprite ref={flashRef}>
        <spriteMaterial
          map={textures.flash}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 冲击波壳层（半透明壳体） */}
      <mesh ref={shellRef}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial
          color="#ffd9a8"
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* 冲击波外缘增亮（BackSide 边缘壳） */}
      <mesh ref={rimRef}>
        <sphereGeometry args={[1.02, 32, 32]} />
        <meshBasicMaterial
          color="#fff0d0"
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* 遗迹星云渐显 */}
      <sprite ref={remnantRef}>
        <spriteMaterial
          map={textures.remnant}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </group>
  );
}

/**
 * 超新星事件系统（需求 3.1.5 动态事件）：
 * - 自动触发：模拟时间内低概率（泊松过程），位置在旋臂内随机；
 *   真实频率约每 50–100 年一次，模拟按 SN_MEAN_INTERVAL_MYR 降频（已登记）
 * - 手动触发：设置面板"超新星演示"按钮（store.triggerSupernova）
 * - 渲染于 Galaxy 组内（银心系本地坐标）
 */
export function Supernova(): JSX.Element {
  const activeSupernova = useSimulationStore((s) => s.activeSupernova);
  const supernovaRemnants = useSimulationStore((s) => s.supernovaRemnants);
  const lastSimDaysRef = useRef<number | null>(null);

  // 自动触发（低概率泊松过程；时间倒退/大跳变时仅重置基准）
  useFrame(() => {
    const store = useSimulationStore.getState();
    const last = lastSimDaysRef.current;
    lastSimDaysRef.current = store.simDays;
    if (last === null || store.simDays <= last) return;
    if (store.activeSupernova) return;
    const deltaMyr = simDaysToMyr(store.simDays - last);
    if (shouldAutoTriggerSupernova(Math.random(), deltaMyr)) {
      const params = rollSupernovaParams();
      store.triggerSupernova(params.positionLy, params.massSun, SN_DEFAULT_DURATION_SEC);
    }
  });

  return (
    <group name="supernova-events">
      {activeSupernova && <ActiveSupernova key={activeSupernova.id} event={activeSupernova} />}
      {supernovaRemnants.map((event) => (
        <Remnant key={event.id} event={event} />
      ))}
    </group>
  );
}
