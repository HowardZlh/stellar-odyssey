'use client';

/**
 * 日全食实验室场景（E 迭代 M2：注册/路由/i18n 骨架 + 地面视角偏食渐进——
 * 天穹 + 日月合成 quad 第一层 + 时间轴 scrubber 骨架；全食景观六件套/曝光
 * 状态机随 M3、太空视角随 M4、Eddington 叙事随 M5、音频/移动端随 M6 递进）
 *
 * 状态流红线（§3.1）：「事件时间轴秒 tSec」为单值状态源——一切效果由 tSec
 * 经纯函数（utils/solarEclipseLab + 契约 C1 函数族）逐帧重建，禁止帧间累积
 * 效果状态（scrubber 任意 seek 的前提）。DOM 控件写 React state → 渲染期
 * 同步 ref → Canvas 子树 useFrame 读 ref 更 uniform（流星雨范式）；
 * HUD 由 500ms interval 经纯函数读 ref 计算。
 *
 * 场景空间（契约 C4）：1 场景单位 = 1 km，+Y 天顶、−Z 正北、+X 正东，
 * 观测者在原点（食甚中心线固定观测点），反转轨道相机（target 原点、
 * 半径 0.1–1.5、polar 钳制 labGestures 常量同源）。日月画在天穹壳
 * （10,000 km）billboard quad 上，quad 内按**真实视半径**绘制（不做几何
 * 放大）；「看不清 0.5° 小盘」由 FOV 缩放解决（TrackpadLookControls 捏合
 * 链复用）+ HUD 常显视直径/食分/遮挡率。
 *
 * 日月位置驱动：直接消费烘焙 topo 星历（60s 粗采样 + C2/C3±3min 1s 细采样，
 * interpolateEphemeris 角度列最短弧插值）——月盘偏移取双体地平坐标差
 * （切平面小角近似），位置角信息隐含其中：缺角方位随月球来向真实转动
 * （M2-5 目验点，非固定方向缺角）。
 *
 * 天穹组件按流星雨同范式扩展（复用其纯函数链，组件为日食专属叶——流星雨
 * 组件零改动）：EclipseStarDome（耶鲁 8,404 星，白昼被极限星等剔除、近全食
 * 渐显）/ EclipseSkyDome（labSkyColors 昼光 × eclipseSkyDarkening 感知因子，
 * 偏食段「几乎无感变暗」；360° 暮光带属 M3）/ EclipseGroundDisk +
 * EclipseHorizonRidge（地景剪影随天光联动）。
 *
 * 渲染架构（§4.1）：StarDome 1 + SkyDome 1 + 日月 quad 1 + 地面 1 + 山脊 1
 * = 5 draw call ≤ 15 预算；渲染循环零 buffer 更新（每帧只动 uniform/位姿），
 * 页签切换为交互事件路径（tSec 对齐新事件 C1 + OrbitControls key remount）。
 *
 * 临边昏暗系数 SUN_LIMB_DARKENING_U 复用 sunSurface.ts（CPU/GLSL 镜像纪律：
 * GLSL 由模板注入同一常量，不得变形）。光球 HDR 固定基准
 * PHOTOSPHERE_HDR_BRIGHTNESS（M3 曝光状态机接管，契约 C5）。
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
import { useSolarEclipses } from '@/hooks/useSolarEclipses';
import type { SolarEclipseEventData, YaleBrightStar } from '@/utils/bakedData';
import type { MessageKey } from '@/i18n';
import { labEntryForId, LAB_PAGE_PATH } from '@/utils/lab';
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
import { SUN_LIMB_DARKENING_U } from '@/utils/sunSurface';
import { SKY_SHELL_RADIUS_KM } from '@/utils/solarEclipse';
import {
  ECLIPSE_PLAY_RATE,
  ECLIPSE_QUAD_HALF_ANGLE_RAD,
  PHOTOSPHERE_HDR_BRIGHTNESS,
  eclipseFrameState,
  eclipseTimelineWindow,
  emptyEclipseFrameState,
  formatAngularDiameterDeg,
  formatUtcClock,
  lstRadFromUnixSec,
  solarEclipseAnchors,
  type EclipseFrameState,
  type EclipseTimelineAnchor,
  type EclipseTimelineWindow,
} from '@/utils/solarEclipseLab';
import { TrackpadLookControls } from '@/components/Lab/TrackpadLookControls';
import { EclipseTimelineScrubber } from '@/components/Lab/EclipseTimelineScrubber';

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

/** 帧循环共享 refs（DOM 写入、Canvas 子树 useFrame 读取；场景不订阅 React 状态） */
interface EclipseFrameRefs {
  /** 事件时间轴秒（UTC；单值状态源） */
  tSecRef: { current: number };
  /** 播放中（×1 真实速度） */
  playingRef: { current: boolean };
  /** 当前事件 + 时间窗（渲染期同步；页签切换即更新） */
  eventRef: { current: { event: SolarEclipseEventData; window: EclipseTimelineWindow } };
  /** 逐帧状态（EclipseTimeDriver 每帧重建，各叶组件只读；挂载期分配一次零 GC） */
  frameRef: { current: EclipseFrameState };
}

