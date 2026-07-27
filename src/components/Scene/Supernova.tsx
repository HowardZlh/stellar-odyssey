"use client";


import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SupernovaEvent } from "@/types";
import { useSimulationStore } from "@/store";
import { eventAutoTriggerAllowed } from "@/utils/eventScopes";
import { SCENE_UNITS_PER_LY, trapezoidWeight } from "@/utils/scale";
import {
  GALACTIC_BULGE_RADIUS_LY,
  GALACTIC_DISK_RADIUS_LY,
  simDaysToMyr,
} from "@/utils/galaxy";
import {
  SN_DEFAULT_DURATION_SEC,
  randomArmPositionLy,
  remnantCompactObject,
  shouldAutoTriggerSupernova,
  supernovaVisualState,
} from "@/utils/supernova";
import { nebulaExpansionScale } from "@/utils/specialBodies";
import {
  advanceFrameTransition,
  renderedGalacticFrame,
} from "@/utils/galacticFrame";
import {
  diskMorphWeight,
  morphGalacticYLy,
} from "@/utils/galacticLatitude";
import { setObjectTreeRaycastEnabled } from "@/utils/raycastGate";
import { createGlowSpriteCanvas } from "@/components/CelestialBody/proceduralTextures";
import { getNebulaTexture } from "@/components/CelestialBody/nebulaTextures";

/**
 * 遗迹丝状星云纹理（P6 §3.2：与蟹状星云共用 shell 生成路径，新遗迹同样受益）
 *
 * 按参数缓存（getNebulaTexture），全部遗迹复用同一张纹理；
 * 个体差异用 sprite 旋转（eventSpinRad）表达，零额外生成成本。
 */
function remnantNebulaTexture(): THREE.DataTexture {
  return getNebulaTexture({
    size: 256,
    seed: 20261987, // SN 1987A 致意；确定性种子
    innerColor: "#cfe4ff",
    outerColor: "#6f8fd8",
    filamentStrength: 0.8,
    irregularity: 0.6,
    octaves: 5,
    shape: "shell",
  });
}

/** 事件 id → 确定性旋转角（弧度）：同一遗迹每帧/每次挂载外观稳定 */
function eventSpinRad(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 628) / 628) * Math.PI * 2;
}

/**
 * 超新星可视范围（起点为 L2/L3 边界 2.5；R3-5 上缘收窄）：满值平台终点
 * 3.5 与事件视角域上缘（SUPERNOVA_EVENT_MAX_LEVEL）对齐，淡出延伸至
 * L4 锚点 4.0 处归零——宇宙视角零可见，与"L4 下活跃事件按 R3-3 硬隔离
 * 丢弃"一致（淡出段 3.5–4.0 内特效部分可见但事件将在离域 1 秒后丢弃，
 * 与太阳事件 2.4→3.0 淡出模式相同）。永久遗迹共用本窗口（行为变更登记：
 * 超新星内容整体收敛为银河系视角专属，L4 下遗迹不再显示，状态保留）。
 */
function snFadeWeight(continuousLevel: number): number {
  return trapezoidWeight(continuousLevel, 2.5, 2.9, 3.5, 4.0);
}

/** 聚焦权重提升过渡时长（秒），与 SpecialBodies/Galaxy 一致 */
const FOCUS_BOOST_SECONDS = 0.5;

/**
 * 本帧有效可见权重：层级淡入权重与聚焦提升取最大值（bug 修复）
 *
 * 飞往/跟随超新星事件时相机距原点可能跌入 L2 连续层级区间，按层级门控
 * 事件会完全淡出（"飞过去却看不到"）。跟随本事件期间权重提升至 1
 * （boostRef 由调用方持有，0.5 秒平滑），取消跟随后恢复层级门控。
 */
function effectiveSnWeight(
  eventId: string,
  boostRef: { current: number },
  delta: number,
): number {
  const state = useSimulationStore.getState();
  const focused =
    state.followBodyId === eventId || state.flyToBodyId === eventId;
  boostRef.current = advanceFrameTransition(
    boostRef.current,
    focused ? 1 : 0,
    delta,
    FOCUS_BOOST_SECONDS,
  );
  return Math.max(snFadeWeight(state.continuousLevel), boostRef.current);
}

/** 可交互阈值：淡入权重低于该值时禁用 raycast（隐形对象不拦截点击） */
const INTERACTIVE_WEIGHT = 0.05;

/**
 * 超新星随盘 morph 后的组内 y（场景单位，R3-7 §7.1-B 行为变更）：
 * 超新星位于旋臂内属盘语境，V 展开时随银盘粒子一起抬升——y 通道经
 * morphGalacticYLy（与盘粒子 shader 公式逐字镜像），morph 权重由
 * R3-6 生效展开增益派生（renderedGalacticFrame 注册表，与渲染/解析同源，
 * cameraFocus.supernovaFocusTarget 消费同一公式）。每帧标量运算零分配。
 */
