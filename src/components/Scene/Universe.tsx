'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { GalaxyData } from '@/types';
import {
  GREAT_ATTRACTOR_DIRECTION,
  LANIAKEA,
  LG_CMB_VELOCITY_KM_S,
  LOCAL_GROUP_GALAXIES,
  M31_COMPANION_OFFSETS_LY,
  MAGELLANIC_STREAM,
  SATELLITE_GALAXY_ORBITS,
} from '@/data/galaxies';
import { useSimulationStore } from '@/store';
import { cosmicDistanceToSceneUnits, lyToSceneUnits, trapezoidWeight } from '@/utils/scale';
import { setObjectTreeRaycastEnabled } from '@/utils/raycastGate';
import { getSoftPointTexture } from '@/components/CelestialBody/sharedTextures';
import {
  OBSERVABLE_UNIVERSE_RADIUS_LY,
  galaxyPlaneSizeUnits,
  generateCosmicWeb,
  hubbleScaleFactor,
  magellanicStreamPointsLy,
  mergeGlowOpacity01,
  mwM31MergeCountdownMyr,
  mwM31SeparationLy,
  satelliteGalaxyPositionLy,
} from '@/utils/universe';
import {
  claimGalaxyNearView,
  galaxyNearViewEnterDistanceUnits,
  galaxyNearViewHolderIds,
  resetGalaxyNearViewHolders,
} from '@/utils/galaxyNearView';
import { NEAR_VIEW_TRANSITION_SECONDS, nearViewGateUpdate } from '@/utils/nearView';
import { advanceFrameTransition } from '@/utils/galacticFrame';
import { GalaxyNearViewLayer } from '@/components/Scene/GalaxyNearView';
import {
  createGalaxySpriteCanvas,
  createGlowSpriteCanvas,
} from '@/components/CelestialBody/proceduralTextures';
import {
  AntennaeGalaxies,
  GammaRayBurst,
  LensingArcs,
  M87Jet,
  Quasar,
} from '@/components/Scene/ExtragalacticObjects';

/** 宇宙级内容 LOD 渐变区间（连续层级） */
const FADE = { start: 3.05, full: 3.6 } as const;

function fadeWeight(continuousLevel: number): number {
  // 连续层级上限为 4，平台区延伸至 4 以上保证 L4 锚点处不淡出
  return trapezoidWeight(continuousLevel, FADE.start, FADE.full, 4.5, 5);
}

/** 渲染循环共用临时向量（零分配纪律） */
const GALAXY_TMP_VEC = new THREE.Vector3();

interface GalaxyObjectProps {
  galaxy: GalaxyData;
}

/**
 * 单个河外星系：形态差异化贴图（旋涡/棒旋/椭圆/不规则，需求 3.1.3），
 * 位置每帧计算（M31 沿连线接近银河系；大小麦哲伦云绕银河系运动）。
 *
 * R2-8 近观升级：
 * - 贴图平面改 billboard 面向相机（薄片修复方案登记于 utils/galaxyNearView
 *   文件头：M31 真实倾角 77° 观测特征改由近观粒子层承载，艺术化差异已登记）；
 * - 飞往/跟随本星系且相机进入近观激活距离时，贴图平面交叉淡出到 3D 粒子
 *   近观层（GalaxyNearViewLayer），释放时淡入恢复；LRU 容量 1——最新激活
 *   星系挤出上一个持有者（挤出即卸载 dispose），远观非跟随保持贴图现状。
 */
