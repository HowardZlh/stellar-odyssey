'use client';

/**
 * 日全食实验室场景（E 迭代 M2+M3：地面视角全量——全食核心景观六件套 +
 * 曝光状态机 + 360° 暮光 + 控件全量；太空视角随 M4、Eddington 叙事随 M5、
 * 音频/移动端随 M6 递进）
 *
 * 状态流红线（§3.1）：「事件时间轴秒 tSec」为单值状态源——一切效果由 tSec
 * 经纯函数（utils/solarEclipseLab + 契约 C1 函数族）逐帧重建，禁止帧间累积
 * 效果状态（scrubber 任意 seek 的前提；日冕/针状体噪声相位取事件种子静态
 * 冻结——真实日冕结构在小时尺度上静止）。DOM 控件写 React state → 渲染期
 * 同步 ref → Canvas 子树 useFrame 读 ref 更 uniform（流星雨范式）；
 * HUD 由 500ms interval 经纯函数读 ref 计算。
 *
 * 场景空间（契约 C4）：1 场景单位 = 1 km，+Y 天顶、−Z 正北、+X 正东，
 * 观测者在原点（食甚中心线固定观测点），反转轨道相机。日月画在天穹壳
 * （10,000 km）billboard quad 上，quad 内按**真实视半径**绘制（不做几何
 * 放大）；「看不清 0.5° 小盘」由 FOV 缩放解决 + HUD 常显视直径/食分/遮挡率。
 *
 * M3 合成 quad 五层序（§4.2，全部 shader 解析绘制——禁止粒子红线）：
 * 1 日冕（sunSurface.coronaIntensity 函数族 GLSL 镜像，isotropy01 接太阳
 * 活动周滑杆）→ 2 色球红环（chromosphereRimAlpha + spiculeRimPerturbation
 * 镜像；月盘遮罩几何使其只在 C2 后/C3 前月缘未及壳层的一侧一闪）→ 3 日珥
 * 剪影（2–4 处事件种子固定方位，A6 登记）→ 4 光球盘（临边昏暗 × 曝光
 * 增益）→ 5 贝利珠（LOLA 月缘剖面 1D DataTexture 静态查表 +
 * beadsLeakProfile 同式 GLSL；珠数收敛至 1 即钻石环——Bloom 自然成环，
 * 不加十字星芒）。渲染循环零 buffer 更新：逐帧只动标量/vec2 uniform。
 *
 * 曝光状态机（契约 C5）：filtered/naked-eye 双基准 + 连续滑杆；自动档
 * autoExposure01 在 C2/C3 跨越时 2s 平滑切换（贝利珠时段提前就位）。
 * photoGain 驱动光球 HDR（filtered 0.55 不过曝 → naked-eye ×15 溢出泛光），
 * coronaGain 驱动日冕/色球/日珥（filtered 恰 0），starGain 驱动星穹与
 * 行星标记（暗弱天体层）；环境天空/地景亮度由 eclipseSkyDarkening 感知链
 * 独立承载（filtered 不压暗白昼天空——§1.4「99% 仍近白天」验收前提）。
 *
 * 360° 暮光（§1.4，M3-CP 专项）：EclipseSkyDome 按 totalityImmersion01
 * 混向「环地平线橙带 + 天顶深蓝」梯度（方位无关——本影外一圈仍是白天）；
 * 星穹极限星等接 eclipseSkyDarkening 链渐显；金/木/水/火按事件历元
 * physics.heliocentricPosition 真实方位投天穹挂标签。
 *
 * 渲染架构（§4.1）：StarDome 1 + SkyDome 1 + 日月 quad 1 + 地面 1 + 山脊 1
 * + 树影贴花 1 + 行星标记 ≤4 = ≤10 draw call ≤ 15 预算；影带为屏幕空间
 * pass（EclipseShadowBands，时段门控挂载/卸载零开销，A7 登记）。
 *
 * CPU/GLSL 镜像纪律：sunSurface/solarActivity/solarEclipse 公式经模板注入
 * 常量照抄，不得变形、不改源文件；主场景零改动。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { useT } from '@/hooks/useI18n';
import { useYaleBrightStars } from '@/hooks/useYaleBrightStars';
import { useSolarEclipses } from '@/hooks/useSolarEclipses';
import { useLunarLimbProfile } from '@/hooks/useLunarLimbProfile';
import type { SolarEclipseEventData, YaleBrightStar } from '@/utils/bakedData';
import type { MessageKey } from '@/i18n';
import { labEntryForId, LAB_PAGE_PATH } from '@/utils/lab';
import { PLANETS } from '@/data/planets';
import {
  CAMERA_RADIUS_MAX_UNITS,
  CAMERA_RADIUS_MIN_UNITS,
  STAR_DOME_RADIUS_UNITS,
  equatorialToHorizontalMatrix,
  equatorialUnitVector,
  horizontalFromEquatorial,
  labQualityParams,
  labQualityTier,
  sceneDirFromAltAz,
  type LabQualityParams,
} from '@/utils/meteorShower';
import {
  LAB_FOV_DEFAULT_DEG,
  LAB_POLAR_MAX_RAD,
  LAB_POLAR_MIN_RAD,
  fovPointScaleFactor,
} from '@/utils/labGestures';
import {
  RIDGE_DARKEN_FACTOR,
  RIDGE_RADIUS_KM,
  RIDGE_SEGMENTS,
  SKY_DOME_RADIUS_FACTOR,
  emptyLabSkyColors,
  labGroundColor,
  labSkyColors,
  ridgeHeightProfile,
} from '@/utils/labSky';
import { bvToTeffK, srgbToLinear01 } from '@/utils/pleiadesCatalog';
import { blackbodyRGB } from '@/utils/starPhysics';
import {
  CHROMOSPHERE_COLOR,
  CHROMOSPHERE_FRESNEL_POWER,
  CHROMOSPHERE_MAX_ALPHA,
  CHROMOSPHERE_SHELL_SCALE,
  CORONAL_HOLE_DIR,
  CORONAL_HOLE_MIN_BRIGHTNESS,
  CORONAL_HOLE_RADIUS_RAD,
  CORONA_COLOR,
  CORONA_FALLOFF_K,
  CORONA_STREAMER_FREQ,
  HELMET_STREAMER_SHARPNESS,
  POLAR_PLUME_CONE_RAD,
  POLAR_PLUME_FREQ,
  POLAR_PLUME_GAIN,
  SPICULE_AMP,
  SPICULE_NOISE_FREQ,
  SUN_LIMB_DARKENING_U,
} from '@/utils/sunSurface';
import { PROMINENCE_FIBRIL_FREQ } from '@/utils/solarActivity';
import {
  LIMB_PROFILE_SAMPLE_COUNT,
  MOON_MEAN_RADIUS_KM,
  SKY_SHELL_RADIUS_KM,
} from '@/utils/solarEclipse';
import {
  ECLIPSE_PLANETS,
  ECLIPSE_QUAD_HALF_ANGLE_RAD,
  EXPOSURE_FILTERED_PHOTO_GAIN,
  EXPOSURE_FILTERED_STAR_GAIN,
  TWILIGHT_RING_BAND_POW,
  TWILIGHT_RING_HORIZON_RGB,
  TWILIGHT_RING_ZENITH_RGB,
  activePhaseCardKey,
  autoExposure01,
  beadsHighlightWindows,
  eclipseEventSeed,
  eclipseFrameState,
  eclipsePlayRate,
  eclipseProminences,
  eclipseTempDropC,
  eclipseTimelineWindow,
  emptyEclipseExposureUniforms,
  emptyEclipseFrameState,
  exposureUniforms,
  formatAngularDiameterDeg,
  formatUtcClock,
  hypotheticalFrameState,
  limbTexRotationRad,
  lstRadFromUnixSec,
  obscurationCrossingTimeSec,
  planetGeocentricEquatorial,
  shadowBandsStrength01,
  solarEclipseAnchors,
  totalityImmersion01,
  type EclipseExposureUniforms,
  type EclipseFrameState,
  type EclipsePhaseCardKey,
  type EclipseProminence,
  type EclipseTimelineAnchor,
  type EclipseTimelineWindow,
  type EquatorialPos,
} from '@/utils/solarEclipseLab';
import {
  MOON_ORBIT_INCLINATION_DEG,
  INCLINATION_DISPLAY_FACTOR,
  NARRATIVE_ORBIT_RADIUS_KM,
  SPACE_CAMERA_FAR_UNITS,
  SPACE_CAMERA_NEAR_UNITS,
  SPACE_CAMERA_RADIUS_MAX_UNITS,
  SPACE_CAMERA_RADIUS_MIN_UNITS,
  VIEW_TRANSITION_SEC,
  emptyEclipseSpaceFrameState,
  groundIntroAim,
  narrativeAngles,
  narrativeMoonPosKm,
  spaceFrameState,
  spaceIntroPose,
  umbraGroundSpeedKmh,
  type EclipseSpaceFrameState,
  type MutableVec3,
  type NarrativeAngles,
  type ViewIntroPose,
} from '@/utils/solarEclipseSpace';
import { EclipseSpaceView } from '@/components/Lab/EclipseSpaceView';
import { TrackpadLookControls } from '@/components/Lab/TrackpadLookControls';
import { EclipseTimelineScrubber } from '@/components/Lab/EclipseTimelineScrubber';
import {
  EclipseControlPanel,
  type EclipseEnvReadout,
  type EclipseM3Settings,
} from '@/components/Lab/EclipseControlPanel';
import { EclipseShadowBandsPass } from '@/components/Lab/EclipseShadowBands';
import { LabelText } from '@/components/Scene/LocalizedLabelText';

/** 度 → 弧度（单位换算，非球面公式） */
const DEG = Math.PI / 180;

/** 地面剪影圆盘 y（流星雨同款登记：视觉上与 y=0 等价，防遮挡天空） */
const GROUND_DISK_Y_UNITS = -1.7;

/** 相机初始轨道半径（场景单位，钳制域 [0.1, 1.5] 内；流星雨同值） */
const INITIAL_CAMERA_RADIUS = 1.2;

/** 山脊剖面烘焙种子（确定性；与流星雨异种子——地景剪影独立） */
const ECLIPSE_RIDGE_SEED = 0xec1b5e;