function morphedSnYUnits(positionLy: {
  x: number;
  y: number;
  z: number;
}): number {
  const morph01 = diskMorphWeight(renderedGalacticFrame().expandGain);
  return (
    morphGalacticYLy(
      positionLy.y,
      Math.hypot(positionLy.x, positionLy.z),
      morph01,
    ) * SCENE_UNITS_PER_LY
  );
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
  const groupRef = useRef<THREE.Group>(null);
  const nebulaRef = useRef<THREE.Sprite>(null);
  const boostRef = useRef(0);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const compact = remnantCompactObject(event.progenitorMassSun);
  const size = SHOCK_MAX_RADIUS_UNITS * 0.6;

  // 丝状遗迹壳纹理（进程内缓存共享，勿在组件卸载时 dispose）
  const texture = remnantNebulaTexture();

  useFrame(({ clock }, delta) => {
    const weight = effectiveSnWeight(event.id, boostRef, delta);
    // 淡出后隐藏并禁用 raycast（Raycaster 不检查 visible，隐形遗迹不得拦截点击）
    if (groupRef.current) {
      groupRef.current.visible = weight > 0.001;
      setObjectTreeRaycastEnabled(
        groupRef.current,
        weight > INTERACTIVE_WEIGHT,
      );
      if (!groupRef.current.visible) return;
      // R3-7：遗迹随盘 morph（V 展开时 y 通道抬升，x/z 不动）
      groupRef.current.position.y = morphedSnYUnits(event.positionLy);
    }
    if (nebulaRef.current) {
      const s = size * nebulaExpansionScale(clock.elapsedTime, 120, 0.08);
      nebulaRef.current.scale.set(s, s, 1);
      (nebulaRef.current.material as THREE.SpriteMaterial).opacity =
        0.35 * weight;
    }
  });

  const posUnits = [
    event.positionLy.x * SCENE_UNITS_PER_LY,
    event.positionLy.y * SCENE_UNITS_PER_LY,
    event.positionLy.z * SCENE_UNITS_PER_LY,
  ] as const;

  return (
    <group
      ref={groupRef}
      position={[posUnits[0], posUnits[1], posUnits[2]]}
      name={event.id}
    >
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
          rotation={eventSpinRad(event.id)}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 中心致密天体：中子星（蓝白）或黑洞（纯黑 + 微弱吸积辉光） */}
      {compact === "neutron-star" ? (
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
  const groupRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Sprite>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const remnantRef = useRef<THREE.Sprite>(null);
  const archivedRef = useRef(false);
  const boostRef = useRef(0);

  const flashTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas("#fff6e8", 256)),
    [],
  );
  useEffect(() => () => flashTexture.dispose(), [flashTexture]);
  // 遗迹渐显与永久遗迹同一丝状壳纹理（缓存共享，勿 dispose）
  const remnantTexture = remnantNebulaTexture();

  useFrame((_, delta) => {
    const store = useSimulationStore.getState();
    const weight = effectiveSnWeight(event.id, boostRef, delta);
    const elapsedSec = (Date.now() - event.startedAtMs) / 1000;
    const state = supernovaVisualState(elapsedSec, event.durationSec);

    // R3-7：活跃事件随盘 morph（V 展开时 y 通道抬升，x/z 不动）
    if (groupRef.current) {
      groupRef.current.position.y = morphedSnYUnits(event.positionLy);
    }

    // 动画完成：归档为永久遗迹（一次性）
    if (state.phase === "remnant" && !archivedRef.current) {
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
    const shockRadius =
      Math.max(1e-3, state.shockRadius01) * SHOCK_MAX_RADIUS_UNITS;
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
      ref={groupRef}
      position={[
        event.positionLy.x * SCENE_UNITS_PER_LY,
        event.positionLy.y * SCENE_UNITS_PER_LY,
        event.positionLy.z * SCENE_UNITS_PER_LY,
      ]}
      name={event.id}
    >
      <sprite ref={flashRef}>
        <spriteMaterial
          map={flashTexture}
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
      {/* 遗迹星云渐显（丝状壳纹理，与永久遗迹同一旋转角保证交接无跳变） */}
      <sprite ref={remnantRef}>
        <spriteMaterial
          map={remnantTexture}
          rotation={eventSpinRad(event.id)}
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
    // R2-4 §4.1-D：超新星自动触发显式限定银河系/宇宙视角域（≥2.5）。
    // 此前 L1/L2 不触发只是低时间压缩比下 deltaMyr≈0 的概率副作用，
    // 这里补显式判定；活跃事件的衰减/遗迹归档不受视角门控影响。
    if (!eventAutoTriggerAllowed('supernova', store.continuousLevel)) return;
    const deltaMyr = simDaysToMyr(store.simDays - last);
    if (shouldAutoTriggerSupernova(Math.random(), deltaMyr)) {
      const params = rollSupernovaParams();
      store.triggerSupernova(
        params.positionLy,
        params.massSun,
        SN_DEFAULT_DURATION_SEC,
      );
    }
  });

  return (
    <group name="supernova-events">
      {activeSupernova && (
        <ActiveSupernova key={activeSupernova.id} event={activeSupernova} />
      )}
      {supernovaRemnants.map((event) => (
        <Remnant key={event.id} event={event} />
      ))}
    </group>
  );
}
