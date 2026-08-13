'use client';

/**
 * 盛夏双重流星雨实验室场景（M3：星穹 + 流星条痕 + 余迹 + 辐射点标注 +
 * 控件面板；M3.5：倒计时/快进/演示触发 + 太空视角 + 燃烧层参考 + 跟随视角；
 * 音频/移动端降级随 M4 递进）
 *
 * M3.5 目验辅助（§M3.5，全部为交互事件路径——契约 C2.1 口径，零 buffer 上传）：
 * - 快进（方案 A，时间真实红线）：timeSecRef 直接跳到 nextIgnition 解析解
 *   的真实点燃时刻前 ~1.5 真实秒——时钟/星穹/倒计时自洽前移，不伪造；
 * - 演示（方案 B，时间轴外注入）：pickDemoSlot 选视野内槽位写 demoRef →
 *   uDemoSlot/uDemoStart（shader 演示扩展分支）；页面常显标注文案；
 * - 跟随视角：演示触发联动，FollowCameraRig 每帧经 followCameraPose 写相机
 *   （慢动作 ×0.1 如实显示在滑杆）；烧尽驻留 ~2 s 展示余迹 + 汽化科普提示
 *   （落地成坑禁止实现：彗星质地流星体 80–115 km 完全汽化，科学红线）；
 * - 太空视角：OrbitControls key remount（target 燃烧层中心、半径 150–3000、
 *   polar ≤ π/2 防穿地）+ 燃烧层参考盘（非粒子系统，不占 draw call 预算）。
 *
 * M3.6 增补（§M3.6，全部交互事件路径 + 非粒子 mesh，契约 C2/C2.1 守恒）：
 * - 演示 100% 入画：pickDemoSlot v2 视锥感知（CameraPoseBridge 补
 *   upDir/fovY/aspect），无"全轨迹入画"候选时 AimRig ~0.6 s 球面运镜保底；
 * - 跟随环绕：followOrbitPose 默认纯侧视，FollowOrbitGestures 拖拽环绕
 *   360°/仰角 ±75°、滚轮距离 [0.6, 6] km（labGestures 纯函数换算）；
 * - 真实地球 LabEarth（1:1，太空档/跟随可见）+ 近观头部细节层
 *   MeteorHeadDetail（演示/跟随可见，+1 draw call 登记）。
 *
 * 比例尺登记（契约 C5，M3.6 联动变更）：1 场景单位 = 1 km（独立比例尺，
 * 与主场景 SCENE_UNITS_PER_AU 无关）；星穹半径 10000（原 3000——真实
 * 地球加入后防星点穿地球边缘）；相机漫游半径 0.1–1.5（视差重核
 * 1.5/10000 = 0.015% < 0.05% 红线）。
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
 * 偏差 atan(1.7/10000) ≈ 0.01°）；下沉理由：环顾相机为反转轨道范式（target
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
  AFTERGLOW_FADE_FIREBALL_SEC,
  AIM_DURATION_SEC,
  BURN_LAYER_BOTTOM_KM,
  BURN_LAYER_HORIZONTAL_RADIUS_KM,
  BURN_LAYER_TOP_KM,
  CAMERA_RADIUS_MAX_UNITS,
  CAMERA_RADIUS_MIN_UNITS,
  EPOCH_LOCAL_HOURS,
  FASTFORWARD_LEAD_REAL_SEC,
  FOLLOW_DISTANCE_DEFAULT_KM,
  FOLLOW_LINGER_REAL_SEC,
  FOLLOW_SLOWMO_TIMESCALE,
  KAPPA_CYGNIDS,
  METEOR_SLOT_COUNT,
  PERSEIDS,
  SPACE_CAMERA_PRESET_UNITS,
  SPACE_CAMERA_RADIUS_MAX_UNITS,
  SPACE_CAMERA_RADIUS_MIN_UNITS,
  SPACE_POLAR_MAX_RAD,
  SPACE_VIEW_TARGET_UNITS,
  STAR_DOME_RADIUS_UNITS,
  equatorialToHorizontalMatrix,
  equatorialUnitVector,
  fluxFraction,
  followOrbitPose,
  formatClockHHMM,
  formatDurationClock,
  groundAimPosition,
  horizontalFromEquatorial,
  localClockHours,
  localSiderealTime,
  makeMeteorSlots,
  nextIgnition,
  pickDemoSlot,
  sceneDirFromAltAz,
  spaceAimPosition,
  visibleHourlyRate,
  type MeteorSlot,
  type NextIgnitionEvent,
} from '@/utils/meteorShower';
import {
  LAB_FOV_DEFAULT_DEG,
  LAB_POLAR_MAX_RAD,
  LAB_POLAR_MIN_RAD,
  clampFollowDistance,
  clampFollowElevation,
  clampLabPolar,
  followOrbitDelta,
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
import { MeteorHeadDetail } from '@/components/Lab/MeteorHeadDetail';
import { LabEarth } from '@/components/Lab/LabEarth';
import { RadiantMarker } from '@/components/Lab/RadiantMarker';
import {
  LabControlPanel,
  type LabHudState,
  type MeteorShowerId,
} from '@/components/Lab/LabControlPanel';
import {
  DEFAULT_LAB_CONTROLS,
  type LabAimState,
  type LabCameraPose,
  type LabControlState,
  type LabDemoState,
  type LabFollowState,
  type LabFrameRefs,
  type LabViewMode,
} from '@/components/Lab/labTypes';

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

/**
 * 相机近平面（场景单位，按视角档切换——M3.6-3 深度精度登记）：
 * 地面/跟随档 0.05（近观流星 0.6 km 不裁剪）；太空档 2（真实地球加入后
 * 观察距离达 ~7000 km，near=0.05 时 24-bit 深度在该距离分辨率 ~60 km >
 * 云层高 8 km，会引发表面/云层 z-fighting；near=2 时分辨率 ~1.5 km ✓，
 * 太空档相机距一切目标 ≥150 km，near=2 无可见裁剪）。
 */