/**
 * 时间轴推进 + 逐帧状态重建（首个 Canvas 子组件，同优先级 useFrame 按挂载序
 * 先行）：播放时 tSec += delta（钳制 0.1s 防页签切回跳帧）×1；到窗口末端
 * 自动暂停（onEnded 交互回调）。随后由 tSec 单值重建 frameRef（纯查表）。
 */
function EclipseTimeDriver({
  refs,
  onEnded,
}: {
  refs: EclipseFrameRefs;
  onEnded: () => void;
}): null {
  useFrame((_, delta) => {
    const { window: win, event } = refs.eventRef.current;
    if (refs.playingRef.current) {
      const next = refs.tSecRef.current + Math.min(delta, 0.1) * ECLIPSE_PLAY_RATE;
      if (next >= win.endSec) {
        refs.tSecRef.current = win.endSec;
        onEnded();
      } else {
        refs.tSecRef.current = next;
      }
    }
    eclipseFrameState(event, refs.tSecRef.current, refs.frameRef.current);
  });
  return null;
}

/** 页签切换相机指向：对准当前 tSec 的太阳方向（反转轨道范式，交互事件路径） */
function EclipseCameraAim({ refs, eventId }: { refs: EclipseFrameRefs; eventId: string }): null {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
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
    vColor = color * brightness;
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

/** LabSkyDome 同式竖直渐变（M2 偏食段：昼光 × 感知因子；360° 暮光带属 M3） */
const ECLIPSE_SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float band = pow(1.0 - abs(dir.y), 3.0);
    gl_FragColor = vec4(mix(uZenith, uHorizon, band), 1.0);
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
// 日月合成 quad（M2-5 第一层：临边昏暗光球盘 + 月盘剪影解析减除，契约 C4）
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
 * 光球盘（临边昏暗，系数镜像 sunSurface.SUN_LIMB_DARKENING_U，模板注入同一
 * 常量——CPU/GLSL 镜像纪律）+ 月盘剪影解析圆减除。真实视半径（uniform 弧度），
 * 月盘遮住日面处为不透明近黑（月背对日照面），日面外月盘透明（白昼天光下
 * 新月不可见属科学事实）。M3 在此 quad 分层叠加日冕/色球/日珥/贝利珠。
 */
const ECLIPSE_QUAD_FRAGMENT_SHADER = /* glsl */ `
  uniform float uSunR;
  uniform float uMoonR;
  uniform vec2 uMoonOffset;
  uniform vec3 uSunColor;
  uniform float uBrightness;
  varying vec2 vAng;
  void main() {
    float rs = length(vAng);
    // 盘缘软化：视半径 3% 固定角宽（FOV 放大时缘宽随真实角尺度，不糊不锯齿）
    float aa = uSunR * 0.03;
    float sunDisk = 1.0 - smoothstep(uSunR - aa, uSunR + aa, rs);
    if (sunDisk < 0.003) discard;
    // 临边昏暗 I(mu) = 1 - u * (1 - mu)，mu = sqrt(1 - (r/R)^2)
    float x = clamp(rs / uSunR, 0.0, 1.0);
    float mu = sqrt(max(1.0 - x * x, 0.0));
    float limb = 1.0 - ${SUN_LIMB_DARKENING_U.toFixed(2)} * (1.0 - mu);
    // 月盘剪影：解析圆减除（缺角方位由 uMoonOffset 驱动——位置角接线目验点）
    float rm = length(vAng - uMoonOffset);
    float moonDisk = 1.0 - smoothstep(uMoonR - aa, uMoonR + aa, rm);
    vec3 col = uSunColor * uBrightness * limb * (1.0 - moonDisk);
    gl_FragColor = vec4(col * sunDisk, sunDisk);
  }
`;

/** 日月合成 quad（1 draw call；每帧只写位姿与 uniforms） */
function EclipseSunMoonQuad({ refs }: { refs: EclipseFrameRefs }): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uHalfAngle: { value: ECLIPSE_QUAD_HALF_ANGLE_RAD },
          uSunR: { value: 0.267 * DEG },
          uMoonR: { value: 0.267 * DEG },
          uMoonOffset: { value: new THREE.Vector2(0, 0) },
          // 光球色（暖白，sRGB 直觉色；HDR 亮度由 uBrightness 承载）
          uSunColor: { value: new THREE.Color(1.0, 0.93, 0.82) },
          uBrightness: { value: PHOTOSPHERE_HDR_BRIGHTNESS },
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

  // quad 边长：天穹壳距离 × tan(半角) × 2（真实角尺度 → 场景 km）
  const quadSize = 2 * SKY_SHELL_RADIUS_KM * Math.tan(ECLIPSE_QUAD_HALF_ANGLE_RAD);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const frame = refs.frameRef.current;
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
    material.uniforms.uSunR.value = frame.sunSdDeg * DEG;
    material.uniforms.uMoonR.value = frame.moonSdDeg * DEG;
    // 本地系换算：x = −方位向偏移（+X 朝方位角减小向）、y = 高度向偏移
    (material.uniforms.uMoonOffset.value as THREE.Vector2).set(
      -frame.offEastRad,
      frame.offUpRad
    );
  });

  return (
    <mesh ref={meshRef} material={material} frustumCulled={false} renderOrder={1}>
      <planeGeometry args={[quadSize, quadSize]} />
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
}

