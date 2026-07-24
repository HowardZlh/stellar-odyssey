'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { CameraState, Vec3, ViewLevel } from '@/types';
import { CAMERA_VIEWS, VIEW_TRANSITION_SECONDS } from '@/data/cameraViews';
import { useSimulationStore } from '@/store';
import type { SimulationState } from '@/store';
import { advanceTransitionProgress, interpolateCameraState } from '@/utils/animation';
import { resolveFocusTarget, supernovaFocusTarget } from '@/utils/cameraFocus';
import type { FocusTarget } from '@/utils/cameraFocus';
import { levelBlendWeights } from '@/utils/scale';

/** 遨游模式缩放范围：行星表面 → 宇宙宏观（需求 3.2.2 跨层级连续缩放） */
const ROAM_MIN_DISTANCE = 1.5;
const ROAM_MAX_DISTANCE = 42000;

/** 飞往运镜时长（秒，需求 3.2.3 平滑运镜） */
const FLY_TO_SECONDS = 2.5;

/** 目标解析（含超新星事件：事件状态在 store 中，需单独查询） */
function resolveTargetById(id: string, state: SimulationState): FocusTarget | null {
  if (id.startsWith('sn-')) {
    const event =
      state.activeSupernova?.id === id
        ? state.activeSupernova
        : state.supernovaRemnants.find((r) => r.id === id);
    return event ? supernovaFocusTarget(event, state.simDays) : null;
  }
  return resolveFocusTarget(id, state.simDays, state.realScaleMode);
}

interface TransitionState {
  from: CameraState;
  to: CameraState;
  progress: number;
  active: boolean;
  /** 飞往模式：目标天体 id（每帧重解析位置，天体运动时目标同步更新） */
  flyToId: string | null;
  /** 飞往模式：进场方向与观察距离（触发时刻捕获，保持运镜方向稳定） */
  approachDir: Vec3 | null;
  viewDistance: number;
}

/**
 * 相机控制器：
 * - 手动控制（旋转/平移/缩放，OrbitControls）
 * - 四视角锚点切换时平滑过渡（位置、朝向、FOV 插值，需求 3.2.1）
 * - 飞往天体：点选后平滑运镜（需求 3.2.3，目标随天体运动每帧更新）
 * - 天体跟随模式：锁定任意天体随其运动（需求 3.2.3，保持相对偏移）
 * - 连续维度缩放（需求 3.2.2）：每帧将相机距离同步为连续层级
 * - 背景色随连续层级实时混合（附录A参考色值；L4 纯黑）
 */
