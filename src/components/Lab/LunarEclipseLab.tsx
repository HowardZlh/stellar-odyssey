"use client";

/**
 * 月食实验室场景（LE 迭代 M2 骨架：地面视角 + 月盘几何遮挡渐进 + 7 锚点
 * scrubber；血月丹戎着色/星空显现/三联对比随 M3，太空/月球视角随 M4/M5）
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
 * M2 月盘遮挡（契约 C4 骨架期）：shader 逐像素求「像素点到影盘中心视角距
 * ρ → 本影/半影分段」——本影段灰度径向渐进（umbraGrayFactor 镜像，M3 换
 * umbraShading 血月色表）、半影段**即用 penumbraShading**（红线 ②「微妙
 * 变暗不得夸大」从骨架期守住）；影盘方位/半径由 lunarFrameState 经地心
 * geo 星历逐帧解析（缺口方位随影轴几何真实变化，M2-CP 目验点）。
 * CPU/GLSL 镜像纪律：常量模板注入自 lunarEclipse/lunarEclipseLab，照抄勿变形。
 *
 * 渲染架构（§4）：StarDome 1 + SkyDome 1 + 月盘 quad 1 + 地面 1 + 山脊 1
 * = 5 draw call ≤ 12 预算；渲染循环零 buffer 更新（每帧只动 uniform）。
 * 主场景与 earthShadow.ts 零改动；Canvas 子树不订阅 locale。
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
  labSkyColors,
  ridgeHeightProfile,
} from "@/utils/labSky";
import { bvToTeffK, srgbToLinear01 } from "@/utils/pleiadesCatalog";
import { blackbodyRGB } from "@/utils/starPhysics";
import { SKY_SHELL_RADIUS_KM } from "@/utils/solarEclipse";
import {
  PENUMBRA_SHADING_MAX_DIM,
  UMBRA_SHADING_EDGE_EXPONENT,
  type LunarEclipseKind,
} from "@/utils/lunarEclipse";
import {
  formatAngularDiameterDeg,
  formatUtcClock,
  lstRadFromUnixSec,
  type EclipseTimelineAnchor,
  type EclipseTimelineWindow,
} from "@/utils/solarEclipseLab";
import {
  LUNAR_MOON_BASE_GAIN,
  LUNAR_QUAD_HALF_ANGLE_RAD,
  UMBRA_GRAY_CENTER_FACTOR,
  UMBRA_GRAY_EDGE_FACTOR,
  activeLunarPhaseKey,
  emptyLunarFrameState,
  lunarEclipseAnchors,
  lunarFrameState,
  lunarPlayRate,
  lunarTimelineWindow,
  type LunarPhaseKey,
  type LunarPlayMode,
  type LunarSeriesGroup,
} from "@/utils/lunarEclipseLab";
import { TrackpadLookControls } from "@/components/Lab/TrackpadLookControls";
import { EclipseTimelineScrubber } from "@/components/Lab/EclipseTimelineScrubber";

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

/** M2 控件状态（播放模式；M3 起扩展丹戎/浑浊度/曝光等） */
interface LunarM2Settings {
  playMode: LunarPlayMode;
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
  /** M2 控件状态（React state 渲染期同步；useFrame 只读） */
  settingsRef: { current: LunarM2Settings };
}

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
  useFrame((_, delta) => {
    const { window: win, event, group } = refs.eventRef.current;
    const rate = lunarPlayRate(refs.settingsRef.current.playMode, win);
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
    );
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
 * 全窗太阳在地平下，晨昏蒙影由 labSkyColors 自然承载。月光环境项随 M3）。
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
    // 本条目无光害控件，lm 固定 6.5（深空基线）
    labSkyColors(6.5, frame.sunAltDeg * DEG, sky);
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

/** 地面剪影圆盘（GroundDisk 同范式：色 = 夜天光反照；月光联动随 M3） */
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
    labSkyColors(6.5, frame.sunAltDeg * DEG, tmp.sky);
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
    labSkyColors(6.5, frame.sunAltDeg * DEG, tmp.sky);
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
// 月盘 quad（M2-4：月面贴图 + 本影/半影几何遮挡渐进；契约 C3/C4 骨架期）
// ---------------------------------------------------------------------------

/**
 * 月盘 quad 顶点着色（日食 quad 同约定）：quad 本地角坐标（弧度）——
 * +X = 方位角减小向（lookAt 原点后的本地系）、+Y = 高度角增大向；
 * uShadowOffset 与此同系（CPU 侧换算）。
 */
const LUNAR_QUAD_VERTEX_SHADER = /* glsl */ `
  uniform float uHalfAngle;
  varying vec2 vAng;
  void main() {
    vAng = (uv - 0.5) * 2.0 * uHalfAngle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 月盘 fragment（契约 C4 骨架期两段式；常量模板注入自 lunarEclipse/
 * lunarEclipseLab——CPU/GLSL 镜像纪律，moonDiskShadeFactor 同式照抄）：
 * 1 月面反照：2K 月面贴图球面映射（近面中心 lon 0 = 贴图中心；静态姿态
 *   近似登记 B11），未就绪时中性灰降级；
 * 2 遮挡因子：ρ = |像素角位 − 影盘中心|——ρ < 本影半径走灰度径向渐进
 *   （中心 0.02 → 边缘 0.45，径向指数与 umbraShading 同源，M3 换血月色表
 *   零跳变）；本影—半影带走 penumbraShading（外缘无变暗、内缘 −0.55，
 *   r≥0.6 段变暗 <0.09——「半影几乎无感」红线 ② 的 GLSL 侧）；半影外全亮。
 */
const LUNAR_QUAD_FRAGMENT_SHADER = /* glsl */ `
  uniform float uMoonR;
  uniform vec2 uShadowOffset;
  uniform float uUmbraR;
  uniform float uPenumbraR;
  uniform sampler2D uMoonTex;
  uniform float uHasTex;
  uniform float uGain;
  varying vec2 vAng;

  const float PI = 3.14159265;
  const float TWO_PI = 6.28318531;

  void main() {
    float rm = length(vAng);
    // 盘缘软化：视半径 3% 固定角宽（FOV 放大时缘宽随真实角尺度）
    float aa = uMoonR * 0.03;
    float disk = 1.0 - smoothstep(uMoonR - aa, uMoonR + aa, rm);
    if (disk < 0.003) discard;

    // 月面贴图球面映射（近面可见半球 lon ∈ [−90°, 90°]，中心 = 贴图中心）
    vec2 pn = vAng / uMoonR;
    float pz = sqrt(max(1.0 - dot(pn, pn), 0.0));
    float lon = atan(pn.x, pz);
    float lat = asin(clamp(pn.y, -1.0, 1.0));
    vec2 uv = vec2(0.5 + lon / TWO_PI, 0.5 + lat / PI);
    vec3 albedo = uHasTex > 0.5 ? texture2D(uMoonTex, uv).rgb : vec3(0.32);

    // 遮挡因子（moonDiskShadeFactor GLSL 镜像；uUmbraR/uPenumbraR 由
    // 契约 C1 影锥函数逐帧驱动——缺口方位随影轴几何真实变化）
    float rho = length(vAng - uShadowOffset);
    float factor = 1.0;
    if (uPenumbraR - uUmbraR > 1e-9) {
      if (uUmbraR > 0.0 && rho < uUmbraR) {
        float r = rho / uUmbraR;
        factor = ${UMBRA_GRAY_CENTER_FACTOR.toFixed(4)}
          + (${UMBRA_GRAY_EDGE_FACTOR.toFixed(4)} - ${UMBRA_GRAY_CENTER_FACTOR.toFixed(4)})
            * pow(r, ${UMBRA_SHADING_EDGE_EXPONENT.toFixed(2)});
      } else {
        float rp = clamp((rho - uUmbraR) / (uPenumbraR - uUmbraR), 0.0, 1.0);
        factor = 1.0 - ${PENUMBRA_SHADING_MAX_DIM.toFixed(2)} * (1.0 - rp) * (1.0 - rp);
      }
    }

    vec3 col = albedo * uGain * factor;
    gl_FragColor = vec4(col * disk, disk);
  }
`;

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
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uHalfAngle: { value: LUNAR_QUAD_HALF_ANGLE_RAD },
          uMoonR: { value: 0.259 * DEG },
          uShadowOffset: { value: new THREE.Vector2(0, 0) },
          uUmbraR: { value: 0 },
          uPenumbraR: { value: 0 },
          uMoonTex: { value: null as THREE.Texture | null },
          uHasTex: { value: 0 },
          uGain: { value: LUNAR_MOON_BASE_GAIN },
        },
        vertexShader: LUNAR_QUAD_VERTEX_SHADER,
        fragmentShader: LUNAR_QUAD_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
      }),
    [],
  );

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

  // M2 控件状态（播放模式；DOM 写 React state → 渲染期同步 ref）
  const [settings, setSettings] = useState<LunarM2Settings>({
    playMode: "fast",
  });

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
  const refs: LunarFrameRefs = useMemo(
    () => ({ tSecRef, playingRef, eventRef, frameRef, settingsRef }),
    [],
  );

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

  /** 页签切换：暂停 + 时间轴对齐新事件 P1（日食 §3.5 同范式） */
  const handleEventChange = (id: LunarEventId): void => {
    if (id === eventId) return;
    setPlaying(false);
    const next = data.events.find((e) => e.id === id) ?? data.events[0];
    tSecRef.current = next.contacts.p1;
    setScrubSec(next.contacts.p1);
    setEventId(id);
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
  });
  const [phaseKey, setPhaseKey] = useState<LunarPhaseKey>("p1");

  useEffect(() => {
    const tick = (): void => {
      const { event: ev, group: g, window: win } = eventRef.current;
      const tSec = tSecRef.current;
      const frame = lunarFrameState(g, ev.observer, tSec);
      const rate = lunarPlayRate(settingsRef.current.playMode, win);
      const next: LunarHudState = {
        utcText: formatUtcClock(tSec),
        rateText: `×${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)}`,
        kindKey: KIND_LABEL_KEYS[frame.kind],
        umbralMagText: frame.umbralMag.toFixed(3),
        penumbralMagText: frame.penumbralMag.toFixed(3),
        moonAltText: `${frame.moonAltDeg.toFixed(1)}°`,
        moonDiamText: formatAngularDiameterDeg(frame.moonSdDeg),
      };
      setHud((prev) =>
        prev.utcText === next.utcText &&
        prev.rateText === next.rateText &&
        prev.kindKey === next.kindKey &&
        prev.umbralMagText === next.umbralMagText &&
        prev.penumbralMagText === next.penumbralMagText &&
        prev.moonAltText === next.moonAltText &&
        prev.moonDiamText === next.moonDiamText
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
        {/* 反转轨道相机（流星雨/日食同配置）+ FOV 手势链 */}
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
        <TrackpadLookControls />
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
            <span className="text-gray-400">{tr("lab.lunarHudMoonAlt")}</span>
            <span>{hud.moonAltText}</span>
            <span className="text-gray-400">{tr("lab.lunarHudMoonDiam")}</span>
            <span>{hud.moonDiamText}</span>
          </div>
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
                onClick={() => setSettings({ playMode: mode })}
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
          {/* 阶段科普卡（七接触点区段，缺省锚点自动跳过） */}
          <p className="mb-2 rounded bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
            {tr(PHASE_CARD_KEYS[phaseKey])}
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

      {/* 底部操作提示（<sm 隐藏——底部被抽屉标题栏占据，日食同范式） */}
      <p className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate whitespace-nowrap rounded bg-black/40 px-3 py-1 text-[10px] text-gray-400 backdrop-blur max-sm:hidden">
        {tr("lab.lunarHintLookAround")}
      </p>
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
