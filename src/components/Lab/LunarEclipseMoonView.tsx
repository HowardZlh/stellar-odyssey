'use client';

/**
 * 月食实验室月球视角场景叶组件（LE 迭代 M5-1，IMPROVEMENT_REQUIREMENTS_LUNAR_ECLIPSE
 * §2.3 / 契约 C3 月球视角段 / B8 登记）
 *
 * 站上月面近地侧看「月球上的日食」：漆黑地球盘（夜半球，食期间无直射）+
 * 大气红环壳（**环状散射：单 mesh + 单 shader**——地球盘剪影外缘一圈薄环，
 * 亮度/色相由契约 C1 earthRingColor(turbidity) uniform 驱动，与 M3 浑浊度
 * 滑杆同一状态源——「调浑浊度 → 红环与血月同步变深」因果闭环的实现层）+
 * 月壤前景剪影（HorizonRidge 程序化剖面手法平移，无大气散射）+ 月面被红光
 * 照亮的色调（lunarMoonViewState.surfaceRgb——与红环同源）。
 *
 * B8 登记（科普卡 lunarMoonViewCard 为用户可见侧）：红环为机制正确的艺术化
 * 再现——真实大气不透明层仅地球半径的 ~1.2%（视角上亚像素），显示厚度放大
 * 至 7%；无逐日大气实况数据；对标 Surveyor 3 (1967) / Blue Ghost Mission 1
 * (2025) 实拍。偏食段太阳自地球缘部分露出（炫目直射 + 红环减淡）由
 * sunVisibleFrac01 线性弦近似驱动——「月球上的日食」的时序叙事侧。
 *
 * 场景空间（契约 C3）：复用地面视角天穹壳约定——地球画在 SKY_SHELL_RADIUS_KM
 * 天穹距离 billboard quad 上按真实视角尺度绘制（~0.95° 视半径），细节靠 FOV
 * 缩放（TrackpadLookControls 手势链）；地球在月面天空的高度/方位为固定常量
 * （近月缘观测点选址，MOON_VIEW_EARTH_ALT_DEG 登记）。星穹复用共享
 * SpaceStarDome（J2000 固定朝向 + 深空极限星等——无大气月面天空的正确口径；
 * 月面天空 ~27.3 天/圈的缓慢周日运动在场景时窗内 <3°，静态近似并入 B11）。
 *
 * 渲染红线（§4）：禁粒子（环壳 + shader 解析绘制）；渲染循环零 buffer 更新
 * （每帧只写 uniform/材质色）；draw call = 星穹 1 + 银河带 1（补丁 P2，
 * reduced 档关）+ 地球红环 quad 1 + 月壤地面盘 1 + 月壤山脊 1 = 5 ≤ 10 预算。
 * 本组件不订阅 locale。
 *
 * LE-M6 补丁 P2（M6-CP 目验发现）：① 片元**边缘淡出窗**——原实现的太阳
 * 辉光衰减尺度（5× 太阳视半径 = 1.33°）在 2.2° 的 quad 内衰减不掉，被 quad
 * 几何边界硬切成一个明显的亮灰方块；现 col/alpha 同乘边缘窗，边界处恒为 0
 * （结构性防守，后续新增发光项自动受收）；② 辉光收紧至 2× 太阳视半径、
 * 幅度 0.45（月面无大气，本项只是相机眩光的再现）；③ 背景不再空洞——
 * 星穹增益提高 + 挂载银河带 + 默认机位下调让月壤前景入画（三项均为
 * 物理正确的做法，**不抬全局曝光底**：月面天空仍是纯黑）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { YaleBrightStar } from '@/utils/bakedData';
import { STAR_DOME_RADIUS_UNITS, sceneDirFromAltAz } from '@/utils/meteorShower';
import { SKY_SHELL_RADIUS_KM } from '@/utils/solarEclipse';
import {
  RIDGE_DARKEN_FACTOR,
  RIDGE_RADIUS_KM,
  RIDGE_SEGMENTS,
  ridgeHeightProfile,
} from '@/utils/labSky';
import {
  EARTH_RING_WIDTH_FRAC,
  MOON_VIEW_EARTH_ALT_DEG,
  MOON_VIEW_EARTH_AZ_DEG,
  MOON_VIEW_EDGE_FADE_END_FRAC,
  MOON_VIEW_EDGE_FADE_START_FRAC,
  MOON_VIEW_MILKY_WAY_INTENSITY,
  MOON_VIEW_QUAD_HALF_ANGLE_RAD,
  MOON_VIEW_RING_GAIN,
  MOON_VIEW_STAR_GAIN,
  MOON_VIEW_SUN_GAIN,
  MOON_VIEW_SUN_GLOW_GAIN,
  MOON_VIEW_SUN_GLOW_SCALE,
  emptyLunarMoonViewState,
  lunarExposureGain,
  lunarMoonViewState,
  type LunarFrameState,
} from '@/utils/lunarEclipseLab';
import {
  MilkyWayBand,
  SpaceStarDome,
} from '@/components/Lab/EclipseSpaceShared';

/** 度 → 弧度 */
const DEG = Math.PI / 180;

