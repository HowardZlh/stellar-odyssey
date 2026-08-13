'use client';

/**
 * 盛夏双重流星雨实验室场景（M3：星穹 + 流星条痕 + 余迹 + 辐射点标注 +
 * 控件面板；音频/移动端降级随 M4 递进）
 *
 * 比例尺登记（契约 C5）：1 场景单位 = 1 km（独立比例尺，与主场景
 * SCENE_UNITS_PER_AU 无关）；星穹半径 3000；相机漫游半径 0.1–1.5。
 * 轴向约定（契约 C5，防东西镜像）：+Y = 天顶、−Z = 正北、+X = 正东；
 * 方位角 Az 北起经东（N=0°，E=90°）。星穹投影/辐射点/流量链一律经 M1
 * 纯函数（utils/meteorShower.ts），组件内不内联球面公式（契约 C1 只消费）。
 *
 * 渲染架构（§4.1 draw call 预算）：星场 1 + 流星 1 + 余迹 1 = 3 个粒子系统
 * draw call，禁止合并；渲染循环零 attribute 上传、零 buffer 重建——唯一
 * 例外是页签切换流星雨（契约 C2.1：入速不同拟合系数必换，slots useMemo
 * 一次性重建，uTime 同步归零对齐新历元）。
 *
 * 状态流：控件面板（DOM）写 React state → 渲染期同步进 settingsRef →
 * Canvas 子树 useFrame 逐帧读 ref 更新 uniforms（滑杆拖动零场景重渲染）；
 * HUD 由 500 ms interval 经 M1 纯函数读 ref 计算（地方时/辐射点高度角）。
 *
 * 地面剪影登记：暗色圆盘置于 y = −1.7（视觉上与需求 y=0 等价——地平线角
 * 偏差 atan(1.7/3000) ≈ 0.03°）；下沉理由：环顾相机为反转轨道范式（target
 * 固定原点、最低点 y = −1.5），圆盘严格置 y=0 会遮挡整个天空。
 *
 * 触控板手势（方案 A，M2 追加）：双指滚动 = 环顾（wheel deltaX/deltaY 双轴）、
 * 捏合 = FOV 缩放（Chrome/Firefox：wheel+ctrlKey；Safari：gesture* 事件）——
 * 换算/钳制全部下沉 utils/labGestures 纯函数；OrbitControls enableZoom 关闭
 * （视距 dolly 物理上无意义，缩放语义由 FOV 承载）；星穹/流星/余迹三个粒子
 * 系统的像素尺度均乘 fovPointScaleFactor 随 FOV 补偿（默认 FOV 时因子恒 1，
 * 与既有观感逐像素一致）。鼠标滚轮与双指滚动浏览器层不可区分，鼠标 FOV
 * 入口由控件面板滑杆/快捷键补位（M3-5 登记）；三指手势被 macOS 系统占用、
 * 网页层无事件（系统开启「三指拖移」时等效拖拽已生效）。M4 触屏捏合复用
 * 同一 FOV 钳制函数。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { useT } from '@/hooks/useI18n';
import { useYaleBrightStars } from '@/hooks/useYaleBrightStars';
import type { YaleBrightStar } from '@/utils/bakedData';
import { labEntryForId, LAB_PAGE_PATH } from '@/utils/lab';
import {
  CAMERA_RADIUS_MAX_UNITS,
  CAMERA_RADIUS_MIN_UNITS,
  EPOCH_LOCAL_HOURS,
  KAPPA_CYGNIDS,
  METEOR_SLOT_COUNT,
  PERSEIDS,
  STAR_DOME_RADIUS_UNITS,
  equatorialToHorizontalMatrix,
  equatorialUnitVector,
  formatClockHHMM,
  horizontalFromEquatorial,
  localClockHours,
  localSiderealTime,
  makeMeteorSlots,
  sceneDirFromAltAz,
} from '@/utils/meteorShower';
import {
  LAB_FOV_DEFAULT_DEG,
  LAB_POLAR_MAX_RAD,
  LAB_POLAR_MIN_RAD,
  clampLabPolar,
  fovPointScaleFactor,
  pinchFovDeg,
  safariGestureFovDeg,
  wheelLookDelta,
} from '@/utils/labGestures';
import { bvToTeffK, srgbToLinear01 } from '@/utils/pleiadesCatalog';
import { blackbodyRGB } from '@/utils/starPhysics';
import type { MessageKey } from '@/i18n';
import { MeteorField } from '@/components/Lab/MeteorField';
import { AfterglowField } from '@/components/Lab/AfterglowField';
import { RadiantMarker } from '@/components/Lab/RadiantMarker';
import {
  LabControlPanel,
  type LabHudState,
  type MeteorShowerId,
} from '@/components/Lab/LabControlPanel';
import { DEFAULT_LAB_CONTROLS, type LabControlState, type LabFrameRefs } from '@/components/Lab/labTypes';

/** 度 → 弧度（单位换算，非球面公式） */
const DEG = Math.PI / 180;

