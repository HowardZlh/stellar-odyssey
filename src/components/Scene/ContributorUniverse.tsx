'use client';

/**
 * 贡献者宇宙 3D 场景（C2，/contributors 页面专用）
 *
 * 独立于主场景的轻量 R3F Canvas：
 * - 贡献者星：单 Points + ShaderMaterial（C1 产物直灌顶点属性，资源
 *   工厂见 contributorUniverseResources.ts）；
 * - 背景氛围星场：≤3000 点、无交互（raycast 置空）、更小更暗；
 * - 相机：drei OrbitControls（旋转 + 缩放，平移关闭——裁决登记于需求
 *   文档 §C2-3；触屏显式 ONE=ROTATE / TWO=DOLLY_PAN，C3-1）+ 入场缓推
 *   运镜 + 点击星聚焦飞行（prefers-reduced-motion 一律直达）；状态全为
 *   组件内 React state/ref，不接主应用 store 视角体系；
 * - 交互：hover 显示昵称 tooltip（仅桌面；isTouch 下 tap 直达"聚焦 +
 *   详情卡"，无 hover 中间态，命中阈值 ×2——C3-1）、点击星回调页面层
 *   打开详情卡、点击空白清除选中；
 * - 档位（C3-2）：dpr/antialias/背景星场点数按 deviceTier 三档取值
 *   （contributorCanvasQuality 纯函数，页面层传入）；
 * - 降级：WebGL 检测 + Canvas 错误边界，失败经 onWebglFail 通知页面层
 *   切换文字名单（C2-5）。
 */

import type { JSX, ReactNode } from 'react';
import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type {
  BoundarySphereSpec,
  ContributorCanvasQuality,
  ContributorStar,
} from '@/utils/contributorUniverse';
import {
  BOUNDARY_ROTATION_SEC_PER_TURN,
  CONTRIBUTOR_CANVAS_FOV_DEG,
  boundaryHomeDistance,
  raycastPointsThreshold,
} from '@/utils/contributorUniverse';
import {
  buildBackgroundStarBuffers,
  buildContributorStarBuffers,
  createBoundarySphereResources,
  createStarPointsResources,
  disposeBoundarySphereResources,
  disposeStarPointsResources,
} from '@/components/Scene/contributorUniverseResources';

/** 贡献者星基准粒径（× C1 aScale ∈ [1, 3.2]）。
 *  C5-1 登记：3 → 4 补偿默认观察距离外移（179 → ≈255，×1.4）——
 *  屏上视觉尺寸与 C4 交付基本持平，金额映射的相对大小语义零改动 */
const CONTRIBUTOR_BASE_SIZE = 4;

/** 背景星场基准粒径（更小更暗，视觉区分贡献者星） */
const BACKGROUND_BASE_SIZE = 1.6;

/** 默认观察方向（单位向量；C5-1 修订：实际观察位 = 方向 × 按画布宽高比
 *  补偿的取景距离 boundaryHomeDistance(aspect)——边界球完整入框，
 *  竖屏画布水平视场更窄自动外移）；入场起点 = 观察位 × INTRO_FROM_FACTOR */
const HOME_DIRECTION: [number, number, number] = [0, 0.2036, 0.9791];
const INTRO_FROM_FACTOR = 1.5;

/** 入场/聚焦飞行时长（秒） */
const INTRO_DURATION = 2.2;
const FOCUS_DURATION = 1.4;

/** 聚焦飞行落点距离：基础 + 随星粒径加距（大星留更大取景框） */
const FOCUS_BASE_DISTANCE = 12;
const FOCUS_DISTANCE_PER_SCALE = 4;

/** OrbitControls 缩放限位（禁止穿透星团中心/缩到不可见）；
 *  C5-1：上限 480 → 380（边界球半径 110 的全景取景框收紧） */
const CONTROLS_MIN_DISTANCE = 25;
const CONTROLS_MAX_DISTANCE = 380;

