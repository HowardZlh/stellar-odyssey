"use client";

/**
 * 月食实验室场景（LE 迭代 M2 骨架 + M3 血月核心：地面视角 + 丹戎径向梯度
 * 血月 shader + 五档预设/浑浊度/曝光控件 + 全食星空显现与月光环境联动 +
 * 月缘增亮 + 三联对比 + 地圆论证；太空/月球视角随 M4/M5）
 *
 * 状态流红线（§3.1 同日食）：「事件时间轴秒 tSec」为单值状态源——一切效果
 * 由 tSec 经纯函数（utils/lunarEclipseLab + 契约 C1 函数族）逐帧重建，禁止
 * 帧间累积。DOM 控件写 React state → 渲染期同步 ref → Canvas 子树 useFrame
 * 读 ref 更 uniform（日食/流星雨同范式）；HUD 由 500ms interval 计算。
 *
 * 场景空间（契约 C3）：1 场景单位 = 1 km，+Y 天顶、−Z 正北、+X 正东，
 * 观测者原点、反转轨道相机。月盘画在天穹壳（10,000 km）billboard quad 上，
 * quad 内按**真实视半径**绘制（不做几何放大）；「看不清 0.5° 月盘」由 FOV
 * 缩放解决（TrackpadLookControls 手势链）+ HUD 常显双食分/月高/视直径。
 *
 * M3 血月着色（契约 C4）：shader 逐像素求「像素点到影盘中心视角距 ρ →
 * 归一化本影半径 rNorm」→ umbraShading(rNorm, uDanjonL) 丹戎径向色表
 * （红线 ①：本影内必须径向梯度，禁均匀变暗）；半影段仍直接消费
 * penumbraShading（红线 ②「微妙变暗不得夸大」幅度上限不动）；直射分量
 * 乘月缘增亮因子（对冲效应，B5 简化逆反射登记）。丹戎 L/浑浊度/曝光均为
 * 标量 uniform（渲染循环零 buffer 更新）。CPU/GLSL 镜像纪律：常量与色表
 * 模板注入自 lunarEclipse/lunarEclipseLab（bloodMoonIlluminationRgb 为 CPU
 * 事实源），照抄勿变形；三视角共用本镜像（M4 复用勿重写）。
 *
 * M3-3 星空显现链：lunarFrameState 内月面物理亮度积分 →
 * moonlightLimitingMagDelta → 星穹极限星等；天光穹/地面盘/山脊经
 * lunarSkyColorsWithMoonlight 单一事实源同步变暗（环境联动）。
 *
 * 渲染架构（§4）：StarDome 1 + SkyDome 1 + 月盘 quad 1 + 地面 1 + 山脊 1
 * = 5 draw call ≤ 12 预算；渲染循环零 buffer 更新（每帧只动 uniform）。
 * 三联对比为独立小 Canvas（frameloop="demand"，3 quad 复用同一 shader
 * 换 uniform——契约 C4 禁多套实现）。主场景与 earthShadow.ts 零改动；
 * Canvas 子树不订阅 locale。
 */

import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  Bloom,
  EffectComposer,
  ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { useT } from "@/hooks/useI18n";
import { useYaleBrightStars } from "@/hooks/useYaleBrightStars";
import { useLunarEclipses } from "@/hooks/useLunarEclipses";
import { useBitmapTexture } from "@/hooks/useBitmapTexture";
import type { LunarEclipseEventData, YaleBrightStar } from "@/utils/bakedData";
import type { MessageKey } from "@/i18n";
import { labEntryForId, LAB_PAGE_PATH } from "@/utils/lab";
import { textureUrl } from "@/data/textures";
import {
  CAMERA_RADIUS_MAX_UNITS,
  CAMERA_RADIUS_MIN_UNITS,
  STAR_DOME_RADIUS_UNITS,
  equatorialToHorizontalMatrix,
  equatorialUnitVector,
  labQualityParams,
  labQualityTier,
  sceneDirFromAltAz,
  type LabQualityParams,
} from "@/utils/meteorShower";
import {
  LAB_FOV_DEFAULT_DEG,
  LAB_POLAR_MAX_RAD,
  LAB_POLAR_MIN_RAD,
  fovPointScaleFactor,
} from "@/utils/labGestures";
import {
  RIDGE_DARKEN_FACTOR,
  RIDGE_RADIUS_KM,
  RIDGE_SEGMENTS,
  SKY_DOME_RADIUS_FACTOR,
  emptyLabSkyColors,
  labGroundColor,
  ridgeHeightProfile,
} from "@/utils/labSky";
import { bvToTeffK, srgbToLinear01 } from "@/utils/pleiadesCatalog";
import { blackbodyRGB } from "@/utils/starPhysics";
import { MOON_MEAN_RADIUS_KM, SKY_SHELL_RADIUS_KM } from "@/utils/solarEclipse";
import {
  turbidityToDanjonL,
  type LunarEclipseKind,
} from "@/utils/lunarEclipse";
import { createLunarMoonMaterial } from "@/components/Lab/lunarMoonDiskMaterial";
import {
  formatAngularDiameterDeg,
  formatUtcClock,
  lstRadFromUnixSec,
  type EclipseTimelineAnchor,
  type EclipseTimelineWindow,
} from "@/utils/solarEclipseLab";
import {
  INCLINATION_DISPLAY_FACTOR,
  MOON_ORBIT_INCLINATION_DEG,
  NARRATIVE_ORBIT_RADIUS_KM,
  SPACE_UNITS_PER_KM,
  narrativeAngles,
  narrativeMoonPosKm,
  type EclipseBodyScaleMode,
  type MutableVec3,
  type NarrativeAngles,
  type ViewIntroPose,
} from "@/utils/solarEclipseSpace";
import { LunarEclipseSpaceView } from "@/components/Lab/LunarEclipseSpaceView";
import {
  LUNAR_ART_RADIAL_FACTOR,
  LUNAR_REAL_RADIAL_MAGNIFY_FACTOR,
  LUNAR_SPACE_CAMERA_FAR_UNITS,
  LUNAR_SPACE_CAMERA_NEAR_UNITS,
  LUNAR_SPACE_CAMERA_RADIUS_MAX_UNITS,
  LUNAR_SPACE_CAMERA_RADIUS_MIN_ART_UNITS,
  LUNAR_SPACE_CAMERA_RADIUS_MIN_REAL_UNITS,
  emptyLunarSpaceFrameState,
  lunarDisplayMoonPos,
  lunarMoonCloseupPose,
  lunarRadialScaleForMode,
  lunarSpaceFrameState,
  lunarSpaceHudTruth,
  lunarSpaceOverviewPose,
  lunarSyzygyOffsetRad,
  type LunarSpacePreset,
  type LunarSyzygyMode,
} from "@/utils/lunarEclipseSpace";

import {
  LUNAR_BASE_LIMITING_MAG,
  LUNAR_QUAD_HALF_ANGLE_RAD,
  MOON_VIEW_EARTH_ALT_DEG,
  MOON_VIEW_EARTH_AZ_DEG,
  MOON_VIEW_INTRO_FOV_DEG,
  SELENELION_EVENT_ID,
  activeLunarPhaseKey,
  defaultTurbidityForDanjonL,
  emptyLunarFrameState,
  lunarEclipseAnchors,
  lunarExposureGain,
  lunarFrameState,
  lunarPlayRate,
  lunarSkyColorsWithMoonlight,
  lunarTimelineWindow,
  type LunarPhaseKey,
  type LunarPlayMode,
  type LunarSeriesGroup,
} from "@/utils/lunarEclipseLab";
import { TrackpadLookControls } from "@/components/Lab/TrackpadLookControls";
import { EclipseTimelineScrubber } from "@/components/Lab/EclipseTimelineScrubber";
import { LunarEclipseMoonView } from "@/components/Lab/LunarEclipseMoonView";
import { LunarSelenelionScene } from "@/components/Lab/LunarSelenelionScene";

/** 度 → 弧度（单位换算，非球面公式） */
const DEG = Math.PI / 180;

/** 地面剪影圆盘 y（流星雨/日食同款登记：视觉上与 y=0 等价，防遮挡天空） */
const GROUND_DISK_Y_UNITS = -1.7;

/** 相机初始轨道半径（场景单位，钳制域内；流星雨/日食同值） */
const INITIAL_CAMERA_RADIUS = 1.2;

/** 山脊剖面烘焙种子（确定性；与流星雨/日食异种子——地景剪影独立） */
const LUNAR_RIDGE_SEED = 0x10a4e5;

/** 月面贴图加载优先级（进入场景即请求；2K 单张，无 LRU 压力） */
const MOON_TEXTURE_PRIORITY = 5;

/** 事件 id 联合（契约 C2） */
type LunarEventId = LunarEclipseEventData["id"];

/** 事件页签（§0.1：标题含日期与食型副标题；观测点说明键随页签切换） */
const LUNAR_TABS: ReadonlyArray<{
  id: LunarEventId;
  labelKey: MessageKey;
  observerKey: MessageKey;
}> = [
  {
    id: "l2029",
    labelKey: "lab.lunarTab2029",
    observerKey: "lab.lunarObserver2029",
  },
  {
    id: "l2026",
    labelKey: "lab.lunarTab2026",
    observerKey: "lab.lunarObserver2026",
  },
  {
    id: "l2027",
    labelKey: "lab.lunarTab2027",
    observerKey: "lab.lunarObserver2027",
  },
  {
    id: "l1992",
    labelKey: "lab.lunarTab1992",
    observerKey: "lab.lunarObserver1992",
  },
];

/** 视角档（M4 地面/太空 + M5 月球视角三态——本地三态类型，勿改日食侧二值类型） */
type LunarViewMode = "ground" | "space" | "moon";

/** 月球视角引导提示的一次性关闭持久键（M5-2；localStorage） */
const MOON_GUIDE_DISMISS_KEY = "lunarMoonViewGuideDismissed";