const GROUND_CAMERA_NEAR_UNITS = 0.05;
const SPACE_CAMERA_NEAR_UNITS = 2;

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
    // 演示注入过期清除（寿命 + 余迹渐隐窗后恢复该槽位正常调度，M3.5-3）
    const demo = refs.demoRef.current;
    if (demo && refs.timeSecRef.current > demo.expiresAtSec) {
      refs.demoRef.current = null;
    }
  });
  return null;
}

/**
 * 相机位姿桥（M3.5-3 + M3.6-1 视锥扩展）：每帧 mutate cameraPoseRef
 * （勿 setState，零 GC）——DOM 层演示按钮读取喂 pickDemoSlot v2
 * （position/viewDir/upDir/fovY/aspect 构成视锥判定基）。
 */
function CameraPoseBridge({ refs }: { refs: LabFrameRefs }): null {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const pose = refs.cameraPoseRef.current;
    pose.position[0] = camera.position.x;
    pose.position[1] = camera.position.y;
    pose.position[2] = camera.position.z;
    const e = camera.matrixWorld.elements;
    // 视线方向 = 相机 −Z 世界方向（matrixWorld 第 3 列取反）
    pose.viewDir[0] = -e[8];
    pose.viewDir[1] = -e[9];
    pose.viewDir[2] = -e[10];
    // 上方向 = 相机 +Y 世界方向（matrixWorld 第 2 列，M3.6-1）
    pose.upDir[0] = e[4];
    pose.upDir[1] = e[5];
    pose.upDir[2] = e[6];
    const cam = camera as THREE.PerspectiveCamera;
    pose.fovYRad = (cam.fov * Math.PI) / 180;
    pose.aspect = cam.aspect;
  });
  return null;
}

/**
 * 演示自动运镜 rig（M3.6-1，决策 A1）：aimRef 存在时每帧对相机做
 * "方向球面插值 + 半径线性插值"（smoothstep 缓动，~0.6 s），到位后
 * 清除 aimRef 并回调 DOM 层注入演示。运镜期间 OrbitControls 由父级
 * 卸载（防 damping 争抢相机），交互事件路径零 buffer 上传。
 */
