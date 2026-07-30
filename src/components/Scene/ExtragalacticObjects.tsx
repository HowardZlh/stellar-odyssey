'use client';


import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { ClampedHtmlLabel } from '@/components/Scene/ClampedHtmlLabel';
import * as THREE from 'three';
import { getGalaxyById } from '@/data/galaxies';
import { getSpecialBodyById } from '@/data/specialBodies';
import { useSimulationStore } from '@/store';
import { cosmicDistanceToSceneUnits, trapezoidWeight } from '@/utils/scale';
import { setObjectTreeRaycastEnabled } from '@/utils/raycastGate';
import { grbFlashState, jetFlowPhase01, quasarFlicker } from '@/utils/specialBodies';
import { EXTRAGALACTIC_VIEW_RADIUS_UNITS } from '@/utils/cameraFocus';
import { quasarCoreNearFactor, quasarDetailLayerSpec } from '@/utils/quasarNearView';
import {
  ANTENNAE_STATIC_NEAR_DIM,
  antennaeDetailLayerSpec,
} from '@/utils/antennaeNearView';
import {
  M87_JET_KNOTS,
  m87JetKnotOpacity01,
  m87JetKnotT01,
} from '@/utils/m87Environment';
import {
  CLUSTER_LENSING_STATIC_ARC_DIM,
  clusterLensingSource,
  lensedBackgroundSources,
  resetClusterLensingSource,
  writeClusterLensingSource,
} from '@/utils/clusterLensing';
import { useDetailLayer } from '@/hooks/useDetailLayer';
import { useAntennaeSnapshots } from '@/hooks/useAntennaeSnapshots';
import { QuasarNearCore } from '@/components/Scene/QuasarNearView';
import { AntennaeNearView } from '@/components/Scene/AntennaeNearView';
import {
  createGalaxySpriteCanvas,
  createGlowSpriteCanvas,
} from '@/components/CelestialBody/proceduralTextures';

/** 与 Universe.tsx 一致的宇宙级 LOD 渐变区间 */
function fadeWeight(continuousLevel: number): number {
  return trapezoidWeight(continuousLevel, 3.05, 3.6, 4.5, 5);
}

/** 可交互阈值：淡入权重低于该值时禁用 raycast（隐形对象不拦截点击） */
const INTERACTIVE_WEIGHT = 0.05;

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
  /** 可见权重读取覆写（默认河外 LOD fadeWeight；R4-16 蟹状 PWN 极向
   * 双喷流复用登记——注入 L3 近观权重、参数化缩小尺度，锥体 shader 不变） */
  getWeight?: () => number;
}

/**
 * 相对论喷流：细长锥体 + 沿喷流方向循环流动的辉光节点（流动动画）
 *
 * R4-16 起导出复用（蟹状 PWN 极向双喷流，SpecialBodies.tsx 消费）。
 */