/** 控件状态（M2 播放模式 + M3 浑浊度/曝光/地圆论证/三联对比 + M4 太空档） */
interface LunarSettings {
  playMode: LunarPlayMode;
  /** 大气浑浊度/火山尘埃（0–1；经 turbidityToDanjonL 连续驱动丹戎 L，M3-2） */
  turbidity01: number;
  /** 曝光滑杆位置（0–1 → lunarExposureGain ×0.25–×4；B2 登记） */
  exposure01: number;
  /** 地圆论证：叠加本影边界拟合圆（M3-6；地面档专属） */
  fitCircle: boolean;
  /** 三联对比面板显隐（M3-5；地面档专属） */
  showTriptych: boolean;
  /** M4 视角档 */
  viewMode: LunarViewMode;
  /** M4-3 天体比例档（默认艺术化，决策 ⑦；B13） */
  bodyScaleMode: EclipseBodyScaleMode;
  /** M4-3 真实档径向放大 ×4（默认开，决策 ⑨；B12；艺术化档隐藏） */
  radialMagnify: boolean;
  /** M4-2 月距处影盘剖面（默认开） */
  sectionDisk: boolean;
  /** M4-4 行星轨道远景层（默认开；倾角叙事时自动隐藏——日食同口径） */
  planetOrbits: boolean;
  /** M4-5 交点几何叙事（默认关；B4） */
  inclinationDemo: boolean;
  /** M4-5 朔↔望档（叙事模式内；默认望 = 地影投月球） */
  syzygy: LunarSyzygyMode;
}

/** 帧循环共享 refs（DOM 写入、Canvas 子树 useFrame 读取；场景不订阅 React 状态） */
interface LunarFrameRefs {
  /** 事件时间轴秒（UTC；单值状态源） */
  tSecRef: { current: number };
  /** 播放中 */
  playingRef: { current: boolean };
  /** 当前事件 + 序列组 + 时间窗（渲染期同步；页签切换即更新） */
  eventRef: {
    current: {
      event: LunarEclipseEventData;
      group: LunarSeriesGroup;
      window: EclipseTimelineWindow;
    };
  };
  /** 逐帧状态（LunarTimeDriver 每帧重建，各叶组件只读；挂载期分配一次零 GC） */
  frameRef: { current: ReturnType<typeof emptyLunarFrameState> };
  /** 控件状态（React state 渲染期同步；useFrame 只读） */
  settingsRef: { current: LunarSettings };
  /** M4 太空视角逐帧状态（驱动器在太空档每帧重建；LunarEclipseSpaceView 只读） */
  spaceRef: { current: ReturnType<typeof emptyLunarSpaceFrameState> };
}

/** 叙事轨道环显示倾角（弧度；真实 5.145° × 显示倍率 4——B4 双条目同口径） */
const NARRATIVE_INC_RAD =
  MOON_ORBIT_INCLINATION_DEG * INCLINATION_DISPLAY_FACTOR * DEG;

/**
 * 时间轴推进 + 逐帧状态重建（首个 Canvas 子组件，同优先级 useFrame 按挂载序
 * 先行）：播放时 tSec += delta（钳制 0.1s 防页签切回跳帧）× 播放倍率
 * （B1 加速回放/×1 真实）；到窗口末端自动暂停（onEnded 交互回调）。
 * 随后由 tSec 单值重建 frameRef（纯查表 + C1 影几何解析）。
 */
function LunarTimeDriver({
  refs,
  onEnded,
}: {
  refs: LunarFrameRefs;
  onEnded: () => void;
}): null {
  // M4 倾角叙事草稿（挂载期分配一次；渲染循环零 GC）
  const narrative = useMemo(
    () => ({
      angles: { phaseRad: 0, nodeRad: 0 } as NarrativeAngles,
      posKm: [0, 0, 0] as MutableVec3,
    }),
    [],
  );
  useFrame((_, delta) => {
    const { window: win, event, group } = refs.eventRef.current;
    const s = refs.settingsRef.current;
    const rate = lunarPlayRate(s.playMode, win);
    if (refs.playingRef.current) {
      const next = refs.tSecRef.current + Math.min(delta, 0.1) * rate;
      if (next >= win.endSec) {
        refs.tSecRef.current = win.endSec;
        onEnded();
      } else {
        refs.tSecRef.current = next;
      }
    }
    lunarFrameState(
      group,
      event.observer,
      refs.tSecRef.current,
      refs.frameRef.current,
      turbidityToDanjonL(s.turbidity01),
    );
    // M4 太空视角帧状态（geo 星历 → 影锥度量/双食分/朔态月影锥；只在太空档
    // 重建。倾角叙事时月球位置走夸张倾角轨道（B4），望/朔经 syzygyOffsetRad
    // 参数化（契约 C7——望 = π 地影投月球、朔 = 0 月影投地球）
    if (s.viewMode === "space") {
      let narrativePos: MutableVec3 | null = null;
      if (s.inclinationDemo) {
        narrativeAngles(refs.tSecRef.current, win.startSec, narrative.angles);
        narrativeMoonPosKm(
          narrative.angles.phaseRad,
          narrative.angles.nodeRad,
          NARRATIVE_INC_RAD,
          NARRATIVE_ORBIT_RADIUS_KM,
          narrative.posKm,
          lunarSyzygyOffsetRad(s.syzygy),
        );
        narrativePos = narrative.posKm;
      }
      lunarSpaceFrameState(
        group.geo,
        refs.tSecRef.current,
        narrativePos,
        s.inclinationDemo && s.syzygy === "new",
        refs.spaceRef.current,
      );
    }
  });
  return null;
}

/**
 * M4/M5 视角/预设机位切换运镜 rig（日食 EclipseViewIntroRig 同手法：from/to
 * 姿态 smoothstep 插值 1.6s；期间 OrbitControls 卸载，完成后从当前位姿接管）：
 * - 切太空（全貌）：影轴侧向机位，侧看「地球 → 影锥 → 月球」全序列；
 * - 切太空（月球特写）：月球显示位置外侧回望地心；
 * - 切地面：视线自月亮上方压回月亮 + FOV 广角收束（反转轨道范式）；
 * - 切月球（M5-2）：视线对准地球固定方位 + FOV 收束至封面构图（黑地球 +
 *   红环 + 月壤前景同框）；
 * - 近/远平面按档切换（far ≥ 相机最大半径 + 星穹壳半径——P5 结构性纪律）。
 */
function LunarViewIntroRig({
  refs,
  target,
  onDone,
}: {
  refs: LunarFrameRefs;
  /** 运镜目标（null = 不在运镜期） */
  target: "ground" | "moon" | LunarSpacePreset | null;
  onDone: () => void;
}): null {
  const camera = useThree((s) => s.camera);
  const elapsedRef = useRef(0);
  const doneRef = useRef(false);
  const scratch = useMemo(
    () => ({
      pose: {
        pos: [0, 0, 0] as MutableVec3,
        fovDeg: LAB_FOV_DEFAULT_DEG,
      } as ViewIntroPose,
      moonPos: [0, 0, 0] as MutableVec3,
    }),
    [],
  );

  // 激活即复位计时 + 按目标档切近/远平面（一次性投影参数，交互事件路径）
  useEffect(() => {
    if (!target) return;
    elapsedRef.current = 0;
    doneRef.current = false;
    const pc = camera as THREE.PerspectiveCamera;
    if (target === "ground" || target === "moon") {
      // 地面/月球视角同天穹壳域（契约 C3：月球视角地球画在天穹壳 quad 上）
      pc.near = 0.05;
      pc.far = STAR_DOME_RADIUS_UNITS * 2.5;
    } else {
      pc.near = LUNAR_SPACE_CAMERA_NEAR_UNITS;
      pc.far = LUNAR_SPACE_CAMERA_FAR_UNITS;
    }
    pc.updateProjectionMatrix();
  }, [target, camera]);

  useFrame((_, delta) => {
    if (!target || doneRef.current) return;
    elapsedRef.current += Math.min(delta, 0.1);
    const t01 = Math.min(1, elapsedRef.current / 1.6);
    const pc = camera as THREE.PerspectiveCamera;
    const s = refs.settingsRef.current;
    if (target === "ground") {
      // 视线压回月亮（日食 groundIntroAim 同式的月亮版：直接对准 + FOV 默认）
      const frame = refs.frameRef.current;
      const dir = sceneDirFromAltAz({
        altRad: frame.moonAltDeg * DEG,
        azRad: frame.moonAzDeg * DEG,
      });
      pc.position.set(
        -dir[0] * INITIAL_CAMERA_RADIUS,
        -dir[1] * INITIAL_CAMERA_RADIUS,
        -dir[2] * INITIAL_CAMERA_RADIUS,
      );
      pc.fov = LAB_FOV_DEFAULT_DEG;
    } else if (target === "moon") {
      // M5-2：对准地球固定方位 + FOV 收束至封面构图（smoothstep 插值）
      const dir = sceneDirFromAltAz({
        altRad: MOON_VIEW_EARTH_ALT_DEG * DEG,
        azRad: MOON_VIEW_EARTH_AZ_DEG * DEG,
      });
      pc.position.set(
        -dir[0] * INITIAL_CAMERA_RADIUS,
        -dir[1] * INITIAL_CAMERA_RADIUS,
        -dir[2] * INITIAL_CAMERA_RADIUS,
      );
      const s = t01 * t01 * (3 - 2 * t01);
      pc.fov =
        LAB_FOV_DEFAULT_DEG + (MOON_VIEW_INTRO_FOV_DEG - LAB_FOV_DEFAULT_DEG) * s;
    } else if (target === "closeup") {
      const factor = lunarRadialScaleForMode(s.bodyScaleMode, s.radialMagnify);
      const posFactor = s.inclinationDemo ? 1 : factor;
      lunarDisplayMoonPos(refs.spaceRef.current, posFactor, scratch.moonPos);
      lunarMoonCloseupPose(
        scratch.moonPos,
        MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM * factor,
        t01,
        scratch.pose,
      );
      pc.position.set(
        scratch.pose.pos[0],
        scratch.pose.pos[1],
        scratch.pose.pos[2],
      );
      pc.fov = scratch.pose.fovDeg;
    } else {
      lunarSpaceOverviewPose(
        refs.spaceRef.current.shadowAxisScene,
        t01,
        scratch.pose,
      );
      pc.position.set(
        scratch.pose.pos[0],
        scratch.pose.pos[1],
        scratch.pose.pos[2],
      );
      pc.fov = scratch.pose.fovDeg;
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

/** 页签切换相机指向：对准当前 tSec 的月亮方向（反转轨道范式，交互事件路径） */
function LunarCameraAim({
  refs,
  eventId,
}: {
  refs: LunarFrameRefs;
  eventId: string;
}): null {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    // 太空档不接管相机（页签切换保持太空机位；回地面由运镜 rig 对准）
    if (refs.settingsRef.current.viewMode !== "ground") return;
    const { event, group } = refs.eventRef.current;
    const frame = lunarFrameState(group, event.observer, refs.tSecRef.current);
    const dir = sceneDirFromAltAz({
      altRad: frame.moonAltDeg * DEG,
      azRad: frame.moonAzDeg * DEG,
    });
    camera.position.set(
      -dir[0] * INITIAL_CAMERA_RADIUS,
      -dir[1] * INITIAL_CAMERA_RADIUS,
      -dir[2] * INITIAL_CAMERA_RADIUS,
    );
    camera.lookAt(0, 0, 0);
    // eventId 为依赖：页签切换重新对准新事件月亮
  }, [camera, refs, eventId]);
  return null;
}

// ---------------------------------------------------------------------------
// 天穹叶组件（流星雨/日食同范式；每帧只写 uniforms/材质色，零 buffer 更新）
// ---------------------------------------------------------------------------

const LUNAR_STAR_VERTEX_SHADER = /* glsl */ `
  attribute float aMag;
  uniform mat3 uEqToHor;
  uniform float uLimitingMag;
  uniform float uSize;
  uniform float uScale;
  uniform float uDomeRadius;
  uniform float uPointMax;
  varying vec3 vColor;
  void main() {
    // 极限星等剔除（月光压制 ≈4 等的真实月夜星空基线；M3 接血月亮度链）
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
    vColor = color * brightness;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const LUNAR_STAR_FRAGMENT_SHADER = /* glsl */ `
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
 * （晨昏蒙影 × 月光压制，lunarFrameState 输出）。
 */
function LunarStarDome({
  stars,
  refs,
  starPointMaxPx,
}: {
  stars: readonly YaleBrightStar[];
  refs: LunarFrameRefs;
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
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aMag", new THREE.BufferAttribute(mags, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uEqToHor: { value: new THREE.Matrix3() },
        uLimitingMag: { value: 2.5 },
        uSize: { value: 30 },
        uScale: { value: 400 },
        uDomeRadius: { value: STAR_DOME_RADIUS_UNITS },
        uPointMax: { value: starPointMaxPx },
      },
      vertexShader: LUNAR_STAR_VERTEX_SHADER,
      fragmentShader: LUNAR_STAR_FRAGMENT_SHADER,
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
    const lst = lstRadFromUnixSec(refs.tSecRef.current, event.observer.lonDeg);
    const m = equatorialToHorizontalMatrix(event.observer.latDeg, lst);
    (material.uniforms.uEqToHor.value as THREE.Matrix3).set(...m);
  });

  return (
    <points geometry={geometry} material={material} frustumCulled={false} />
  );
}