function AimRig({
  refs,
  onDone,
}: {
  refs: LabFrameRefs;
  onDone: (slotIndex: number) => void;
}): null {
  const camera = useThree((s) => s.camera);
  // 帧临时向量（挂载期复用，渲染循环零 GC）
  const tmp = useMemo(
    () => ({ from: new THREE.Vector3(), to: new THREE.Vector3(), pos: new THREE.Vector3() }),
    []
  );

  useFrame((_, delta) => {
    const aim = refs.aimRef.current;
    if (!aim) return;
    aim.elapsedSec += delta;
    const k = Math.min(aim.elapsedSec / AIM_DURATION_SEC, 1);
    const ease = k * k * (3 - 2 * k); // smoothstep 缓动（平滑起止）
    tmp.from.set(aim.fromOffset[0], aim.fromOffset[1], aim.fromOffset[2]);
    tmp.to.set(aim.toOffset[0], aim.toOffset[1], aim.toOffset[2]);
    const rFrom = tmp.from.length();
    const rTo = tmp.to.length();
    tmp.from.normalize();
    tmp.to.normalize();
    // 单位方向球面插值（大圆路径；共线退化时直接取终点方向）
    const dot = Math.min(1, Math.max(-1, tmp.from.dot(tmp.to)));
    const angle = Math.acos(dot);
    if (angle > 1e-6) {
      const sinA = Math.sin(angle);
      tmp.pos
        .copy(tmp.from)
        .multiplyScalar(Math.sin((1 - ease) * angle) / sinA)
        .addScaledVector(tmp.to, Math.sin(ease * angle) / sinA);
    } else {
      tmp.pos.copy(tmp.to);
    }
    tmp.pos.multiplyScalar(rFrom + (rTo - rFrom) * ease);
    camera.position.set(
      aim.center[0] + tmp.pos.x,
      aim.center[1] + tmp.pos.y,
      aim.center[2] + tmp.pos.z
    );
    camera.lookAt(aim.center[0], aim.center[1], aim.center[2]);
    if (k >= 1) {
      refs.aimRef.current = null;
      onDone(aim.slotIndex);
    }
  });
  return null;
}

/**
 * 跟随环绕手势（M3.6-2）：跟随期间拖拽 = 绕流星头部环绕（方位 360°
 * 无限制、仰角钳制 ±75°）、滚轮 = 距离缩放（[0.6, 6] km）。换算/钳制
 * 全部走 utils/labGestures 纯函数；环绕参数 mutate followRef（交互事件
 * 路径），FollowCameraRig 每帧消费。仅 followActive 时由父级挂载。
 */
function FollowOrbitGestures({ refs }: { refs: LabFrameRefs }): null {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent): void => {
      if (!refs.followRef.current) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent): void => {
      const follow = refs.followRef.current;
      if (!dragging || !follow) return;
      const { dAzimuthRad, dElevationRad } = followOrbitDelta(
        e.clientX - lastX,
        e.clientY - lastY,
        el.clientHeight
      );
      lastX = e.clientX;
      lastY = e.clientY;
      follow.azimuthRad += dAzimuthRad;
      follow.elevationRad = clampFollowElevation(follow.elevationRad + dElevationRad);
    };
    const onPointerUp = (e: PointerEvent): void => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent): void => {
      const follow = refs.followRef.current;
      if (!follow) return;
      e.preventDefault();
      follow.distanceKm = clampFollowDistance(follow.distanceKm, e.deltaY);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl, refs]);

  return null;
}

/** 按视角档设置相机近平面（深度精度登记见常量注释；幂等，仅变更时重算投影） */
function applyCameraNear(camera: THREE.Camera, nearUnits: number): void {
  const cam = camera as THREE.PerspectiveCamera;
  if (cam.near !== nearUnits) {
    cam.near = nearUnits;
    cam.updateProjectionMatrix();
  }
}

/** 视角档预设机位（切档/跟随结束时相机复位，交互事件路径） */
function applyViewPreset(camera: THREE.Camera, viewMode: LabViewMode): void {
  if (viewMode === 'space') {
    camera.position.set(...SPACE_CAMERA_PRESET_UNITS);
    camera.lookAt(...SPACE_VIEW_TARGET_UNITS);
    applyCameraNear(camera, SPACE_CAMERA_NEAR_UNITS);
  } else {
    camera.position.set(...INITIAL_CAMERA_POSITION);
    camera.lookAt(0, 0, 0);
    applyCameraNear(camera, GROUND_CAMERA_NEAR_UNITS);
  }
}