/** 地面剪影圆盘 y（≈0 视觉等价，实现性下沉登记见文件头） */
const GROUND_DISK_Y_UNITS = -1.7;

/** 流星槽位烘焙种子（确定性，跨会话一致） */
const METEOR_SLOT_SEED = 20260813;

/** 相机初始视线：北偏东 25°、高度角 40°（北极星/仙后座/北斗均在视野可及） */
const INITIAL_VIEW_DIR = sceneDirFromAltAz({ altRad: 40 * DEG, azRad: 25 * DEG });

/** 相机初始轨道半径（场景单位，钳制域 [0.1, 1.5] 内） */
const INITIAL_CAMERA_RADIUS = 1.2;

/** 初始相机位置：反转轨道范式——相机在视线反方向（经原点望向天空） */
const INITIAL_CAMERA_POSITION: [number, number, number] = [
  -INITIAL_VIEW_DIR[0] * INITIAL_CAMERA_RADIUS,
  -INITIAL_VIEW_DIR[1] * INITIAL_CAMERA_RADIUS,
  -INITIAL_VIEW_DIR[2] * INITIAL_CAMERA_RADIUS,
];

/** 辐射点星座名标签键（DOM 层按页签选择；场景组件不订阅 locale） */
const RADIANT_LABEL_KEYS: Record<MeteorShowerId, MessageKey> = {
  perseids: 'lab.radiantLabelPerseids',
  kappaCygnids: 'lab.radiantLabelKappaCygnids',
};