/** Canvas 底色（C5-2：#05060f → 略亮深蓝，配合星场提亮增加可见度） */
const CANVAS_CLEAR_COLOR = '#0a0e1e';

/** WebGL 可用性检测（C2-5 降级判据；jsdom 下 getContext 返回 null → false） */
export function detectWebglSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** prefers-reduced-motion 判定（运镜/飞行动画跳过判据） */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// 相机运镜（入场缓推 + 聚焦飞行；OrbitControls target 同步）
// ---------------------------------------------------------------------------

interface CameraFlight {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  elapsed: number;
  duration: number;
}

interface CameraRigProps {
  stars: readonly ContributorStar[];
  /** 聚焦星下标（null = 无聚焦；关闭详情卡不自动回全景——裁决登记） */
  focusIndex: number | null;
}

function CameraRig({ stars, focusIndex }: CameraRigProps): JSX.Element {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const flightRef = useRef<CameraFlight | null>(null);
  const camera = useThree((state) => state.camera);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  // 入场运镜：远处缓推至默认观察位（reduced-motion 直达）。
  // C5-1：观察距离按画布宽高比补偿（竖屏水平视场窄 → 自动外移使边界球
  // 完整入框），上钳缩放上限防超出 OrbitControls 限位。
  useEffect(() => {
    const aspect =
      camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
    const distance = Math.min(boundaryHomeDistance(aspect), CONTROLS_MAX_DISTANCE);
    const home = new THREE.Vector3(...HOME_DIRECTION).multiplyScalar(distance);
    const from = home.clone().multiplyScalar(INTRO_FROM_FACTOR);
    camera.position.copy(from);
    if (reducedMotion) {
      camera.position.copy(home);
      return;
    }
    flightRef.current = {
      fromPos: from,
      toPos: home,
      fromTarget: new THREE.Vector3(0, 0, 0),
      toTarget: new THREE.Vector3(0, 0, 0),
      elapsed: 0,
      duration: INTRO_DURATION,
    };
    // 入场仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 聚焦飞行：沿当前视线方向飞近目标星，OrbitControls target 同步
  useEffect(() => {
    if (focusIndex === null) return;
    const star = stars[focusIndex];
    if (!star) return;
    const starPos = new THREE.Vector3(...star.position);
    const direction = camera.position.clone().sub(starPos);
    if (direction.lengthSq() < 1e-6) direction.set(0, 0.3, 1);
    direction.normalize();
    const distance = FOCUS_BASE_DISTANCE + star.scale * FOCUS_DISTANCE_PER_SCALE;
    const controls = controlsRef.current;
    flightRef.current = {
      fromPos: camera.position.clone(),
      toPos: starPos.clone().add(direction.multiplyScalar(distance)),
      fromTarget: controls ? controls.target.clone() : new THREE.Vector3(),
      toTarget: starPos,
      elapsed: 0,
      duration: reducedMotion ? 0 : FOCUS_DURATION,
    };
  }, [focusIndex, stars, camera, reducedMotion]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const flight = flightRef.current;
    if (controls) controls.enabled = flight === null;
    if (!flight) return;
    flight.elapsed += delta;
    const t = flight.duration <= 0 ? 1 : Math.min(1, flight.elapsed / flight.duration);
    const k = easeInOutCubic(t);
    camera.position.lerpVectors(flight.fromPos, flight.toPos, k);
    if (controls) {
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
      controls.update();
    }
    if (t >= 1) flightRef.current = null;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      minDistance={CONTROLS_MIN_DISTANCE}
      maxDistance={CONTROLS_MAX_DISTANCE}
      // C3-1：触屏显式手势映射（单指旋转 / 双指捏合缩放；pan 已全局关闭，
      // DOLLY_PAN 中 pan 分量无效——与主场景 M4-1 同口径，各自独立配置）
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
    />
  );
}

// ---------------------------------------------------------------------------
// 星点组
// ---------------------------------------------------------------------------

interface ContributorStarsPointsProps {
  stars: readonly ContributorStar[];
  onSelect: (index: number) => void;
  /** hover 回调（isTouch 下不传 = 不挂 hover 事件，tap 直达聚焦——C3-1） */
  onHover?: (index: number | null) => void;
}

/** 贡献者星 Points（C1 产物直灌；hover/click 经 raycast 命中 e.index） */
function ContributorStarsPoints({
  stars,
  onSelect,
  onHover,
}: ContributorStarsPointsProps): JSX.Element {
  const resources = useMemo(
    () => createStarPointsResources(buildContributorStarBuffers(stars), CONTRIBUTOR_BASE_SIZE),
    [stars],
  );
  useEffect(() => () => disposeStarPointsResources(resources), [resources]);

  useFrame((state) => {
    resources.material.uniforms.uScale.value = state.gl.domElement.height * 0.5;
    resources.material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <points
      geometry={resources.geometry}
      material={resources.material}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.index !== undefined) onSelect(e.index);
      }}
      onPointerOver={
        onHover
          ? (e: ThreeEvent<PointerEvent>) => {
              if (e.index !== undefined) onHover(e.index);
            }
          : undefined
      }
      onPointerMove={
        onHover
          ? (e: ThreeEvent<PointerEvent>) => {
              if (e.index !== undefined) onHover(e.index);
            }
          : undefined
      }
      onPointerOut={onHover ? () => onHover(null) : undefined}
    />
  );
}

