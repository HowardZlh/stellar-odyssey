'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { CameraState } from '@/types';
import { CAMERA_VIEWS, VIEW_TRANSITION_SECONDS } from '@/data/cameraViews';
import { useSimulationStore } from '@/store';
import { advanceTransitionProgress, interpolateCameraState } from '@/utils/animation';

/**
 * 相机控制器：
 * - 手动控制（旋转/平移/缩放，OrbitControls）
 * - 四视角锚点切换时平滑过渡（位置、朝向、FOV 插值，需求 3.2.1）
 * - 背景色随层级渐变（附录A参考色值）
 */
export function CameraController(): JSX.Element {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);

  const viewLevel = useSimulationStore((s) => s.viewLevel);
  const viewTransitionId = useSimulationStore((s) => s.viewTransitionId);

  const transitionRef = useRef<{
    from: CameraState;
    to: CameraState;
    progress: number;
    fromBg: THREE.Color;
    toBg: THREE.Color;
    active: boolean;
  } | null>(null);

  // 初始背景色
  useEffect(() => {
    if (!scene.background) {
      scene.background = new THREE.Color(CAMERA_VIEWS.L2.background);
    }
    // 仅初始化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 视角切换：记录过渡起止状态
  useEffect(() => {
    if (viewTransitionId === 0) return;
    const view = CAMERA_VIEWS[viewLevel];
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
      fromBg:
        scene.background instanceof THREE.Color
          ? scene.background.clone()
          : new THREE.Color('#1a1a35'),
      toBg: new THREE.Color(view.background),
      active: true,
    };
  }, [viewLevel, viewTransitionId, camera, scene]);

  useFrame((_, delta) => {
    const transition = transitionRef.current;
    const controls = controlsRef.current;
    if (!transition || !transition.active) return;

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
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(transition.fromBg).lerp(transition.toBg, transition.progress);
    }
    if (transition.progress >= 1) {
      transition.active = false;
    }
  });

  const view = CAMERA_VIEWS[viewLevel];

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={view.minDistance}
      maxDistance={view.maxDistance}
    />
  );
}