export function RelativisticJet({
  direction,
  lengthUnits,
  color,
  bilateral,
  baseOpacity,
  getWeight,
}: JetProps): JSX.Element {
  const nodesRef = useRef<THREE.Group>(null);
  const texture = useMemo(() => new THREE.CanvasTexture(createGlowSpriteCanvas(color, 64)), [color]);
  useEffect(() => () => texture.dispose(), [texture]);

  // 喷流 shader（P6 §3.4）：沿轴湍流噪声 + 亮节点（knots，M87 HST-1 观测特征）
  // 替换纯色 cone。uv.y 沿轴、uv.x 环向。
  const jetMaterial = useMemo(() => {
    const c = new THREE.Color(color);
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: baseOpacity * 0.4 },
        uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec2 vUv;
        float hash(float n){ return fract(sin(n)*43758.5453); }
        float noise(float x){ float i=floor(x); float f=fract(x); return mix(hash(i),hash(i+1.0),f*f*(3.0-2.0*f)); }
        void main() {
          // 环向径向渐变（中心线亮）
          float radial = pow(clamp(1.0 - abs(vUv.x - 0.5)*2.0, 0.0, 1.0), 1.4);
          // 沿轴湍流 + 亮节点（周期性 knots，随时间沿轴流动）
          float turb = 0.6 + 0.4 * noise(vUv.y * 10.0 - uTime * 0.6);
          float knots = smoothstep(0.75, 1.0, sin(vUv.y * 22.0 - uTime * 1.2) * 0.5 + 0.5);
          float axial = smoothstep(1.0, 0.05, vUv.y);
          float a = radial * axial * (turb + knots * 0.8) * uOpacity;
          gl_FragColor = vec4(uColor * (1.0 + knots), a);
        }
      `,
    });
     
  }, [color, baseOpacity]);
  useEffect(() => () => jetMaterial.dispose(), [jetMaterial]);

  const sides = bilateral ? [1, -1] : [1];

  // 锥体朝向：+Y 对齐 direction
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    return q;
  }, [direction]);

  useFrame(({ clock }) => {
    const weight = getWeight
      ? getWeight()
      : fadeWeight(useSimulationStore.getState().continuousLevel);
    jetMaterial.uniforms.uTime.value = clock.elapsedTime;
    jetMaterial.uniforms.uOpacity.value = baseOpacity * 0.5 * weight;
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
          material={jetMaterial}
        >
          <coneGeometry args={[lengthUnits * 0.035, lengthUnits, 16, 1, true]} />
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
 *
 * R4-21：近观挂接细节层（useDetailLayer particles 池，'lru-retain' L4
 * 语义与 R2-8 星系近观共池）——跟随/飞往且距离达阈值时挂载
 * QuasarNearCore（吸积盘 + BLR 辉光 + 尘埃环面，盘/环面平面 ⊥ 喷流轴），
 * 与既有喷流构成内→外四层结构；核心辉光按 quasarCoreNearFactor 减淡
 * 让出盘视野（光变闪烁保留不回退），退出反向恢复、资源随卸载 dispose。
 */
export function Quasar(): JSX.Element | null {
  const body = getSpecialBodyById('quasar-3c273');
  const coreRef = useRef<THREE.Sprite>(null);
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 3.05);
  // R3-4 §4.1-D：跟随/飞往本天体时隐藏自身标签（R2-8 星系同款机制补齐）
  const focused = useSimulationStore(
    (s) => s.followBodyId === 'quasar-3c273' || s.flyToBodyId === 'quasar-3c273',
  );

  const texture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#dfeeff', 128)),
    [],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  const jetDirection = useMemo(() => new THREE.Vector3(0.35, 0.9, 0.25).normalize(), []);
  // 盘/环面姿态：局部 +y → 喷流轴（盘面 ⊥ 喷流，AGN 统一模型几何）
  const diskQuaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), jetDirection),
    [jetDirection],
  );

  // R4-21 近观细节层门控（阈值与 resolveFocusTarget 同源，utils/quasarNearView）
  const weightRef = useRef(0);
  const nearSpec = useMemo(() => quasarDetailLayerSpec(), []);
  const { active: nearActive, opacity01: getNear01 } = useDetailLayer(nearSpec, {
    objectRef: groupRef,
    retention: 'lru-retain',
  });
  /** 近观层不透明度 = 河外层级淡入权重 × 近观激活权重 */
  const getNearOpacity = useCallback(
    () => weightRef.current * getNear01(),
    [getNear01],
  );

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    weightRef.current = weight;
    group.visible = weight > 0.001;
    setObjectTreeRaycastEnabled(group, weight > INTERACTIVE_WEIGHT);
    if (!group.visible) return;
    if (coreRef.current) {
      // 光变闪烁（不规则光变，需求 3.1.5）；R4-21 近观减淡让出盘视野
      // （quasarCoreNearFactor，光变因子保留不回退）
      (coreRef.current.material as THREE.SpriteMaterial).opacity =
        0.95 * quasarFlicker(clock.elapsedTime) * weight * quasarCoreNearFactor(getNear01());
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
      {/* R4-21 近观细节层：吸积盘 + BLR 辉光 + 尘埃环面（⊥ 喷流轴） */}
      {nearActive && (
        <group quaternion={diskQuaternion}>
          <QuasarNearCore
            baseRadiusUnits={EXTRAGALACTIC_VIEW_RADIUS_UNITS}
            getOpacity={getNearOpacity}
          />
        </group>
      )}
      {showLabels && inRange && !focused && (
        // R3-4：近距反向缩放钳制 + 焦点隐藏（治理缺口补齐）
        <ClampedHtmlLabel position={[0, 700, 0]} distanceFactor={12000} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-sky-200">
            {body.nameZh}（约 24 亿光年）
          </span>
        </ClampedHtmlLabel>
      )}
    </group>
  );
}

/**
 * 触须星系近观层挂载器（R4-22）：仅近观激活时挂载 → 首次激活才 fetch
 * 烘焙快照；加载中/失败返回 null——外层静态渲染即降级现状（登记）。
 */
function AntennaeNearLayer({
  getOpacity,
  getSimDays,
}: {
  getOpacity: () => number;
  getSimDays: () => number;
}): JSX.Element | null {
  const data = useAntennaeSnapshots();
  if (!data) return null;
  return (
    <AntennaeNearView
      data={data}
      baseRadiusUnits={EXTRAGALACTIC_VIEW_RADIUS_UNITS}
      getOpacity={getOpacity}
      getSimDays={getSimDays}
    />
  );
}

/**
 * 触须星系（NGC 4038/4039，可选需求 3.1.5）：星系碰撞现场——
 * 两个相互扭曲的旋涡星系盘 + 两条潮汐尾（"触须"）+ 星暴区亮斑
 *
 * R4-22：近观挂接细节层（useDetailLayer starCatalog 池，容量 1 与
 * R4-17 昴星团共池、'lru-retain' L4 语义）——跟随/飞往且距离达阈值时
 * 挂载 AntennaeNearLayer（两核 + 双潮汐尾烘焙快照粒子，随 simDays
 * 快照插值缓慢演化）；既有静态层按 ANTENNAE_STATIC_NEAR_DIM 减淡让位
 * 粒子结构；快照加载失败降级现状静态渲染（AntennaeNearLayer 返回 null）。
 */
export function AntennaeGalaxies(): JSX.Element | null {
  const body = getSpecialBodyById('antennae-galaxies');
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 3.05);
  // R3-4 §4.1-D：跟随/飞往本天体时隐藏自身标签（R2-8 星系同款机制补齐）
  const focused = useSimulationStore(
    (s) => s.followBodyId === 'antennae-galaxies' || s.flyToBodyId === 'antennae-galaxies',
  );

  const textures = useMemo(
    () => ({
      diskA: new THREE.CanvasTexture(createGalaxySpriteCanvas('spiral', '#ffd8c8', 128, 40381)),
      diskB: new THREE.CanvasTexture(createGalaxySpriteCanvas('spiral', '#cfd8ff', 128, 40391)),
      burst: new THREE.CanvasTexture(createGlowSpriteCanvas('#ffb8d8', 64)),
    }),
    [],
  );
  useEffect(
    () => () => {
      textures.diskA.dispose();
      textures.diskB.dispose();
      textures.burst.dispose();
    },
    [textures],
  );

  // 潮汐尾曲线（确定性弧线，Toomre & Toomre 型潮汐尾示意）
  const tails = useMemo(() => {
    const makeTail = (sign: number): THREE.Line => {
      const segments = 40;
      const positions = new Float32Array((segments + 1) * 3);
      for (let s = 0; s <= segments; s += 1) {
        const t = s / segments;
        // 从星系盘甩出的弧线：半径增大 + 角度回卷
        const angle = sign * (0.4 + t * 2.2);
        const r = 220 + t * 1400;
        positions[s * 3] = Math.cos(angle) * r * sign;
        positions[s * 3 + 1] = Math.sin(angle) * r + sign * t * 300;
        positions[s * 3 + 2] = t * 180 * sign;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: sign > 0 ? '#ffd8c8' : '#cfd8ff',
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      return line;
    };
    return [makeTail(1), makeTail(-1)];
  }, []);

  useEffect(
    () => () => {
      for (const tail of tails) {
        tail.geometry.dispose();
        (tail.material as THREE.Material).dispose();
      }
    },
    [tails],
  );

  // R4-22 近观细节层门控（starCatalog 池；阈值与 resolveFocusTarget 同源）
  const weightRef = useRef(0);
  const nearSpec = useMemo(() => antennaeDetailLayerSpec(), []);
  const { active: nearActive, opacity01: getNear01 } = useDetailLayer(nearSpec, {
    objectRef: groupRef,
    retention: 'lru-retain',
  });
  /** 近观层不透明度 = 河外层级淡入权重 × 近观激活权重 */
  const getNearOpacity = useCallback(
    () => weightRef.current * getNear01(),
    [getNear01],
  );
  /** 快照演化时钟 = 主场景 simDays（时间映射登记见 utils/antennaeNearView） */
  const getSimDays = useCallback(() => useSimulationStore.getState().simDays, []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    weightRef.current = weight;
    group.visible = weight > 0.001;
    setObjectTreeRaycastEnabled(group, weight > INTERACTIVE_WEIGHT);
    if (!group.visible) return;
    // R4-22：近观时静态示意层减淡让位烘焙粒子结构（登记；近观层 sprite
    // 由 AntennaeNearView 自管 —— 标记 userData.nearLayer 跳过）
    const staticDim = 1 - ANTENNAE_STATIC_NEAR_DIM * getNear01();
    group.traverse((obj) => {
      if (obj.userData.nearLayer) return;
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
        const mat = obj.material as THREE.Material & { opacity: number };
        mat.opacity =
          ((obj.userData.baseOpacity as number | undefined) ?? 0.85) * weight * staticDim;
      }
      if (obj instanceof THREE.Line) {
        (obj.material as THREE.LineBasicMaterial).opacity = 0.55 * weight * staticDim;
      }
    });
  });

  if (!body || !body.direction) return null;
  const d = cosmicDistanceToSceneUnits(body.realDistanceLy);

  return (
    <group
      ref={groupRef}
      position={[body.direction.x * d, body.direction.y * d, body.direction.z * d]}
      name={body.id}
    >
      {/* 两个相互扭曲、部分重叠的星系盘 */}
      <mesh
        position={[-160, 60, 0]}
        rotation={[0.9, 0.3, 0.4]}
        userData={{ baseOpacity: 0.9 }}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <planeGeometry args={[760, 760]} />
        <meshBasicMaterial
          map={textures.diskA}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh
        position={[170, -70, 40]}
        rotation={[1.3, -0.2, -0.6]}
        userData={{ baseOpacity: 0.9 }}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <planeGeometry args={[700, 700]} />
        <meshBasicMaterial
          map={textures.diskB}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* 碰撞界面的星暴区（气体压缩触发剧烈恒星形成） */}
      <sprite scale={[420, 420, 1]} position={[10, 0, 20]} userData={{ baseOpacity: 0.55 }}>
        <spriteMaterial
          map={textures.burst}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 两条潮汐尾（"触须"） */}
      {tails.map((tail, i) => (
        <primitive key={i} object={tail} />
      ))}
      {/* R4-22 近观细节层：两核 + 双潮汐尾烘焙快照粒子（加载失败降级现状） */}
      {nearActive && (
        <AntennaeNearLayer getOpacity={getNearOpacity} getSimDays={getSimDays} />
      )}
      {showLabels && inRange && !focused && (
        <ClampedHtmlLabel position={[0, 900, 0]} distanceFactor={12000} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-orange-200">
            {body.nameZh}（星系碰撞现场，约 4500 万光年）
          </span>
        </ClampedHtmlLabel>
      )}
    </group>
  );
}

/** LensingArcs 渲染循环临时向量（世界坐标写入持有者，零分配） */
const LENSING_TMP_WORLD = new THREE.Vector3();

/**
 * 星系团引力透镜弧（可选需求 3.1.5 + R4-23 升级）：围绕星系团中心的
 * 蓝色弧状背景星系拉伸虚像（示意置于室女座星系团位置，原型 Abell 370，
 * 已登记）。
 *
 * R4-23：近观（跟随/飞往本天体）时由 PostEffects 挂载屏幕空间 SIS
 * 偏转 Effect（方案 a，登记见 ClusterLensingEffect.tsx）呈现真折射——
 * 本组件每帧把团块质心世界坐标/可见权重写入 clusterLensingSource
 * 持有者供后期管线消费；静态示意 ring 弧按效果强度减淡 75% 让位
 * 真折射弧（保留残影登记）；新增确定性背景源 sprite（团块之后的
 * "背景星系"，世界系固定 → 绕行视差下被拉伸弧位置随视角一致）与
 * 团块弥散光晕。非跟随时持有者 visible01 随层级权重写入但 Effect
 * 不挂载（PostEffects 域判据），仍为零渲染开销。
 */
export function LensingArcs(): JSX.Element | null {
  const body = getSpecialBodyById('cluster-lensing');
  const groupRef = useRef<THREE.Group>(null);
  const arcsRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 3.05);
  // R3-4 §4.1-D：跟随/飞往本天体时隐藏自身标签（R2-8 星系同款机制补齐）
  const focused = useSimulationStore(
    (s) => s.followBodyId === 'cluster-lensing' || s.flyToBodyId === 'cluster-lensing',
  );

  // 弧参数：围绕团中心不同半径/方位角/弧长的拉伸光弧（确定性）
  const arcs = useMemo(
    () => [
      { radius: 950, start: 0.3, length: 1.1, tilt: 0.2 },
      { radius: 1250, start: 2.4, length: 0.8, tilt: -0.35 },
      { radius: 1100, start: 4.2, length: 1.4, tilt: 0.5 },
    ],
    [],
  );

  // R4-23 近观背景源（确定性布局，被 SIS Effect 拉伸成切向弧）与
  // 团块弥散光晕贴图；背景源组姿态：局部 +z 对齐团块视向"更远"方向
  const sources = useMemo(() => lensedBackgroundSources(), []);
  const sourceTextures = useMemo(
    () => ({
      warm: new THREE.CanvasTexture(createGlowSpriteCanvas('#ffe3c8', 64)),
      cool: new THREE.CanvasTexture(createGlowSpriteCanvas('#cfe0ff', 64)),
      core: new THREE.CanvasTexture(createGlowSpriteCanvas('#dfe6ff', 128)),
    }),
    [],
  );
  useEffect(
    () => () => {
      sourceTextures.warm.dispose();
      sourceTextures.cool.dispose();
      sourceTextures.core.dispose();
    },
    [sourceTextures],
  );
  const sourcesQuaternion = useMemo(() => {
    if (!body?.direction) return new THREE.Quaternion();
    const dir = new THREE.Vector3(
      body.direction.x,
      body.direction.y,
      body.direction.z,
    ).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  }, [body]);
  // 组件卸载：清空持有者（Effect 读到 present=false 即归零）
  useEffect(() => () => resetClusterLensingSource(), []);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    group.visible = weight > 0.001;
    setObjectTreeRaycastEnabled(group, weight > INTERACTIVE_WEIGHT);
    // R4-23：团块质心世界坐标 + 可见权重写入持有者（后期 Effect 消费）
    group.getWorldPosition(LENSING_TMP_WORLD);
    writeClusterLensingSource(
      LENSING_TMP_WORLD.x,
      LENSING_TMP_WORLD.y,
      LENSING_TMP_WORLD.z,
      weight,
    );
    if (!group.visible) return;
    // 弧面朝向相机（透镜像沿视线方向观察；背景源组保持世界系固定）
    arcsRef.current?.quaternion.copy(camera.quaternion);
    // 静态示意弧按效果强度减淡（真折射弧接管，保留残影登记）
    const staticDim =
      1 - CLUSTER_LENSING_STATIC_ARC_DIM * clusterLensingSource().effectStrength01;
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.MeshBasicMaterial).opacity = 0.6 * weight * staticDim;
      }
      if (obj instanceof THREE.Sprite) {
        const mat = obj.material as THREE.SpriteMaterial;
        mat.opacity = ((obj.userData.baseOpacity as number | undefined) ?? 0.6) * weight;
      }
    });
  });

  if (!body || !body.direction) return null;
  const d = cosmicDistanceToSceneUnits(body.realDistanceLy);

  return (
    <group
      ref={groupRef}
      position={[body.direction.x * d, body.direction.y * d, body.direction.z * d]}
      name={body.id}
    >
      {/* 静态示意弧组（面向相机 billboard，近观按效果强度减淡） */}
      <group ref={arcsRef}>
        {arcs.map((arc, i) => (
          <mesh
            key={i}
            rotation={[0, 0, arc.tilt]}
            onClick={(e) => {
              e.stopPropagation();
              selectBody(body.id);
            }}
          >
            {/* 细环弧段：背景星系被拉伸成的弧状虚像 */}
            <ringGeometry args={[arc.radius - 28, arc.radius + 28, 48, 1, arc.start, arc.length]} />
            <meshBasicMaterial
              color="#a8d4ff"
              transparent
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
      {/* R4-23 团块弥散光晕（透镜体可见锚点） */}
      <sprite scale={[900, 900, 1]} userData={{ baseOpacity: 0.4 }}>
        <spriteMaterial
          map={sourceTextures.core}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0}
        />
      </sprite>
      {/* R4-23 背景源（世界系固定于团块之后，近观被 SIS Effect 拉伸成弧） */}
      <group quaternion={sourcesQuaternion}>
        {sources.map((s, i) => (
          <sprite
            key={i}
            position={[s.x, s.y, s.z]}
            scale={[s.scale, s.scale, 1]}
            userData={{ baseOpacity: 0.85 }}
          >
            <spriteMaterial
              map={s.warmth01 < 0.5 ? sourceTextures.warm : sourceTextures.cool}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              opacity={0}
            />
          </sprite>
        ))}
      </group>
      {showLabels && inRange && !focused && (
        <ClampedHtmlLabel position={[0, 1550, 0]} distanceFactor={12000} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-sky-200">
            星系团引力透镜弧（示意，原型 Abell 370）
          </span>
        </ClampedHtmlLabel>
      )}
    </group>
  );
}

/**
 * 伽马射线暴（GRB 221009A，可选需求 3.1.5）：周期性重放的
 * 极亮闪光 + 双向窄喷流（真实为一次性事件，演示示意已登记）
 */
export function GammaRayBurst(): JSX.Element | null {
  const body = getSpecialBodyById('grb-221009a');
  const groupRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Sprite>(null);
  const beamsRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 3.05);
  // R3-4 §4.1-D：跟随/飞往本天体时隐藏自身标签（R2-8 星系同款机制补齐）
  const focused = useSimulationStore(
    (s) => s.followBodyId === 'grb-221009a' || s.flyToBodyId === 'grb-221009a',
  );

  const texture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#eef6ff', 128)),
    [],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    group.visible = weight > 0.001;
    setObjectTreeRaycastEnabled(group, weight > INTERACTIVE_WEIGHT);
    if (!group.visible) return;
    const { intensity01 } = grbFlashState(clock.elapsedTime);
    if (flashRef.current) {
      const s = 500 + 1800 * intensity01;
      flashRef.current.scale.set(s, s, 1);
      (flashRef.current.material as THREE.SpriteMaterial).opacity = intensity01 * weight;
    }
    if (beamsRef.current) {
      beamsRef.current.visible = intensity01 > 0.02;
      beamsRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          (obj.material as THREE.MeshBasicMaterial).opacity = 0.5 * intensity01 * weight;
        }
      });
    }
  });

  if (!body || !body.direction) return null;
  const d = cosmicDistanceToSceneUnits(body.realDistanceLy);

  return (
    <group
      ref={groupRef}
      position={[body.direction.x * d, body.direction.y * d, body.direction.z * d]}
      name={body.id}
    >
      {/* 极亮伽马闪光（FRED 光变曲线驱动） */}
      <sprite
        ref={flashRef}
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
      {/* 双向窄相对论喷流（核坍缩喷流示意） */}
      <group ref={beamsRef} rotation={[0.4, 0, 0.9]}>
        {[1, -1].map((dir) => (
          <mesh key={dir} position={[0, dir * 900, 0]} rotation={[dir < 0 ? Math.PI : 0, 0, 0]}>
            <coneGeometry args={[70, 1800, 10, 1, true]} />
            <meshBasicMaterial
              color="#cfe8ff"
              transparent
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>
      {showLabels && inRange && !focused && (
        <ClampedHtmlLabel position={[0, 800, 0]} distanceFactor={12000} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-violet-200">
            {body.nameZh}（演示重放，约 20 亿光年）
          </span>
        </ClampedHtmlLabel>
      )}
    </group>
  );
}

/**
 * M87 喷流亮节点（R5-4：HST-1 类 knot，sprite 方案登记于 utils/m87Environment
 * 文件头）：3–5 个亮 knot 沿喷流轴分布，亮度沿轴衰减 + 循环缓慢外移
 * （视觉化登记，非真实视超光速运动）。主场景 M87Jet 与预览页共用。
 */
export function M87JetKnots({
  direction,
  lengthUnits,
  getWeight,
}: {
  direction: THREE.Vector3;
  lengthUnits: number;
  /** 读取本帧可见权重（主场景 = 宇宙层级淡入；预览 = 恒 1） */
  getWeight: () => number;
}): JSX.Element {
  const knotsRef = useRef<THREE.Group>(null);
  const texture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#e8f1ff', 64)),
    [],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(({ clock }) => {
    const group = knotsRef.current;
    if (!group) return;
    const weight = getWeight();
    group.visible = weight > 0.001;
    if (!group.visible) return;
    for (let i = 0; i < M87_JET_KNOTS.length; i += 1) {
      const sprite = group.children[i] as THREE.Sprite | undefined;
      if (!sprite) continue;
      const knot = M87_JET_KNOTS[i];
      const t = m87JetKnotT01(knot.t0, clock.elapsedTime);
      const d = t * lengthUnits;
      sprite.position.set(direction.x * d, direction.y * d, direction.z * d);
      (sprite.material as THREE.SpriteMaterial).opacity =
        m87JetKnotOpacity01(t, knot.brightness) * weight;
    }
  });

  return (
    <group ref={knotsRef}>
      {M87_JET_KNOTS.map((knot, i) => (
        <sprite
          key={i}
          scale={[lengthUnits * knot.sizeFactor, lengthUnits * knot.sizeFactor, 1]}
          raycast={() => null}
        >
          <spriteMaterial
            map={texture}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}

/**
 * M87 活动星系核喷流（需求 3.1.5）：与室女座星系团 M87 条目联动为同一对象
 * （附着于 Universe 中 M87 星系的静态位置），单侧可见喷流。
 *
 * R5-4：叠加 HST-1 类亮节点（M87JetKnots，登记见 utils/m87Environment）。
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
      {/* R5-4：HST-1 类亮节点（亮度沿轴衰减 + 缓慢外移，视觉化登记） */}
      <M87JetKnots
        direction={jetDirection}
        lengthUnits={1500}
        getWeight={m87JetWeight}
      />
    </group>
  );
}

/** M87 喷流可见权重（模块级常量函数：宇宙层级淡入，零逐帧分配） */
function m87JetWeight(): number {
  return fadeWeight(useSimulationStore.getState().continuousLevel);
}
