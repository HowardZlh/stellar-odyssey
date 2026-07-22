'use client';

import { Canvas } from '@react-three/fiber';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { AudioController } from '@/components/Audio/AudioController';
import { SpatialAudio } from '@/components/Audio/SpatialAudio';
import { CameraController } from '@/components/Camera/CameraController';
import { ControlPanel } from '@/components/UI/ControlPanel';
import { HudInfo } from '@/components/UI/HudInfo';
import { PerformanceMonitor } from '@/components/UI/PerformanceMonitor';
import { HelpHint } from '@/components/UI/HelpHint';
import { Galaxy } from '@/components/Scene/Galaxy';
import { SimulationClock } from '@/components/Scene/SimulationClock';
import { SolarSystem } from '@/components/Scene/SolarSystem';
import { Starfield } from '@/components/Scene/Starfield';
import { Universe } from '@/components/Scene/Universe';

/**
 * 应用根组件：3D Canvas + UI 面板 + 音效控制
 */
export default function SolarSystemApp(): JSX.Element {
  useKeyboardShortcuts();

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
      </Canvas>

      <ControlPanel />
      <HudInfo />
      <PerformanceMonitor />
      <HelpHint />
      <AudioController />
    </div>
  );
}
