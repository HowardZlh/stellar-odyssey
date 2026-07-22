'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { GalaxyData } from '@/types';
import {
  GREAT_ATTRACTOR_DIRECTION,
  LANIAKEA,
  LG_CMB_VELOCITY_KM_S,
  LOCAL_GROUP_GALAXIES,
  SATELLITE_GALAXY_ORBITS,
} from '@/data/galaxies';
import { useSimulationStore } from '@/store';
import { cosmicDistanceToSceneUnits, lyToSceneUnits, trapezoidWeight } from '@/utils/scale';
import {
  generateCosmicWeb,
  mwM31MergeCountdownMyr,
  mwM31SeparationLy,
  satelliteGalaxyPositionLy,
} from '@/utils/universe';
import { createGalaxySpriteCanvas } from '@/components/CelestialBody/proceduralTextures';
import { M87Jet, Quasar } from '@/components/Scene/ExtragalacticObjects';

/** 宇宙级内容 LOD 渐变区间（连续层级） */
const FADE = { start: 3.05, full: 3.6 } as const;
/** 银河系可视半径（场景单位，与 Galaxy 组件一致：5 万光年 × 0.05） */
const MW_VISUAL_RADIUS_UNITS = 2500;

function fadeWeight(continuousLevel: number): number {
  // 连续层级上限为 4，平台区延伸至 4 以上保证 L4 锚点处不淡出
  return trapezoidWeight(continuousLevel, FADE.start, FADE.full, 4.5, 5);
}

/** 由星系 id 派生确定性伪随机盘面朝向 */
function orientationFromId(id: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return [((h % 100) / 100) * Math.PI * 0.5, ((h % 37) / 37) * Math.PI, 0];
}

interface GalaxyObjectProps {
  galaxy: GalaxyData;
}

/**
 * 单个河外星系：形态差异化贴图（旋涡/棒旋/椭圆/不规则，需求 3.1.3），
 * 位置每帧计算（M31 沿连线接近银河系；大小麦哲伦云绕银河系运动）。
 */
function GalaxyObject({ galaxy }: GalaxyObjectProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控
  const inRange = useSimulationStore((s) => s.continuousLevel > FADE.start);

  const texture = useMemo(() => {
    const canvas = createGalaxySpriteCanvas(
      galaxy.morphology,
      galaxy.morphology === 'elliptical' ? '#ffe2b8' : '#cfd8ff',
      256,
      20260722,
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [galaxy.morphology]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  // 视觉尺寸：直径相对银河系换算（登记：×0.55 抑制压缩距离下的透视夸大）
  const sizeUnits = (galaxy.diameterLy / 100000) * MW_VISUAL_RADIUS_UNITS * 2 * 0.55;
  const orientation = useMemo(() => orientationFromId(galaxy.id), [galaxy.id]);

  useFrame(() => {
    const state = useSimulationStore.getState();
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(state.continuousLevel);
    group.visible = weight > 0.001;
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

    if (meshRef.current) {
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity = weight;
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
        rotation={orientation}
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
      {showLabels && inRange && (
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

  useEffect(() => {
    return () => {
      webGeometry.dispose();
      webMaterial.dispose();
      approachGeometry.dispose();
      approachMaterial.dispose();
      boundaryGeometry.dispose();
      boundaryMaterial.dispose();
    };
  }, [webGeometry, webMaterial, approachGeometry, approachMaterial, boundaryGeometry, boundaryMaterial]);

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

      {/* 河外特殊对象（需求 3.1.5，P2）：类星体 3C 273 + M87 单侧喷流 */}
      <Quasar />
      <M87Jet />

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

      {/* 宇宙网：星系团（节点）—纤维—空洞（确定性分布） */}
      <points geometry={webGeometry} material={webMaterial} />

      {/* 拉尼亚凯亚超星系团边界示意 + 巨引源标记 */}
      <primitive object={boundaryLine} />
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