/** 月壤地面盘 y（地面视角 GROUND_DISK_Y_UNITS 同款登记：防遮挡天空的下沉量） */
const MOON_GROUND_Y_UNITS = -1.7;

/** 月壤山脊剖面种子（确定性；与地面视角异种子——月面地形独立） */
const MOON_RIDGE_SEED = 0x5e1e0e;

/** 月壤山脊高度放大（× ridgeHeightProfile 输出；近景月面地形剪影的前景存在感） */
const MOON_RIDGE_HEIGHT_SCALE = 2.2;

/** 地球方向（场景单位向量；固定机位，契约 C3 月球视角段） */
const EARTH_DIR = sceneDirFromAltAz({
  altRad: MOON_VIEW_EARTH_ALT_DEG * DEG,
  azRad: MOON_VIEW_EARTH_AZ_DEG * DEG,
});

/** 本组件消费的帧循环 refs 子集（LunarEclipseLab 的 LunarFrameRefs 结构超集兼容） */
export interface LunarMoonViewRefs {
  frameRef: { current: LunarFrameState };
  settingsRef: {
    current: {
      turbidity01: number;
      exposure01: number;
    };
  };
}

// ---------------------------------------------------------------------------
// 地球红环 quad（单 mesh + 单 shader；黑地球盘 + 红环 + 偏食段太阳露出）
// ---------------------------------------------------------------------------