/** 事件已就绪后的场景 + 控件（数据 ready 前由外层 gate，见 SolarEclipseLab） */
function EclipseExperience({ data }: { data: { events: SolarEclipseEventData[] } }): JSX.Element {
  const tr = useT();
  const entry = labEntryForId('solar-eclipse');
  const { stars } = useYaleBrightStars();

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

  // scrubber 显示值（拖动即时更新；播放期间由 500ms tick 从 tSecRef 回同步）
  const [scrubSec, setScrubSec] = useState<number>(event.contacts.c1);

  // 帧循环共享 refs（渲染期同步赋值：useFrame 读到的永远是最新事件/播放态）
  const tSecRef = useRef(event.contacts.c1);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const eventRef = useRef({ event, window: window_ });
  eventRef.current = { event, window: window_ };
  const frameRef = useRef(emptyEclipseFrameState());
  const refs: EclipseFrameRefs = useMemo(
    () => ({ tSecRef, playingRef, eventRef, frameRef }),
    []
  );

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

  /** 页签切换（§3.5 范式）：结束演示态（暂停）+ 时间轴对齐新事件 C1 */
  const handleEventChange = (id: EclipseEventId): void => {
    if (id === eventId) return;
    setPlaying(false);
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

  // HUD：500ms interval 经纯函数读 ref 计算（DOM 层，不进 useFrame）
  const [hud, setHud] = useState<EclipseHudState>({
    utcText: '--:--:--',
    magnitudeText: '0.000',
    obscurationText: '0.0%',
    sunDiamText: '—',
    moonDiamText: '—',
  });
  useEffect(() => {
    const tick = (): void => {
      const ev = eventRef.current.event;
      const tSec = tSecRef.current;
      const frame = eclipseFrameState(ev, tSec);
      const utcText = formatUtcClock(tSec);
      const magnitudeText = frame.magnitude.toFixed(3);
      const obscurationText = `${(frame.obscuration01 * 100).toFixed(1)}%`;
      const sunDiamText = formatAngularDiameterDeg(frame.sunSdDeg);
      const moonDiamText = formatAngularDiameterDeg(frame.moonSdDeg);
      setHud((prev) =>
        prev.utcText === utcText &&
        prev.magnitudeText === magnitudeText &&
        prev.obscurationText === obscurationText &&
        prev.sunDiamText === sunDiamText &&
        prev.moonDiamText === moonDiamText
          ? prev
          : { utcText, magnitudeText, obscurationText, sunDiamText, moonDiamText }
      );
      // 播放期间回同步 scrubber 显示值（拖动路径由 handleSeek 即时更新）
      if (playingRef.current) setScrubSec(tSecRef.current);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  const activeTab = ECLIPSE_TABS.find((t) => t.id === eventId) ?? ECLIPSE_TABS[0];

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
        <EclipseSkyDome refs={refs} />
        {stars && (
          <EclipseStarDome stars={stars} refs={refs} starPointMaxPx={quality.starPointMaxPx} />
        )}
        <EclipseSunMoonQuad refs={refs} />
        <EclipseGroundDisk refs={refs} />
        <EclipseHorizonRidge refs={refs} />
        {/* 反转轨道相机（流星雨地面档同配置；key remount 随页签重置阻尼态） */}
        <OrbitControls
          key={eventId}
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
        {/* 后期：Bloom + ACES（流星雨同配置；光球 HDR 由 Bloom 拾取） */}
        {quality.bloomEnabled ? (
          <EffectComposer multisampling={4}>
            <Bloom intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        ) : (
          <EffectComposer multisampling={0}>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
      </Canvas>

      {/* 左上：返回实验室 + 条目标题 */}
      <div className="absolute left-4 top-4 select-none rounded-lg bg-black/60 px-3 py-2 text-xs text-gray-100 backdrop-blur">
        <Link href={LAB_PAGE_PATH} className="text-space-accent hover:underline">
          ← {tr('lab.backToLab')}
        </Link>
        {entry && <div className="mt-1 font-semibold text-sky-300">{tr(entry.titleKey)}</div>}
      </div>

      {/* 右上：事件页签 + 观测点 + HUD + 数据来源 */}
      <div className="absolute right-3 top-3 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg bg-black/65 p-3 text-xs text-gray-100 backdrop-blur">
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
        {/* HUD：UTC/食分/遮挡率/日月视直径（真实值常显，契约 C4） */}
        <div className="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded bg-sky-950/60 px-2 py-1 font-mono text-[11px] text-sky-200">
          <span className="text-gray-400">{tr('lab.eclipseHudUtc')}</span>
          <span>{hud.utcText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudMagnitude')}</span>
          <span>{hud.magnitudeText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudObscuration')}</span>
          <span>{hud.obscurationText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudSunDiam')}</span>
          <span>{hud.sunDiamText}</span>
          <span className="text-gray-400">{tr('lab.eclipseHudMoonDiam')}</span>
          <span>{hud.moonDiamText}</span>
        </div>
        <p className="border-t border-white/10 pt-2 text-[10px] leading-snug text-gray-500">
          {tr('lab.dataSourceLabel')}：{entry?.dataSource ?? ''}
        </p>
      </div>

      {/* 底部：时间轴 scrubber（契约 C7 数据驱动锚点） */}
      <EclipseTimelineScrubber
        window={window_}
        valueSec={scrubSec}
        playing={playing}
        anchors={anchors}
        onSeek={handleSeek}
        onTogglePlay={() => setPlaying((p) => !p)}
      />

      {/* 底部操作提示 */}
      <p className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate whitespace-nowrap rounded bg-black/40 px-3 py-1 text-[10px] text-gray-400 backdrop-blur">
        {tr('lab.eclipseHintLookAround')}
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
