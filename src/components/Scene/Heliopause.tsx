'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useSimulationStore } from '@/store';
import {
  HELIOPAUSE_MAX_OPACITY,
  HELIOPAUSE_VISIBLE_LEVEL_MAX,
  HELIOPAUSE_VISIBLE_LEVEL_MIN,
  HELIOPAUSE_VISUAL_RADIUS_UNITS,
  HELIOSHEATH_SHELL_COUNT,
  TERMINATION_SHOCK_REAL_DISTANCE_AU,
  VOYAGER_MARKERS,
  heliopauseLayerColor01,
  heliopauseVisibilityWeight,
  heliosheathShellRadiusUnits,
  isHeliopauseNearFocusId,
  terminationShockRadiusUnits,
  voyagerMarkerPositionUnits,
} from '@/utils/heliopause';
import {
  NEAR_VIEW_TRANSITION_SECONDS,
  nearViewEnterDistanceUnits,
  nearViewGateUpdate,
} from '@/utils/nearView';
import { advanceFrameTransition } from '@/utils/galacticFrame';
import { setObjectTreeRaycastEnabled } from '@/utils/raycastGate';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';

/** 近观三层结构基础不透明度（近观权重另行相乘；加色混合下微弱示意） */
const TERMINATION_SHOCK_BASE_OPACITY = 0.12;
const HELIOSHEATH_BASE_OPACITY = 0.06;
/** 近观期间外边界壳的透明度增益（在常态 0.06 基础上叠加，外边界更可辨） */
const HELIOPAUSE_NEAR_OPACITY_BOOST = 0.05;

/**
 * 日球层顶近观三层结构 + 旅行者标记（R2-7 §7.1-A）
 *
 * 仅在近观门控激活期间挂载（跟随/飞往 heliopause 或旅行者标记且相机进入
 * 激活距离），离开即卸载释放（几何/材质由 R3F 声明式创建自动 dispose，
 * 辉光 CanvasTexture 在本组件卸载时显式 dispose）。
 * 结构半径/着色渐变均来自 utils/heliopause 纯函数（单测覆盖）。
 */