function GalaxyObject({ galaxy }: GalaxyObjectProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控
  const inRange = useSimulationStore((s) => s.continuousLevel > FADE.start);
  // R2-8：跟随/飞往本星系期间隐藏其标签（R2-7 近观标签治理同款——近距下
  // distanceFactor 缩放呈大字号遮挡近观结构；信息面板已示名称）
  const focusedNow = useSimulationStore(
    (s) => s.followBodyId === galaxy.id || s.flyToBodyId === galaxy.id,
  );

  // ---- R2-8 近观门控状态（滞回 + 0.5s 淡入淡出 + LRU 保留） ----
  const [nearMounted, setNearMounted] = useState(false);
  const nearMountedRef = useRef(false);
  const nearActiveRef = useRef(false);
  const near01Ref = useRef(0);
  const weightRef = useRef(0);
  const nearEnterDistance = useMemo(
    () => galaxyNearViewEnterDistanceUnits(galaxy.id),
    [galaxy.id],
  );
  /** 近观层不透明度 = 宇宙层级淡入权重 × 近观激活权重 */
  const getNearOpacity = useCallback(
    () => weightRef.current * near01Ref.current,
    [],
  );

  const texture = useMemo(() => {
    // M31/M33 专属形态（P6 §3.4，与通用旋涡星系区分）
    const variant =
      galaxy.id === 'm31' ? 'm31' : galaxy.id === 'm33' ? 'm33' : undefined;
    const canvas = createGalaxySpriteCanvas(
      galaxy.morphology,
      galaxy.morphology === 'elliptical' ? '#ffe2b8' : '#cfd8ff',
      256,
      20260722,
      variant,
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [galaxy.morphology, galaxy.id]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  // 视觉尺寸：直径相对银河系换算（同源公式 utils/universe.galaxyPlaneSizeUnits，
  // 登记：×0.55 抑制压缩距离下的透视夸大）
  const sizeUnits = galaxyPlaneSizeUnits(galaxy.diameterLy);

  useFrame(({ camera }, delta) => {
    const state = useSimulationStore.getState();
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(state.continuousLevel);
    weightRef.current = weight;
    group.visible = weight > 0.001;
    // Raycaster 不检查 visible：淡出后禁用 raycast，避免 L2/L3 下隐形星系拦截点击
    setObjectTreeRaycastEnabled(group, weight > 0.05);
    if (!group.visible) return;

    const { simDays } = state;
    if (galaxy.id === 'm31') {
      // 银河系—仙女座相互接近（银河系中心参考系下沿连线靠近）
      const separation = mwM31SeparationLy(simDays);
      const d = cosmicDistanceToSceneUnits(separation);
      group.position.set(
        galaxy.direction.x * d,
        galaxy.direction.y * d,
        galaxy.direction.z * d,
      );
    } else if (galaxy.id === 'm32' || galaxy.id === 'm110') {
      // M31 伴星系（可选需求）：随 M31 一同接近银河系（示意偏移已登记）
      const m31Data = LOCAL_GROUP_GALAXIES.find((g) => g.id === 'm31');
      if (m31Data) {
        const d = cosmicDistanceToSceneUnits(mwM31SeparationLy(simDays));
        const offset = M31_COMPANION_OFFSETS_LY[galaxy.id];
        group.position.set(
          m31Data.direction.x * d + lyToSceneUnits(offset.x),
          m31Data.direction.y * d + lyToSceneUnits(offset.y),
          m31Data.direction.z * d + lyToSceneUnits(offset.z),
        );
      }
    } else if (galaxy.id === 'lmc' || galaxy.id === 'smc') {
      // 卫星星系绕银河系运动
      const orbit = SATELLITE_GALAXY_ORBITS[galaxy.id];
      const p = satelliteGalaxyPositionLy(
        galaxy.distanceLy,
        orbit.periodMyr,
        orbit.phase0Rad,
        orbit.inclinationDeg,
        simDays,
      );
      group.position.set(lyToSceneUnits(p.x), lyToSceneUnits(p.y), lyToSceneUnits(p.z));
    }
    // 其余星系静态（初始 position）

    // ---- R2-8 近观门控（滞回状态机 utils/nearView.nearViewGateUpdate）----
    const focused =
      state.followBodyId === galaxy.id || state.flyToBodyId === galaxy.id;
    const distance = camera.position.distanceTo(group.getWorldPosition(GALAXY_TMP_VEC));
    const gate = nearViewGateUpdate(
      nearActiveRef.current,
      focused,
      distance,
      nearEnterDistance,
    );
    nearActiveRef.current = gate.active;
    // 激活时声明 LRU 持有权（已是最新持有者时跳过，渲染循环零分配）
    if (gate.active && galaxyNearViewHolderIds()[0] !== galaxy.id) {
      claimGalaxyNearView(galaxy.id);
    }
    near01Ref.current = advanceFrameTransition(
      near01Ref.current,
      gate.active ? 1 : 0,
      delta,
      NEAR_VIEW_TRANSITION_SECONDS,
    );
    // LRU 语义：释放跟随后近观层保留（淡出但不卸载，快速切回免重建）；
    // 被其他星系挤出持有权时立即卸载（几何/材质随卸载 dispose）
    const shouldMount = galaxyNearViewHolderIds().includes(galaxy.id);
    if (shouldMount !== nearMountedRef.current) {
      nearMountedRef.current = shouldMount;
      setNearMounted(shouldMount);
    }

    if (meshRef.current) {
      // billboard 面向相机（薄片修复，登记见组件头注释）；
      // 近观层激活时贴图交叉淡出（释放时随 near01 回落自动淡入）
      meshRef.current.quaternion.copy(camera.quaternion);
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity =
        weight * (1 - near01Ref.current);
    }
  });

  const staticDistance = cosmicDistanceToSceneUnits(galaxy.distanceLy);

  return (
    <group
      ref={groupRef}
      position={[
        galaxy.direction.x * staticDistance,
        galaxy.direction.y * staticDistance,
        galaxy.direction.z * staticDistance,
      ]}
      name={galaxy.id}
    >
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(galaxy.id);
        }}
      >
        <planeGeometry args={[sizeUnits, sizeUnits]} />
        <meshBasicMaterial
          map={texture}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* R2-8 近观 3D 粒子层（LRU 容量 1；卸载即 dispose） */}
      {nearMounted && (
        <GalaxyNearViewLayer galaxy={galaxy} getOpacity={getNearOpacity} />
      )}
      {showLabels && inRange && !focusedNow && (
        <Html
          position={[0, sizeUnits * 0.55, 0]}
          center
          distanceFactor={9000}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-gray-200/80">{galaxy.nameZh}</span>
        </Html>
      )}
    </group>
  );
}

