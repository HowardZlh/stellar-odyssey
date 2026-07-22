'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { CameraState, ViewLevel } from '@/types';
import { CAMERA_VIEWS, VIEW_TRANSITION_SECONDS } from '@/data/cameraViews';
import { useSimulationStore } from '@/store';
import { advanceTransitionProgress, interpolateCameraState } from '@/utils/animation';
import { levelBlendWeights } from '@/utils/scale';

/** 遨游模式缩放范围：行星表面 → 宇宙宏观（需求 3.2.2 跨层级连续缩放） */
const ROAM_MIN_DISTANCE = 1.5;
const ROAM_MAX_DISTANCE = 42000;

/**
 * 相机控制器：
 * - 手动控制（旋转/平移/缩放，OrbitControls）
 * - 四视角锚点切换时平滑过渡（位置、朝向、FOV 插值，需求 3.2.1）
 * - 连续维度缩放（需求 3.2.2）：每帧将相机距离同步为连续层级，
 *   驱动 LOD 渐变、时间压缩比插值与音景实时混合
 * - 背景色随连续层级实时混合（附录A参考色值；L4 纯黑）
 */
export function CameraController(): JSX.Element {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);

  const viewTransitionId = useSimulationStore((s) => s.viewTransitionId);

  const transitionRef = useRef<{
    from: CameraState;
    to: CameraState;
    progress: number;
    active: boolean;
  } | null>(null);

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

  // 视角锚点切换：记录过渡起止状态（仅由切换代次触发，目标层级在触发时刻捕获）
  useEffect(() => {
    if (viewTransitionId === 0) return;
    const view = CAMERA_VIEWS[useSimulationStore.getState().viewLevel];
    const controls = controlsRef.current;
    const currentTarget = controls
      ? { x: controls.target.x, y: controls.target.y, z: controls.target.z }
      : { x: 0, y: 0, z: 0 };
    transitionRef.current = {
      from: {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: currentTarget,
        fov: camera.fov,
      },
      to: { position: view.position, target: view.target, fov: view.fov },
      progress: 0,
      active: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTransitionId, camera]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const transition = transitionRef.current;

    // 锚点过渡动画
    if (transition && transition.active) {
      transition.progress = advanceTransitionProgress(
        transition.progress,
        delta,
        VIEW_TRANSITION_SECONDS,
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
    }

    // 连续维度缩放：相机距原点距离 → 连续层级
    // 锚点过渡期间仅更新连续层级（LOD/音景平滑跟随），不回写离散层级，
    // 避免过渡目标被相机当前位置改写
    const distance = camera.position.length();
    const transitionActive = Boolean(transition && transition.active);
    useSimulationStore.getState().syncCameraDistance(distance, !transitionActive);

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