interface BackgroundStarsProps {
  count?: number;
}

interface BoundarySphereProps {
  spec: BoundarySphereSpec;
}

/**
 * 网格球体宇宙边界（C5-1）：经纬网格 LineSegments 常驻渲染（有/无贡献者
 * 均显示，用户确认口径①）；缓慢自转（75s/圈，prefers-reduced-motion
 * 静止）；不参与 raycast（不干扰点星交互）；卸载 dispose。
 */
function BoundarySphere({ spec }: BoundarySphereProps): JSX.Element {
  const resources = useMemo(() => createBoundarySphereResources(spec), [spec]);
  useEffect(() => () => disposeBoundarySphereResources(resources), [resources]);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (reducedMotion || !groupRef.current) return;
    groupRef.current.rotation.y += (delta * 2 * Math.PI) / BOUNDARY_ROTATION_SEC_PER_TURN;
  });

  return (
    <group ref={groupRef}>
      <lineSegments
        geometry={resources.geometry}
        material={resources.material}
        raycast={() => null}
      />
    </group>
  );
}

/** 背景氛围星场（无交互，raycast 置空） */
function BackgroundStars({ count }: BackgroundStarsProps): JSX.Element {
  const resources = useMemo(
    () => createStarPointsResources(buildBackgroundStarBuffers(count), BACKGROUND_BASE_SIZE),
    [count],
  );
  useEffect(() => () => disposeStarPointsResources(resources), [resources]);

  useFrame((state) => {
    resources.material.uniforms.uScale.value = state.gl.domElement.height * 0.5;
    resources.material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <points
      geometry={resources.geometry}
      material={resources.material}
      raycast={() => null}
    />
  );
}

// ---------------------------------------------------------------------------
// Canvas 错误边界（WebGL 上下文创建失败等运行期错误 → 页面层降级）
// ---------------------------------------------------------------------------

interface CanvasErrorBoundaryProps {
  onError: () => void;
  children: ReactNode;
}

class CanvasErrorBoundary extends Component<CanvasErrorBoundaryProps, { failed: boolean }> {
  constructor(props: CanvasErrorBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

export interface ContributorUniverseCanvasProps {
  stars: readonly ContributorStar[];
  /** 当前聚焦星下标（页面详情卡状态同源） */
  selectedIndex: number | null;
  /** 点击星（index）/点击空白（null）回调 */
  onSelectStar: (index: number | null) => void;
  /** WebGL 初始化/运行期失败回调（页面层切文字名单） */
  onWebglFail: () => void;
  /** 触屏为主设备（M1 store 判据，页面层传入；tap 直达聚焦 + 命中阈值 ×2） */
  isTouch: boolean;
  /** 渲染档位参数（contributorCanvasQuality(deviceTier) 产物，C3-2） */
  quality: ContributorCanvasQuality;
}

/** 贡献者宇宙 Canvas（独立轻量 R3F 场景，两组 Points 合计 2 次 draw call） */
export function ContributorUniverseCanvas({
  stars,
  selectedIndex,
  onSelectStar,
  onWebglFail,
  isTouch,
  quality,
}: ContributorUniverseCanvasProps): JSX.Element {
  // DprSpec 为 readonly 元组，R3F Dpr 要求可变元组——拷贝转换
  const dpr: number | [number, number] =
    typeof quality.dpr === 'number' ? quality.dpr : [quality.dpr[0], quality.dpr[1]];
  return (
    <CanvasErrorBoundary onError={onWebglFail}>
      <Canvas
        dpr={dpr}
        gl={{ antialias: quality.antialias, alpha: false }}
        // 初始位取桌面基准入场起点近似值；挂载后 CameraRig 按实际画布
        // 宽高比重算（boundaryHomeDistance），首帧偏差不可感知
        camera={{
          fov: CONTRIBUTOR_CANVAS_FOV_DEG,
          near: 0.5,
          far: 4000,
          position: [0, 78, 375],
        }}
        onCreated={(state) => {
          state.raycaster.params.Points.threshold = raycastPointsThreshold(isTouch);
        }}
        onPointerMissed={() => onSelectStar(null)}
      >
        <color attach="background" args={[CANVAS_CLEAR_COLOR]} />
        <SceneWithFocus
          stars={stars}
          selectedIndex={selectedIndex}
          onSelectStar={onSelectStar}
          isTouch={isTouch}
          backgroundStarCount={quality.backgroundStarCount}
          boundarySphere={quality.boundarySphere}
        />
      </Canvas>
    </CanvasErrorBoundary>
  );
}

interface SceneWithFocusProps {
  stars: readonly ContributorStar[];
  selectedIndex: number | null;
  onSelectStar: (index: number | null) => void;
  isTouch: boolean;
  backgroundStarCount: number;
  boundarySphere: BoundarySphereSpec;
}

/** 场景 + 相机聚焦组合（CameraRig 需在 Canvas 内消费 useThree） */
function SceneWithFocus({
  stars,
  selectedIndex,
  onSelectStar,
  isTouch,
  backgroundStarCount,
  boundarySphere,
}: SceneWithFocusProps): JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    if (isTouch) return undefined;
    gl.domElement.style.cursor = hovered !== null ? 'pointer' : 'auto';
    return () => {
      gl.domElement.style.cursor = 'auto';
    };
  }, [hovered, gl, isTouch]);

  // isTouch：无 hover 中间态（tap 直达聚焦 + 详情卡，C3-1）
  const hoveredStar = !isTouch && hovered !== null ? stars[hovered] : undefined;

  return (
    <>
      <BackgroundStars count={backgroundStarCount} />
      <BoundarySphere spec={boundarySphere} />
      {stars.length > 0 && (
        <ContributorStarsPoints
          stars={stars}
          onSelect={(index) => onSelectStar(index)}
          onHover={isTouch ? undefined : setHovered}
        />
      )}
      {hoveredStar && (
        <Html
          position={[
            hoveredStar.position[0],
            hoveredStar.position[1] + 1.2 * hoveredStar.scale,
            hoveredStar.position[2],
          ]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <span className="-translate-y-4 whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-xs text-sky-100">
            {hoveredStar.donor.name}
          </span>
        </Html>
      )}
      <CameraRig stars={stars} focusIndex={selectedIndex} />
    </>
  );
}