function HeliopauseNearStructure({
  getNear01,
}: {
  getNear01: () => number;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // 跟随/飞往某个旅行者标记期间隐藏该标记自身的标注（近距下 distanceFactor
  // 缩放呈大字号铺屏，与 BodyLabel 焦点隐藏语义一致；信息面板已示名称）
  const focusedMarkerId = useSimulationStore((s) =>
    s.followBodyId === 'voyager-1' || s.flyToBodyId === 'voyager-1'
      ? 'voyager-1'
      : s.followBodyId === 'voyager-2' || s.flyToBodyId === 'voyager-2'
        ? 'voyager-2'
        : null,
  );

  // 三层结构壳参数（纯函数换算，挂载时一次性求值）
  const shells = useMemo(() => {
    const list: { radius: number; color: THREE.Color; baseOpacity: number }[] = [];
    const ts = heliopauseLayerColor01(0);
    list.push({
      radius: terminationShockRadiusUnits(),
      color: new THREE.Color(ts.r, ts.g, ts.b),
      baseOpacity: TERMINATION_SHOCK_BASE_OPACITY,
    });
    for (let i = 0; i < HELIOSHEATH_SHELL_COUNT; i += 1) {
      const t = (i + 1) / (HELIOSHEATH_SHELL_COUNT + 1);
      const c = heliopauseLayerColor01(t);
      list.push({
        radius: heliosheathShellRadiusUnits(i),
        color: new THREE.Color(c.r, c.g, c.b),
        baseOpacity: HELIOSHEATH_BASE_OPACITY,
      });
    }
    return list;
  }, []);

  // 旅行者标记位置（纯函数，确定性）
  const markers = useMemo(
    () =>
      VOYAGER_MARKERS.map((m) => ({
        ...m,
        position: voyagerMarkerPositionUnits(m.id),
      })),
    [],
  );

  const markerGlowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#ffd9a0', 64)),
    [],
  );
  useEffect(() => () => markerGlowTexture.dispose(), [markerGlowTexture]);

  // 每帧按近观权重调制透明度（userData.baseOpacity 模式，与 SpecialBodies 一致）
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const near01 = getNear01();
    group.traverse((obj) => {
      const base = obj.userData.baseOpacity as number | undefined;
      if (base === undefined) return;
      if (obj instanceof THREE.Sprite) {
        obj.material.opacity = base * near01;
      } else if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.Material & { opacity: number }).opacity = base * near01;
      }
    });
    // 淡入未完成时禁用标记点选（隐形对象不拦截点击）
    setObjectTreeRaycastEnabled(group, near01 > 0.2);
  });

  const tsRadius = terminationShockRadiusUnits();
  const sheathMidRadius = heliosheathShellRadiusUnits(1);

  return (
    <group ref={groupRef} name="heliopause-near-structure">
      {/* 终端激波内壳 + 日鞘渐变壳层（半透明多层壳 + 琥珀→蓝着色渐变） */}
      {shells.map((s, i) => (
        <mesh key={i} userData={{ baseOpacity: s.baseOpacity }}>
          <sphereGeometry args={[s.radius, 48, 32]} />
          <meshBasicMaterial
            color={s.color}
            transparent
            opacity={0}
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
      {/* 结构分层标注（近观激活期间可辨识三层结构） */}
      {showLabels && (
        <>
          <Html
            position={[0, tsRadius * 0.72, 0]}
            center
            distanceFactor={520}
            style={{ pointerEvents: 'none' }}
          >
            <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-amber-300/85">
              终端激波（示意，约 {TERMINATION_SHOCK_REAL_DISTANCE_AU} AU）
            </span>
          </Html>
          <Html
            position={[sheathMidRadius * 0.8, -sheathMidRadius * 0.3, 0]}
            center
            distanceFactor={520}
            style={{ pointerEvents: 'none' }}
          >
            <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-orange-200/80">
              日鞘（渐变区）
            </span>
          </Html>
        </>
      )}
      {/* 旅行者 1/2 号位置标记：辉光点 + 点选热区 + 标注（点选科普卡片） */}
      {markers.map((m) => (
        <group key={m.id} position={[m.position.x, m.position.y, m.position.z]}>
          <sprite scale={[16, 16, 1]} userData={{ baseOpacity: 0.9 }}>
            <spriteMaterial
              map={markerGlowTexture}
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </sprite>
          <mesh userData={{ baseOpacity: 0.95 }}>
            <sphereGeometry args={[3.2, 12, 12]} />
            <meshBasicMaterial color="#ffd9a0" transparent opacity={0} depthWrite={false} />
          </mesh>
          {/* 点选热区（透明放大球，保证小标记可点） */}
          <mesh
            onClick={(e) => {
              e.stopPropagation();
              selectBody(m.id);
            }}
          >
            <sphereGeometry args={[16, 8, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {showLabels && focusedMarkerId !== m.id && (
            <Html position={[0, 22, 0]} center distanceFactor={480} style={{ pointerEvents: 'none' }}>
              <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-amber-200/90">
                {m.nameZh}（{m.crossedYear} 穿越）
              </span>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * 日球层顶示意（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-4；R2-7 近观升级）
 *
 * L2 太阳系视角外缘的半透明球壳 + 标注：太阳风与星际介质的边界（日球层
 * 外缘）。半径为压缩示意值（真实约 120 AU，登记于 utils/heliopause.ts），
 * 真实距离经标注/信息面板科普。仅 L2 段淡入，进入 L1/L3 淡出。
 *
 * R2-7：跟随/飞往日球层顶（或旅行者标记）且相机进入近观激活距离时，
 * 挂载近观三层结构（终端激波 → 日鞘 → 日球层顶）+ 旅行者 1/2 号标记；
 * 离开跟随/超出退出距离即卸载释放（utils/nearView 滞回门控，常态 L2
 * 游览零新增开销）。
 */
export function Heliopause(): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // 飞往/跟随日球层顶期间标签与球壳保持可见（R2-1 聚焦权重提升）
  const inRange = useSimulationStore(
    (s) =>
      isHeliopauseNearFocusId(s.followBodyId) ||
      isHeliopauseNearFocusId(s.flyToBodyId) ||
      (s.continuousLevel > HELIOPAUSE_VISIBLE_LEVEL_MIN &&
        s.continuousLevel < HELIOPAUSE_VISIBLE_LEVEL_MAX),
  );

  // R2-7 近观门控（滞回状态机纯逻辑 utils/nearView，Comet.tsx nearView 范式）
  const [nearActive, setNearActive] = useState(false);
  const nearActiveRef = useRef(false);
  const near01Ref = useRef(0);
  const nearEnterDistance = useMemo(() => nearViewEnterDistanceUnits('heliopause'), []);

  const { geometry, material } = useMemo(() => {
    const geo = new THREE.SphereGeometry(HELIOPAUSE_VISUAL_RADIUS_UNITS, 48, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: '#5a9bd4',
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return { geometry: geo, material: mat };
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(({ camera }, delta) => {
    const { continuousLevel, followBodyId, flyToBodyId } = useSimulationStore.getState();
    // L2 段淡入（进入 L1 近观或 L3 银河系视角淡出）；
    // 飞往/跟随期间聚焦权重提升为满值（R2-1，防层级门控淡出）
    const focused =
      isHeliopauseNearFocusId(followBodyId) || isHeliopauseNearFocusId(flyToBodyId);
    const weight = heliopauseVisibilityWeight(continuousLevel, focused);
    // R2-7 近观门控：球壳中心位于场景原点，相机-目标距离 = 相机位置模长
    const gate = nearViewGateUpdate(
      nearActiveRef.current,
      focused,
      camera.position.length(),
      nearEnterDistance,
    );
    near01Ref.current = advanceFrameTransition(
      near01Ref.current,
      gate.active ? 1 : 0,
      delta,
      NEAR_VIEW_TRANSITION_SECONDS,
    );
    // 淡出完成后再卸载（释放几何/材质，无突变）
    const shouldMount = gate.active || near01Ref.current > 0.001;
    if (shouldMount !== nearActiveRef.current) {
      nearActiveRef.current = shouldMount;
      setNearActive(shouldMount);
    }
    // 近观期间外边界壳增亮（三层结构中"日球层顶外边界"更可辨）
    material.opacity =
      HELIOPAUSE_MAX_OPACITY * weight + HELIOPAUSE_NEAR_OPACITY_BOOST * near01Ref.current;
    if (meshRef.current) {
      setObjectTreeRaycastEnabled(meshRef.current, weight > 0.05);
    }
  });

  return (
    <group name="heliopause">
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        onClick={(e) => {
          e.stopPropagation();
          selectBody('heliopause');
        }}
      />
      {nearActive && <HeliopauseNearStructure getNear01={() => near01Ref.current} />}
      {showLabels && inRange && (
        <Html
          position={[0, HELIOPAUSE_VISUAL_RADIUS_UNITS * 0.82, 0]}
          center
          distanceFactor={900}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-sky-300/80">
            日球层顶（示意，实际约 120 AU）
          </span>
        </Html>
      )}
    </group>
  );
}