const EARTH_RING_VERTEX_SHADER = /* glsl */ `
  uniform float uHalfAngle;
  varying vec2 vAng;
  void main() {
    vAng = (uv - 0.5) * 2.0 * uHalfAngle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 地球红环 fragment（M5-1）：
 * 1 夜半球地球盘：近黑微蓝剪影（食期间对月面无直射——「漆黑地球」）；
 * 2 红环：地球缘双侧指数衰减薄环（内侧更陡——大气只在外缘；显示厚度
 *   EARTH_RING_WIDTH_FRAC 放大登记 B8）× 前向散射方位调制（太阳偏心时
 *   朝日侧更亮）× (1 − uSunVis 减淡)——太阳全隐（全食段）时红环最纯；
 * 3 太阳：偏食段自地球缘部分露出的炫目直射盘（几何遮挡 = 地球盘剪影），
 *   HDR 增益交 Bloom 辉光；
 * 4 uExposure：与血月同一曝光滑杆（B2 口径跨视角一致）。
 */
const EARTH_RING_FRAGMENT_SHADER = /* glsl */ `
  uniform float uHalfAngle;
  uniform float uEarthR;
  uniform float uSunR;
  uniform vec2 uSunOff;
  uniform float uSunVis;
  uniform vec3 uRing;
  uniform float uExposure;
  varying vec2 vAng;

  void main() {
    float r = length(vAng);
    float aa = uEarthR * 0.02;
    float disk = 1.0 - smoothstep(uEarthR - aa, uEarthR + aa, r);
    // 夜半球地球盘（微弱盘心-盘缘渐变防死黑）
    vec3 earthCol = vec3(0.0035, 0.005, 0.009)
      * (0.65 + 0.35 * (1.0 - clamp(r / max(uEarthR, 1e-6), 0.0, 1.0)));
    // 红环：缘部双侧指数衰减（B8 显示厚度放大登记）
    float w = uEarthR * ${EARTH_RING_WIDTH_FRAC.toFixed(3)};
    float t = (r - uEarthR) / max(w, 1e-6);
    float ringShape = t < 0.0 ? exp(t * 3.0) : exp(-t * 1.2);
    // 边缘淡出窗（补丁 P2）：quad 几何边界处强制归零——任何发光项都不再
    // 被硬切出方块（结构性防守，勿删）
    float edge = 1.0 - smoothstep(
      uHalfAngle * ${MOON_VIEW_EDGE_FADE_START_FRAC.toFixed(3)},
      uHalfAngle * ${MOON_VIEW_EDGE_FADE_END_FRAC.toFixed(3)},
      r
    );
    // 前向散射方位调制：太阳偏心时朝日侧更亮（全食深处 sep→0 趋于均匀）
    // reduced 档降采样：省去逐像素方位求解，取均匀环（形状/色相/亮度基准不变）
    float azMod = 1.0;
    #ifndef LUNAR_RING_REDUCED
      float sep = length(uSunOff);
      if (sep > 1e-6 && r > 1e-6) {
        azMod = 1.0
          + 0.45 * dot(vAng / r, uSunOff / sep) * clamp(sep / uEarthR, 0.0, 1.0);
      }
    #endif
    vec3 ringCol = uRing * ringShape * azMod
      * ${MOON_VIEW_RING_GAIN.toFixed(2)} * (1.0 - 0.85 * uSunVis);
    // 太阳（偏食段部分露出；地球盘几何遮挡）
    float ds = length(vAng - uSunOff);
    float sunAa = uSunR * 0.25;
    float sunMask = (1.0 - smoothstep(uSunR - sunAa, uSunR + sunAa, ds)) * (1.0 - disk);
    vec3 sunCol = vec3(1.0, 0.95, 0.86) * ${MOON_VIEW_SUN_GAIN.toFixed(1)} * sunMask;
    // 太阳辉光包络（露出时随可见比增强）；reduced 档省去 exp 长尾。
    // 补丁 P2：衰减尺度与幅度收紧（月面无大气，本项只是相机眩光的再现）
    vec3 glow = vec3(0.0);
    #ifndef LUNAR_RING_REDUCED
      glow = vec3(1.0, 0.9, 0.75)
        * exp(-ds / (uSunR * ${MOON_VIEW_SUN_GLOW_SCALE.toFixed(2)}))
        * ${MOON_VIEW_SUN_GLOW_GAIN.toFixed(2)} * uSunVis * (1.0 - disk);
    #endif

    vec3 col = (earthCol * disk + ringCol + sunCol + glow) * uExposure * edge;
    float alpha =
      max(disk, max(ringShape * (1.0 - 0.85 * uSunVis), sunMask)) * edge;
    if (alpha < 0.004 && max(col.r, max(col.g, col.b)) < 0.004) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/**
 * 地球红环 quad（1 draw call；位姿固定挂载期一次，逐帧只写标量/vec2/vec3
 * uniform——零 buffer 更新）。
 *
 * reduced 档「红环壳降采样」（M6-2，需求 §4 画质分档）：`uReduced` 关闭
 * 两项**逐像素附加项**——前向散射方位调制（依赖 length/dot 的方位求解）
 * 与太阳辉光包络（exp 长尾），改由常数/硬边替代。红环的形状、色相、
 * 亮度基准与地球/太阳的几何尺寸**全部不变**（只减片元指令数，非改物理），
 * 用户可见侧为 `lab.lunarReducedNote`。
 */
function EarthRingQuad({
  refs,
  reduced,
}: {
  refs: LunarMoonViewRefs;
  reduced: boolean;
}): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        defines: reduced ? { LUNAR_RING_REDUCED: '' } : {},
        uniforms: {
          uHalfAngle: { value: MOON_VIEW_QUAD_HALF_ANGLE_RAD },
          uEarthR: { value: 0.0166 },
          uSunR: { value: 0.00465 },
          uSunOff: { value: new THREE.Vector2(0, 0) },
          uSunVis: { value: 0 },
          uRing: { value: new THREE.Color(0, 0, 0) },
          uExposure: { value: 1 },
        },
        vertexShader: EARTH_RING_VERTEX_SHADER,
        fragmentShader: EARTH_RING_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
      }),
    // 画质档为挂载期常量（labQualityParams 同链，切档不发生）——依赖登记
    [reduced]
  );
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  // 位姿固定（地球在月面天空不动——潮汐锁定；挂载期一次）
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.position.set(
      EARTH_DIR[0] * SKY_SHELL_RADIUS_KM,
      EARTH_DIR[1] * SKY_SHELL_RADIUS_KM,
      EARTH_DIR[2] * SKY_SHELL_RADIUS_KM
    );
    mesh.lookAt(0, 0, 0);
  }, []);

  const scratch = useMemo(() => emptyLunarMoonViewState(), []);

  useFrame(() => {
    const s = refs.settingsRef.current;
    const view = lunarMoonViewState(refs.frameRef.current, s.turbidity01, scratch);
    const u = material.uniforms;
    u.uEarthR.value = view.earthRadRad;
    u.uSunR.value = view.sunRadRad;
    // quad 本地系：lookAt 原点后 +X = 方位角减小向 → 写 (−east, up)（地面
    // 月盘 quad 同约定）
    (u.uSunOff.value as THREE.Vector2).set(-view.sunOffEastRad, view.sunOffUpRad);
    u.uSunVis.value = view.sunVisibleFrac01;
    (u.uRing.value as THREE.Color).setRGB(view.ringRgb[0], view.ringRgb[1], view.ringRgb[2]);
    u.uExposure.value = lunarExposureGain(s.exposure01);
  });

  const quadSize = 2 * SKY_SHELL_RADIUS_KM * Math.tan(MOON_VIEW_QUAD_HALF_ANGLE_RAD);
  return (
    <mesh ref={meshRef} material={material} frustumCulled={false} renderOrder={1}>
      <planeGeometry args={[quadSize, quadSize]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 月壤前景（HorizonRidge 手法平移：程序化剖面剪影 + 地面盘；被红光照亮）
// ---------------------------------------------------------------------------

/** 月壤地面盘（1 draw call；色 = surfaceRgb——直射灰/红环红随食相混合） */
function MoonRegolithGround({
  refs,
  reduced,
}: {
  refs: LunarMoonViewRefs;
  reduced: boolean;
}): JSX.Element {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const scratch = useMemo(() => emptyLunarMoonViewState(), []);

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    const s = refs.settingsRef.current;
    const view = lunarMoonViewState(refs.frameRef.current, s.turbidity01, scratch);
    const gain = lunarExposureGain(s.exposure01);
    material.color.setRGB(
      view.surfaceRgb[0] * gain,
      view.surfaceRgb[1] * gain,
      view.surfaceRgb[2] * gain
    );
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, MOON_GROUND_Y_UNITS, 0]}>
      <circleGeometry args={[STAR_DOME_RADIUS_UNITS, reduced ? 48 : 96]} />
      <meshBasicMaterial ref={materialRef} color="#050505" side={THREE.DoubleSide} />
    </mesh>
  );
}

