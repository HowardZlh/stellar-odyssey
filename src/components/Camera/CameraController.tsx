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

  const viewTransitionId = useSimulationStore((s) => s.viewTransitionId);
  const flyToRequestId = useSimulationStore((s) => s.flyToRequestId);

  const transitionRef = useRef<TransitionState | null>(null);
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

  // 视角锚点切换：记录过渡起止状态（仅由切换代次触发，目标层级在触发时刻捕获）
  useEffect(() => {
    if (viewTransitionId === 0) return;
    const view = CAMERA_VIEWS[useSimulationStore.getState().viewLevel];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTransitionId, camera]);

  // 飞往天体：以当前相机→天体方向进场，运镜期间每帧重解析目标位置
  useEffect(() => {
    if (flyToRequestId === 0) return;
    const state = useSimulationStore.getState();
    const id = state.flyToBodyId;
    if (!id) return;
    const target = resolveTargetById(id, state);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToRequestId, camera]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const transition = transitionRef.current;
    const store = useSimulationStore.getState();

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