/** 视角档切换复位：地面 ⇄ 太空时相机置预设机位（初始挂载不动，M3.5-4） */
function ViewModeRig({ viewMode }: { viewMode: LabViewMode }): null {
  const camera = useThree((s) => s.camera);
  const prevRef = useRef(viewMode);
  useEffect(() => {
    if (prevRef.current === viewMode) return;
    prevRef.current = viewMode;
    applyViewPreset(camera, viewMode);
  }, [viewMode, camera]);
  return null;
}

interface FollowCameraRigProps {
  refs: LabFrameRefs;
  slots: readonly MeteorSlot[];
  viewMode: LabViewMode;
  /** 烧尽瞬间回调（一次性：DOM 层弹汽化科普提示） */
  onBurnout: () => void;
  /** 跟随结束回调（还原 timeScale/followActive；相机已由 rig 复位） */
  onEnd: (savedTimeScale: number) => void;
}

/**
 * 跟随视角状态机（M3.5-6 + M3.6-2 环绕升级）：每帧经 followOrbitPose
 * （M1 位移公式 CPU 镜像 + 以头部为中心的环绕正交基）写相机——默认
 * 纯侧视且视线水平，方位/仰角/距离由 FollowOrbitGestures 手势 mutate。
 * 烧尽（elapsed > lifetime，位姿钳制在烧尽点）后驻留 FOLLOW_LINGER_REAL_SEC
 * 真实秒展示余迹，随后自动复位相机到当前视角档预设并回调 DOM 层还原。
 * endRequested（ESC/退出按钮/页签切换）随时中止。跟随期间 OrbitControls
 * 由父级卸载（避免 damping 每帧争抢相机）。
 */
function FollowCameraRig({ refs, slots, viewMode, onBurnout, onEnd }: FollowCameraRigProps): null {
  const camera = useThree((s) => s.camera);
  const lingerSecRef = useRef(0);
  const burnoutSentRef = useRef(false);

  useFrame((_, delta) => {
    const follow = refs.followRef.current;
    if (!follow) return;
    const slot = slots[follow.slotIndex] as MeteorSlot | undefined;

    const end = (): void => {
      refs.followRef.current = null;
      lingerSecRef.current = 0;
      burnoutSentRef.current = false;
      applyViewPreset(camera, viewMode);
      onEnd(follow.savedTimeScale);
    };

    if (!slot || follow.endRequested) {
      end();
      return;
    }

    // 飞行方向与流星系统同帧同式（流量链经 M1 纯函数，= −辐射点方向）
    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    const lst = localSiderealTime(shower.epochLst0Deg, s.hourOffset, refs.timeSecRef.current / 3600);
    const radiant = horizontalFromEquatorial(
      shower.radiantRaDeg,
      shower.radiantDecDeg,
      s.observerLat,
      lst
    );
    const dir = sceneDirFromAltAz(radiant);
    const elapsed = refs.timeSecRef.current - follow.startTimeSec;
    const pose = followOrbitPose(
      slot.startPos,
      slot.dispCoefs,
      slot.lifetimeSec,
      [-dir[0], -dir[1], -dir[2]],
      elapsed,
      follow.azimuthRad,
      follow.elevationRad,
      follow.distanceKm
    );
    // 跟随近观（最近 0.6 km）强制小近平面（太空档进入跟随时自动切换；
    // 幂等函数，结束时 applyViewPreset 按档还原）
    applyCameraNear(camera, GROUND_CAMERA_NEAR_UNITS);
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);

    // 烧尽：驻留展示余迹 + 汽化科普提示（无落地/成坑，科学红线）
    if (elapsed > slot.lifetimeSec) {
      if (!burnoutSentRef.current) {
        burnoutSentRef.current = true;
        onBurnout();
      }
      lingerSecRef.current += delta; // 驻留计时用真实秒（不随 timeScale 缩放）
      if (lingerSecRef.current >= FOLLOW_LINGER_REAL_SEC) end();
    }
  });
  return null;
}

/**
 * 燃烧层参考几何（M3.5-5）：80/115 km 两层低透明度盘面 + 边界环（半径 300），
 * depthWrite:false 防遮星点/流星；仅太空档渲染、面板可开关（默认开）。
 * 非粒子系统，不占 §4.1 的 3 draw call 预算。
 */