export function CameraController(): JSX.Element {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);

  const transitionRef = useRef<TransitionState | null>(null);
  /** 已处理的切换/飞往请求代次（在 useFrame 内捕获，避免与层级同步竞态） */
  const handledViewTransitionIdRef = useRef(0);
  const handledFlyToRequestIdRef = useRef(0);
  /** 跟随模式：上一帧目标位置（id 变化时重置） */
  const followRef = useRef<{ id: string; position: Vec3 } | null>(null);

  const levelColors = useMemo<Record<ViewLevel, THREE.Color>>(
    () => ({
      L1: new THREE.Color(CAMERA_VIEWS.L1.background),
      L2: new THREE.Color(CAMERA_VIEWS.L2.background),
      L3: new THREE.Color(CAMERA_VIEWS.L3.background),
      L4: new THREE.Color(CAMERA_VIEWS.L4.background),
    }),
    [],
  );
  const bgColor = useMemo(() => new THREE.Color(CAMERA_VIEWS.L2.background), []);

  // 初始背景色
  useEffect(() => {
    if (!scene.background) {
      scene.background = new THREE.Color(CAMERA_VIEWS.L2.background);
    }
    // 仅初始化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 记录当前相机状态为过渡起点 */
  const captureFrom = (): CameraState => {
    const controls = controlsRef.current;
    const currentTarget = controls
      ? { x: controls.target.x, y: controls.target.y, z: controls.target.z }
      : { x: 0, y: 0, z: 0 };
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: currentTarget,
      fov: camera.fov,
    };
  };

  /**
   * 视角锚点切换：记录过渡起止状态（目标层级在触发时刻捕获）。
   *
   * 在 useFrame 内检测切换代次（而非 useEffect）：保证捕获发生在同帧的
   * syncCameraDistance 之前——否则点击切换后、React 副作用执行前的渲染帧
   * 会按当前相机距离把 viewLevel 回写为旧层级，导致过渡目标被改写
   * （P3-7 自查修复：视角切换在部分时序下失效）。
   */
  const captureViewTransition = (store: SimulationState): void => {
    const view = CAMERA_VIEWS[store.viewLevel];
    transitionRef.current = {
      from: captureFrom(),
      to: { position: view.position, target: view.target, fov: view.fov },
      progress: 0,
      active: true,
      flyToId: null,
      approachDir: null,
      viewDistance: 0,
    };
    followRef.current = null;
  };

  /** 飞往天体：以当前相机→天体方向进场，运镜期间每帧重解析目标位置 */
  const captureFlyToTransition = (store: SimulationState): void => {
    const id = store.flyToBodyId;
    if (!id) return;
    // P6 自查修复（需求 §3.1.1"飞往后自动切回跟随模式"）：银心固定参考系
    // 仅用于 L3 尺度观察"太阳系在轨道内运行"，任何"飞往"都先切回跟随参考系。
    // 否则位于场景原点的目标（太阳系天体/银心黑洞）会与低层级"原点=太阳系"
    // 的语义矛盾（相机靠近原点后太阳系内容在银心处淡入）。切回后渲染权重
    // 2 秒过渡、飞往运镜每帧重解析目标位置，全程平滑无跳变。
    if (store.galacticFrameMode === 'galactic-center') {
      store.setGalacticFrameMode('follow');
    }
    const target = resolveTargetById(id, store);
    if (!target) return;

    const dx = camera.position.x - target.position.x;
    const dy = camera.position.y - target.position.y;
    const dz = camera.position.z - target.position.z;
    const len = Math.hypot(dx, dy, dz);
    // 相机与目标重合时的兜底进场方向
    const approachDir: Vec3 =
      len > 1e-6
        ? { x: dx / len, y: dy / len, z: dz / len }
        : { x: 0.33, y: 0.25, z: 0.91 };
    const d = target.viewDistanceUnits;
    transitionRef.current = {
      from: captureFrom(),
      to: {
        position: {
          x: target.position.x + approachDir.x * d,
          y: target.position.y + approachDir.y * d,
          z: target.position.z + approachDir.z * d,
        },
        target: target.position,
        fov: camera.fov,
      },
      progress: 0,
      active: true,
      flyToId: id,
      approachDir,
      viewDistance: d,
    };
    followRef.current = null;
  };

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const store = useSimulationStore.getState();

    // 新的锚点切换/飞往请求：本帧内先捕获过渡，再做层级同步（防竞态）
    if (store.viewTransitionId !== handledViewTransitionIdRef.current) {
      handledViewTransitionIdRef.current = store.viewTransitionId;
      captureViewTransition(store);
    }
    if (store.flyToRequestId !== handledFlyToRequestIdRef.current) {
      handledFlyToRequestIdRef.current = store.flyToRequestId;
      captureFlyToTransition(store);
    }
    const transition = transitionRef.current;

    // 锚点切换 / 飞往运镜动画
    if (transition && transition.active) {
      // 飞往模式：目标天体在运动，每帧重解析并更新终点（平滑追踪）
      if (transition.flyToId && transition.approachDir) {
        const target = resolveTargetById(transition.flyToId, store);
        if (target) {
          const d = transition.viewDistance;
          transition.to.position = {
            x: target.position.x + transition.approachDir.x * d,
            y: target.position.y + transition.approachDir.y * d,
            z: target.position.z + transition.approachDir.z * d,
          };
          transition.to.target = target.position;
        }
      }
      transition.progress = advanceTransitionProgress(
        transition.progress,
        delta,
        transition.flyToId ? FLY_TO_SECONDS : VIEW_TRANSITION_SECONDS,
      );
      const state = interpolateCameraState(transition.from, transition.to, transition.progress);
      camera.position.set(state.position.x, state.position.y, state.position.z);
      camera.fov = state.fov;
      camera.updateProjectionMatrix();
      if (controls) {
        controls.target.set(state.target.x, state.target.y, state.target.z);
        controls.update();
      }
      if (transition.progress >= 1) {
        transition.active = false;
        // 飞往运镜完成（P5 自查修复）：立即以落点位置播种跟随基准。
        // 否则下一帧跟随分支仅初始化 followRef 而不平移，该帧目标天体的
        // 位移被永久丢失——高时间压缩下（如 L2 跟随冥王星，单帧位移可达
        // 数个场景单位）天体会永久偏出近观视野（矮行星观察距离仅 ~2.5 单位）
        if (transition.flyToId && store.followBodyId === transition.flyToId) {
          followRef.current = { id: transition.flyToId, position: transition.to.target };
        }
      }
    } else if (store.followBodyId) {
      // 天体跟随模式（需求 3.2.3）：按目标位移平移相机与观察点，
      // 保持用户手动调整的相对偏移（仍可旋转/缩放）
      const target = resolveTargetById(store.followBodyId, store);
      if (target) {
        const last = followRef.current;
        if (last && last.id === store.followBodyId) {
          const dx = target.position.x - last.position.x;
          const dy = target.position.y - last.position.y;
          const dz = target.position.z - last.position.z;
          if (dx !== 0 || dy !== 0 || dz !== 0) {
            camera.position.x += dx;
            camera.position.y += dy;
            camera.position.z += dz;
            if (controls) {
              controls.target.x += dx;
              controls.target.y += dy;
              controls.target.z += dz;
              controls.update();
            }
          }
        }
        followRef.current = { id: store.followBodyId, position: target.position };
      }
    } else {
      followRef.current = null;
    }

    // 连续维度缩放：相机距原点距离 → 连续层级
    // 锚点过渡期间仅更新连续层级（LOD/音景平滑跟随），不回写离散层级，
    // 避免过渡目标被相机当前位置改写
    const distance = camera.position.length();
    const transitionActive = Boolean(transition && transition.active);
    store.syncCameraDistance(distance, !transitionActive);

    // 背景色按层级权重实时混合（连续缩放时无跳变；L4 纯黑）
    const weights = levelBlendWeights(useSimulationStore.getState().continuousLevel);
    bgColor.setRGB(0, 0, 0);
    for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
      const w = weights[level];
      if (w > 0) {
        bgColor.r += levelColors[level].r * w;
        bgColor.g += levelColors[level].g * w;
        bgColor.b += levelColors[level].b * w;
      }
    }
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(bgColor);
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={ROAM_MIN_DISTANCE}
      maxDistance={ROAM_MAX_DISTANCE}
    />
  );
}