/** 月壤山脊剪影带（几何烘焙一次；异种子 + 高度放大——近景月面地形，无大气） */
function MoonRegolithRidge({ refs }: { refs: LunarMoonViewRefs }): JSX.Element {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  const geometry = useMemo(() => {
    const profile = ridgeHeightProfile(RIDGE_SEGMENTS, MOON_RIDGE_SEED);
    const positions = new Float32Array(RIDGE_SEGMENTS * 2 * 3);
    const indices = new Uint16Array(RIDGE_SEGMENTS * 6);
    for (let i = 0; i < RIDGE_SEGMENTS; i += 1) {
      const theta = (i / RIDGE_SEGMENTS) * Math.PI * 2;
      const x = Math.cos(theta) * RIDGE_RADIUS_KM;
      const z = Math.sin(theta) * RIDGE_RADIUS_KM;
      positions[i * 6] = x;
      positions[i * 6 + 1] = MOON_GROUND_Y_UNITS;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x;
      positions[i * 6 + 4] = MOON_GROUND_Y_UNITS + profile[i] * MOON_RIDGE_HEIGHT_SCALE;
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

  const scratch = useMemo(() => emptyLunarMoonViewState(), []);

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    const s = refs.settingsRef.current;
    const view = lunarMoonViewState(refs.frameRef.current, s.turbidity01, scratch);
    const gain = lunarExposureGain(s.exposure01) * RIDGE_DARKEN_FACTOR;
    material.color.setRGB(
      view.surfaceRgb[0] * gain,
      view.surfaceRgb[1] * gain,
      view.surfaceRgb[2] * gain
    );
  });

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial ref={materialRef} color="#020202" side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 组合导出
// ---------------------------------------------------------------------------

export interface LunarEclipseMoonViewProps {
  refs: LunarMoonViewRefs;
  /** 星穹数据（Yale 亮星；未就绪时 null 跳过挂载） */
  stars: readonly YaleBrightStar[] | null;
  /** 星点尺寸上限（labQualityParams 同链） */
  starPointMaxPx: number;
  /**
   * 画质降级档（M6-2，§4：reduced 档「红环壳降采样」）——红环片元省去
   * 方位调制与辉光长尾、月壤地面盘分段减半；几何尺寸与色值口径不变。
   */
  reduced?: boolean;
}

/** 月球视角场景组（挂载于 LunarEclipseLab 的 viewMode==='moon' 分支） */
export function LunarEclipseMoonView({
  refs,
  stars,
  starPointMaxPx,
  reduced = false,
}: LunarEclipseMoonViewProps): JSX.Element {
  return (
    <>
      {/* 星穹（无大气零消光 → 增益高于太空档，补丁 P2） */}
      {stars && (
        <SpaceStarDome
          stars={stars}
          starPointMaxPx={starPointMaxPx}
          gain={MOON_VIEW_STAR_GAIN}
        />
      )}
      {/* 银河带（补丁 P2）：月面天空的真实主角，填充背景；reduced 档不挂载 */}
      {!reduced && <MilkyWayBand intensity={MOON_VIEW_MILKY_WAY_INTENSITY} />}
      <EarthRingQuad refs={refs} reduced={reduced} />
      <MoonRegolithGround refs={refs} reduced={reduced} />
      <MoonRegolithRidge refs={refs} />
    </>
  );
}