function BurnLayerReference(): JSX.Element {
  return (
    <group>
      {[BURN_LAYER_BOTTOM_KM, BURN_LAYER_TOP_KM].map((heightKm) => (
        <group key={heightKm} position={[0, heightKm, 0]} rotation-x={-Math.PI / 2}>
          <mesh>
            <circleGeometry args={[BURN_LAYER_HORIZONTAL_RADIUS_KM, 64]} />
            <meshBasicMaterial
              color="#67e8f9"
              transparent
              opacity={0.05}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <ringGeometry
              args={[BURN_LAYER_HORIZONTAL_RADIUS_KM - 3, BURN_LAYER_HORIZONTAL_RADIUS_KM, 96]}
            />
            <meshBasicMaterial
              color="#67e8f9"
              transparent
              opacity={0.45}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
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
  // 10000 处），必须关 frustum culling 防止整批被误剔除
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
  const [viewMode, setViewMode] = useState<LabViewMode>('ground');
  const [followActive, setFollowActive] = useState(false);
  const [aimActive, setAimActive] = useState(false);
  const [vaporizedVisible, setVaporizedVisible] = useState(false);
  const [hud, setHud] = useState<LabHudState>({
    clockText: '--:--',
    radiantAltDeg: 0,
    nextMeteorText: '—',
    nextFireballText: '—',
  });

  const shower = showerId === 'perseids' ? PERSEIDS : KAPPA_CYGNIDS;

  // 帧循环共享 refs（渲染期同步赋值：useFrame 读到的永远是最新控件值）
  const timeSecRef = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const showerRef = useRef(shower);
  showerRef.current = shower;
  const demoRef = useRef<LabDemoState | null>(null);
  const followRef = useRef<LabFollowState | null>(null);
  const aimRef = useRef<LabAimState | null>(null);
  const cameraPoseRef = useRef<LabCameraPose>({
    position: [...INITIAL_CAMERA_POSITION],
    viewDir: [...INITIAL_VIEW_DIR],
    upDir: [0, 1, 0],
    fovYRad: (LAB_FOV_DEFAULT_DEG * Math.PI) / 180,
    aspect: 16 / 9, // 首帧前占位；CameraPoseBridge 每帧覆写真实值
  });
  const refs: LabFrameRefs = useMemo(
    () => ({ timeSecRef, settingsRef, showerRef, demoRef, followRef, aimRef, cameraPoseRef }),
    []
  );

  // 槽位烘焙：RK4 + 拟合一次性完成；页签切换重建（契约 C2.1 唯一例外路径）
  const slots = useMemo(() => makeMeteorSlots(METEOR_SLOT_SEED, METEOR_SLOT_COUNT, shower), [shower]);

  /** 请求结束跟随（ESC/退出按钮/页签切换；rig 下一帧复原相机后回调还原） */
  const requestFollowEnd = (): void => {
    const follow = followRef.current;
    if (follow) follow.endRequested = true;
  };

  const handleShowerChange = (id: MeteorShowerId): void => {
    if (id === showerId) return;
    // 页签切换强制结束演示/跟随/运镜（新雨槽位拟合系数不同，旧下标失义）
    demoRef.current = null;
    aimRef.current = null;
    setAimActive(false);
    requestFollowEnd();
    setVaporizedVisible(false);
    // 换历元：uTime 归零对齐新历元起点（交互事件路径，非每帧）
    timeSecRef.current = 0;
    setShowerId(id);
  };

  /** 视角档切换：进行中的自动运镜随即取消（目标机位随档失义，M3.6-1） */
  const handleViewModeChange = (mode: LabViewMode): void => {
    if (mode === viewMode) return;
    aimRef.current = null;
    setAimActive(false);
    setViewMode(mode);
  };

  /** 当前时刻流量链快照（快进/倒计时共用，全部 M1/M3.5 纯函数） */
  const fluxSnapshot = (): { fluxFrac: number } => {
    const s = settingsRef.current;
    const sh = showerRef.current;
    const lst = localSiderealTime(sh.epochLst0Deg, s.hourOffset, timeSecRef.current / 3600);
    const radiant = horizontalFromEquatorial(
      sh.radiantRaDeg,
      sh.radiantDecDeg,
      s.observerLat,
      lst
    );
    const hr = visibleHourlyRate(sh.zhr, sh.populationIndex, radiant.altRad, s.limitingMag);
    return { fluxFrac: fluxFraction(hr, slots.length, sh.cyclePeriodSec) };
  };

  /** 快进（方案 A，时间真实）：跳到真实点燃时刻前 ~1.5 真实秒 */
  const handleFastForward = (fireballOnly: boolean): void => {
    const s = settingsRef.current;
    const sh = showerRef.current;
    const now = timeSecRef.current;
    const { fluxFrac } = fluxSnapshot();
    const next = nextIgnition(slots, fluxFrac, s.fireballRate, now, sh.cyclePeriodSec, fireballOnly);
    if (!next) return;
    // lead = 1.5 × max(timeScale, 1) 场景秒 ≈ 1.5 真实秒（timeScale ≥ 1 时）
    const lead = FASTFORWARD_LEAD_REAL_SEC * Math.max(s.timeScale, 1);
    timeSecRef.current = Math.max(now, next.igniteAtSec - lead);
    // timeScale = 0 时快进后自动恢复 ×1（否则画面冻结在点燃前）
    if (s.timeScale === 0) {
      setSettings((prev) => ({ ...prev, timeScale: 1 }));
    }
  };

  /** 演示注入（挑选完成后的实际注入；直接入画与 aim 到位两条路径共用） */
  const injectDemo = (slotIndex: number): void => {
    const s = settingsRef.current;
    const startTimeSec = timeSecRef.current;
    demoRef.current = {
      slotIndex,
      startTimeSec,
      // 过期 = 寿命 + 最长余迹渐隐窗（火流星 10 s）后恢复正常调度
      expiresAtSec: startTimeSec + slots[slotIndex].lifetimeSec + AFTERGLOW_FADE_FIREBALL_SEC,
    };
    setVaporizedVisible(false);
    // timeScale = 0 时自动恢复 ×1（否则演示画面冻结）
    const effectiveTimeScale = s.timeScale === 0 ? 1 : s.timeScale;
    if (s.followOnDemo) {
      followRef.current = {
        slotIndex,
        startTimeSec,
        savedTimeScale: effectiveTimeScale,
        endRequested: false,
        // 环绕参数默认：纯侧视、视线水平、距离 1.5 km（M3.6-2；退出不保留）
        azimuthRad: 0,
        elevationRad: 0,
        distanceKm: FOLLOW_DISTANCE_DEFAULT_KM,
      };
      setFollowActive(true);
      // 慢动作 ×0.1（timeScale 本为用户控件，滑杆如实显示，非时间伪造）
      setSettings((prev) => ({ ...prev, timeScale: FOLLOW_SLOWMO_TIMESCALE }));
    } else if (s.timeScale === 0) {
      setSettings((prev) => ({ ...prev, timeScale: 1 }));
    }
  };

  /**
   * 演示触发（方案 B，时间轴外注入 + M3.6-1 100% 入画保障）：
   * pickDemoSlot v2 视锥感知挑选——有"全轨迹入画"候选立即注入；无候选
   * 时写 aimRef 启动 ~0.6 s 自动运镜（AimRig 球面插值到 aim 目标机位后
   * 经 handleAimDone 注入），运镜期间演示/快进按钮禁用。
   */
  const handleDemo = (fireballOnly: boolean): void => {
    if (followRef.current || aimRef.current) return;
    const s = settingsRef.current;
    const sh = showerRef.current;
    const pose = cameraPoseRef.current;
    const lst = localSiderealTime(sh.epochLst0Deg, s.hourOffset, timeSecRef.current / 3600);
    const radiant = horizontalFromEquatorial(
      sh.radiantRaDeg,
      sh.radiantDecDeg,
      s.observerLat,
      lst
    );
    const dir = sceneDirFromAltAz(radiant);
    const pick = pickDemoSlot(slots, [-dir[0], -dir[1], -dir[2]], pose, fireballOnly);
    if (!pick) return;
    if (!pick.needsAim) {
      injectDemo(pick.slotIndex);
      return;
    }
    // 自动运镜保底（决策 A1）：目标机位 = 两档 aim 纯函数（保持当前轨道半径/距离）
    const center: [number, number, number] =
      viewMode === 'ground' ? [0, 0, 0] : [...SPACE_VIEW_TARGET_UNITS];
    const fromOffset: [number, number, number] = [
      pose.position[0] - center[0],
      pose.position[1] - center[1],
      pose.position[2] - center[2],
    ];
    const radius = Math.hypot(fromOffset[0], fromOffset[1], fromOffset[2]);
    if (!(radius > 0)) return; // 相机与轨道中心重合（防御，正常不可达）
    const aimPos =
      viewMode === 'ground'
        ? groundAimPosition(pick.midPoint, radius)
        : spaceAimPosition(pick.midPoint, center, radius);
    aimRef.current = {
      slotIndex: pick.slotIndex,
      center,
      fromOffset,
      toOffset: [aimPos[0] - center[0], aimPos[1] - center[1], aimPos[2] - center[2]],
      elapsedSec: 0,
    };
    setAimActive(true);
  };

  /** 自动运镜到位（AimRig 回调）：注入演示并恢复按钮/OrbitControls */
  const handleAimDone = (slotIndex: number): void => {
    setAimActive(false);
    injectDemo(slotIndex);
  };

  /** 跟随结束（rig 已复位相机）：还原 timeScale 与 OrbitControls 挂载 */
  const handleFollowEnd = (savedTimeScale: number): void => {
    setFollowActive(false);
    setSettings((prev) => ({ ...prev, timeScale: savedTimeScale }));
  };

  /** 烧尽：汽化科普提示（落地成坑禁止实现——科学准确性红线） */
  const handleBurnout = (): void => {
    setVaporizedVisible(true);
  };

  // ESC 退出跟随
  useEffect(() => {
    if (!followActive) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestFollowEnd();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [followActive]);

  // 汽化提示自动隐藏（跟随驻留 2 s + 返回后短暂驻留供阅读）
  useEffect(() => {
    if (!vaporizedVisible) return;
    const id = window.setTimeout(() => setVaporizedVisible(false), 6000);
    return () => window.clearTimeout(id);
  }, [vaporizedVisible]);

  // HUD：500 ms 间隔经 M1/M3.5 纯函数计算（DOM 层，不进 useFrame；
  // 倒计时 = (igniteAt − uTime)/timeScale 折算真实秒，时间真实性红线）
  useEffect(() => {
    const tick = (): void => {
      const s = settingsRef.current;
      const sh = showerRef.current;
      const nowSec = timeSecRef.current;
      const elapsedHours = nowSec / 3600;
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
      const hr = visibleHourlyRate(sh.zhr, sh.populationIndex, radiant.altRad, s.limitingMag);
      const fluxFrac = fluxFraction(hr, slots.length, sh.cyclePeriodSec);
      const countdown = (next: NextIgnitionEvent | null): string =>
        s.timeScale > 0 && next
          ? formatDurationClock((next.igniteAtSec - nowSec) / s.timeScale)
          : '—';
      const nextMeteorText = countdown(
        nextIgnition(slots, fluxFrac, s.fireballRate, nowSec, sh.cyclePeriodSec, false)
      );
      const nextFireballText = countdown(
        nextIgnition(slots, fluxFrac, s.fireballRate, nowSec, sh.cyclePeriodSec, true)
      );
      setHud((prev) =>
        prev.clockText === clockText &&
        prev.radiantAltDeg === radiantAltDeg &&
        prev.nextMeteorText === nextMeteorText &&
        prev.nextFireballText === nextFireballText
          ? prev
          : { clockText, radiantAltDeg, nextMeteorText, nextFireballText }
      );
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [slots]);

  return (
    <div className="relative h-screen w-screen bg-black">
      <Canvas
        flat
        gl={{ antialias: true }}
        camera={{
          position: INITIAL_CAMERA_POSITION,
          fov: LAB_FOV_DEFAULT_DEG,
          near: GROUND_CAMERA_NEAR_UNITS,
          far: STAR_DOME_RADIUS_UNITS * 2.5,
        }}
      >
        <color attach="background" args={['#000004']} />
        <LabTimeDriver refs={refs} />
        <CameraPoseBridge refs={refs} />
        <ViewModeRig viewMode={viewMode} />
        <AimRig refs={refs} onDone={handleAimDone} />
        <FollowCameraRig
          refs={refs}
          slots={slots}
          viewMode={viewMode}
          onBurnout={handleBurnout}
          onEnd={handleFollowEnd}
        />
        {followActive && <FollowOrbitGestures refs={refs} />}
        {stars && <StarDome stars={stars} refs={refs} />}
        {/* 流星 + 余迹：与星场共 3 个粒子系统 draw call（§4.1，禁止合并） */}
        <MeteorField slots={slots} refs={refs} />
        <AfterglowField slots={slots} refs={refs} />
        {/* 近观头部细节层（M3.6-4③）：常驻挂载、仅演示/跟随期间 visible
            （+1 draw call 登记——"行星近观 4K 细节层"的流星对应物） */}
        <MeteorHeadDetail slots={slots} refs={refs} />
        {settings.showRadiant && hud.radiantAltDeg > 0 && (
          <RadiantMarker refs={refs} labelKey={RADIANT_LABEL_KEYS[showerId]} />
        )}
        {/* 燃烧层参考盘（M3.5-5）：仅太空档 + 开关（默认开）；非粒子系统 */}
        {viewMode === 'space' && settings.showBurnLayer && <BurnLayerReference />}
        {/* 真实地球（M3.6-3）：常驻挂载 + visible 门控（太空档/跟随期间可见；
            纹理页面挂载即低优先级预载，切档零等待） */}
        <LabEarth refs={refs} visible={viewMode === 'space' || followActive} />
        {/* 地面剪影盘：仅地面档且非跟随（贴地曲率不可辨；跟随期间隐藏防
            平面盘遮挡真实地球夜面——M3.6-3 登记差异） */}
        {viewMode === 'ground' && !followActive && <GroundDisk />}
        {/* 相机控制（跟随/自动运镜期间整体卸载，防 damping 与
            FollowCameraRig/AimRig 争抢相机；结束时相机已就位，重挂载的
            OrbitControls 从当前位姿接管）。
            地面档（§2）：环顾式仰视——target 原点、半径 0.1–1.5、禁平移；
            polar 域取 labGestures 常量（与 wheel 环顾钳制同一事实源）；
            enableZoom 关闭（视差 <0.05%，缩放语义由 TrackpadLookControls FOV 承载）。
            太空档（M3.5-4，key remount）：target 燃烧层中心 (0,97,0)、半径
            150–3000（M3.6 决策 D：拉远可见完整地平弧）、polar ≤ π/2 防穿地；
            滚轮 dolly 缩放距离。 */}
        {!followActive &&
          !aimActive &&
          (viewMode === 'ground' ? (
            <OrbitControls
              key="ground"
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
          ) : (
            <OrbitControls
              key="space"
              target={[SPACE_VIEW_TARGET_UNITS[0], SPACE_VIEW_TARGET_UNITS[1], SPACE_VIEW_TARGET_UNITS[2]]}
              minDistance={SPACE_CAMERA_RADIUS_MIN_UNITS}
              maxDistance={SPACE_CAMERA_RADIUS_MAX_UNITS}
              enablePan={false}
              enableZoom
              minPolarAngle={0.05}
              maxPolarAngle={SPACE_POLAR_MAX_RAD}
              rotateSpeed={0.6}
              enableDamping
              dampingFactor={0.12}
            />
          ))}
        {viewMode === 'ground' && !followActive && !aimActive && <TrackpadLookControls />}
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

      {/* 右上：控件面板（§3 + §M3.5） */}
      <LabControlPanel
        showerId={showerId}
        onShowerChange={handleShowerChange}
        settings={settings}
        onSettingsChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
        hud={hud}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onFastForward={handleFastForward}
        onDemo={handleDemo}
        followActive={followActive}
        aimActive={aimActive}
      />

      {/* 跟随视角：退出按钮（ESC 等价，§M3.5-6） */}
      {followActive && (
        <button
          onClick={requestFollowEnd}
          className="absolute bottom-14 left-1/2 -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-xs text-sky-200 backdrop-blur transition-colors hover:bg-black/85"
        >
          {tr('lab.followExit')}
        </button>
      )}

      {/* 汽化科普提示（烧尽点收尾——彗星流星体不落地，科学红线） */}
      {vaporizedVisible && (
        <p className="pointer-events-none absolute bottom-24 left-1/2 max-w-md -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-center text-xs leading-relaxed text-emerald-200 backdrop-blur">
          {tr('lab.vaporizedToast')}
        </p>
      )}

      {/* 底部：操作提示（按视角档切换） */}
      <p className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate whitespace-nowrap rounded bg-black/40 px-3 py-1 text-[10px] text-gray-400 backdrop-blur">
        {viewMode === 'space' ? tr('lab.hintSpace') : tr('lab.hintLookAround')}
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