const LUNAR_SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LUNAR_SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float band = pow(1.0 - abs(dir.y), 3.0);
    gl_FragColor = vec4(mix(uZenith, uHorizon, band), 1.0);
  }
`;

/**
 * 夜天光穹壳（LabSkyDome 同式竖直渐变；太阳高度来自烘焙 topo 行——四事件
 * 全窗太阳在地平下，晨昏蒙影由 labSkyColors 自然承载。M3-3：月光环境项
 * 随月面亮度联动——全食段天光同步变暗，lunarSkyColorsWithMoonlight 单一事实源）。
 */
function LunarSkyDome({ refs }: { refs: LunarFrameRefs }): JSX.Element {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: new THREE.Color(0, 0, 0) },
          uHorizon: { value: new THREE.Color(0, 0, 0) },
        },
        vertexShader: LUNAR_SKY_VERTEX_SHADER,
        fragmentShader: LUNAR_SKY_FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  );
  const sky = useMemo(() => emptyLabSkyColors(), []);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const frame = refs.frameRef.current;
    // 本条目无光害控件，lm 固定 6.5（深空基线）；月光项随月面亮度联动
    lunarSkyColorsWithMoonlight(
      LUNAR_BASE_LIMITING_MAG,
      frame.sunAltDeg * DEG,
      frame.moonBrightness01,
      frame.moonAltDeg,
      sky,
    );
    (material.uniforms.uZenith.value as THREE.Color).setRGB(
      sky.zenith[0],
      sky.zenith[1],
      sky.zenith[2],
    );
    (material.uniforms.uHorizon.value as THREE.Color).setRGB(
      sky.horizon[0],
      sky.horizon[1],
      sky.horizon[2],
    );
  });

  return (
    <mesh material={material} frustumCulled={false}>
      <sphereGeometry
        args={[STAR_DOME_RADIUS_UNITS * SKY_DOME_RADIUS_FACTOR, 48, 24]}
      />
    </mesh>
  );
}

/** 地面剪影圆盘（GroundDisk 同范式：色 = 夜天光反照 + 月光联动，M3-3—— 全食段地面反照同步变暗的环境说服力链） */
function LunarGroundDisk({ refs }: { refs: LunarFrameRefs }): JSX.Element {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const tmp = useMemo(
    () => ({
      sky: emptyLabSkyColors(),
      ground: [0, 0, 0] as [number, number, number],
    }),
    [],
  );

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    const frame = refs.frameRef.current;
    lunarSkyColorsWithMoonlight(
      LUNAR_BASE_LIMITING_MAG,
      frame.sunAltDeg * DEG,
      frame.moonBrightness01,
      frame.moonAltDeg,
      tmp.sky,
    );
    labGroundColor(tmp.sky, tmp.ground);
    material.color.setRGB(tmp.ground[0], tmp.ground[1], tmp.ground[2]);
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_DISK_Y_UNITS, 0]}>
      <circleGeometry args={[STAR_DOME_RADIUS_UNITS, 96]} />
      <meshBasicMaterial
        ref={materialRef}
        color="#04060a"
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** 地平山脊剪影带（HorizonRidge 同范式；几何烘焙一次，每帧只写材质色） */
function LunarHorizonRidge({ refs }: { refs: LunarFrameRefs }): JSX.Element {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  const geometry = useMemo(() => {
    const profile = ridgeHeightProfile(RIDGE_SEGMENTS, LUNAR_RIDGE_SEED);
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
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const tmp = useMemo(
    () => ({
      sky: emptyLabSkyColors(),
      ground: [0, 0, 0] as [number, number, number],
    }),
    [],
  );

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    const frame = refs.frameRef.current;
    lunarSkyColorsWithMoonlight(
      LUNAR_BASE_LIMITING_MAG,
      frame.sunAltDeg * DEG,
      frame.moonBrightness01,
      frame.moonAltDeg,
      tmp.sky,
    );
    labGroundColor(tmp.sky, tmp.ground);
    material.color.setRGB(
      tmp.ground[0] * RIDGE_DARKEN_FACTOR,
      tmp.ground[1] * RIDGE_DARKEN_FACTOR,
      tmp.ground[2] * RIDGE_DARKEN_FACTOR,
    );
  });

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        ref={materialRef}
        color="#010203"
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 月盘 quad（M2-4 骨架 + M3-1 血月着色；契约 C3/C4）
// ---------------------------------------------------------------------------

// M4：umbraShading GLSL 镜像段抽至 lunarBloodMoonGlsl.ts 共享；M5：月盘
// quad shader 与材质工厂整体抽至 lunarMoonDiskMaterial.ts（契约 C4 单点：
// 地面 quad / 三联对比 / selenelion 彩蛋三处消费同一工厂，禁第二套实现）。

/**
 * 月盘 quad（1 draw call；渲染循环零 buffer 更新——贴图事件级一次性设置，
 * 逐帧只写位姿与标量/vec2 uniform；真实视半径渲染，细节靠 FOV 缩放）
 */
function LunarMoonQuad({ refs }: { refs: LunarFrameRefs }): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const moonTexture = useBitmapTexture(
    textureUrl("moon", "surface"),
    MOON_TEXTURE_PRIORITY,
    true,
  );
  const material = useMemo(() => createLunarMoonMaterial(), []);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  // 月面贴图：加载完成一次性换 uniform（交互/加载事件路径，非逐帧）
  useEffect(() => {
    material.uniforms.uMoonTex.value = moonTexture;
    material.uniforms.uHasTex.value = moonTexture ? 1 : 0;
  }, [material, moonTexture]);

  // quad 边长：天穹壳距离 × tan(半角) × 2（真实角尺度 → 场景 km）
  const quadSize =
    2 * SKY_SHELL_RADIUS_KM * Math.tan(LUNAR_QUAD_HALF_ANGLE_RAD);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const frame = refs.frameRef.current;
    const dir = sceneDirFromAltAz({
      altRad: frame.moonAltDeg * DEG,
      azRad: frame.moonAzDeg * DEG,
    });
    mesh.position.set(
      dir[0] * SKY_SHELL_RADIUS_KM,
      dir[1] * SKY_SHELL_RADIUS_KM,
      dir[2] * SKY_SHELL_RADIUS_KM,
    );
    // lookAt 原点：本地 +Y = 高度角向、+X = 方位角减小向（日食 quad 同约定）
    mesh.lookAt(0, 0, 0);
    material.uniforms.uMoonR.value = frame.moonSdDeg * DEG;
    // 本地系换算：x = −东向偏移（+X 朝方位角减小向）、y = 高度向偏移
    (material.uniforms.uShadowOffset.value as THREE.Vector2).set(
      -frame.shadowOffEastRad,
      frame.shadowOffUpRad,
    );
    material.uniforms.uUmbraR.value = frame.umbraRadRad;
    material.uniforms.uPenumbraR.value = frame.penumbraRadRad;
    // M3 控件 uniform（标量，零 buffer 更新）：丹戎 L/曝光/拟合圆开关
    const settings = refs.settingsRef.current;
    material.uniforms.uDanjonL.value = turbidityToDanjonL(settings.turbidity01);
    material.uniforms.uExposure.value = lunarExposureGain(settings.exposure01);
    material.uniforms.uFitCircle.value = settings.fitCircle ? 1 : 0;
  });

  return (
    <mesh
      ref={meshRef}
      material={material}
      frustumCulled={false}
      renderOrder={1}
    >
      <planeGeometry args={[quadSize, quadSize]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 三联对比（M3-5）：半影/偏食/全食三事件食甚状态并列——同一 shader 镜像换
// uniform 三份小视口（独立小 Canvas，frameloop="demand"，3 draw call；
// 契约 C4 禁止复制出第二套着色实现）
// ---------------------------------------------------------------------------

/** 三联对比栏事件序（半影 → 偏食 → 全食；各取该事件食甚 tSec 的静态状态） */
const TRIPTYCH_PANES: ReadonlyArray<{
  id: LunarEventId;
  labelKey: MessageKey;
}> = [
  { id: "l2027", labelKey: "lab.lunarTriptychPenumbral" },
  { id: "l2026", labelKey: "lab.lunarTriptychPartial" },
  { id: "l2029", labelKey: "lab.lunarTriptychTotal" },
];

/** 三联小视口月盘半角裕量（月盘占视口 ~74%，留缺口与软化边） */
const TRIPTYCH_HALF_ANGLE_FACTOR = 1.35;

/** 三联小视口 plane 边长 / 间距（正交场景单位） */
const TRIPTYCH_PANE_SIZE = 2.2;
const TRIPTYCH_PANE_PITCH = 2.3;

/** 单面板静态 uniform 子集（食甚帧状态一次性求出，不逐帧） */
interface TriptychPaneState {
  moonRRad: number;
  offEastRad: number;
  offUpRad: number;
  umbraRadRad: number;
  penumbraRadRad: number;
}

/** 三事件食甚状态 → 面板 uniform 子集（挂载期一次；纯查表 + C1 解析） */
function triptychPaneStates(
  events: LunarEclipseEventData[],
): TriptychPaneState[] {
  return TRIPTYCH_PANES.map(({ id }) => {
    const ev = events.find((e) => e.id === id) ?? events[0];
    const f = lunarFrameState(
      { topo: ev.topo, geo: ev.geo },
      ev.observer,
      ev.contacts.max,
    );
    return {
      moonRRad: f.moonSdDeg * DEG,
      offEastRad: f.shadowOffEastRad,
      offUpRad: f.shadowOffUpRad,
      umbraRadRad: f.umbraRadRad,
      penumbraRadRad: f.penumbraRadRad,
    };
  });
}

/**
 * 三联视口内层（Canvas 子树）：静态 uniform 挂载期一次写入；丹戎 L/曝光
 * 变化经 useEffect 更新并 invalidate（frameloop="demand"——无逐帧循环，
 * 面板闲置零 GPU 开销）。相机 zoom 按视口尺寸适配三面板宽度。
 */
function TriptychDisks({
  panes,
  danjonL,
  exposureGain,
  moonTexture,
}: {
  panes: TriptychPaneState[];
  danjonL: number;
  exposureGain: number;
  moonTexture: THREE.Texture | null;
}): JSX.Element {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const materials = useMemo(
    () => panes.map(() => createLunarMoonMaterial()),
    [panes],
  );
  useEffect(() => {
    return () => {
      for (const m of materials) m.dispose();
    };
  }, [materials]);

  // 静态几何 uniform（食甚状态；面板间只差 uniform——契约 C4 单镜像纪律）
  useEffect(() => {
    for (let i = 0; i < panes.length; i += 1) {
      const p = panes[i];
      const u = materials[i].uniforms;
      u.uHalfAngle.value = p.moonRRad * TRIPTYCH_HALF_ANGLE_FACTOR;
      u.uMoonR.value = p.moonRRad;
      (u.uShadowOffset.value as THREE.Vector2).set(-p.offEastRad, p.offUpRad);
      u.uUmbraR.value = p.umbraRadRad;
      u.uPenumbraR.value = p.penumbraRadRad;
    }
    invalidate();
  }, [panes, materials, invalidate]);

  // 动态 uniform（丹戎 L/曝光随控件；贴图加载完成一次性换）
  useEffect(() => {
    for (const m of materials) {
      m.uniforms.uDanjonL.value = danjonL;
      m.uniforms.uExposure.value = exposureGain;
      m.uniforms.uMoonTex.value = moonTexture;
      m.uniforms.uHasTex.value = moonTexture ? 1 : 0;
    }
    invalidate();
  }, [materials, danjonL, exposureGain, moonTexture, invalidate]);

  // 正交相机适配（三面板总宽 ~7 单位、高 ~2.3 单位）
  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = Math.min(
      size.width / (TRIPTYCH_PANE_PITCH * 3 + 0.2),
      size.height / (TRIPTYCH_PANE_SIZE + 0.1),
    );
    ortho.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);

  return (
    <>
      {panes.map((p, i) => (
        <mesh
          // 静态三面板（挂载期定序，无重排；index key 安全）
          key={i}
          material={materials[i]}
          position={[(i - 1) * TRIPTYCH_PANE_PITCH, 0, 0]}
        >
          <planeGeometry args={[TRIPTYCH_PANE_SIZE, TRIPTYCH_PANE_SIZE]} />
        </mesh>
      ))}
    </>
  );
}

/**
 * 三联对比条（DOM 容器 + 小 Canvas + 标签行）：半影/偏食/全食食甚并列，
 * 配诚实文案「半影这一栏你几乎看不见任何变化」（§1.4——诚实呈现优先）。
 */
function LunarTriptychStrip({
  events,
  turbidity01,
  exposure01,
}: {
  events: LunarEclipseEventData[];
  turbidity01: number;
  exposure01: number;
}): JSX.Element {
  const tr = useT();
  const panes = useMemo(() => triptychPaneStates(events), [events]);
  const moonTexture = useBitmapTexture(
    textureUrl("moon", "surface"),
    MOON_TEXTURE_PRIORITY,
    true,
  );
  return (
    <div className="mb-2 rounded bg-white/5 p-1.5">
      <div className="h-20 w-full overflow-hidden rounded bg-black/70">
        <Canvas
          flat
          frameloop="demand"
          orthographic
          camera={{ position: [0, 0, 10], zoom: 30 }}
          gl={{ antialias: true }}
          dpr={[1, 2]}
        >
          <TriptychDisks
            panes={panes}
            danjonL={turbidityToDanjonL(turbidity01)}
            exposureGain={lunarExposureGain(exposure01)}
            moonTexture={moonTexture}
          />
        </Canvas>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[9px] leading-tight text-gray-400">
        {TRIPTYCH_PANES.map((pane) => (
          <span key={pane.id}>{tr(pane.labelKey)}</span>
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-gray-300">
        {tr("lab.lunarTriptychHonest")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 场景主组件（DOM 覆盖层订阅 locale；Canvas 子树不订阅——3D locale 纪律）
// ---------------------------------------------------------------------------

/** HUD 状态（500ms interval 经纯函数计算） */
interface LunarHudState {
  utcText: string;
  rateText: string;
  kindKey: MessageKey;
  umbralMagText: string;
  penumbralMagText: string;
  moonAltText: string;
  moonDiamText: string;
  /** M4 太空档恒真值行（不随档位/开关变化——比例恒等红线的用户可见侧） */
  coneLenText: string;
  moonDistText: string;
  umbraWidthText: string;
  umbraRatioText: string;
  coneRatioText: string;
}

/** 食型 → i18n 键（lunarEclipseKind 实时判定，不硬编码事件类型） */
const KIND_LABEL_KEYS: Record<LunarEclipseKind, MessageKey> = {
  none: "lab.lunarKindNone",
  penumbral: "lab.lunarKindPenumbral",
  partial: "lab.lunarKindPartial",
  total: "lab.lunarKindTotal",
};

/** 阶段科普卡键 → i18n 文案键（七接触点；缺省锚点区段自动跳过） */
const PHASE_CARD_KEYS: Record<LunarPhaseKey, MessageKey> = {
  p1: "lab.lunarCardP1",
  u1: "lab.lunarCardU1",
  u2: "lab.lunarCardU2",
  max: "lab.lunarCardMax",
  u3: "lab.lunarCardU3",
  u4: "lab.lunarCardU4",
  p4: "lab.lunarCardP4",
};

/** M4-6 日食 vs 月食对比表（底稿 §八整表全量入 i18n；[维度, 日食, 月食] 键三元组） */
const LUNAR_COMPARE_ROWS: ReadonlyArray<
  readonly [MessageKey, MessageKey, MessageKey]
> = [
  ["lab.lunarCompareRow1Dim", "lab.lunarCompareRow1Solar", "lab.lunarCompareRow1Lunar"],
  ["lab.lunarCompareRow2Dim", "lab.lunarCompareRow2Solar", "lab.lunarCompareRow2Lunar"],
  ["lab.lunarCompareRow3Dim", "lab.lunarCompareRow3Solar", "lab.lunarCompareRow3Lunar"],
  ["lab.lunarCompareRow4Dim", "lab.lunarCompareRow4Solar", "lab.lunarCompareRow4Lunar"],
  ["lab.lunarCompareRow5Dim", "lab.lunarCompareRow5Solar", "lab.lunarCompareRow5Lunar"],
  ["lab.lunarCompareRow6Dim", "lab.lunarCompareRow6Solar", "lab.lunarCompareRow6Lunar"],
  ["lab.lunarCompareRow7Dim", "lab.lunarCompareRow7Solar", "lab.lunarCompareRow7Lunar"],
  ["lab.lunarCompareRow8Dim", "lab.lunarCompareRow8Solar", "lab.lunarCompareRow8Lunar"],
  ["lab.lunarCompareRow9Dim", "lab.lunarCompareRow9Solar", "lab.lunarCompareRow9Lunar"],
  ["lab.lunarCompareRow10Dim", "lab.lunarCompareRow10Solar", "lab.lunarCompareRow10Lunar"],
  ["lab.lunarCompareRow11Dim", "lab.lunarCompareRow11Solar", "lab.lunarCompareRow11Lunar"],
  ["lab.lunarCompareRow12Dim", "lab.lunarCompareRow12Solar", "lab.lunarCompareRow12Lunar"],
  ["lab.lunarCompareRow13Dim", "lab.lunarCompareRow13Solar", "lab.lunarCompareRow13Lunar"],
  ["lab.lunarCompareRow14Dim", "lab.lunarCompareRow14Solar", "lab.lunarCompareRow14Lunar"],
];

/** 丹戎档位描述键（底稿 §六 逐级目视描述直译；滑杆连续值四舍五入取档） */
const DANJON_DESC_KEYS: Record<0 | 1 | 2 | 3 | 4, MessageKey> = {
  0: "lab.lunarDanjonDesc0",
  1: "lab.lunarDanjonDesc1",
  2: "lab.lunarDanjonDesc2",
  3: "lab.lunarDanjonDesc3",
  4: "lab.lunarDanjonDesc4",
};

/** 事件已就绪后的场景 + 控件（数据 ready 前由外层 gate，见 LunarEclipseLab） */
function LunarExperience({
  data,
}: {
  data: { events: LunarEclipseEventData[] };
}): JSX.Element {
  const tr = useT();
  const entry = labEntryForId("lunar-eclipse");
  const { stars } = useYaleBrightStars();

  const [eventId, setEventId] = useState<LunarEventId>("l2029");
  const [playing, setPlaying] = useState(false);
  const event = useMemo(
    () => data.events.find((e) => e.id === eventId) ?? data.events[0],
    [data, eventId],
  );
  const group = useMemo<LunarSeriesGroup>(
    () => ({ topo: event.topo, geo: event.geo }),
    [event],
  );
  const window_ = useMemo(() => lunarTimelineWindow(event.contacts), [event]);
  // 七锚点（契约 C7 数据驱动：偏食 5 / 半影食 3，按 contacts 缺省传子集）
  const anchors = useMemo<EclipseTimelineAnchor[]>(
    () => lunarEclipseAnchors(event.contacts),
    [event],
  );

  // 控件状态（DOM 写 React state → 渲染期同步 ref）；浑浊度初值 = 页签
  // danjonDefault 的逆映射（l2029 教学预设 L2；l1992 皮纳图博实测 L0）
  const [settings, setSettings] = useState<LunarSettings>(() => ({
    playMode: "fast",
    turbidity01: defaultTurbidityForDanjonL(event.danjonDefault),
    exposure01: 0.5,
    fitCircle: false,
    showTriptych: false,
    // M4 太空档初值（决策 ⑦⑨⑩：默认艺术化 + ×4 开 + 观感层/剖面盘开）
    viewMode: "ground",
    bodyScaleMode: "art",
    radialMagnify: true,
    sectionDisk: true,
    planetOrbits: true,
    inclinationDemo: false,
    syzygy: "full",
  }));

  // M4/M5 视角/预设运镜期（OrbitControls 卸载 gate；rig 完成回调解除）+
  // 当前预设机位（全貌/月球特写一键切换）
  const [viewTransition, setViewTransition] = useState<
    "ground" | "moon" | LunarSpacePreset | null
  >(null);
  // M4-6 对比卡折叠态
  const [showCompare, setShowCompare] = useState(false);

  // scrubber 显示值（拖动即时更新；播放期间由 500ms tick 从 tSecRef 回同步）
  const [scrubSec, setScrubSec] = useState<number>(event.contacts.p1);

  // 帧循环共享 refs（渲染期同步赋值：useFrame 读到的永远是最新事件/播放态）
  const tSecRef = useRef(event.contacts.p1);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const eventRef = useRef({ event, group, window: window_ });
  eventRef.current = { event, group, window: window_ };
  const frameRef = useRef(emptyLunarFrameState());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const spaceRef = useRef(emptyLunarSpaceFrameState());
  const refs: LunarFrameRefs = useMemo(
    () => ({ tSecRef, playingRef, eventRef, frameRef, settingsRef, spaceRef }),
    [],
  );

  // M5-2 月球视角引导提示（因果闭环叙事：先见血月 → 提示切月球视角看红环；
  // 一次性/可关——localStorage 持久，去过月球视角或手动关闭后不再出现）
  const [moonGuideDismissed, setMoonGuideDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(MOON_GUIDE_DISMISS_KEY) === "1";
  });
  const dismissMoonGuide = (): void => {
    setMoonGuideDismissed(true);
    try {
      window.localStorage.setItem(MOON_GUIDE_DISMISS_KEY, "1");
    } catch {
      // 隐私模式等存储不可用时仅本会话关闭
    }
  };

  // M5-3 selenelion 彩蛋场景开关（l1992 页签科普卡「亲眼看看」入口）
  const [selenelionOpen, setSelenelionOpen] = useState(false);

  /** M4/M5 视角切换（tSec 跨视角保持；1.6s 运镜至目标档默认机位） */
  const handleViewChange = (mode: LunarViewMode): void => {
    if (mode === settings.viewMode) return;
    setSettings((s) => ({ ...s, viewMode: mode }));
    setViewTransition(mode === "space" ? "overview" : mode);
    // 用户已抵达月球视角——引导提示完成使命（一次性，M5-2）
    if (mode === "moon") dismissMoonGuide();
  };

  /** M4-3 天体比例档切换（太空档内切档触发 1.6s 运镜回全貌默认机位） */
  const handleScaleModeChange = (mode: EclipseBodyScaleMode): void => {
    if (mode === settings.bodyScaleMode) return;
    setSettings((s) => ({ ...s, bodyScaleMode: mode }));
    if (settings.viewMode === "space") setViewTransition("overview");
  };

  /** M4-2 预设机位一键切换（全貌/月球特写 + 运镜插值） */
  const handlePreset = (preset: LunarSpacePreset): void => {
    setViewTransition(preset);
  };

  // M6 移动端底部抽屉展开态（<sm 生效；日食同范式，默认收起防遮挡场景）
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 画质档（流星雨同链：挂载时判定一次；reduced 关 Bloom、DPR≤2）
  const [quality] = useState<LabQualityParams>(() =>
    labQualityParams(
      typeof window === "undefined"
        ? "full"
        : labQualityTier({
            dpr: window.devicePixelRatio,
            userAgent: navigator.userAgent,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number })
              .deviceMemory,
          }),
    ),
  );

  /** 页签切换：暂停 + 时间轴对齐新事件 P1（日食 §3.5 同范式）+ 浑浊度
   *  重置为该事件 danjonDefault（l1992 默认即 L=0 极暗，M3-2） */
  const handleEventChange = (id: LunarEventId): void => {
    if (id === eventId) return;
    setPlaying(false);
    const next = data.events.find((e) => e.id === id) ?? data.events[0];
    tSecRef.current = next.contacts.p1;
    setScrubSec(next.contacts.p1);
    setEventId(id);
    setSettings((s) => ({
      ...s,
      turbidity01: defaultTurbidityForDanjonL(next.danjonDefault),
    }));
  };

  /** scrubber seek（交互事件路径：写 ref + 显示值；效果由 tSec 单值重建） */
  const handleSeek = (tSec: number): void => {
    tSecRef.current = tSec;
    setScrubSec(tSec);
  };

  // HUD：500ms interval 经纯函数读 ref 计算（DOM 层，不进 useFrame）
  const [hud, setHud] = useState<LunarHudState>({
    utcText: "--:--:--",
    rateText: "×1",
    kindKey: "lab.lunarKindNone",
    umbralMagText: "—",
    penumbralMagText: "—",
    moonAltText: "—",
    moonDiamText: "—",
    coneLenText: "—",
    moonDistText: "—",
    umbraWidthText: "—",
    umbraRatioText: "—",
    coneRatioText: "—",
  });
  const [phaseKey, setPhaseKey] = useState<LunarPhaseKey>("p1");

  useEffect(() => {
    const tick = (): void => {
      const { event: ev, group: g, window: win } = eventRef.current;
      const tSec = tSecRef.current;
      const frame = lunarFrameState(
        g,
        ev.observer,
        tSec,
        undefined,
        turbidityToDanjonL(settingsRef.current.turbidity01),
      );
      const rate = lunarPlayRate(settingsRef.current.playMode, win);
      // M4 太空档恒真值行（km 域真值，径向因子不入——B12/B13 用户可见侧；
      // 倾角叙事的示意轨道下月距 = 叙事半径，属演示语义）
      let coneLenText = "—";
      let moonDistText = "—";
      let umbraWidthText = "—";
      let umbraRatioText = "—";
      let coneRatioText = "—";
      if (settingsRef.current.viewMode === "space") {
        const truth = lunarSpaceHudTruth(spaceRef.current);
        coneLenText = `${Math.round(truth.coneLengthKm).toLocaleString("en-US")} km`;
        moonDistText = `${Math.round(truth.moonDistKm).toLocaleString("en-US")} km`;
        if (truth.umbraRadiusKm > 0) {
          umbraWidthText = `${Math.round(truth.umbraRadiusKm * 2).toLocaleString("en-US")} km`;
          umbraRatioText = `×${truth.umbraPerMoonDiam.toFixed(2)} / ×${truth.umbraPerEarthRadius.toFixed(2)}`;
        }
        if (truth.coneLenPerMoonDist > 0) {
          coneRatioText = `×${truth.coneLenPerMoonDist.toFixed(2)}`;
        }
      }
      const next: LunarHudState = {
        utcText: formatUtcClock(tSec),
        rateText: `×${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)}`,
        kindKey: KIND_LABEL_KEYS[frame.kind],
        umbralMagText: frame.umbralMag.toFixed(3),
        penumbralMagText: frame.penumbralMag.toFixed(3),
        moonAltText: `${frame.moonAltDeg.toFixed(1)}°`,
        moonDiamText: formatAngularDiameterDeg(frame.moonSdDeg),
        coneLenText,
        moonDistText,
        umbraWidthText,
        umbraRatioText,
        coneRatioText,
      };
      setHud((prev) =>
        prev.utcText === next.utcText &&
        prev.rateText === next.rateText &&
        prev.kindKey === next.kindKey &&
        prev.umbralMagText === next.umbralMagText &&
        prev.penumbralMagText === next.penumbralMagText &&
        prev.moonAltText === next.moonAltText &&
        prev.moonDiamText === next.moonDiamText &&
        prev.coneLenText === next.coneLenText &&
        prev.moonDistText === next.moonDistText &&
        prev.umbraWidthText === next.umbraWidthText &&
        prev.umbraRatioText === next.umbraRatioText &&
        prev.coneRatioText === next.coneRatioText
          ? prev
          : next,
      );
      setPhaseKey(activeLunarPhaseKey(tSec, ev.contacts));
      // 播放期间回同步 scrubber 显示值（拖动路径由 handleSeek 即时更新）
      if (playingRef.current) setScrubSec(tSecRef.current);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  const activeTab = LUNAR_TABS.find((t) => t.id === eventId) ?? LUNAR_TABS[0];

  // M5-3 selenelion 彩蛋场景（独立小场景换入；主场景 tSec/控件状态由本层
  // state/refs 保持，退出即还原；同 chunk 内条件挂载——主路径 bundle 零增）
  if (selenelionOpen) {
    const selEvent =
      data.events.find((e) => e.id === SELENELION_EVENT_ID) ?? data.events[0];
    return (
      <LunarSelenelionScene
        group={{ topo: selEvent.topo, geo: selEvent.geo }}
        turbidity01={settings.turbidity01}
        exposure01={settings.exposure01}
        bloomEnabled={quality.bloomEnabled}
        onClose={() => {
          setSelenelionOpen(false);
          // 主 Canvas 重挂后经运镜 rig 恢复当前视角档的近/远平面与默认机位
          // （太空档 Canvas 初始相机为地面域参数，必须经 rig 重设——P5 纪律）
          setViewTransition(
            settings.viewMode === "space" ? "overview" : settings.viewMode,
          );
        }}
      />
    );
  }

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
        <color attach="background" args={["#000004"]} />
        <LunarTimeDriver refs={refs} onEnded={() => setPlaying(false)} />
        <LunarCameraAim refs={refs} eventId={eventId} />
        {/* M4 视角/预设机位运镜（1.6s 插值；期间相机控制器卸载） */}
        <LunarViewIntroRig
          refs={refs}
          target={viewTransition}
          onDone={() => setViewTransition(null)}
        />
        {settings.viewMode === "ground" && (
          <>
            <LunarSkyDome refs={refs} />
            {stars && (
              <LunarStarDome
                stars={stars}
                refs={refs}
                starPointMaxPx={quality.starPointMaxPx}
              />
            )}
            <LunarMoonQuad refs={refs} />
            <LunarGroundDisk refs={refs} />
            <LunarHorizonRidge refs={refs} />
          </>
        )}
        {/* M5-1 月球视角（黑地球盘 + 红环壳 + 月壤前景；红环与浑浊度滑杆
            同一状态源——因果闭环；draw call 4 ≤ 10） */}
        {settings.viewMode === "moon" && (
          <LunarEclipseMoonView
            refs={refs}
            stars={stars}
            starPointMaxPx={quality.starPointMaxPx}
          />
        )}
        {settings.viewMode === "space" && (
          /* M4 太空视角（地影锥全貌 + 月球穿影 + M7 观感层 + 望态叙事；
             倾角叙事开启时行星层自动隐藏——日食同口径；reduced 档银河带/
             小行星带随 labQualityParams 关闭，B14） */
          <LunarEclipseSpaceView
            refs={refs}
            stars={stars}
            starPointMaxPx={quality.starPointMaxPx}
            milkyWay={quality.bloomEnabled}
            bodyScaleMode={settings.bodyScaleMode}
            radialMagnify={settings.radialMagnify}
            sectionDisk={settings.sectionDisk}
            planetOrbits={settings.planetOrbits && !settings.inclinationDemo}
            inclinationDemo={settings.inclinationDemo}
            syzygy={settings.syzygy}
            asteroidBelt={quality.bloomEnabled}
          />
        )}
        {/* 相机控制器（运镜期卸载防争抢；结束后从当前位姿接管——日食同范式；
            太空档 OrbitControls 原生单指旋转/双指捏合） */}
        {!viewTransition &&
          (settings.viewMode !== "space" ? (
            /* 地面/月球视角同款反转轨道相机（月球视角小范围环顾 + FOV 缩放，
               契约 C3 月球视角段） */
            <OrbitControls
              key={`${settings.viewMode}-${eventId}`}
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
              minDistance={
                settings.bodyScaleMode === "art"
                  ? LUNAR_SPACE_CAMERA_RADIUS_MIN_ART_UNITS
                  : LUNAR_SPACE_CAMERA_RADIUS_MIN_REAL_UNITS
              }
              maxDistance={LUNAR_SPACE_CAMERA_RADIUS_MAX_UNITS}
              enablePan={false}
              enableZoom
              minPolarAngle={0.03}
              maxPolarAngle={Math.PI - 0.03}
              rotateSpeed={0.5}
              enableDamping
              dampingFactor={0.12}
            />
          ))}
        {settings.viewMode !== "space" && !viewTransition && (
          <TrackpadLookControls />
        )}
        {/* 后期：Bloom + ACES（lab 既有底座；无双基准曝光状态机，契约 C4） */}
        {quality.bloomEnabled ? (
          <EffectComposer multisampling={4}>
            <Bloom
              intensity={0.6}
              luminanceThreshold={0.6}
              luminanceSmoothing={0.2}
              mipmapBlur
            />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        ) : (
          <EffectComposer multisampling={0}>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
      </Canvas>

      {/* 左上：返回实验室 + 条目标题（safe-area 避让，日食同范式） */}
      <div className="absolute left-[max(1rem,env(safe-area-inset-left))] top-[max(1rem,env(safe-area-inset-top))] select-none rounded-lg bg-black/60 px-3 py-2 text-xs text-gray-100 backdrop-blur">
        <Link
          href={LAB_PAGE_PATH}
          className="text-space-accent hover:underline"
        >
          ← {tr("lab.backToLab")}
        </Link>
        {entry && (
          <div className="mt-1 font-semibold text-sky-300 max-sm:hidden">
            {tr(entry.titleKey)}
          </div>
        )}
      </div>

      {/* 右上：事件页签 + 观测点 + HUD + 阶段科普卡 + 数据来源（可滚动）。
          <sm 转底部抽屉（日食/ObservatoryHarness 同范式——标题栏常显 +
          ▾/▴ 开合钮 ≥44pt + aria-expanded + safe-area 底衬） */}
      <div className="absolute right-3 top-3 max-h-[calc(100vh-8rem)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg bg-black/65 p-3 text-xs text-gray-100 backdrop-blur max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:max-h-[55vh] max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sky-300">
            {tr("lab.lunarPanelTitle")}
          </h2>
          <button
            type="button"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-expanded={drawerOpen}
            aria-label={tr(
              drawerOpen ? "lab.panelCollapseAria" : "lab.panelExpandAria",
            )}
            className="-my-2 flex h-11 w-11 items-center justify-center rounded text-sky-300 transition-colors hover:bg-white/10 sm:hidden"
          >
            {drawerOpen ? "▾" : "▴"}
          </button>
        </div>
        <div className={`mt-2 ${drawerOpen ? "" : "max-sm:hidden"}`}>
          <div
            role="tablist"
            aria-label={tr("lab.lunarTabAria")}
            className="mb-2 grid grid-cols-2 gap-1"
          >
            {LUNAR_TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={eventId === tab.id}
                onClick={() => handleEventChange(tab.id)}
                className={`rounded px-1 py-1.5 text-[10px] leading-tight transition-colors max-md:min-h-11 ${
                  eventId === tab.id
                    ? "bg-sky-500/30 font-semibold text-sky-200"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                }`}
              >
                {tr(tab.labelKey)}
              </button>
            ))}
          </div>
          <p className="mb-2 text-[10px] leading-snug text-gray-400">
            {tr(activeTab.observerKey)}
          </p>
          {/* HUD：UTC/倍速/阶段/双食分/月高/月视直径（真实值常显，
              契约 C3 + B1 登记） */}
          <div className="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded bg-sky-950/60 px-2 py-1 font-mono text-[11px] text-sky-200">
            <span className="text-gray-400">{tr("lab.lunarHudUtc")}</span>
            <span>{hud.utcText}</span>
            <span className="text-gray-400">{tr("lab.lunarHudRate")}</span>
            <span>{hud.rateText}</span>
            <span className="text-gray-400">{tr("lab.lunarHudKind")}</span>
            <span>{tr(hud.kindKey)}</span>
            <span className="text-gray-400">
              {tr("lab.lunarHudUmbralMag")}
            </span>
            <span>{hud.umbralMagText}</span>
            <span className="text-gray-400">
              {tr("lab.lunarHudPenumbralMag")}
            </span>
            <span>{hud.penumbralMagText}</span>
            <span className="text-gray-400">{tr("lab.lunarHudDanjon")}</span>
            <span>L={turbidityToDanjonL(settings.turbidity01).toFixed(1)}</span>
            <span className="text-gray-400">{tr("lab.lunarHudMoonAlt")}</span>
            <span>{hud.moonAltText}</span>
            <span className="text-gray-400">{tr("lab.lunarHudMoonDiam")}</span>
            <span>{hud.moonDiamText}</span>
            {/* M4 太空档：档位/倍率徽标 + 恒真值行（锥长/月距/月距处本影
                2.6 月径、0.72 R⊕——不随档位与开关变化，B12/B13 用户可见侧） */}
            {settings.viewMode === "space" && (
              <>
                <span className="text-gray-400">{tr("lab.lunarHudScale")}</span>
                <span>
                  {settings.bodyScaleMode === "art"
                    ? `${tr("lab.eclipseBodyScaleArt")} ×${LUNAR_ART_RADIAL_FACTOR.toFixed(1)}`
                    : `${tr("lab.eclipseBodyScaleReal")} ×${settings.radialMagnify ? LUNAR_REAL_RADIAL_MAGNIFY_FACTOR : 1}`}
                </span>
                <span className="text-gray-400">
                  {tr("lab.lunarHudConeLen")}
                </span>
                <span>{hud.coneLenText}</span>
                <span className="text-gray-400">
                  {tr("lab.lunarHudMoonDistRow")}
                </span>
                <span>{hud.moonDistText}</span>
                <span className="text-gray-400">
                  {tr("lab.lunarHudUmbraWidthRow")}
                </span>
                <span>{hud.umbraWidthText}</span>
                <span className="text-gray-400">
                  {tr("lab.lunarHudUmbraRatio")}
                </span>
                <span>{hud.umbraRatioText}</span>
                <span className="text-gray-400">
                  {tr("lab.lunarHudConeRatio")}
                </span>
                <span>{hud.coneRatioText}</span>
              </>
            )}
          </div>
          {/* M4 视角分段控件（地面/太空；切换触发 1.6s 运镜，tSec 跨视角保持） */}
          <h3 className="mb-1 mt-2 text-[10px] font-semibold text-gray-300">
            {tr("lab.lunarViewTitle")}
          </h3>
          <div
            role="radiogroup"
            aria-label={tr("lab.lunarViewAria")}
            className="mb-2 flex gap-1"
          >
            {(
              [
                ["ground", "lab.lunarViewGround"],
                ["space", "lab.lunarViewSpace"],
                ["moon", "lab.lunarViewMoon"],
              ] as const
            ).map(([mode, key]) => (
              <button
                key={mode}
                role="radio"
                aria-checked={settings.viewMode === mode}
                onClick={() => handleViewChange(mode)}
                className={`flex-1 rounded px-1 py-1 text-[10px] transition-colors max-md:min-h-11 ${
                  settings.viewMode === mode
                    ? "bg-sky-500/30 font-semibold text-sky-200"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                }`}
              >
                {tr(key)}
              </button>
            ))}
          </div>
          {/* M4 太空档控件（比例双模/径向放大/预设机位/剖面盘/行星层/
              交点几何望态/对比卡；触控目标 ≥44pt 经 max-md:min-h-11） */}
          {settings.viewMode === "space" && (
            <>
              {/* 天体比例分段（决策 ⑦：默认艺术化；共用日食档名键，B13） */}
              <div
                role="radiogroup"
                aria-label={tr("lab.eclipseBodyScaleAria")}
                className="mb-1 flex gap-1"
              >
                {(
                  [
                    ["art", "lab.eclipseBodyScaleArt"],
                    ["real", "lab.eclipseBodyScaleReal"],
                  ] as const
                ).map(([mode, key]) => (
                  <button
                    key={mode}
                    role="radio"
                    aria-checked={settings.bodyScaleMode === mode}
                    onClick={() => handleScaleModeChange(mode)}
                    className={`flex-1 rounded px-1 py-1 text-[10px] transition-colors max-md:min-h-11 ${
                      settings.bodyScaleMode === mode
                        ? "bg-sky-500/30 font-semibold text-sky-200"
                        : "bg-white/5 text-gray-400 hover:bg-white/10"
                    }`}
                  >
                    {tr(key)}
                  </button>
                ))}
              </div>
              {/* 真实档专属：径向放大 ×4 开关（默认开；艺术化档隐藏，B12） */}
              {settings.bodyScaleMode === "real" && (
                <button
                  aria-pressed={settings.radialMagnify}
                  aria-label={tr("lab.lunarRadialMagnifyAria")}
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      radialMagnify: !s.radialMagnify,
                    }))
                  }
                  className={`mb-1 w-full rounded px-2 py-1 text-left text-[10px] transition-colors max-md:min-h-11 ${
                    settings.radialMagnify
                      ? "bg-sky-500/30 font-semibold text-sky-200"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {settings.radialMagnify ? "☑" : "☐"}{" "}
                  {tr("lab.lunarRadialMagnifyLabel")}
                </button>
              )}
              {settings.bodyScaleMode === "real" && settings.radialMagnify && (
                <p className="mb-1 rounded bg-amber-950/40 px-2 py-1 text-[9px] leading-snug text-amber-200/80">
                  {tr("lab.lunarRadialMagnifyBadge")}
                </p>
              )}
              {/* 预设机位一键切换（全貌/月球特写 + 1.6s 运镜插值） */}
              <div
                role="group"
                aria-label={tr("lab.lunarPresetAria")}
                className="mb-1 flex gap-1"
              >
                {(
                  [
                    ["overview", "lab.lunarPresetOverview"],
                    ["closeup", "lab.lunarPresetCloseup"],
                  ] as const
                ).map(([preset, key]) => (
                  <button
                    key={preset}
                    onClick={() => handlePreset(preset)}
                    className="flex-1 rounded bg-white/5 px-1 py-1 text-[10px] text-gray-300 transition-colors hover:bg-white/10 max-md:min-h-11"
                  >
                    {tr(key)}
                  </button>
                ))}
              </div>
              {/* 剖面盘/行星层/交点几何开关（行星层与倾角叙事互斥挂载） */}
              <div className="mb-1 flex flex-col gap-1">
                <button
                  aria-pressed={settings.sectionDisk}
                  aria-label={tr("lab.lunarSectionDiskAria")}
                  onClick={() =>
                    setSettings((s) => ({ ...s, sectionDisk: !s.sectionDisk }))
                  }
                  className={`rounded px-2 py-1 text-left text-[10px] transition-colors max-md:min-h-11 ${
                    settings.sectionDisk
                      ? "bg-sky-500/30 font-semibold text-sky-200"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {settings.sectionDisk ? "☑" : "☐"}{" "}
                  {tr("lab.lunarSectionDiskLabel")}
                </button>
                <button
                  aria-pressed={settings.planetOrbits}
                  aria-label={tr("lab.eclipsePlanetOrbitsAria")}
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      planetOrbits: !s.planetOrbits,
                    }))
                  }
                  className={`rounded px-2 py-1 text-left text-[10px] transition-colors max-md:min-h-11 ${
                    settings.planetOrbits
                      ? "bg-sky-500/30 font-semibold text-sky-200"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {settings.planetOrbits ? "☑" : "☐"}{" "}
                  {tr("lab.eclipsePlanetOrbitsLabel")}
                </button>
                <button
                  aria-pressed={settings.inclinationDemo}
                  aria-label={tr("lab.eclipseInclinationAria")}
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      inclinationDemo: !s.inclinationDemo,
                    }))
                  }
                  className={`rounded px-2 py-1 text-left text-[10px] transition-colors max-md:min-h-11 ${
                    settings.inclinationDemo
                      ? "bg-sky-500/30 font-semibold text-sky-200"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {settings.inclinationDemo ? "☑" : "☐"}{" "}
                  {tr("lab.eclipseInclinationLabel")}
                </button>
              </div>
              {/* 交点几何：朔↔望开关 + 倾角夸张徽标（B4：共用日食文案键，
                  HUD 标真实值 5.145° 与 ×4 倍率）+ 望态叙事卡 */}
              {settings.inclinationDemo && (
                <>
                  <div
                    role="radiogroup"
                    aria-label={tr("lab.lunarSyzygyAria")}
                    className="mb-1 flex gap-1"
                  >
                    {(
                      [
                        ["full", "lab.lunarSyzygyFull"],
                        ["new", "lab.lunarSyzygyNew"],
                      ] as const
                    ).map(([mode, key]) => (
                      <button
                        key={mode}
                        role="radio"
                        aria-checked={settings.syzygy === mode}
                        onClick={() =>
                          setSettings((s) => ({ ...s, syzygy: mode }))
                        }
                        className={`flex-1 rounded px-1 py-1 text-[10px] transition-colors max-md:min-h-11 ${
                          settings.syzygy === mode
                            ? "bg-amber-500/30 font-semibold text-amber-200"
                            : "bg-white/5 text-gray-400 hover:bg-white/10"
                        }`}
                      >
                        {tr(key)}
                      </button>
                    ))}
                  </div>
                  <p className="mb-1 rounded bg-amber-950/40 px-2 py-1 text-[9px] leading-snug text-amber-200/80">
                    {tr("lab.eclipseInclinationBadge")}
                  </p>
                  <p className="mb-2 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
                    {tr("lab.lunarNodeCard")}
                  </p>
                </>
              )}
              {/* B3/B13 科普卡：轴向真比例卖点 + 太阳距离压缩 + 比例口径 */}
              <p className="mb-1 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-gray-400">
                {tr("lab.lunarSpaceCard")}
              </p>
              <p className="mb-2 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-gray-400">
                {tr("lab.lunarScaleCard")}
              </p>
              {settings.planetOrbits && !settings.inclinationDemo && (
                <p className="mb-2 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-gray-400">
                  {tr("lab.eclipsePlanetOrbitsCard")}
                </p>
              )}
              {/* M4-6 日食 vs 月食对比卡（底稿 §八整表）+ 半沙罗配对 + 互链 */}
              <button
                aria-pressed={showCompare}
                onClick={() => setShowCompare((v) => !v)}
                className={`mb-1 w-full rounded px-2 py-1 text-left text-[10px] transition-colors max-md:min-h-11 ${
                  showCompare
                    ? "bg-sky-500/30 font-semibold text-sky-200"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                }`}
              >
                {showCompare ? "▾" : "▸"} {tr("lab.lunarCompareToggle")}
              </button>
              {showCompare && (
                <div className="mb-2 rounded bg-white/5 p-2">
                  <table className="w-full border-collapse text-left text-[9px] leading-snug text-gray-300">
                    <thead>
                      <tr className="text-gray-400">
                        <th className="pb-1 pr-1 font-normal">
                          {tr("lab.lunarCompareColDim")}
                        </th>
                        <th className="pb-1 pr-1 font-normal">
                          {tr("lab.lunarCompareColSolar")}
                        </th>
                        <th className="pb-1 font-normal">
                          {tr("lab.lunarCompareColLunar")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {LUNAR_COMPARE_ROWS.map(([dim, sol, lun]) => (
                        <tr key={dim} className="border-t border-white/10">
                          <td className="py-1 pr-1 text-gray-400">
                            {tr(dim)}
                          </td>
                          <td className="py-1 pr-1">{tr(sol)}</td>
                          <td className="py-1">{tr(lun)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1.5 text-[9px] leading-snug text-sky-200/80">
                    {tr("lab.lunarCompareSummary")}
                  </p>
                </div>
              )}
              <p className="mb-1 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
                {tr("lab.lunarHalfSarosCard")}
              </p>
              <Link
                href="/lab/solar-eclipse"
                className="mb-2 block rounded bg-white/5 px-2 py-1.5 text-[10px] text-space-accent transition-colors hover:bg-white/10 max-md:min-h-11"
              >
                {tr("lab.lunarLinkToSolar")}
              </Link>
            </>
          )}
          {/* M5-1 月球视角科普卡（B8 登记用户可见侧：机制正确的艺术化再现 +
              Surveyor 3 / Blue Ghost 实拍对标 + 因果闭环操作指引） */}
          {settings.viewMode === "moon" && (
            <p className="mb-2 rounded bg-red-950/40 px-2 py-1.5 text-[10px] leading-relaxed text-orange-200/90">
              {tr("lab.lunarMoonViewCard")}
            </p>
          )}
          {/* 播放模式（B1：加速回放全程 ~1.5 分钟 / ×1 真实；HUD 常显倍速） */}
          <div
            role="radiogroup"
            aria-label={tr("lab.lunarPlayModeAria")}
            className="mb-2 flex gap-1"
          >
            {(
              [
                ["fast", "lab.lunarPlayModeFast"],
                ["real", "lab.lunarPlayModeReal"],
              ] as const
            ).map(([mode, key]) => (
              <button
                key={mode}
                role="radio"
                aria-checked={settings.playMode === mode}
                onClick={() => setSettings((s) => ({ ...s, playMode: mode }))}
                className={`flex-1 rounded px-1 py-1 text-[10px] transition-colors max-md:min-h-11 ${
                  settings.playMode === mode
                    ? "bg-sky-500/30 font-semibold text-sky-200"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                }`}
              >
                {tr(key)}
              </button>
            ))}
          </div>
          {/* M3-2 丹戎标度：五档预设 + 浑浊度滑杆（turbidityToDanjonL 连续
              驱动）+ B6 注记「目视主观评级，色值为美术映射」 */}
          <h3 className="mb-1 mt-2 text-[10px] font-semibold text-gray-300">
            {tr("lab.lunarDanjonTitle")}
          </h3>
          <div
            role="radiogroup"
            aria-label={tr("lab.lunarDanjonAria")}
            className="mb-1 grid grid-cols-5 gap-1"
          >
            {([0, 1, 2, 3, 4] as const).map((l) => {
              const active =
                Math.abs(turbidityToDanjonL(settings.turbidity01) - l) < 0.05;
              return (
                <button
                  key={l}
                  role="radio"
                  aria-checked={active}
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      turbidity01: defaultTurbidityForDanjonL(l),
                    }))
                  }
                  className={`rounded px-1 py-1 text-[10px] transition-colors max-md:min-h-11 ${
                    active
                      ? "bg-red-500/30 font-semibold text-orange-200"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  L{l}
                </button>
              );
            })}
          </div>
          <p className="mb-1 text-[10px] leading-snug text-gray-400">
            {tr(
              DANJON_DESC_KEYS[
                Math.round(
                  turbidityToDanjonL(settings.turbidity01),
                ) as 0 | 1 | 2 | 3 | 4
              ],
            )}
          </p>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[10px] text-gray-400">
              {tr("lab.lunarTurbidityClean")}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.turbidity01}
              aria-label={tr("lab.lunarTurbidityAria")}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  turbidity01: Number.parseFloat(e.target.value),
                }))
              }
              className="h-1.5 flex-1 cursor-pointer accent-red-400"
            />
            <span className="text-[10px] text-gray-400">
              {tr("lab.lunarTurbidityDusty")}
            </span>
          </div>
          <p className="mb-2 text-[9px] leading-snug text-gray-500">
            {tr("lab.lunarDanjonNote")}
          </p>
          {/* l1992 皮纳图博叙事卡（历史场景默认即 L=0 极暗） */}
          {eventId === "l1992" && (
            <p className="mb-2 rounded bg-red-950/40 px-2 py-1.5 text-[10px] leading-relaxed text-orange-200/90">
              {tr("lab.lunarPinatuboCard")}
            </p>
          )}
          {/* M5-3 selenelion 科普卡 + 彩蛋入口（l1992 页签专属——真实组合
              事件；B9 登记的用户可见侧在场景内 HUD/说明卡） */}
          {eventId === SELENELION_EVENT_ID && (
            <div className="mb-2 rounded bg-amber-950/30 px-2 py-1.5">
              <p className="text-[10px] leading-relaxed text-amber-200/90">
                {tr("lab.lunarSelenelionCard")}
              </p>
              <button
                type="button"
                onClick={() => setSelenelionOpen(true)}
                className="mt-1.5 w-full rounded bg-amber-500/25 px-2 py-1 text-left text-[10px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/40 max-md:min-h-11"
              >
                {tr("lab.lunarSelenelionEnter")}
              </button>
            </div>
          )}
          {/* M3-2 曝光滑杆（简单乘子无状态机，契约 C4）+ B2 注记 */}
          <h3 className="mb-1 mt-2 text-[10px] font-semibold text-gray-300">
            {tr("lab.lunarExposureTitle")}
          </h3>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[10px] text-gray-400">
              {tr("lab.lunarExposureDim")}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.exposure01}
              aria-label={tr("lab.lunarExposureAria")}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  exposure01: Number.parseFloat(e.target.value),
                }))
              }
              className="h-1.5 flex-1 cursor-pointer accent-sky-400"
            />
            <span className="text-[10px] text-gray-400">
              {tr("lab.lunarExposureBright")}
            </span>
          </div>
          <p className="mb-2 text-[9px] leading-snug text-gray-500">
            {tr("lab.lunarExposureNote")}
          </p>
          {/* M3-5/M3-6 教学交互开关（三联对比 / 地圆论证拟合圆——地面档专属） */}
          {settings.viewMode === "ground" && (
            <div className="mb-2 flex flex-col gap-1">
              {(
                [
                  ["showTriptych", "lab.lunarTriptychToggle"],
                  ["fitCircle", "lab.lunarFitCircleToggle"],
                ] as const
              ).map(([key, labelKey]) => (
                <button
                  key={key}
                  aria-pressed={settings[key]}
                  onClick={() =>
                    setSettings((s) => ({ ...s, [key]: !s[key] }))
                  }
                  className={`rounded px-2 py-1 text-left text-[10px] transition-colors max-md:min-h-11 ${
                    settings[key]
                      ? "bg-sky-500/30 font-semibold text-sky-200"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {settings[key] ? "☑" : "☐"} {tr(labelKey)}
                </button>
              ))}
            </div>
          )}
          {/* 三联对比条（同 shader 换 uniform，独立小 Canvas） */}
          {settings.viewMode === "ground" && settings.showTriptych && (
            <LunarTriptychStrip
              events={data.events}
              turbidity01={settings.turbidity01}
              exposure01={settings.exposure01}
            />
          )}
          {/* 地圆论证科普卡（古希腊推理链，底稿 §10.1） */}
          {settings.viewMode === "ground" && settings.fitCircle && (
            <p className="mb-2 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
              {tr("lab.lunarFitCircleCard")}
            </p>
          )}
          {/* 阶段科普卡（七接触点区段，缺省锚点自动跳过） */}
          <p className="mb-2 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
            {tr(PHASE_CARD_KEYS[phaseKey])}
          </p>
          {/* 月缘增亮科普注解（对冲效应；B5 简化逆反射登记的用户可见侧） */}
          <p className="mb-2 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-gray-400">
            {tr("lab.lunarLimbSurgeCard")}
          </p>
          <p className="mt-2 border-t border-white/10 pt-2 text-[10px] leading-snug text-gray-500">
            {tr("lab.dataSourceLabel")}：{entry?.dataSource ?? ""}
          </p>
        </div>
      </div>

      {/* 底部：时间轴 scrubber（契约 C7 复用日食组件，7 锚点按事件缺省） */}
      <EclipseTimelineScrubber
        window={window_}
        valueSec={scrubSec}
        playing={playing}
        anchors={anchors}
        onSeek={handleSeek}
        onTogglePlay={() => setPlaying((p) => !p)}
      />

      {/* 底部操作提示（按视角档切换；<sm 隐藏——底部被抽屉标题栏占据，日食同范式） */}
      <p className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate whitespace-nowrap rounded bg-black/40 px-3 py-1 text-[10px] text-gray-400 backdrop-blur max-sm:hidden">
        {settings.viewMode === "space"
          ? tr("lab.lunarHintSpace")
          : settings.viewMode === "moon"
            ? tr("lab.lunarHintMoonView")
            : tr("lab.lunarHintLookAround")}
      </p>

      {/* M5-2 月球视角引导提示（因果闭环叙事：地面档见到血月（全食段）时
          一次性出现；可关/去过即不再骚扰——localStorage 持久） */}
      {settings.viewMode === "ground" &&
        !moonGuideDismissed &&
        !viewTransition &&
        hud.kindKey === "lab.lunarKindTotal" && (
          <div className="absolute left-3 top-1/2 w-56 max-w-[calc(100vw-1.5rem)] -translate-y-1/2 rounded-lg bg-red-950/70 p-3 text-xs text-orange-100 shadow-lg backdrop-blur">
            <p className="text-[11px] leading-relaxed">
              {tr("lab.lunarMoonGuideTip")}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleViewChange("moon")}
                className="flex-1 rounded bg-red-500/40 px-2 py-1.5 text-[11px] font-semibold text-orange-100 transition-colors hover:bg-red-500/60 max-md:min-h-11"
              >
                {tr("lab.lunarMoonGuideGo")}
              </button>
              <button
                type="button"
                onClick={dismissMoonGuide}
                aria-label={tr("lab.lunarMoonGuideDismissAria")}
                className="flex h-8 w-8 items-center justify-center rounded text-orange-200/70 transition-colors hover:bg-white/10 max-md:h-11 max-md:w-11"
              >
                ✕
              </button>
            </div>
          </div>
        )}
    </div>
  );
}

/**
 * 实验室场景入口（`/lab/lunar-eclipse` 经 next/dynamic ssr:false 挂载）：
 * 星历三态 gate——loading/failed 显示提示，ready 后挂载场景。
 */
export function LunarEclipseLab(): JSX.Element {
  const tr = useT();
  const { data, status } = useLunarEclipses();

  if (status !== "ready" || !data) {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center bg-black">
        <div className="absolute left-4 top-4 rounded-lg bg-black/60 px-3 py-2 text-xs backdrop-blur">
          <Link
            href={LAB_PAGE_PATH}
            className="text-space-accent hover:underline"
          >
            ← {tr("lab.backToLab")}
          </Link>
        </div>
        <p
          className={`rounded-lg bg-black/60 px-4 py-2 text-sm text-gray-300 backdrop-blur ${
            status === "loading" ? "animate-pulse" : ""
          }`}
        >
          {status === "failed"
            ? tr("lab.lunarEphemerisFailed")
            : tr("lab.lunarLoadingEphemeris")}
        </p>
      </div>
    );
  }
  return <LunarExperience data={data} />;
}