/** 事件 id 联合（契约 C2） */
type EclipseEventId = SolarEclipseEventData['id'];

/** 事件页签（§3.5：标题含日期与地点；观测点说明键随页签切换） */
const ECLIPSE_TABS: ReadonlyArray<{
  id: EclipseEventId;
  labelKey: MessageKey;
  observerKey: MessageKey;
}> = [
  { id: 'e2027', labelKey: 'lab.eclipseTab2027', observerKey: 'lab.eclipseObserver2027' },
  { id: 'e2035', labelKey: 'lab.eclipseTab2035', observerKey: 'lab.eclipseObserver2035' },
  { id: 'e1919', labelKey: 'lab.eclipseTab1919', observerKey: 'lab.eclipseObserver1919' },
];

/** 逐帧渲染派生状态（曝光增益组 + 全食沉浸/倍速/影带包络；驱动器每帧重建） */
interface EclipseRenderState extends EclipseExposureUniforms {
  /** 当前曝光插值（0 filtered ↔ 1 naked-eye；HUD/调试可读） */
  exposure01: number;
  /** 全食沉浸因子（totalityImmersion01；360° 暮光带混合权重） */
  twilight01: number;
  /** 当前播放倍率（A1 登记：HUD 常显） */
  rateNow: number;
  /** 影带强度包络（shadowBandsStrength01；pass 帧读） */
  bands01: number;
}

/** 空渲染派生状态（挂载期分配一次零 GC） */
function emptyEclipseRenderState(): EclipseRenderState {
  return {
    ...emptyEclipseExposureUniforms(),
    exposure01: 0,
    twilight01: 0,
    rateNow: 1,
    bands01: 0,
  };
}

/** 帧循环共享 refs（DOM 写入、Canvas 子树 useFrame 读取；场景不订阅 React 状态） */
interface EclipseFrameRefs {
  /** 事件时间轴秒（UTC；单值状态源） */
  tSecRef: { current: number };
  /** 播放中 */
  playingRef: { current: boolean };
  /** 当前事件 + 时间窗（渲染期同步；页签切换即更新） */
  eventRef: { current: { event: SolarEclipseEventData; window: EclipseTimelineWindow } };
  /** 逐帧状态（EclipseTimeDriver 每帧重建，各叶组件只读；挂载期分配一次零 GC） */
  frameRef: { current: EclipseFrameState };
  /** M3 控件状态（React state 渲染期同步；useFrame 只读） */
  settingsRef: { current: EclipseM3Settings };
  /** M3 渲染派生状态（驱动器每帧重建；各叶组件只读） */
  renderRef: { current: EclipseRenderState };
  /** M4 太空视角逐帧状态（驱动器在太空档每帧重建；EclipseSpaceView 只读） */
  spaceRef: { current: EclipseSpaceFrameState };
}

/** 倾角叙事显示倾角（弧度；A5 登记：真实 5.145° × 显示倍率） */
const NARRATIVE_INC_RAD = MOON_ORBIT_INCLINATION_DEG * INCLINATION_DISPLAY_FACTOR * DEG;

/**
 * 时间轴推进 + 逐帧状态重建（首个 Canvas 子组件，同优先级 useFrame 按挂载序
 * 先行）：播放时 tSec += delta（钳制 0.1s 防页签切回跳帧）× 播放模式倍率
 * （导览变速/×1，A1 登记）；到窗口末端自动暂停（onEnded 交互回调）。
 * 随后由 tSec 单值重建 frameRef（真实路径纯查表 / 假想路径 geo 重算）与
 * renderRef（曝光状态机 + 暮光/影带包络）。假想模式与真实时间轴互斥
 * （§3.3）：hypoActive 时不推进播放。
 */
function EclipseTimeDriver({
  refs,
  onEnded,
}: {
  refs: EclipseFrameRefs;
  onEnded: () => void;
}): null {
  // M4 倾角叙事草稿（挂载期分配一次；渲染循环零 GC）
  const narrative = useMemo(
    () => ({
      angles: { phaseRad: 0, nodeRad: 0 } as NarrativeAngles,
      posKm: [0, 0, 0] as MutableVec3,
    }),
    []
  );
  useFrame((_, delta) => {
    const { window: win, event } = refs.eventRef.current;
    const s = refs.settingsRef.current;
    const rate = eclipsePlayRate(s.playMode, refs.tSecRef.current, event.contacts);
    if (refs.playingRef.current && !s.hypoActive) {
      const next = refs.tSecRef.current + Math.min(delta, 0.1) * rate;
      if (next >= win.endSec) {
        refs.tSecRef.current = win.endSec;
        onEnded();
      } else {
        refs.tSecRef.current = next;
      }
    }
    const tSec = refs.tSecRef.current;
    const frame = s.hypoActive
      ? hypotheticalFrameState(event, tSec, s.hypoMoonDistKm, refs.frameRef.current)
      : eclipseFrameState(event, tSec, refs.frameRef.current);
    // M4 太空视角帧状态（geo 星历 → 真锥/足印/姿态；只在太空档重建。
    // 倾角叙事时月球位置改走夸张倾角轨道（A5）；假想模式沿地心方向改写
    // 月距——太空档为真物理路径，与地面档口径差异已在 M3 差异登记）
    if (s.viewMode === 'space') {
      let narrativePos: MutableVec3 | null = null;
      if (s.inclinationDemo) {
        narrativeAngles(tSec, win.startSec, narrative.angles);
        narrativeMoonPosKm(
          narrative.angles.phaseRad,
          narrative.angles.nodeRad,
          NARRATIVE_INC_RAD,
          NARRATIVE_ORBIT_RADIUS_KM,
          narrative.posKm
        );
        narrativePos = narrative.posKm;
      }
      spaceFrameState(
        event.geo,
        tSec,
        s.hypoActive ? s.hypoMoonDistKm : null,
        narrativePos,
        refs.spaceRef.current
      );
    }
    const r = refs.renderRef.current;
    // 曝光状态机（契约 C5）：自动档真实路径走 C2/C3 时刻曲线；假想路径无
    // 权威接触时刻，以遮挡率沉浸因子替代（环食恒 filtered、全食恒 naked-eye）
    r.exposure01 =
      s.exposureMode === 'manual'
        ? s.exposureManual01
        : s.hypoActive
          ? totalityImmersion01(frame.obscuration01)
          : autoExposure01(tSec, event.contacts);
    exposureUniforms(r.exposure01, r);
    r.twilight01 = totalityImmersion01(frame.obscuration01);
    r.rateNow = rate;
    r.bands01 = s.hypoActive ? 0 : shadowBandsStrength01(tSec, event.contacts);
  });
  return null;
}

/** 页签切换相机指向：对准当前 tSec 的太阳方向（反转轨道范式，交互事件路径） */
function EclipseCameraAim({ refs, eventId }: { refs: EclipseFrameRefs; eventId: string }): null {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    // 太空档不接管相机（页签切换保持太空机位；回地面由运镜 rig 对准）
    if (refs.settingsRef.current.viewMode !== 'ground') return;
    const { event } = refs.eventRef.current;
    const frame = eclipseFrameState(event, refs.tSecRef.current);
    const dir = sceneDirFromAltAz({ altRad: frame.sunAltDeg * DEG, azRad: frame.sunAzDeg * DEG });
    camera.position.set(
      -dir[0] * INITIAL_CAMERA_RADIUS,
      -dir[1] * INITIAL_CAMERA_RADIUS,
      -dir[2] * INITIAL_CAMERA_RADIUS
    );
    camera.lookAt(0, 0, 0);
    // eventId 为依赖：页签切换重新对准新事件太阳
  }, [camera, refs, eventId]);
  return null;
}

/**
 * 视角切换运镜 rig（§M4-3；captureViewTransition 手法参考——from/to 姿态
 * smoothstep 插值 1.6s，实现独立于主场景 CameraController）：
 * - 切太空：沿太阳方向自远滑入 DSCOVR 式日侧机位（绕 Y 横摆弧线）；
 * - 切地面：视线自太阳上方压回太阳 + FOV 广角收束（反转轨道范式）；
 * - 近/远平面按档切换（MeteorShowerLab M3.6-3 深度精度登记同手法：
 *   太空档 near=0.5 单位（500 km）——near=0.05 时远机位深度分辨率
 *   ~0.4 单位 > 大气壳 0.12，会 z-fighting；near=0.5 时 ~0.04 ✓，
 *   太空档相机距地表 ≥1.6 单位无裁剪）；
 * - 运镜期间 OrbitControls 卸载（父级 gate），完成后重挂从当前位姿接管。
 */
function EclipseViewIntroRig({
  refs,
  active,
  onDone,
}: {
  refs: EclipseFrameRefs;
  active: boolean;
  onDone: () => void;
}): null {
  const camera = useThree((s) => s.camera);
  const elapsedRef = useRef(0);
  const doneRef = useRef(false);
  const scratch = useMemo(
    () => ({
      pose: { pos: [0, 0, 0] as MutableVec3, fovDeg: LAB_FOV_DEFAULT_DEG } as ViewIntroPose,
      aim: { altDeg: 0, azDeg: 0, fovDeg: LAB_FOV_DEFAULT_DEG },
    }),
    []
  );

  // 激活即复位计时 + 按目标档切近/远平面（一次性投影参数，交互事件路径）
  useEffect(() => {
    if (!active) return;
    elapsedRef.current = 0;
    doneRef.current = false;
    const pc = camera as THREE.PerspectiveCamera;
    if (refs.settingsRef.current.viewMode === 'space') {
      pc.near = SPACE_CAMERA_NEAR_UNITS;
      pc.far = SPACE_CAMERA_FAR_UNITS;
    } else {
      pc.near = 0.05;
      pc.far = STAR_DOME_RADIUS_UNITS * 2.5;
    }
    pc.updateProjectionMatrix();
  }, [active, camera, refs]);

  useFrame((_, delta) => {
    if (!active || doneRef.current) return;
    elapsedRef.current += Math.min(delta, 0.1);
    const t01 = Math.min(1, elapsedRef.current / VIEW_TRANSITION_SEC);
    const pc = camera as THREE.PerspectiveCamera;
    if (refs.settingsRef.current.viewMode === 'space') {
      spaceIntroPose(refs.spaceRef.current.sunDirScene, t01, scratch.pose);
      pc.position.set(scratch.pose.pos[0], scratch.pose.pos[1], scratch.pose.pos[2]);
      pc.fov = scratch.pose.fovDeg;
    } else {
      const frame = refs.frameRef.current;
      groundIntroAim(frame.sunAltDeg, frame.sunAzDeg, t01, scratch.aim);
      const dir = sceneDirFromAltAz({
        altRad: scratch.aim.altDeg * DEG,
        azRad: scratch.aim.azDeg * DEG,
      });
      pc.position.set(
        -dir[0] * INITIAL_CAMERA_RADIUS,
        -dir[1] * INITIAL_CAMERA_RADIUS,
        -dir[2] * INITIAL_CAMERA_RADIUS
      );
      pc.fov = scratch.aim.fovDeg;
    }
    pc.lookAt(0, 0, 0);
    pc.updateProjectionMatrix();
    if (t01 >= 1) {
      doneRef.current = true;
      onDone();
    }
  });
  return null;
}