const STAR_DOME_VERTEX_SHADER = /* glsl */ `
  attribute float aMag;
  uniform mat3 uEqToHor;
  uniform float uLimitingMag;
  uniform float uSize;
  uniform float uScale;
  uniform float uDomeRadius;
  varying vec3 vColor;
  void main() {
    // 极限星等剔除：暗于阈值的星直接移出裁剪域（零 fragment 开销）
    if (aMag > uLimitingMag) {
      vColor = vec3(0.0);
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // 赤道系单位向量 → 地平系（CPU 每帧求矩阵，M1 equatorialToHorizontalMatrix）
    vec3 dir = uEqToHor * position;
    vec4 mvPosition = modelViewMatrix * vec4(dir * uDomeRadius, 1.0);
    // 星等 → 尺寸：简单幂律（mag 0 为 uSize 基准）
    float size = uSize * pow(1.32, -aMag);
    gl_PointSize = clamp(size * (uScale / -mvPosition.z), 1.0, 24.0);
    // 星等 → 亮度：半对数压缩 10^(−0.2·mag)，亮星微超 1 供 Bloom 拾取
    float brightness = clamp(pow(10.0, -0.2 * aMag), 0.03, 1.6);
    vColor = color * brightness;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_DOME_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    // 柔边圆形星点（加性混合，Composer 末端统一 ACES）
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = 1.0 - smoothstep(0.2, 0.5, d);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;

/** 场景推进时钟：uTime += delta × timeScale（页签切换由父级归零） */
function LabTimeDriver({ refs }: { refs: LabFrameRefs }): null {
  useFrame((_, delta) => {
    // 钳制 delta 防页签切回时跳帧（uTime 突进 = 流星集体跳相位）
    refs.timeSecRef.current += Math.min(delta, 0.1) * refs.settingsRef.current.timeScale;
  });
  return null;
}

interface StarDomeProps {
  stars: readonly YaleBrightStar[];
  refs: LabFrameRefs;
}

/**
 * 真实星穹（1 draw call）：8,404 颗耶鲁亮星，attribute 初始化一次，
 * 每帧仅更新旋转矩阵/极限星等/像素尺度 uniforms（M3：limitingMag /
 * observerLat / hourOffset / timeScale 控件经 refs 接管，历元随页签切换）。
 */
function StarDome({ stars, refs }: StarDomeProps): JSX.Element {
  const { geometry, material } = useMemo(() => {
    const n = stars.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const mags = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const s = stars[i];
      // 赤道系单位向量（xe = cosδ·cosα 约定，M1 equatorialUnitVector）
      const [xe, ye, ze] = equatorialUnitVector(s.ra, s.dec);
      positions[i * 3] = xe;
      positions[i * 3 + 1] = ye;
      positions[i * 3 + 2] = ze;
      // B−V → Teff（Ballesteros 2012）→ 黑体 RGB（R4-6 表复用，sRGB → 线性）
      const rgb = blackbodyRGB(bvToTeffK(s.bv));
      colors[i * 3] = srgbToLinear01(rgb.r);
      colors[i * 3 + 1] = srgbToLinear01(rgb.g);
      colors[i * 3 + 2] = srgbToLinear01(rgb.b);
      mags[i] = s.mag;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uEqToHor: { value: new THREE.Matrix3() },
        uLimitingMag: { value: DEFAULT_LAB_CONTROLS.limitingMag },
        uSize: { value: 30 },
        uScale: { value: 400 },
        uDomeRadius: { value: STAR_DOME_RADIUS_UNITS },
      },
      vertexShader: STAR_DOME_VERTEX_SHADER,
      fragmentShader: STAR_DOME_FRAGMENT_SHADER,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: geo, material: mat };
  }, [stars]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state) => {
    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    // 点大小随屏幕像素高度衰减（Starfield 同口径）+ FOV 缩放补偿
    // （默认 FOV 时因子恒 1，捏合放大时星点按透视投影因子等比变大）
    material.uniforms.uScale.value =
      state.gl.domElement.height *
      0.5 *
      fovPointScaleFactor((state.camera as THREE.PerspectiveCamera).fov);
    // limitingMag 同时驱动恒星剔除与流量压低（§1.4 自洽联动）
    material.uniforms.uLimitingMag.value = s.limitingMag;
    // 恒星时演化：历元随页签、时长随 timeScale 放大后的共享 uTime
    const lst = localSiderealTime(shower.epochLst0Deg, s.hourOffset, refs.timeSecRef.current / 3600);
    const m = equatorialToHorizontalMatrix(s.observerLat, lst);
    (material.uniforms.uEqToHor.value as THREE.Matrix3).set(...m);
  });

  // 几何包围球是单位球（attribute 为单位向量，真实位置由 shader 放到半径
  // 3000 处），必须关 frustum culling 防止整批被误剔除
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/** Safari 专有捏合手势事件（lib.dom 无类型声明，最小结构接口） */
interface SafariGestureEvent extends Event {
  readonly scale?: number;
}

/**
 * 触控板手势接线（方案 A）：双指滚动 → 环顾、捏合 → FOV 缩放。
 * 换算/钳制走 utils/labGestures 纯函数（组件内零可测业务逻辑）；
 * 监听挂画布元素、非被动（preventDefault 阻止页面缩放/回弹）。
 */
function TrackpadLookControls(): null {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const el = gl.domElement;
    const cam = camera as THREE.PerspectiveCamera;
    const spherical = new THREE.Spherical();
    // Safari 捏合走 gesture*（激活期间忽略 ctrl+wheel 分支防双重缩放）
    let gestureActive = false;
    let gestureStartFovDeg = cam.fov;

    const applyFov = (fovDeg: number): void => {
      cam.fov = fovDeg;
      cam.updateProjectionMatrix();
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // 触控板捏合（Chrome/Firefox/Edge 映射为 wheel+ctrlKey）→ FOV
        if (!gestureActive) applyFov(pinchFovDeg(cam.fov, e.deltaY));
        return;
      }
      // 双指滚动 → 环顾（deltaMode 换行/换页按近似像素预乘）
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const { dThetaRad, dPhiRad } = wheelLookDelta(
        e.deltaX * unit,
        e.deltaY * unit,
        el.clientHeight,
        cam.fov
      );
      if (dThetaRad === 0 && dPhiRad === 0) return;
      // 相机球坐标绕 target（原点）旋转，半径不变；polar 钳制与
      // OrbitControls props 同一事实源（labGestures 常量）
      spherical.setFromVector3(cam.position);
      spherical.theta += dThetaRad;
      spherical.phi = clampLabPolar(spherical.phi + dPhiRad);
      cam.position.setFromSpherical(spherical);
      cam.lookAt(0, 0, 0);
    };

    const onGestureStart = (e: Event): void => {
      e.preventDefault();
      gestureActive = true;
      gestureStartFovDeg = cam.fov;
    };
    const onGestureChange = (e: Event): void => {
      e.preventDefault();
      const scale = (e as SafariGestureEvent).scale;
      if (typeof scale === 'number') {
        applyFov(safariGestureFovDeg(gestureStartFovDeg, scale));
      }
    };
    const onGestureEnd = (e: Event): void => {
      e.preventDefault();
      gestureActive = false;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [camera, gl]);

  return null;
}

/** 地面剪影圆盘（暗色、不透明——遮蔽地平线以下的星，禁止地景细节工作量） */
function GroundDisk(): JSX.Element {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_DISK_Y_UNITS, 0]}>
      <circleGeometry args={[STAR_DOME_RADIUS_UNITS, 96]} />
      <meshBasicMaterial color="#04060a" side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * 实验室场景主组件（`/lab/meteor-shower` 经 next/dynamic ssr:false 挂载）。
 * DOM 覆盖层（返回链接/控件面板/HUD/加载态）订阅 locale；Canvas 子树不订阅
 * （3D 场景 locale 纪律，辐射点星座名走 LabelText 叶组件）。
 */
export function MeteorShowerLab(): JSX.Element {
  const tr = useT();
  const { stars, status } = useYaleBrightStars();
  const entry = labEntryForId('meteor-shower');

  const [showerId, setShowerId] = useState<MeteorShowerId>('perseids');
  const [settings, setSettings] = useState<LabControlState>(DEFAULT_LAB_CONTROLS);
  const [hud, setHud] = useState<LabHudState>({ clockText: '--:--', radiantAltDeg: 0 });

  const shower = showerId === 'perseids' ? PERSEIDS : KAPPA_CYGNIDS;

  // 帧循环共享 refs（渲染期同步赋值：useFrame 读到的永远是最新控件值）
  const timeSecRef = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const showerRef = useRef(shower);
  showerRef.current = shower;
  const refs: LabFrameRefs = useMemo(
    () => ({ timeSecRef, settingsRef, showerRef }),
    []
  );

  // 槽位烘焙：RK4 + 拟合一次性完成；页签切换重建（契约 C2.1 唯一例外路径）
  const slots = useMemo(() => makeMeteorSlots(METEOR_SLOT_SEED, METEOR_SLOT_COUNT, shower), [shower]);

  const handleShowerChange = (id: MeteorShowerId): void => {
    if (id === showerId) return;
    // 换历元：uTime 归零对齐新历元起点（交互事件路径，非每帧）
    timeSecRef.current = 0;
    setShowerId(id);
  };

  // HUD：500 ms 间隔经 M1 纯函数计算（DOM 层，不进 useFrame）
  useEffect(() => {
    const tick = (): void => {
      const s = settingsRef.current;
      const sh = showerRef.current;
      const elapsedHours = timeSecRef.current / 3600;
      const lst = localSiderealTime(sh.epochLst0Deg, s.hourOffset, elapsedHours);
      const radiant = horizontalFromEquatorial(
        sh.radiantRaDeg,
        sh.radiantDecDeg,
        s.observerLat,
        lst
      );
      const clockText = formatClockHHMM(
        localClockHours(EPOCH_LOCAL_HOURS[sh.id], s.hourOffset, elapsedHours)
      );
      const radiantAltDeg = Math.round(radiant.altRad / DEG);
      setHud((prev) =>
        prev.clockText === clockText && prev.radiantAltDeg === radiantAltDeg
          ? prev
          : { clockText, radiantAltDeg }
      );
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="relative h-screen w-screen bg-black">
      <Canvas
        flat
        gl={{ antialias: true }}
        camera={{
          position: INITIAL_CAMERA_POSITION,
          fov: LAB_FOV_DEFAULT_DEG,
          near: 0.05,
          far: STAR_DOME_RADIUS_UNITS * 2.5,
        }}
      >
        <color attach="background" args={['#000004']} />
        <LabTimeDriver refs={refs} />
        {stars && <StarDome stars={stars} refs={refs} />}
        {/* 流星 + 余迹：与星场共 3 个粒子系统 draw call（§4.1，禁止合并） */}
        <MeteorField slots={slots} refs={refs} />
        <AfterglowField slots={slots} refs={refs} />
        {settings.showRadiant && hud.radiantAltDeg > 0 && (
          <RadiantMarker refs={refs} labelKey={RADIANT_LABEL_KEYS[showerId]} />
        )}
        <GroundDisk />
        {/* 环顾式仰视（§2）：target 固定原点、半径钳制 0.1–1.5、禁平移；
            polar 域取 labGestures 常量（与 wheel 环顾钳制同一事实源）——
            视线俯角 ≤20°（不看穿地面）、仰角上限 ≈88°（避开天顶极点奇异）。
            enableZoom 关闭：视距 dolly 无意义（视差 <0.05%），滚轮/捏合语义
            由 TrackpadLookControls 承载（方案 A） */}
        <OrbitControls
          target={[0, 0, 0]}
          minDistance={CAMERA_RADIUS_MIN_UNITS}
          maxDistance={CAMERA_RADIUS_MAX_UNITS}
          enablePan={false}
          enableZoom={false}
          minPolarAngle={LAB_POLAR_MIN_RAD}
          maxPolarAngle={LAB_POLAR_MAX_RAD}
          rotateSpeed={0.45}
          enableDamping
          dampingFactor={0.12}
        />
        <TrackpadLookControls />
        {/* 后期：Bloom + ACES ToneMapping（DevPreviewHarness 同配置；
            火流星末端闪爆 HDR ×15 由 Bloom 拾取，§4.4） */}
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>

      {/* 左上：返回实验室 + 条目标题 */}
      <div className="absolute left-4 top-4 select-none rounded-lg bg-black/60 px-3 py-2 text-xs text-gray-100 backdrop-blur">
        <Link href={LAB_PAGE_PATH} className="text-space-accent hover:underline">
          ← {tr('lab.backToLab')}
        </Link>
        {entry && (
          <div className="mt-1 font-semibold text-sky-300">{tr(entry.titleKey)}</div>
        )}
      </div>

      {/* 右上：控件面板（§3） */}
      <LabControlPanel
        showerId={showerId}
        onShowerChange={handleShowerChange}
        settings={settings}
        onSettingsChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
        hud={hud}
      />

      {/* 底部：操作提示 */}
      <p className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate whitespace-nowrap rounded bg-black/40 px-3 py-1 text-[10px] text-gray-400 backdrop-blur">
        {tr('lab.hintLookAround')}
      </p>

      {/* 亮星星表加载态/失败态覆盖层（场景 chunk 加载提示在路由层） */}
      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-lg bg-black/60 px-4 py-2 text-xs text-gray-300 backdrop-blur">
            {status === 'loading' ? tr('lab.loadingStars') : tr('lab.starsFailed')}
          </p>
        </div>
      )}
    </div>
  );
}

export default MeteorShowerLab;
