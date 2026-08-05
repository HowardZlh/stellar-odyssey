'use client';


import type { JSX } from 'react';
import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { useLocaleInit } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import { useLaunchInit } from '@/hooks/useLaunchParams';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useKiosk } from '@/hooks/useKiosk';
import { useDeviceTierInit, useViewportKind } from '@/hooks/useViewportKind';
import { AudioController } from '@/components/Audio/AudioController';
import { SpatialAudio } from '@/components/Audio/SpatialAudio';
import { CameraController } from '@/components/Camera/CameraController';
import { getTextureManager } from '@/components/CelestialBody/textureManager';
import { getSatelliteModelManager } from '@/components/CelestialBody/modelManager';
import { BodyCycleSwitcher } from '@/components/UI/BodyCycleSwitcher';
import { ContactBadge } from '@/components/UI/ContactBadge';
import { ControlPanel } from '@/components/UI/ControlPanel';
import { HudInfo } from '@/components/UI/HudInfo';
import { KioskBadge } from '@/components/UI/KioskBadge';
import { LaunchLogo } from '@/components/UI/LaunchLogo';
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
  // B5 §5.1-A：UI 显隐总开关（受控组件顶层包裹，见下方 JSX 登记）
  const uiVisible = useSimulationStore((s) => s.uiVisible);
  // B2 i18n：启动 locale 初始化（?lang= > localStorage > 默认 zh，
  // lang 解析经 B4 统一入口 utils/launchParams.ts）
  useLocaleInit();
  // B4 启动 URL 参数：挂载后解析写入 store + body 就绪飞往（方案 K4）
  useLaunchInit();
  // B5 展馆模式驱动（方案 K5）：须在 useLaunchInit 之后挂载——同批
  // effect 按 hook 声明序执行，?mode=kiosk 读取时 launch 已写入
  useKiosk();
  // M1 触屏基建：设备档位一次性探测 + 视口类型（isTouch/isCompact）
  // matchMedia 订阅写 store（M2 渲染降档 / M3 移动布局消费）
  useDeviceTierInit();
  useViewportKind();

  // 应用卸载时释放全部位图纹理与 glTF 模型（AGENTS.md 内存管理）
  useEffect(() => {
    return () => {
      getTextureManager().disposeAll();
      getSatelliteModelManager().disposeAll();
    };
  }, []);

  return (
    <div className="relative h-screen w-screen">
      <Canvas
        // M1-2 手势隔离：Canvas 容器 touch-action none——双指捏合/单指拖动
        // 完全交给 OrbitControls，杜绝页面级缩放与滚动
        className="touch-none"
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

      {/* B5 §5.1-A UI 显隐受控组件（受控方式登记 = 顶层包裹二选一取此：
          单点 hidden（display:none）覆盖全部受控组件并保留组件内部状态，
          各组件零改动）；LoadingProgress（加载期必须可见）与 LaunchLogo
          （B4 §4.1 登记）不受控，置于包裹外 */}
      {/* M1-2 UI 悬浮层：touch-manipulation 消除 300ms 点按延迟；
          select-none 禁 UI 文本长按选中（信息面板科学文案经 select-text
          豁免保持可复制，见 HudInfo） */}
      <div hidden={!uiVisible} className="touch-manipulation select-none">
        <ControlPanel />
        <HudInfo />
        {/* 行星视角天体切换（P4，需求 3.2.4：仅 L1 语境显示） */}
        <BodyCycleSwitcher />
        <PerformanceMonitor />
        <HelpHint />
        {/* 商业合作角标（左下角常驻，事件通知/剖面卡片占位时避让隐藏；
            B1 预留登记收口：经本包裹接入 uiVisible） */}
        <ContactBadge />
      </div>
      {/* uiVisible 包裹外的常驻悬浮层（M1-2 触屏属性同上；静态 div 不改
          定位/层叠语义，桌面零变化） */}
      <div className="touch-manipulation select-none">
        <LoadingProgress />
        {/* B5 展馆模式暂停角标（仅 paused 态显示；置于包裹外——作为退出
            入口须不受 uiVisible 影响恒可达，登记） */}
        <KioskBadge />
        {/* B4 启动参数客户 logo（?logo=，右侧 top-64；B5 kiosk 隐藏 UI 时保持显示） */}
        <LaunchLogo />
        <AudioController />
      </div>
    </div>
  );
}