// ---------------------------------------------------------------------------
// 天穹叶组件（流星雨同范式扩展；每帧只写 uniforms/材质色，零 buffer 更新）
// ---------------------------------------------------------------------------

const ECLIPSE_STAR_VERTEX_SHADER = /* glsl */ `
  attribute float aMag;
  uniform mat3 uEqToHor;
  uniform float uLimitingMag;
  uniform float uSize;
  uniform float uScale;
  uniform float uDomeRadius;
  uniform float uPointMax;
  uniform float uGain;
  varying vec3 vColor;
  void main() {
    // 极限星等剔除：白昼 lm=−4 时全部剔除（零 fragment 开销）；
    // 近全食经 eclipseSkyDarkening 抬升 lm 后渐显（M3 专项目验）
    if (aMag > uLimitingMag) {
      vColor = vec3(0.0);
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 dir = uEqToHor * position;
    vec4 mvPosition = modelViewMatrix * vec4(dir * uDomeRadius, 1.0);
    float size = uSize * pow(1.32, -aMag);
    gl_PointSize = clamp(size * (uScale / -mvPosition.z), 1.0, uPointMax);
    float brightness = clamp(pow(10.0, -0.2 * aMag), 0.03, 1.6);
    // 曝光环境增益（契约 C5：filtered 档星空完全不可见）
    vColor = color * brightness * uGain;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const ECLIPSE_STAR_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = 1.0 - smoothstep(0.2, 0.5, d);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;

/**
 * 真实星穹（1 draw call，StarDome 消费链照抄）：attribute 初始化一次，
 * 每帧只写赤道→地平矩阵（LST 由 tSec + 观测点经度直接求得）与极限星等
 * （eclipseSkyDarkening 输出——偏食段白昼星隐属科学事实）。
 */
function EclipseStarDome({
  stars,
  refs,
  starPointMaxPx,
}: {
  stars: readonly YaleBrightStar[];
  refs: EclipseFrameRefs;
  starPointMaxPx: number;
}): JSX.Element {
  const { geometry, material } = useMemo(() => {
    const n = stars.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const mags = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const s = stars[i];
      const [xe, ye, ze] = equatorialUnitVector(s.ra, s.dec);
      positions[i * 3] = xe;
      positions[i * 3 + 1] = ye;
      positions[i * 3 + 2] = ze;
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
        uLimitingMag: { value: -4 },
        uSize: { value: 30 },
        uScale: { value: 400 },
        uDomeRadius: { value: STAR_DOME_RADIUS_UNITS },
        uPointMax: { value: starPointMaxPx },
        uGain: { value: EXPOSURE_FILTERED_STAR_GAIN },
      },
      vertexShader: ECLIPSE_STAR_VERTEX_SHADER,
      fragmentShader: ECLIPSE_STAR_FRAGMENT_SHADER,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: geo, material: mat };
  }, [stars, starPointMaxPx]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state) => {
    const frame = refs.frameRef.current;
    const { event } = refs.eventRef.current;
    material.uniforms.uScale.value =
      state.gl.domElement.height *
      0.5 *
      fovPointScaleFactor((state.camera as THREE.PerspectiveCamera).fov);
    material.uniforms.uLimitingMag.value = frame.limitingMag;
    material.uniforms.uGain.value = refs.renderRef.current.starGain;
    const lst = lstRadFromUnixSec(refs.tSecRef.current, event.observer.lonDeg);
    const m = equatorialToHorizontalMatrix(event.observer.latDeg, lst);
    (material.uniforms.uEqToHor.value as THREE.Matrix3).set(...m);
  });

  // 单位球 attribute（真实位置由 shader 放到壳半径），关剔除防整批误剔
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

const ECLIPSE_SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * LabSkyDome 同式竖直渐变（昼光 × 感知因子）+ M3-4 全食暮光模式：
 * uTotality01（totalityImmersion01 镜像权重）把昼光梯度混向「环地平线
 * 橙色暮光带 + 天顶深蓝」——梯度只依赖 dir.y（方位无关 = 360° 环带，
 * §1.4「全食 ≠ 夜晚」第一视觉特征）。天空亮度不受曝光基准衰减（曝光只
 * 作用于天体层——filtered 压暗白昼天空会杀死「99% 仍近白天」验收曲线）。
 * 暮光带常量 TWILIGHT_RING_* 模板注入（CPU 侧为事实源）。
 */
const ECLIPSE_SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform float uTotality01;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float band = pow(1.0 - abs(dir.y), 3.0);
    vec3 day = mix(uZenith, uHorizon, band);
    // 360° 暮光梯度（本影仅百余公里宽，地平线一圈外仍是白天）
    float twBand = pow(1.0 - clamp(dir.y, 0.0, 1.0), ${TWILIGHT_RING_BAND_POW.toFixed(1)});
    vec3 twZenith = vec3(${TWILIGHT_RING_ZENITH_RGB[0].toFixed(4)}, ${TWILIGHT_RING_ZENITH_RGB[1].toFixed(4)}, ${TWILIGHT_RING_ZENITH_RGB[2].toFixed(4)});
    vec3 twHorizon = vec3(${TWILIGHT_RING_HORIZON_RGB[0].toFixed(4)}, ${TWILIGHT_RING_HORIZON_RGB[1].toFixed(4)}, ${TWILIGHT_RING_HORIZON_RGB[2].toFixed(4)});
    vec3 twilight = mix(twZenith, twHorizon, twBand);
    vec3 col = mix(day, twilight, uTotality01);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 天光穹壳（LabSkyDome 同范式；亮度经 eclipseSkyDarkening 感知因子调制） */
function EclipseSkyDome({ refs }: { refs: EclipseFrameRefs }): JSX.Element {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: new THREE.Color(0, 0, 0) },
          uHorizon: { value: new THREE.Color(0, 0, 0) },
          uTotality01: { value: 0 },
        },
        vertexShader: ECLIPSE_SKY_VERTEX_SHADER,
        fragmentShader: ECLIPSE_SKY_FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  );
  const sky = useMemo(() => emptyLabSkyColors(), []);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const frame = refs.frameRef.current;
    const render = refs.renderRef.current;
    // 昼光基色（lm 固定 6.5——本条目无光害控件；日食变暗由感知因子承载）
    labSkyColors(6.5, frame.sunAltDeg * DEG, sky);
    const f = frame.skyFactor01;
    (material.uniforms.uZenith.value as THREE.Color).setRGB(
      sky.zenith[0] * f,
      sky.zenith[1] * f,
      sky.zenith[2] * f
    );
    (material.uniforms.uHorizon.value as THREE.Color).setRGB(
      sky.horizon[0] * f,
      sky.horizon[1] * f,
      sky.horizon[2] * f
    );
    material.uniforms.uTotality01.value = render.twilight01;
  });

  return (
    <mesh material={material} frustumCulled={false}>
      <sphereGeometry args={[STAR_DOME_RADIUS_UNITS * SKY_DOME_RADIUS_FACTOR, 48, 24]} />
    </mesh>
  );
}

/** 地面剪影圆盘（GroundDisk 同范式：色 = 天光反照 × 日食感知因子） */
function EclipseGroundDisk({ refs }: { refs: EclipseFrameRefs }): JSX.Element {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const tmp = useMemo(
    () => ({ sky: emptyLabSkyColors(), ground: [0, 0, 0] as [number, number, number] }),
    []
  );

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    const frame = refs.frameRef.current;
    labSkyColors(6.5, frame.sunAltDeg * DEG, tmp.sky);
    labGroundColor(tmp.sky, tmp.ground);
    const f = frame.skyFactor01;
    material.color.setRGB(tmp.ground[0] * f, tmp.ground[1] * f, tmp.ground[2] * f);
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_DISK_Y_UNITS, 0]}>
      <circleGeometry args={[STAR_DOME_RADIUS_UNITS, 96]} />
      <meshBasicMaterial ref={materialRef} color="#04060a" side={THREE.DoubleSide} />
    </mesh>
  );
}

/** 地平山脊剪影带（HorizonRidge 同范式；几何烘焙一次，每帧只写材质色） */
function EclipseHorizonRidge({ refs }: { refs: EclipseFrameRefs }): JSX.Element {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  const geometry = useMemo(() => {
    const profile = ridgeHeightProfile(RIDGE_SEGMENTS, ECLIPSE_RIDGE_SEED);
    const positions = new Float32Array(RIDGE_SEGMENTS * 2 * 3);
    const indices = new Uint16Array(RIDGE_SEGMENTS * 6);
    for (let i = 0; i < RIDGE_SEGMENTS; i += 1) {
      const theta = (i / RIDGE_SEGMENTS) * Math.PI * 2;
      const x = Math.cos(theta) * RIDGE_RADIUS_KM;
      const z = Math.sin(theta) * RIDGE_RADIUS_KM;
      positions[i * 6] = x;
      positions[i * 6 + 1] = GROUND_DISK_Y_UNITS;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x;
      positions[i * 6 + 4] = GROUND_DISK_Y_UNITS + profile[i];
      positions[i * 6 + 5] = z;
      const next = (i + 1) % RIDGE_SEGMENTS;
      indices[i * 6] = i * 2;
      indices[i * 6 + 1] = i * 2 + 1;
      indices[i * 6 + 2] = next * 2;
      indices[i * 6 + 3] = next * 2;
      indices[i * 6 + 4] = i * 2 + 1;
      indices[i * 6 + 5] = next * 2 + 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const tmp = useMemo(
    () => ({ sky: emptyLabSkyColors(), ground: [0, 0, 0] as [number, number, number] }),
    []
  );

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    const frame = refs.frameRef.current;
    labSkyColors(6.5, frame.sunAltDeg * DEG, tmp.sky);
    labGroundColor(tmp.sky, tmp.ground);
    const f = frame.skyFactor01 * RIDGE_DARKEN_FACTOR;
    material.color.setRGB(tmp.ground[0] * f, tmp.ground[1] * f, tmp.ground[2] * f);
  });

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial ref={materialRef} color="#010203" side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 日月合成 quad（M2-5 光球层 + M3-2/M3-3 全食景观五层序，§4.2；契约 C4/C5）
// ---------------------------------------------------------------------------

const ECLIPSE_QUAD_VERTEX_SHADER = /* glsl */ `
  uniform float uHalfAngle;
  varying vec2 vAng;
  void main() {
    // quad 本地角坐标（弧度）：+X = 方位角减小向（lookAt 原点后的本地系）、
    // +Y = 高度角增大向；uMoonOffset 与此同系（CPU 侧换算）
    vAng = (uv - 0.5) * 2.0 * uHalfAngle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 五层合成 fragment（§4.2 层序；全部常量模板注入自 sunSurface/solarActivity/
 * solarEclipseLab——CPU/GLSL 镜像纪律，照抄勿变形）：
 *
 * 1 日冕：coronaRadialFalloff(K=2.2) × coronaStreamerFactor(isotropy01) +
 *   helmetStreamerFactor + polarPlumeBrightness + coronalHoleDarkening
 *   （Sun.tsx 镜像注入先例同手法；噪声相位 = 事件种子静态冻结，seek 一致）；
 * 2 色球红环：chromosphereRimAlpha（壳层 1.015、菲涅尔 ^3、峰值 0.85）+
 *   spiculeRimPerturbation 锯齿——月盘遮罩几何使其只在月缘未及壳层的一侧
 *   显现（C2 后/C3 前红色一闪，无需时间开关）；
 * 3 日珥剪影：2–4 处粉红拱状（事件种子固定方位，A6 登记：典型形态再现），
 *   prominenceFibrilFactor 镜像纤维条纹；
 * 4 光球盘：临边昏暗（SUN_LIMB_DARKENING_U）× 曝光 photoGain（契约 C5：
 *   filtered 0.55 不过曝 ↔ naked-eye ×15 交 Bloom 溢出）；
 * 5 贝利珠：月缘逐角半径 = moonR + LOLA 剖面偏差（720 点 1D 静态纹理双点
 *   插值查表）；漏光角深 = beadsLeakProfile 同式的向量等价式
 *   d(ψ) − moonLimb(ψ)，d = along + √(sunR² − perp²)（= offset·cosφ +
 *   √(sunR²−offset²sin²φ)）。细于 2% R☉ 的漏光按 HDR 珠辉渲染（辉光宽
 *   1.5% R☉ 为泛光尺度表达，非几何放大珠体——真实珠宽亚角秒级，登记
 *   艺术化）；珠数收敛至 1 → Bloom 自然成钻石环（不加十字星芒）。
 *
 * 月盘遮罩用凹凸月缘半径（贝利珠几何母体）；月盘遮光球/色球/日珥/日冕，
 * 珠辉为漏光本体不受遮。白昼天光下月盘日面外透明（新月不可见，科学事实）。
 */
const ECLIPSE_QUAD_FRAGMENT_SHADER = /* glsl */ `
  uniform float uSunR;
  uniform float uMoonR;
  uniform vec2 uMoonOffset;
  uniform vec3 uSunColor;
  uniform float uPhotoGain;
  uniform float uCoronaGain;
  uniform float uIsotropy;
  uniform float uKmToRad;
  uniform float uLimbRot;
  uniform float uNoiseSeed;
  uniform sampler2D uLimbTex;
  uniform float uPromCount;
  uniform float uPromAngle[4];
  uniform float uPromHeight[4];
  uniform float uPromSpan[4];
  varying vec2 vAng;

  const float PI = 3.14159265;
  const float TWO_PI = 6.28318531;

  float hash1(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
  }
  float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float smooth01(float t) { t = clamp(t, 0.0, 1.0); return t*t*(3.0-2.0*t); }
  float valueNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 t = vec3(smooth01(f.x), smooth01(f.y), smooth01(f.z));
    float v000 = hash3(i);
    float v100 = hash3(i + vec3(1.0, 0.0, 0.0));
    float v010 = hash3(i + vec3(0.0, 1.0, 0.0));
    float v110 = hash3(i + vec3(1.0, 1.0, 0.0));
    float v001 = hash3(i + vec3(0.0, 0.0, 1.0));
    float v101 = hash3(i + vec3(1.0, 0.0, 1.0));
    float v011 = hash3(i + vec3(0.0, 1.0, 1.0));
    float v111 = hash3(i + vec3(1.0, 1.0, 1.0));
    float a = mix(mix(v000, v100, t.x), mix(v010, v110, t.x), t.y);
    float b = mix(mix(v001, v101, t.x), mix(v011, v111, t.x), t.y);
    return mix(a, b, t.z);
  }
  float fbm3(vec3 p, float t) {
    float sum = 0.0; float amp = 1.0; float total = 0.0;
    float freq = ${CORONA_STREAMER_FREQ.toFixed(1)};
    for (int o = 0; o < 4; o++) {
      float drift = t * (0.05 + float(o) * 0.02);
      sum += valueNoise3(p * freq + vec3(drift, -drift, drift * 0.7)) * amp;
      total += amp; amp *= 0.5; freq *= 2.0;
    }
    return sum / total;
  }

  // 月缘剖面查表（契约 C3：720 点 @0.5°，静态 1D 纹理 + 双点手动线性插值）
  float limbDevKm(float psi) {
    float u = psi / TWO_PI;
    float x = u * ${LIMB_PROFILE_SAMPLE_COUNT.toFixed(1)} - 0.5;
    float k = floor(x);
    float f = x - k;
    float d0 = texture2D(uLimbTex, vec2((k + 0.5) / ${LIMB_PROFILE_SAMPLE_COUNT.toFixed(1)}, 0.5)).r;
    float d1 = texture2D(uLimbTex, vec2((k + 1.5) / ${LIMB_PROFILE_SAMPLE_COUNT.toFixed(1)}, 0.5)).r;
    return mix(d0, d1, f);
  }

  float angDiff(float a, float b) {
    return mod(a - b + PI, TWO_PI) - PI;
  }

  void main() {
    float rs = length(vAng);
    // 盘缘软化：视半径 3% 固定角宽（FOV 放大时缘宽随真实角尺度）
    float aa = uSunR * 0.03;

    // ---- 层 4：光球盘（临边昏暗 I(mu) = 1 − u·(1 − mu)，镜像常量注入）
    float sunDisk = 1.0 - smoothstep(uSunR - aa, uSunR + aa, rs);
    float x = clamp(rs / uSunR, 0.0, 1.0);
    float mu = sqrt(max(1.0 - x * x, 0.0));
    float limbDark = 1.0 - ${SUN_LIMB_DARKENING_U.toFixed(2)} * (1.0 - mu);
    vec3 photo = uSunColor * uPhotoGain * limbDark * sunDisk;

    // ---- 月盘剪影（凹凸月缘：LOLA 剖面逐角半径——贝利珠几何母体）
    vec2 pm = vAng - uMoonOffset;
    float rm = length(pm);
    // 本地极角（上起经东；本地 +X = 方位角减小向 → east = −x）
    float psiLocal = atan(-pm.x, pm.y);
    float psiEq = psiLocal + uLimbRot;
    float devKm = limbDevKm(psiEq);
    float moonLimbR = uMoonR + devKm * uKmToRad;
    float moonMask = 1.0 - smoothstep(moonLimbR - aa, moonLimbR + aa, rm);

    // ---- 层 5：贝利珠（beadsLeakProfile 同式向量等价：月心沿 ψ̂ 到日缘
    //      距离 d = dot(ψ̂, sc) + √(sunR² − perp²)，漏光 = d − 月缘半径）
    vec2 psiDir = rm > 1e-9 ? pm / rm : vec2(0.0, 1.0);
    vec2 sc = -uMoonOffset;
    float along = dot(psiDir, sc);
    float perp2 = dot(sc, sc) - along * along;
    float inside = uSunR * uSunR - perp2;
    float leak = 0.0;
    if (inside > 0.0) {
      float dSunLimb = along + sqrt(inside);
      leak = max(0.0, dSunLimb - moonLimbR);
    }
    // 珠辉窗：漏光角深 < 2% R☉ 按珠渲染（更宽的月牙走几何剪影路径）
    float cap = uSunR * 0.02;
    float leakN = leak / cap;
    float beadI = leakN * (1.0 - smooth01((leakN - 0.6) / 0.4));
    float beadW = uSunR * 0.015;
    float dr = rm - moonLimbR;
    float beadG = exp(-dr * dr / (beadW * beadW));
    vec3 beads = uSunColor * uPhotoGain * 2.0 * max(beadI, 0.0) * beadG;

    // ---- 层 1：日冕（coronaIntensity 函数族镜像；isotropy01 接活动周滑杆）
    vec3 corona = vec3(0.0);
    if (uCoronaGain > 0.001) {
      float rNorm = rs / uSunR;
      float fall = rNorm <= 1.0 ? 1.0 : exp(-${CORONA_FALLOFF_K.toFixed(2)} * (rNorm - 1.0));
      vec2 u2 = rs > 1e-9 ? vAng / rs : vec2(0.0, 1.0);
      vec3 dir = vec3(u2, 0.0);
      float streak = fbm3(dir, uNoiseSeed);
      float absY = abs(dir.y);
      float eq = pow(1.0 - absY, 2.0);
      // coronaStreamerFactor 镜像：极小期强赤道加权 ↔ 极大期各向同性
      float angular = mix(0.35 + 0.65 * eq, 1.0, uIsotropy);
      float streamer = (0.45 + 0.55 * streak) * angular;
      // helmetStreamerFactor 镜像：赤道盔状尖顶锐化
      float helmet = mix(
        pow(1.0 - absY, ${HELMET_STREAMER_SHARPNESS.toFixed(1)}),
        eq,
        uIsotropy
      );
      streamer += 0.5 * helmet * (0.45 + 0.55 * streak);
      // polarPlumeBrightness 镜像：极区细窄羽状射线
      float cosCone = ${Math.cos(POLAR_PLUME_CONE_RAD).toFixed(6)};
      if (absY > cosCone) {
        float pt = (absY - cosCone) / (1.0 - cosCone);
        float pn = valueNoise3(vec3(atan(dir.z, dir.x) * 3.0, dir.y * 2.0, uNoiseSeed * 0.3));
        streamer += ${POLAR_PLUME_GAIN.toFixed(4)} * pt * (0.5 + 0.5 * sin(pn * ${POLAR_PLUME_FREQ.toFixed(1)} * PI));
      }
      // coronalHoleDarkening 镜像：开放磁力线暗区
      float holeAng = acos(clamp(dot(dir, vec3(${CORONAL_HOLE_DIR.x.toFixed(4)}, ${CORONAL_HOLE_DIR.y.toFixed(4)}, ${CORONAL_HOLE_DIR.z.toFixed(4)})), -1.0, 1.0));
      float hole = 1.0;
      if (holeAng < ${CORONAL_HOLE_RADIUS_RAD.toFixed(4)}) {
        float ht = holeAng / ${CORONAL_HOLE_RADIUS_RAD.toFixed(4)};
        float hs = ht * ht * (3.0 - 2.0 * ht);
        hole = ${CORONAL_HOLE_MIN_BRIGHTNESS.toFixed(4)} + (1.0 - ${CORONAL_HOLE_MIN_BRIGHTNESS.toFixed(4)}) * hs;
      }
      vec3 coronaColor = vec3(${CORONA_COLOR.r.toFixed(2)}, ${CORONA_COLOR.g.toFixed(2)}, ${CORONA_COLOR.b.toFixed(2)});
      // ×1.3 HDR：内冕越过 Bloom 阈值 0.6 产生辉光（A2：非线性真值登记）
      corona = coronaColor * (fall * streamer * hole * uCoronaGain * 1.3) * (1.0 - sunDisk);
    }

    // ---- 层 2：色球红环（chromosphereRimAlpha + spiculeRimPerturbation 镜像）
    vec3 chromo = vec3(0.0);
    float shellR = uSunR * ${CHROMOSPHERE_SHELL_SCALE.toFixed(3)};
    if (uCoronaGain > 0.001 && rs > uSunR && rs < shellR) {
      float cx = clamp(rs / shellR, 0.0, 1.0);
      float cmu = sqrt(max(1.0 - cx * cx, 0.0));
      float ca = pow(1.0 - cmu, ${CHROMOSPHERE_FRESNEL_POWER.toFixed(1)}) * ${CHROMOSPHERE_MAX_ALPHA.toFixed(2)};
      float psiSun = atan(-vAng.x, vAng.y);
      float sn = hash1(floor(psiSun * ${SPICULE_NOISE_FREQ.toFixed(1)}) + uNoiseSeed);
      ca *= (1.0 + ${SPICULE_AMP.toFixed(4)} * (sn - 0.5) * 2.0);
      vec3 chromoColor = vec3(${CHROMOSPHERE_COLOR.r.toFixed(2)}, ${CHROMOSPHERE_COLOR.g.toFixed(2)}, ${CHROMOSPHERE_COLOR.b.toFixed(2)});
      // ×3 HDR：红环一闪的辉光量级
      chromo = chromoColor * max(ca, 0.0) * 3.0 * uCoronaGain;
    }

    // ---- 层 3：日珥剪影（2–4 处，事件种子固定方位；A6 典型形态登记；
    //      纤维条纹为 prominenceFibrilFactor 镜像）
    vec3 prom = vec3(0.0);
    if (uCoronaGain > 0.001 && rs > uSunR * 0.985) {
      float psiSun2 = atan(-vAng.x, vAng.y);
      for (int k = 0; k < 4; k++) {
        if (float(k) < uPromCount) {
          float halfSpan = uPromSpan[k] * 0.5;
          float dAng = angDiff(psiSun2, uPromAngle[k]);
          if (abs(dAng) < halfSpan) {
            // 拱形包络：半椭圆顶弧（solarActivity 单位弧线同族形态）
            float archTop = sqrt(max(1.0 - pow(dAng / halfSpan, 2.0), 0.0));
            float rise = (rs - uSunR) / (uSunR * uPromHeight[k]);
            float radial = 1.0 - smooth01((rise - archTop * 0.7) / max(archTop * 0.3, 0.05));
            float t01 = dAng / uPromSpan[k] + 0.5;
            float pnz = hash1(floor(psiSun2 * 40.0) + uNoiseSeed);
            float fib = max(0.0, 1.0 + 0.25 * sin(t01 * ${PROMINENCE_FIBRIL_FREQ.toFixed(1)} * PI + (pnz - 0.5) * 4.0) * (0.6 + 0.4 * pnz));
            // 粉红（氢α 发射的日珥观测色）；×2 HDR
            prom += vec3(1.0, 0.42, 0.45) * clamp(radial, 0.0, 1.0) * fib * 2.0 * uCoronaGain;
          }
        }
      }
    }

    // ---- 合成（§4.2 层序）：月盘遮光球/色球/日珥/日冕；珠辉为漏光不受遮
    vec3 light = (photo + chromo + prom + corona) * (1.0 - moonMask) + beads;
    float alpha = sunDisk;
    float peak = max(max(light.r, light.g), light.b);
    if (alpha < 0.003 && peak < 0.002) discard;
    gl_FragColor = vec4(light, alpha);
  }
`;

/**
 * 日月合成 quad（1 draw call；渲染循环零 buffer 更新——月缘纹理静态、
 * 逐帧只写位姿与标量/vec2 uniform；日珥布点与噪声种子为事件级一次性设置）
 */
function EclipseSunMoonQuad({
  refs,
  limbTexture,
  prominences,
  noiseSeed01,
}: {
  refs: EclipseFrameRefs;
  limbTexture: THREE.DataTexture;
  prominences: readonly EclipseProminence[];
  noiseSeed01: number;
}): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uHalfAngle: { value: ECLIPSE_QUAD_HALF_ANGLE_RAD },
          uSunR: { value: 0.267 * DEG },
          uMoonR: { value: 0.267 * DEG },
          uMoonOffset: { value: new THREE.Vector2(0, 0) },
          // 光球色（暖白，sRGB 直觉色；HDR 亮度由 uPhotoGain 承载）
          uSunColor: { value: new THREE.Color(1.0, 0.93, 0.82) },
          uPhotoGain: { value: EXPOSURE_FILTERED_PHOTO_GAIN },
          uCoronaGain: { value: 0 },
          uIsotropy: { value: 0 },
          uKmToRad: { value: (0.267 * DEG) / MOON_MEAN_RADIUS_KM },
          uLimbRot: { value: 0 },
          uNoiseSeed: { value: 0 },
          uLimbTex: { value: null as THREE.DataTexture | null },
          uPromCount: { value: 0 },
          uPromAngle: { value: [0, 0, 0, 0] },
          uPromHeight: { value: [0.08, 0.08, 0.08, 0.08] },
          uPromSpan: { value: [0.2, 0.2, 0.2, 0.2] },
        },
        vertexShader: ECLIPSE_QUAD_VERTEX_SHADER,
        fragmentShader: ECLIPSE_QUAD_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
      }),
    []
  );

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  // 月缘纹理/日珥布点/噪声种子：事件级一次性设置（交互事件路径，非逐帧）
  useEffect(() => {
    material.uniforms.uLimbTex.value = limbTexture;
    material.uniforms.uNoiseSeed.value = noiseSeed01 * 37.0;
    material.uniforms.uPromCount.value = prominences.length;
    const angles = material.uniforms.uPromAngle.value as number[];
    const heights = material.uniforms.uPromHeight.value as number[];
    const spans = material.uniforms.uPromSpan.value as number[];
    for (let k = 0; k < 4; k += 1) {
      const p = prominences[Math.min(k, prominences.length - 1)];
      angles[k] = p.angleRad;
      heights[k] = p.heightFrac;
      spans[k] = p.spanRad;
    }
  }, [material, limbTexture, prominences, noiseSeed01]);

  // quad 边长：天穹壳距离 × tan(半角) × 2（真实角尺度 → 场景 km）
  const quadSize = 2 * SKY_SHELL_RADIUS_KM * Math.tan(ECLIPSE_QUAD_HALF_ANGLE_RAD);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const frame = refs.frameRef.current;
    const render = refs.renderRef.current;
    const dir = sceneDirFromAltAz({
      altRad: frame.sunAltDeg * DEG,
      azRad: frame.sunAzDeg * DEG,
    });
    mesh.position.set(
      dir[0] * SKY_SHELL_RADIUS_KM,
      dir[1] * SKY_SHELL_RADIUS_KM,
      dir[2] * SKY_SHELL_RADIUS_KM
    );
    // lookAt 原点：本地 +Y = 高度角向（世界上方向投影）、+X = 方位角减小向
    mesh.lookAt(0, 0, 0);
    const sunR = frame.sunSdDeg * DEG;
    const moonR = frame.moonSdDeg * DEG;
    material.uniforms.uSunR.value = sunR;
    material.uniforms.uMoonR.value = moonR;
    // 本地系换算：x = −方位向偏移（+X 朝方位角减小向）、y = 高度向偏移
    (material.uniforms.uMoonOffset.value as THREE.Vector2).set(
      -frame.offEastRad,
      frame.offUpRad
    );
    // 月缘 km ↔ 角量（beadsLeakProfile 同式换算，自洽于 moonR）
    material.uniforms.uKmToRad.value = moonR / MOON_MEAN_RADIUS_KM;
    // 剖面索引系（天球北起经东）→ quad 本地系帧旋转
    material.uniforms.uLimbRot.value = limbTexRotationRad(
      frame.offEastRad,
      frame.offUpRad,
      frame.posAngleDeg
    );
    // 曝光状态机增益（契约 C5）+ 活动周滑杆
    material.uniforms.uPhotoGain.value = render.photoGain;
    material.uniforms.uCoronaGain.value = render.coronaGain;
    material.uniforms.uIsotropy.value = refs.settingsRef.current.isotropy01;
  });

  return (
    <mesh ref={meshRef} material={material} frustumCulled={false} renderOrder={1}>
      <planeGeometry args={[quadSize, quadSize]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// M3-4 亮行星标注（§2.1：事件历元真实方位 physics 链 + 名标签）
// ---------------------------------------------------------------------------

/** 行星标注距离（场景单位；星穹 10000 内侧防深度冲突，RadiantMarker 同法） */
const PLANET_MARKER_DISTANCE_UNITS = 9800;

/** 行星标注点半径（场景单位；9800 距离下 ≈0.15° 视径的辨识点） */
const PLANET_MARKER_RADIUS_UNITS = 13;

/** 行星标注色（近似观感色：金白/暖白/灰白/橘红） */
const PLANET_MARKER_COLORS: Record<string, string> = {
  venus: '#f5f0dc',
  jupiter: '#f0e6c8',
  mercury: '#d8d4cc',
  mars: '#e8a070',
};

/** 行星轨道要素查找（data/planets 单一事实源） */
const PLANET_ORBIT_BY_ID = new Map(PLANETS.map((p) => [p.id, p.orbit]));

/**
 * 单颗行星标注（点 + 名标签）：RA/Dec 每 300s 重算（行星视位置在 ±4h 窗内
 * 移动 ≪1°，登记近似；seek 大跳时立即重算），逐帧只做地平变换与位姿写入。
 * locale 纪律：标签经叶组件 LabelText（内部订阅），本组件不订阅 locale。
 */
function EclipsePlanetMarker({
  refs,
  planetId,
  labelKey,
}: {
  refs: EclipseFrameRefs;
  planetId: 'venus' | 'jupiter' | 'mercury' | 'mars';
  labelKey: MessageKey;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const cacheRef = useRef<{ tSec: number; eq: EquatorialPos }>({
    tSec: Number.NEGATIVE_INFINITY,
    eq: { raDeg: 0, decDeg: 0 },
  });

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const { event } = refs.eventRef.current;
    const tSec = refs.tSecRef.current;
    const cache = cacheRef.current;
    if (Math.abs(tSec - cache.tSec) > 300) {
      const orbit = PLANET_ORBIT_BY_ID.get(planetId);
      const earth = PLANET_ORBIT_BY_ID.get('earth');
      if (!orbit || !earth) return;
      planetGeocentricEquatorial(orbit, earth, tSec, cache.eq);
      cache.tSec = tSec;
    }
    const lst = lstRadFromUnixSec(tSec, event.observer.lonDeg);
    const altAz = horizontalFromEquatorial(
      cache.eq.raDeg,
      cache.eq.decDeg,
      event.observer.latDeg,
      lst
    );
    const dir = sceneDirFromAltAz(altAz);
    group.position.set(
      dir[0] * PLANET_MARKER_DISTANCE_UNITS,
      dir[1] * PLANET_MARKER_DISTANCE_UNITS,
      dir[2] * PLANET_MARKER_DISTANCE_UNITS
    );
    group.lookAt(0, 0, 0);
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <circleGeometry args={[PLANET_MARKER_RADIUS_UNITS, 24]} />
        <meshBasicMaterial
          color={PLANET_MARKER_COLORS[planetId]}
          transparent
          opacity={0.95}
          depthWrite={false}
        />
      </mesh>
      <Html position={[0, -PLANET_MARKER_RADIUS_UNITS * 5, 0]} center style={{ pointerEvents: 'none' }}>
        <span className="whitespace-nowrap rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-amber-100/90 backdrop-blur">
          <LabelText k={labelKey} />
        </span>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// M3-5 树影月牙贴花（§4.3：针孔成像光斑，月牙形态与日月偏移 uniform 同源）
// ---------------------------------------------------------------------------

/** 贴花补丁边长（场景单位 = km；观测者近旁地面的示意光斑毯） */
const CRESCENT_DECAL_SIZE_UNITS = 1.3;

/**
 * 针孔光斑 fragment：网格胞元内各画一枚「日面可见形状」的缩影——太阳盘
 * 减月盘，圆盘比例与偏移方向取当前 uSunR/uMoonR/uMoonOffset（与合成 quad
 * 同源 uniform，实时一致）；针孔成像倒立 → 偏移取反。胞元抖动/尺寸/取舍
 * 由哈希决定（树冠缝隙随机性）。
 */
const CRESCENT_DECAL_FRAGMENT_SHADER = /* glsl */ `
  uniform float uSunR;
  uniform float uMoonR;
  uniform vec2 uMoonOffset;
  uniform float uGain;
  varying vec2 vUv;
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  void main() {
    // 圆形补丁包络（边缘淡出）
    float envelope = 1.0 - smoothstep(0.32, 0.5, length(vUv - 0.5));
    if (envelope < 0.01) discard;
    vec2 g = vUv * 7.0;
    vec2 cell = floor(g);
    float keep = hash21(cell);
    if (keep < 0.42) discard;
    vec2 jitter = vec2(hash21(cell + 7.3), hash21(cell + 3.1)) * 0.36 - 0.18;
    float size = 0.26 + 0.14 * hash21(cell + 11.7);
    vec2 q = (fract(g) - 0.5 - jitter) / size;
    float r = length(q);
    float sun = 1.0 - smoothstep(0.92, 1.0, r);
    // 针孔成像倒立：月盘偏移取反；比例与合成 quad 同源
    vec2 off = -uMoonOffset / uSunR;
    float ratio = uMoonR / uSunR;
    float rmDec = length(q - off);
    float moon = 1.0 - smoothstep(ratio - 0.08, ratio, rmDec);
    float lit = sun * (1.0 - moon) * envelope;
    vec3 col = vec3(1.0, 0.9, 0.72) * lit * uGain;
    gl_FragColor = vec4(col, lit * uGain);
  }
`;

/** 树影月牙贴花（GroundDisk 上的针孔光斑毯；1 draw call） */
function EclipseCrescentDecal({ refs }: { refs: EclipseFrameRefs }): JSX.Element {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uSunR: { value: 0.267 * DEG },
          uMoonR: { value: 0.267 * DEG },
          uMoonOffset: { value: new THREE.Vector2(0, 0) },
          uGain: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: CRESCENT_DECAL_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const frame = refs.frameRef.current;
    material.uniforms.uSunR.value = frame.sunSdDeg * DEG;
    material.uniforms.uMoonR.value = frame.moonSdDeg * DEG;
    (material.uniforms.uMoonOffset.value as THREE.Vector2).set(
      -frame.offEastRad,
      frame.offUpRad
    );
    // 亮度 = 天光感知因子 × 太阳在地平上包络（全食时自然熄灭）
    const sunUp = Math.min(1, Math.max(0, frame.sunAltDeg / 5));
    material.uniforms.uGain.value = frame.skyFactor01 * sunUp * 0.6;
  });

  return (
    <mesh
      material={material}
      rotation-x={-Math.PI / 2}
      position={[0.7, GROUND_DISK_Y_UNITS + 0.01, -0.7]}
    >
      <planeGeometry args={[CRESCENT_DECAL_SIZE_UNITS, CRESCENT_DECAL_SIZE_UNITS]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 场景主组件（DOM 覆盖层订阅 locale；Canvas 子树不订阅——3D locale 纪律）
// ---------------------------------------------------------------------------

/** HUD 状态（500ms interval 经纯函数计算） */
interface EclipseHudState {
  utcText: string;
  magnitudeText: string;
  obscurationText: string;
  sunDiamText: string;
  moonDiamText: string;
  /** 当前倍速（A1 登记：HUD 常显；假想模式显示 '—'） */
  rateText: string;
  /** 食型键（eclipseKind 实时判定） */
  kindKey: MessageKey;
  /** 全食剩余时间（仅真实路径全食段；否则 '—'） */
  totalityLeftText: string;
  /** M4 太空档：本影足印短轴宽度（真锥×球面解析真实值；无足印 '—'） */
  umbraWidthText: string;
  /** M4 太空档：足印为伪本影（环食分支——HUD 附注） */
  umbraIsAntumbra: boolean;
  /** M4 太空档：本影地面移动速度（>1,700 km/h 验收锚点；无足印 '—'） */
  shadowSpeedText: string;
}

/** 食型 → i18n 键（假想模式月地距离滑杆的实时反馈依赖此映射） */
const KIND_LABEL_KEYS: Record<EclipseFrameState['kind'], MessageKey> = {
  none: 'lab.eclipsePhaseNone',
  partial: 'lab.eclipsePhasePartial',
  total: 'lab.eclipsePhaseTotal',
  annular: 'lab.eclipsePhaseAnnular',
};

/** M3+M4 控件初值（地面视角 + 导览变速 + 自动曝光；活动周取中庸 0.3；
 * 本影放大默认关 = 真实比例（A4）、倾角叙事默认关） */
function defaultEclipseSettings(): EclipseM3Settings {
  return {
    viewMode: 'ground',
    playMode: 'tour',
    exposureMode: 'auto',
    exposureManual01: 0,
    isotropy01: 0.3,
    hypoActive: false,
    hypoMoonDistKm: 384400,
    umbraMagnify: false,
    inclinationDemo: false,
  };
}

/** 事件已就绪后的场景 + 控件（数据 ready 前由外层 gate，见 SolarEclipseLab） */
function EclipseExperience({ data }: { data: { events: SolarEclipseEventData[] } }): JSX.Element {
  const tr = useT();
  const entry = labEntryForId('solar-eclipse');
  const { stars } = useYaleBrightStars();
  const { profile: limbProfile } = useLunarLimbProfile();

  const [eventId, setEventId] = useState<EclipseEventId>('e2027');
  const [playing, setPlaying] = useState(false);
  const event = useMemo(
    () => data.events.find((e) => e.id === eventId) ?? data.events[0],
    [data, eventId]
  );
  const window_ = useMemo(() => eclipseTimelineWindow(event.contacts), [event]);
  const anchors = useMemo<EclipseTimelineAnchor[]>(
    () => solarEclipseAnchors(event.contacts),
    [event]
  );
  // 贝利珠/钻石环时段高亮刻度（§3.1；数据驱动，契约 C7 口径）
  const highlights = useMemo(() => beadsHighlightWindows(event.contacts), [event]);
  // 99% 遮挡时刻（一键对比 seek 目标；事件级一次反解）
  const t99 = useMemo(() => obscurationCrossingTimeSec(event, event.contacts, 0.99), [event]);

  // 月缘剖面 1D 静态纹理（契约 C3 → 贝利珠 shader 查表；加载前为零剖面
  // ——均匀月缘的珠串退化形态，profile 就绪后一次性换纹理，交互事件路径）
  const limbTexture = useMemo(() => {
    const dataArr = new Float32Array(LIMB_PROFILE_SAMPLE_COUNT);
    if (limbProfile) dataArr.set(limbProfile.samples);
    const tex = new THREE.DataTexture(
      dataArr,
      LIMB_PROFILE_SAMPLE_COUNT,
      1,
      THREE.RedFormat,
      THREE.FloatType
    );
    tex.wrapS = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }, [limbProfile]);
  useEffect(() => () => limbTexture.dispose(), [limbTexture]);

  // 日珥布点 + 日冕噪声种子（事件种子固定——A6 登记 + seek 一致性）
  const prominences = useMemo(() => eclipseProminences(eclipseEventSeed(eventId)), [eventId]);
  const noiseSeed01 = useMemo(() => (eclipseEventSeed(eventId) % 1000) / 1000, [eventId]);

  // M3 控件状态（DOM 写 React state → 渲染期同步 ref → useFrame 只读）
  const [settings, setSettings] = useState<EclipseM3Settings>(defaultEclipseSettings);

  // scrubber 显示值（拖动即时更新；播放期间由 500ms tick 从 tSecRef 回同步）
  const [scrubSec, setScrubSec] = useState<number>(event.contacts.c1);

  // 帧循环共享 refs（渲染期同步赋值：useFrame 读到的永远是最新事件/播放态）
  const tSecRef = useRef(event.contacts.c1);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const eventRef = useRef({ event, window: window_ });
  eventRef.current = { event, window: window_ };
  const frameRef = useRef(emptyEclipseFrameState());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const renderRef = useRef(emptyEclipseRenderState());
  const spaceRef = useRef(emptyEclipseSpaceFrameState());
  const refs: EclipseFrameRefs = useMemo(
    () => ({ tSecRef, playingRef, eventRef, frameRef, settingsRef, renderRef, spaceRef }),
    []
  );

  // M4 视角切换运镜期（OrbitControls 卸载 gate；rig 完成回调解除）
  const [viewTransitioning, setViewTransitioning] = useState(false);

  // 画质档（流星雨 M4-2 同链：挂载时判定一次；reduced 关 Bloom、DPR≤2）
  const [quality] = useState<LabQualityParams>(() =>
    labQualityParams(
      typeof window === 'undefined'
        ? 'full'
        : labQualityTier({
            dpr: window.devicePixelRatio,
            userAgent: navigator.userAgent,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          })
    )
  );

  /** 页签切换（§3.5 范式）：结束演示态（暂停 + 退出假想）+ 时间轴对齐新事件 C1 */
  const handleEventChange = (id: EclipseEventId): void => {
    if (id === eventId) return;
    setPlaying(false);
    setSettings((prev) => (prev.hypoActive ? { ...prev, hypoActive: false } : prev));
    const next = data.events.find((e) => e.id === id) ?? data.events[0];
    tSecRef.current = next.contacts.c1;
    setScrubSec(next.contacts.c1);
    setEventId(id);
  };

  /** scrubber seek（交互事件路径：写 ref + 显示值；效果由 tSec 单值重建） */
  const handleSeek = (tSec: number): void => {
    tSecRef.current = tSec;
    setScrubSec(tSec);
  };

  /** M3 控件变更（假想模式开启即暂停——与真实时间轴互斥，§3.3；
   * M4：视角切换触发 1.6s 运镜——时间轴 tSec 跨视角保持，§M4-3） */
  const handleSettingsChange = (patch: Partial<EclipseM3Settings>): void => {
    if (patch.hypoActive) setPlaying(false);
    if (patch.viewMode && patch.viewMode !== settings.viewMode) setViewTransitioning(true);
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  /** 99%/100% 一键对比（§3.3：seek 到反解时刻/食甚并暂停；退出假想） */
  const handleCompare = (which: '99' | '100'): void => {
    setPlaying(false);
    setSettings((prev) => (prev.hypoActive ? { ...prev, hypoActive: false } : prev));
    handleSeek(which === '99' ? t99 : event.contacts.max);
  };

  // HUD：500ms interval 经纯函数读 ref 计算（DOM 层，不进 useFrame）
  const [hud, setHud] = useState<EclipseHudState>({
    utcText: '--:--:--',
    magnitudeText: '0.000',
    obscurationText: '0.0%',
    sunDiamText: '—',
    moonDiamText: '—',
    rateText: '×1',
    kindKey: 'lab.eclipsePhaseNone',
    totalityLeftText: '—',
    umbraWidthText: '—',
    umbraIsAntumbra: false,
    shadowSpeedText: '—',
  });
  const [env, setEnv] = useState<EclipseEnvReadout>({ tempText: '—', skyText: '—', lmText: '—' });
  const [phaseCard, setPhaseCard] = useState<EclipsePhaseCardKey>('c1');
  // 影带 pass 时段门控（窗外整体卸载零开销，§4.3；reduced 档恒关 §4.5）
  const [bandsActive, setBandsActive] = useState(false);
  // 可见行星（500ms 粒度评估：地平上 + 亮于极限星等 + 裸眼曝光；挂载门控）
  const [visiblePlanets, setVisiblePlanets] = useState<string>('');

  useEffect(() => {
    const tick = (): void => {
      const ev = eventRef.current.event;
      const s = settingsRef.current;
      const tSec = tSecRef.current;
      const frame = s.hypoActive
        ? hypotheticalFrameState(ev, tSec, s.hypoMoonDistKm)
        : eclipseFrameState(ev, tSec);
      const rate = eclipsePlayRate(s.playMode, tSec, ev.contacts);
      const totalityLeft =
        !s.hypoActive && frame.kind === 'total' && tSec < ev.contacts.c3
          ? formatUtcClock(Math.max(0, ev.contacts.c3 - tSec))
          : '—';
      // M4 太空档读数（spaceRef 由驱动器每帧重建；倾角叙事的示意轨道多数
      // 时刻无足印 → '—' 属预期表意）
      let umbraWidthText = '—';
      let umbraIsAntumbra = false;
      let shadowSpeedText = '—';
      if (s.viewMode === 'space') {
        const space = spaceRef.current;
        if (space.footExists && !s.inclinationDemo) {
          umbraWidthText = `${Math.round(space.footMinorKm).toLocaleString('en-US')} km`;
          umbraIsAntumbra = space.footIsAntumbra;
          const speed = umbraGroundSpeedKmh(
            ev.geo,
            tSec,
            s.hypoActive ? s.hypoMoonDistKm : null
          );
          if (speed !== null) {
            shadowSpeedText = `${Math.round(speed).toLocaleString('en-US')} km/h`;
          }
        } else if (space.footExists && s.inclinationDemo) {
          umbraWidthText = `${Math.round(space.footMinorKm).toLocaleString('en-US')} km`;
          umbraIsAntumbra = space.footIsAntumbra;
        }
      }
      const next: EclipseHudState = {
        utcText: formatUtcClock(tSec),
        magnitudeText: frame.magnitude.toFixed(3),
        obscurationText: `${(frame.obscuration01 * 100).toFixed(1)}%`,
        sunDiamText: formatAngularDiameterDeg(frame.sunSdDeg),
        moonDiamText: formatAngularDiameterDeg(frame.moonSdDeg),
        rateText: s.hypoActive ? '—' : `×${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)}`,
        kindKey: KIND_LABEL_KEYS[frame.kind],
        totalityLeftText: totalityLeft,
        umbraWidthText,
        umbraIsAntumbra,
        shadowSpeedText,
      };
      setHud((prev) =>
        prev.utcText === next.utcText &&
        prev.magnitudeText === next.magnitudeText &&
        prev.obscurationText === next.obscurationText &&
        prev.sunDiamText === next.sunDiamText &&
        prev.moonDiamText === next.moonDiamText &&
        prev.rateText === next.rateText &&
        prev.kindKey === next.kindKey &&
        prev.totalityLeftText === next.totalityLeftText &&
        prev.umbraWidthText === next.umbraWidthText &&
        prev.umbraIsAntumbra === next.umbraIsAntumbra &&
        prev.shadowSpeedText === next.shadowSpeedText
          ? prev
          : next
      );
      // 环境数值条（§1.4：气温降幅/天光/极限星等）
      const tempText = `−${eclipseTempDropC(frame.obscuration01).toFixed(1)} °C`;
      const skyText = `${(frame.skyFactor01 * 100).toFixed(0)}%`;
      const lmText = frame.limitingMag.toFixed(1);
      setEnv((prev) =>
        prev.tempText === tempText && prev.skyText === skyText && prev.lmText === lmText
          ? prev
          : { tempText, skyText, lmText }
      );
      setPhaseCard(activePhaseCardKey(tSec, ev.contacts));
      setBandsActive(!s.hypoActive && shadowBandsStrength01(tSec, ev.contacts) > 0.001);
      // 可见行星评估（RA/Dec 每 tick 重算成本可忽略：4 次开普勒解）
      const earthOrbit = PLANET_ORBIT_BY_ID.get('earth');
      const lst = lstRadFromUnixSec(tSec, ev.observer.lonDeg);
      const vis: string[] = [];
      if (earthOrbit && renderRef.current.starGain > 0.3) {
        for (const p of ECLIPSE_PLANETS) {
          const orbit = PLANET_ORBIT_BY_ID.get(p.id);
          if (!orbit) continue;
          const eq = planetGeocentricEquatorial(orbit, earthOrbit, tSec);
          const altAz = horizontalFromEquatorial(
            eq.raDeg,
            eq.decDeg,
            ev.observer.latDeg,
            lst
          );
          if (altAz.altRad > 0 && p.typicalMag < frame.limitingMag) vis.push(p.id);
        }
      }
      const visJoined = vis.join(',');
      setVisiblePlanets((prev) => (prev === visJoined ? prev : visJoined));
      // 播放期间回同步 scrubber 显示值（拖动路径由 handleSeek 即时更新）
      if (playingRef.current) setScrubSec(tSecRef.current);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  const activeTab = ECLIPSE_TABS.find((t) => t.id === eventId) ?? ECLIPSE_TABS[0];
  const visiblePlanetIds = useMemo(
    () => new Set(visiblePlanets.split(',').filter((v) => v.length > 0)),
    [visiblePlanets]
  );

  return (
    <div className="relative h-screen w-screen bg-black">
      <Canvas
        flat
        gl={{ antialias: true }}
        dpr={[1, quality.maxDpr]}
        camera={{
          position: [0, 0, INITIAL_CAMERA_RADIUS],
          fov: LAB_FOV_DEFAULT_DEG,
          near: 0.05,
          far: STAR_DOME_RADIUS_UNITS * 2.5,
        }}
      >
        <color attach="background" args={['#000004']} />
        <EclipseTimeDriver refs={refs} onEnded={() => setPlaying(false)} />
        <EclipseCameraAim refs={refs} eventId={eventId} />
        {/* M4 视角切换运镜（1.6s 插值；期间相机控制器卸载） */}
        <EclipseViewIntroRig
          refs={refs}
          active={viewTransitioning}
          onDone={() => setViewTransitioning(false)}
        />
        {settings.viewMode === 'ground' ? (
          <>
            <EclipseSkyDome refs={refs} />
            {stars && (
              <EclipseStarDome stars={stars} refs={refs} starPointMaxPx={quality.starPointMaxPx} />
            )}
            <EclipseSunMoonQuad
              refs={refs}
              limbTexture={limbTexture}
              prominences={prominences}
              noiseSeed01={noiseSeed01}
            />
            <EclipseGroundDisk refs={refs} />
            <EclipseHorizonRidge refs={refs} />
            <EclipseCrescentDecal refs={refs} />
            {/* 亮行星标注（全食暗天 500ms 粒度门控挂载；≤4 draw call） */}
            {ECLIPSE_PLANETS.filter((p) => visiblePlanetIds.has(p.id)).map((p) => (
              <EclipsePlanetMarker key={p.id} refs={refs} planetId={p.id} labelKey={p.labelKey} />
            ))}
          </>
        ) : (
          /* M4 太空视角（地球 + 月球 + 方向光日盘 + 真锥双层 + 中心线 +
             倾角叙事轨道环；§M4-1/M4-2/M4-4） */
          <EclipseSpaceView refs={refs} inclinationDemo={settings.inclinationDemo} />
        )}
        {/* 相机控制器（运镜期卸载防争抢；结束后从当前位姿接管——流星雨
            key remount 范式；太空档 OrbitControls 原生单指旋转/双指捏合） */}
        {!viewTransitioning &&
          (settings.viewMode === 'ground' ? (
            <OrbitControls
              key={`ground-${eventId}`}
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
              target={[0, 0, 0]}
              minDistance={SPACE_CAMERA_RADIUS_MIN_UNITS}
              maxDistance={SPACE_CAMERA_RADIUS_MAX_UNITS}
              enablePan={false}
              enableZoom
              minPolarAngle={0.03}
              maxPolarAngle={Math.PI - 0.03}
              rotateSpeed={0.5}
              enableDamping
              dampingFactor={0.12}
            />
          ))}
        {settings.viewMode === 'ground' && !viewTransitioning && <TrackpadLookControls />}
        {/* 后期：Bloom + ACES（流星雨同配置；光球/贝利珠 HDR 由 Bloom 拾取
            成钻石环）；影带 pass 仅时段窗内挂载（排 Bloom 前，A7；reduced
            档随 Bloom 一并关闭 §4.5） */}
        {quality.bloomEnabled ? (
          settings.viewMode === 'ground' && bandsActive ? (
            <EffectComposer multisampling={4}>
              <EclipseShadowBandsPass
                getStrength={() => renderRef.current.bands01}
                getTime={() => tSecRef.current - eventRef.current.event.contacts.c2}
              />
              <Bloom intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
              <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            </EffectComposer>
          ) : (
            <EffectComposer multisampling={4}>
              <Bloom intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
              <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            </EffectComposer>
          )
        ) : (
          <EffectComposer multisampling={0}>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
      </Canvas>

      {/* 假想模式 HUD 明示（§3.3：与真实时间轴互斥的顶栏徽标） */}
      {settings.hypoActive && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-amber-500/25 px-3 py-1 text-[11px] font-semibold text-amber-200 backdrop-blur">
          {tr('lab.eclipseHypoBadge')}
        </div>
      )}

      {/* 左上：返回实验室 + 条目标题 */}
      <div className="absolute left-4 top-4 select-none rounded-lg bg-black/60 px-3 py-2 text-xs text-gray-100 backdrop-blur">
        <Link href={LAB_PAGE_PATH} className="text-space-accent hover:underline">
          ← {tr('lab.backToLab')}
        </Link>
        {entry && <div className="mt-1 font-semibold text-sky-300">{tr(entry.titleKey)}</div>}
      </div>

      {/* 右上：事件页签 + 观测点 + HUD + 控件全量 + 数据来源（可滚动） */}
      <div className="absolute right-3 top-3 max-h-[calc(100vh-8rem)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg bg-black/65 p-3 text-xs text-gray-100 backdrop-blur">
        <div role="tablist" aria-label={tr('lab.eclipseTabAria')} className="mb-2 flex gap-1">
          {ECLIPSE_TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={eventId === tab.id}
              onClick={() => handleEventChange(tab.id)}
              className={`flex-1 rounded px-1 py-1.5 text-[10px] leading-tight transition-colors max-md:min-h-11 ${
                eventId === tab.id
                  ? 'bg-sky-500/30 font-semibold text-sky-200'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              {tr(tab.labelKey)}
            </button>
          ))}
        </div>
        <p className="mb-2 text-[10px] leading-snug text-gray-400">{tr(activeTab.observerKey)}</p>
        {/* HUD：UTC/倍速/食型/食分/遮挡率/视直径/全食剩余（真实值常显，
            契约 C4 + A1 登记） */}
        <div className="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded bg-sky-950/60 px-2 py-1 font-mono text-[11px] text-sky-200">
          <span className="text-gray-400">{tr('lab.eclipseHudUtc')}</span>
          <span>{hud.utcText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudRate')}</span>
          <span>{hud.rateText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudKind')}</span>
          <span>{tr(hud.kindKey)}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudMagnitude')}</span>
          <span>{hud.magnitudeText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudObscuration')}</span>
          <span>{hud.obscurationText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudSunDiam')}</span>
          <span>{hud.sunDiamText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudMoonDiam')}</span>
          <span>{hud.moonDiamText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudTotalityLeft')}</span>
          <span>{hud.totalityLeftText}</span>
          {/* M4 太空档读数：本影真实宽度（A4 放大只作用显示，HUD 恒为真值）
              + 地面移动速度（§1.2 >1,700 km/h 量级锚点） */}
          {settings.viewMode === 'space' && (
            <>
              <span className="text-gray-400">{tr('lab.eclipseHudUmbraWidth')}</span>
              <span>
                {hud.umbraWidthText}
                {hud.umbraIsAntumbra ? `（${tr('lab.eclipseHudAntumbra')}）` : ''}
              </span>
              <span className="text-gray-400">{tr('lab.eclipseHudShadowSpeed')}</span>
              <span>{hud.shadowSpeedText}</span>
            </>
          )}
        </div>
        {/* 控件全量（M3-6：播放模式/曝光/活动周/假想/对比/环境/科普卡） */}
        <EclipseControlPanel
          settings={settings}
          onChange={handleSettingsChange}
          env={env}
          phaseCardKey={phaseCard}
          onCompare={handleCompare}
        />
        <p className="mt-2 border-t border-white/10 pt-2 text-[10px] leading-snug text-gray-500">
          {tr('lab.dataSourceLabel')}：{entry?.dataSource ?? ''}
        </p>
      </div>

      {/* 底部：时间轴 scrubber（契约 C7 数据驱动锚点 + 贝利珠高亮刻度） */}
      <EclipseTimelineScrubber
        window={window_}
        valueSec={scrubSec}
        playing={playing}
        anchors={anchors}
        highlights={highlights}
        onSeek={handleSeek}
        onTogglePlay={() => setPlaying((p) => !p)}
      />

      {/* 底部操作提示（按视角档切换） */}
      <p className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate whitespace-nowrap rounded bg-black/40 px-3 py-1 text-[10px] text-gray-400 backdrop-blur">
        {settings.viewMode === 'space'
          ? tr('lab.eclipseHintSpace')
          : tr('lab.eclipseHintLookAround')}
      </p>
    </div>
  );
}

/**
 * 实验室场景入口（`/lab/solar-eclipse` 经 next/dynamic ssr:false 挂载）：
 * 星历三态 gate——loading/failed 显示提示，ready 后挂载场景。
 */
export function SolarEclipseLab(): JSX.Element {
  const tr = useT();
  const { data, status } = useSolarEclipses();

  if (status !== 'ready' || !data) {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center bg-black">
        <div className="absolute left-4 top-4 rounded-lg bg-black/60 px-3 py-2 text-xs backdrop-blur">
          <Link href={LAB_PAGE_PATH} className="text-space-accent hover:underline">
            ← {tr('lab.backToLab')}
          </Link>
        </div>
        <p
          className={`rounded-lg bg-black/60 px-4 py-2 text-sm text-gray-300 backdrop-blur ${
            status === 'loading' ? 'animate-pulse' : ''
          }`}
        >
          {status === 'failed' ? tr('lab.eclipseEphemerisFailed') : tr('lab.eclipseLoadingEphemeris')}
        </p>
      </div>
    );
  }
  return <EclipseExperience data={data} />;
}