/**
 * 宇宙级场景（需求 3.1.3）：
 * - 本星系群成员（真实相对距离/大小，距离对数压缩已登记于 utils/scale.ts）
 * - 银河系—仙女座接近轨迹线 + 碰撞倒计时提示
 * - 本星系群整体本动：速度矢量箭头 + 数值标签（不实际移动场景，避免坐标漂移）
 * - 宇宙网大尺度结构：星系团（节点）—纤维—空洞，确定性算法
 * - 拉尼亚凯亚超星系团边界示意 + 巨引源标记
 *
 * 参考系（3.1.3 参考系定义）：L4 使用本星系群质心系的银河系中心近似
 * （银河系保持原点，M31 以相对速度接近，本动以矢量表达）。
 */
export function Universe(): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const mergeLabelRef = useRef<HTMLSpanElement>(null);
  const webRef = useRef<THREE.Points>(null);
  const mergeGlowRef = useRef<THREE.Sprite>(null);
  const showVelocityVectors = useSimulationStore((s) => s.showVelocityVectors);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控
  const inRange = useSimulationStore((s) => s.continuousLevel > FADE.start);

  // ---------- 宇宙网（确定性，节点—纤维—空洞） ----------
  const { webGeometry, webMaterial } = useMemo(() => {
    const web = generateCosmicWeb({
      seed: 20260724,
      nodeCount: 56,
      minRadiusUnits: 13500,
      maxRadiusUnits: 19500,
      linksPerNode: 2,
      galaxiesPerLink: 42,
      galaxiesPerNode: 60,
      filamentJitterUnits: 260,
      clusterRadiusUnits: 320,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(web.galaxyPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(web.galaxyColors, 3));
    const mat = new THREE.PointsMaterial({
      size: 55,
      map: getSoftPointTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { webGeometry: geo, webMaterial: mat };
  }, []);

  // ---------- MW–M31 接近轨迹线（虚线预测线） ----------
  const m31 = useMemo(() => LOCAL_GROUP_GALAXIES.find((g) => g.id === 'm31'), []);
  const { approachGeometry, approachMaterial } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    const mat = new THREE.LineDashedMaterial({
      color: '#ffb27f',
      transparent: true,
      opacity: 0,
      dashSize: 260,
      gapSize: 180,
    });
    return { approachGeometry: geo, approachMaterial: mat };
  }, []);
  const approachLine = useMemo(() => {
    const line = new THREE.Line(approachGeometry, approachMaterial);
    line.frustumCulled = false;
    return line;
  }, [approachGeometry, approachMaterial]);

  // ---------- 拉尼亚凯亚边界示意 ----------
  const laniakeaRadius = cosmicDistanceToSceneUnits(LANIAKEA.diameterLy / 2);
  const { boundaryGeometry, boundaryMaterial } = useMemo(() => {
    const segments = 128;
    const positions = new Float32Array((segments + 1) * 3);
    for (let s = 0; s <= segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      positions[s * 3] = Math.cos(a) * laniakeaRadius;
      positions[s * 3 + 1] = 0;
      positions[s * 3 + 2] = Math.sin(a) * laniakeaRadius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#6a5a9a',
      transparent: true,
      opacity: 0,
    });
    return { boundaryGeometry: geo, boundaryMaterial: mat };
  }, [laniakeaRadius]);
  const boundaryLine = useMemo(
    () => new THREE.Line(boundaryGeometry, boundaryMaterial),
    [boundaryGeometry, boundaryMaterial],
  );

  // ---------- 可观测宇宙边界示意（可选需求 3.1.3） ----------
  const observableRadius = cosmicDistanceToSceneUnits(OBSERVABLE_UNIVERSE_RADIUS_LY);
  const { observableGeometry, observableMaterial } = useMemo(() => {
    const segments = 160;
    const positions = new Float32Array((segments + 1) * 3);
    for (let s = 0; s <= segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      positions[s * 3] = Math.cos(a) * observableRadius;
      positions[s * 3 + 1] = 0;
      positions[s * 3 + 2] = Math.sin(a) * observableRadius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#8a4a5a',
      transparent: true,
      opacity: 0,
    });
    return { observableGeometry: geo, observableMaterial: mat };
  }, [observableRadius]);
  const observableLine = useMemo(() => {
    const line = new THREE.Line(observableGeometry, observableMaterial);
    line.frustumCulled = false;
    return line;
  }, [observableGeometry, observableMaterial]);

  // ---------- 麦哲伦星流（可选需求 3.1.3） ----------
  const { streamGeometry, streamMaterial } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAGELLANIC_STREAM.pointCount * 3), 3),
    );
    const mat = new THREE.PointsMaterial({
      color: MAGELLANIC_STREAM.color,
      size: 90,
      map: getSoftPointTexture(),
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { streamGeometry: geo, streamMaterial: mat };
  }, []);
  const streamPoints = useMemo(() => {
    const pts = new THREE.Points(streamGeometry, streamMaterial);
    pts.frustumCulled = false;
    return pts;
  }, [streamGeometry, streamMaterial]);

  // ---------- 银河系—仙女座合并辉光（可选需求 3.1.3 碰撞合并预览） ----------
  const mergeGlowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#ffe0c0', 128)),
    [],
  );

  useEffect(() => {
    return () => {
      webGeometry.dispose();
      webMaterial.dispose();
      approachGeometry.dispose();
      approachMaterial.dispose();
      boundaryGeometry.dispose();
      boundaryMaterial.dispose();
      observableGeometry.dispose();
      observableMaterial.dispose();
      streamGeometry.dispose();
      streamMaterial.dispose();
      mergeGlowTexture.dispose();
    };
  }, [webGeometry, webMaterial, approachGeometry, approachMaterial, boundaryGeometry, boundaryMaterial, observableGeometry, observableMaterial, streamGeometry, streamMaterial, mergeGlowTexture]);

  // R2-8：场景卸载时重置星系近观层 LRU 持有者注册表（防跨挂载残留）
  useEffect(() => () => resetGalaxyNearViewHolders(), []);

  useFrame(() => {
    const state = useSimulationStore.getState();
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(state.continuousLevel);
    group.visible = weight > 0.001;
    if (!group.visible) return;

    webMaterial.opacity = 0.75 * weight;
    boundaryMaterial.opacity = 0.28 * weight;
    approachMaterial.opacity = 0.7 * weight;
    observableMaterial.opacity = 0.22 * weight;
    streamMaterial.opacity = 0.5 * weight;

    // 哈勃膨胀示意（可选需求 3.1.3）：宇宙网整体随时间膨胀，
    // 退行速度自然与距离成正比（v = H·d，哈勃定律）
    if (webRef.current) {
      webRef.current.scale.setScalar(hubbleScaleFactor(state.simDays));
    }

    // 麦哲伦星流：沿 LMC 轨道向后拖尾（每帧更新，跟随 LMC 运动）
    {
      const lmcOrbit = SATELLITE_GALAXY_ORBITS.lmc;
      const lmcData = LOCAL_GROUP_GALAXIES.find((g) => g.id === 'lmc');
      if (lmcData) {
        const streamPts = magellanicStreamPointsLy(
          lmcData.distanceLy,
          lmcOrbit.periodMyr,
          lmcOrbit.phase0Rad,
          lmcOrbit.inclinationDeg,
          state.simDays,
          MAGELLANIC_STREAM.pointCount,
          MAGELLANIC_STREAM.seed,
        );
        const pos = streamGeometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < streamPts.length; i += 1) {
          pos.setXYZ(
            i,
            lyToSceneUnits(streamPts[i].x),
            lyToSceneUnits(streamPts[i].y),
            lyToSceneUnits(streamPts[i].z),
          );
        }
        pos.needsUpdate = true;
      }
    }

    // 接近轨迹线端点更新：M31 当前位置 → 银河系（原点）
    if (m31) {
      const separation = mwM31SeparationLy(state.simDays);
      const d = cosmicDistanceToSceneUnits(separation);
      const pos = approachGeometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, m31.direction.x * d, m31.direction.y * d, m31.direction.z * d);
      pos.setXYZ(1, 0, 0, 0);
      pos.needsUpdate = true;
      approachLine.computeLineDistances();

      // 碰撞倒计时提示
      if (mergeLabelRef.current) {
        const countdown = mwM31MergeCountdownMyr(state.simDays);
        mergeLabelRef.current.textContent =
          countdown > 0
            ? `银河系—仙女座相互接近（~110 km/s），约 ${(countdown / 1000).toFixed(1)} 十亿年后碰撞合并`
            : '银河系—仙女座已合并（模拟时间超过预计碰撞时刻）';
      }

      // 合并辉光（可选需求：碰撞合并过程示意）——两星系接近后期
      // 在两者之间显现并增强的并合辉光
      if (mergeGlowRef.current) {
        const glow = mergeGlowOpacity01(separation);
        mergeGlowRef.current.visible = glow > 0.001;
        const mid = d * 0.5;
        mergeGlowRef.current.position.set(
          m31.direction.x * mid,
          m31.direction.y * mid,
          m31.direction.z * mid,
        );
        const s = 2600 + 1800 * glow;
        mergeGlowRef.current.scale.set(s, s, 1);
        (mergeGlowRef.current.material as THREE.SpriteMaterial).opacity =
          0.75 * glow * weight;
      }
    }
    // 本星系群整体本动仅作矢量指示，不移动场景（需求 3.1.3，避免坐标漂移）
  });

  const greatAttractorDistance = cosmicDistanceToSceneUnits(2.2e8);

  return (
    <group ref={groupRef}>
      {/* 本星系群与近邻星系团成员（四类形态差异化） */}
      {LOCAL_GROUP_GALAXIES.map((galaxy) => (
        <GalaxyObject key={galaxy.id} galaxy={galaxy} />
      ))}

      {/* 河外特殊对象（需求 3.1.5，P2）：类星体 3C 273 + M87 单侧喷流；
          可选项：触须星系碰撞现场 + 星系团引力透镜弧 + 伽马射线暴 */}
      <Quasar />
      <M87Jet />
      <AntennaeGalaxies />
      <LensingArcs />
      <GammaRayBurst />

      {/* 麦哲伦星流（可选需求）：LMC/SMC 被潮汐剥离的气体流 */}
      <primitive object={streamPoints} />

      {/* 银河系—仙女座合并辉光（可选需求：碰撞合并示意，接近后期显现） */}
      <sprite ref={mergeGlowRef} visible={false}>
        <spriteMaterial
          map={mergeGlowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {/* MW–M31 接近轨迹（虚线） + 碰撞提示 */}
      <primitive object={approachLine} />
      {showLabels && inRange && m31 && (
        <Html
          position={[
            m31.direction.x * 6000,
            m31.direction.y * 6000 + 500,
            m31.direction.z * 6000,
          ]}
          center
          distanceFactor={12000}
          style={{ pointerEvents: 'none' }}
        >
          <span
            ref={mergeLabelRef}
            className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-orange-200"
          />
        </Html>
      )}

      {/* 本星系群整体本动矢量（可开关；仅矢量指示，不移动场景） */}
      {showVelocityVectors && inRange && (
        <group>
          <arrowHelper
            args={[
              new THREE.Vector3(
                GREAT_ATTRACTOR_DIRECTION.x,
                GREAT_ATTRACTOR_DIRECTION.y,
                GREAT_ATTRACTOR_DIRECTION.z,
              ),
              new THREE.Vector3(0, 0, 0),
              4200,
              0xffd27f,
              900,
              420,
            ]}
          />
          <Html
            position={[
              GREAT_ATTRACTOR_DIRECTION.x * 4600,
              GREAT_ATTRACTOR_DIRECTION.y * 4600,
              GREAT_ATTRACTOR_DIRECTION.z * 4600,
            ]}
            center
            distanceFactor={12000}
            style={{ pointerEvents: 'none' }}
          >
            <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-amber-200">
              本星系群本动 ~{LG_CMB_VELOCITY_KM_S} km/s（朝巨引源/沙普利方向，相对 CMB）
            </span>
          </Html>
        </group>
      )}

      {/* 宇宙网：星系团（节点）—纤维—空洞（确定性分布）；
          整体缩放表达哈勃膨胀（可选需求），远端星系颜色偏红（红移示意） */}
      <points ref={webRef} geometry={webGeometry} material={webMaterial} />

      {/* 拉尼亚凯亚超星系团边界示意 + 巨引源标记 */}
      <primitive object={boundaryLine} />

      {/* 可观测宇宙边界示意（可选需求：约 465 亿光年，距离对数压缩） */}
      <primitive object={observableLine} />
      {showLabels && inRange && (
        <Html
          position={[observableRadius * 0.7, -900, observableRadius * 0.3]}
          center
          distanceFactor={14000}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-rose-300/60">
            可观测宇宙边界示意（半径约 465 亿光年）
          </span>
        </Html>
      )}
      {showLabels && inRange && (
        <Html
          position={[laniakeaRadius * 0.72, 800, 0]}
          center
          distanceFactor={14000}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-purple-300/70">
            {LANIAKEA.nameZh}边界示意（直径约 5.2 亿光年）
          </span>
        </Html>
      )}
      {showLabels && inRange && (
        <Html
          position={[
            GREAT_ATTRACTOR_DIRECTION.x * greatAttractorDistance,
            GREAT_ATTRACTOR_DIRECTION.y * greatAttractorDistance,
            GREAT_ATTRACTOR_DIRECTION.z * greatAttractorDistance,
          ]}
          center
          distanceFactor={14000}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-amber-300/70">{LANIAKEA.greatAttractorZh}</span>
        </Html>
      )}
    </group>
  );
}
