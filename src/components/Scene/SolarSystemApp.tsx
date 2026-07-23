'use client';

import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { AudioController } from '@/components/Audio/AudioController';
import { SpatialAudio } from '@/components/Audio/SpatialAudio';
import { CameraController } from '@/components/Camera/CameraController';
import { getTextureManager } from '@/components/CelestialBody/textureManager';
import { BodyCycleSwitcher } from '@/components/UI/BodyCycleSwitcher';
import { ControlPanel } from '@/components/UI/ControlPanel';
import { HudInfo } from '@/components/UI/HudInfo';
import { LoadingProgress } from '@/components/UI/LoadingProgress';
import { PerformanceMonitor } from '@/components/UI/PerformanceMonitor';
import { HelpHint } from '@/components/UI/HelpHint';
import { Galaxy } from '@/components/Scene/Galaxy';
import { PostEffects } from '@/components/Scene/PostEffects';
import { SimulationClock } from '@/components/Scene/SimulationClock';
import { SolarSystem } from '@/components/Scene/SolarSystem';
import { Starfield } from '@/components/Scene/Starfield';
import { Universe } from '@/components/Scene/Universe';

/**
 * 应用根组件：3D Canvas + 后处理 + UI 面板 + 音效控制
 */
export default function SolarSystemApp(): JSX.Element {
  useKeyboardShortcuts();

  // 应用卸载时释放全部位图纹理（AGENTS.md 内存管理）
  useEffect(() => {
    return () => {
      getTextureManager().disposeAll();
    };
  }, []);

  return (
    <div className="relative h-screen w-screen">
      <Canvas
        // 对数深度缓冲：尺度管理方案的一部分，避免大尺度 z-fighting（需求 5.1）
        gl={{ logarithmicDepthBuffer: true, antialias: true }}
        camera={{
          position: [
            CAMERA_VIEWS.L2.position.x,
            CAMERA_VIEWS.L2.position.y,
            CAMERA_VIEWS.L2.position.z,
          ],
          fov: CAMERA_VIEWS.L2.fov,
          near: 0.1,
          far: 200000,
        }}
      >
        <SimulationClock />
        <CameraController />
        {/* 附录A：环境光 0.5 */}
        <ambientLight intensity={0.5} />
        <Starfield />
        <SolarSystem />
        {/* L3 银河系（太阳系绕银心，嵌套一致性）与 L4 宇宙（本星系群/宇宙网） */}
        <Galaxy />
        <Universe />
        {/* 3D 空间音效（可选需求 3.4.2）：靠近太阳/黑洞时对应音源增强 */}
        <SpatialAudio />
        {/* Bloom 泛光后处理（P3-3，需求 4.6）：选择性发光 + 层级适配强度 */}
        <PostEffects />
      </Canvas>

      <ControlPanel />
      <HudInfo />
      {/* 行星视角天体切换（P4，需求 3.2.4：仅 L1 语境显示） */}
      <BodyCycleSwitcher />
      <LoadingProgress />
      <PerformanceMonitor />
      <HelpHint />
      <AudioController />
    </div>
  );
}
