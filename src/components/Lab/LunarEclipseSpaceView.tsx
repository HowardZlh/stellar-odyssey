'use client';

/**
 * 月食实验室太空视角场景叶组件（LE 迭代 M4，IMPROVEMENT_REQUIREMENTS_LUNAR_ECLIPSE
 * §M4-1…M4-5 / §2.2 / 契约 C3/C4 / 复用日食 C7 与太空基建）
 *
 * 组成与 draw call 预算（§4：真实档 ≤15 / 艺术化档 ≤22）：
 * 真实档 = 星穹 1 + 银河带 1 + 地球表面/大气 2 + 月球 1 + 日盘 1 + 地影双锥 2 +
 * 剖面盘 1 + 轨迹线 1 + 轨道线合批 1 + 行星点合批 1 + 月轨环 1 = 13；
 * 艺术化档另含太阳球 1 + 行星球 7 + 土星环 1 + 小行星带 1 − 行星点 1 = 22。
 *
 * - 地球：日食 SpaceEarth 范式（昼/夜/云并入单 shader + 大气壳 + 地理配准
 *   矩阵每帧写入）**减去影斑分支**——地影不落在地球自身上（差异登记 ①）；
 *   艺术化/×4 档 group 统一缩放（lunarRadialScaleForMode 单一事实源）。
 * - 月球：2K 贴图 + LOLA 4K 法线（导数切线基扰动）+ **血月着色**——契约 C4
 *   镜像：GLSL_UMBRA_SHADING 共享模板（与地面 quad 同一段注入，禁双套）；
 *   逐像素求「世界位到影轴垂距 ρ → ρ/本影显示半径 = rNorm」查色——显示域
 *   垂距与显示半径乘同一径向因子，rNorm 与 km 域真值恒等（比例恒等红线的
 *   shader 侧自洽）；姿态近似潮汐锁定（B11）；位置 = lunarDisplayMoonPos
 *   （轴向真值 + 横向 × 因子，B12 各向异性）。
 * - 地影锥：本影收敛锥 + 半影外扩锥（契约 C1 半径函数逐距离采样的剖面
 *   lathe 几何，**轴向真比例无压缩**——B3 卖点；每帧只写姿态四元数与径向
 *   缩放，几何按事件一次性构建）；半影渲染段在本影锥长处截断（utils 登记）。
 * - 月距处影盘剖面：单 quad shader 双圆（本影实 + 半影淡），随档径向因子
 *   同倍缩放（比例恒等）；月球轨迹线：时间窗均匀采样 + 已走过段变色
 *   （uSwept01 + aT，零 buffer 更新；径向因子变化允许一次性重建）。
 * - M7 观感层（默认开，B14 继承日食 A15/A17/A18 口径）：共享叶组件
 *   SpaceStarDome / MilkyWayBand / SpaceSun / PlanetOrbitLayer（+ 艺术化档
 *   小行星带）/ MoonPathRing（radialFactorRef 各向异性共点扩展）。
 * - 交点几何望态（§M4-5，B4）：共享 MoonOrbitRing 夸张轨道环 + 朔态月影锥
 *   （契约 C1 umbraCone/penumbraCone——「影锥方向反转」的可视侧；单位锥
 *   几何 + 每帧矩阵）。叙事模式下月球位置走示意轨道（显示不施加横向因子，
 *   差异登记 ②：叙事为示意演示，径向比例恒等红线作用于星历路径）。
 *
 * 状态流：全部量由 refs.spaceRef（LunarTimeDriver 每帧经 lunarSpaceFrameState
 * 重建，tSec 单值可重建红线）读取；本组件 useFrame 只写 uniform/矩阵。
 * locale 纪律：本组件不订阅 locale（标签经共享叶组件内部处理）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { textureUrl, normalMapUrl } from '@/data/textures';
import { useBitmapTexture } from '@/hooks/useBitmapTexture';
import type { YaleBrightStar } from '@/utils/bakedData';
import {
  EARTH_MEAN_RADIUS_KM,
  MOON_MEAN_RADIUS_KM,
  type EphemerisSeries,
} from '@/utils/solarEclipse';
import {
  PENUMBRA_SHADING_MAX_DIM,
  turbidityToDanjonL,
} from '@/utils/lunarEclipse';
import {
  LUNAR_ALBEDO_MEAN,
  LUNAR_MOON_BASE_GAIN,
  UMBRA_EDGE_BLEND_FRAC,
  lunarExposureGain,
} from '@/utils/lunarEclipseLab';
import {
  INCLINATION_DISPLAY_FACTOR,
  MOON_ORBIT_INCLINATION_DEG,
  NARRATIVE_ORBIT_RADIUS_KM,
  SPACE_EARTH_RADIUS_UNITS,
  SPACE_UNITS_PER_KM,
  type EclipseBodyScaleMode,
  type MutableVec3,
} from '@/utils/solarEclipseSpace';
import {
  lunarRadialScaleForMode,
  lunarDisplayMoonPos,
  moonTrajectoryPositions,
  shadowConeProfileUnits,
  trajectorySweep01,
  type LunarSpaceFrameState,
  type LunarSyzygyMode,
} from '@/utils/lunarEclipseSpace';
import type { EclipseTimelineWindow } from '@/utils/solarEclipseLab';
import {
  MilkyWayBand,
  MoonOrbitRing,
  MoonPathRing,
  PlanetOrbitLayer,
  SpaceStarDome,
  SpaceSun,
  SPACE_TEXTURE_PRIORITY,
} from '@/components/Lab/EclipseSpaceShared';
import { GLSL_UMBRA_SHADING } from '@/components/Lab/lunarBloodMoonGlsl';

/** 度 → 弧度 */
const DEG = Math.PI / 180;

/** 云层相对地表 uv 漂移速率（圈/秒；日食 SpaceEarth 同源换算） */
const CLOUD_DRIFT_REV_PER_SEC = 0.12 / 86164;

/** 大气辉光壳顶高（km；日食 SpaceEarth 同值） */
const SPACE_ATMOSPHERE_TOP_KM = 120;

/** 叙事轨道环显示倾角（弧度；真实 5.145° × 显示倍率 4，B4 双条目同口径） */
const NARRATIVE_INC_RAD = MOON_ORBIT_INCLINATION_DEG * INCLINATION_DISPLAY_FACTOR * DEG;

/** 本组件消费的帧循环 refs 子集（LunarEclipseLab 的 LunarFrameRefs 结构超集兼容） */
export interface LunarSpaceRefs {
  tSecRef: { current: number };
  eventRef: {
    current: {
      event: { geo: EphemerisSeries };
      window: EclipseTimelineWindow;
    };
  };
  settingsRef: {
    current: {
      turbidity01: number;
      exposure01: number;
      bodyScaleMode: EclipseBodyScaleMode;
      radialMagnify: boolean;
      inclinationDemo: boolean;
      syzygy: LunarSyzygyMode;
    };
  };
  spaceRef: { current: LunarSpaceFrameState };
}

/** 当前统一径向因子（settingsRef 单点换算；useFrame 内逐帧读取） */
function frameRadialFactor(refs: LunarSpaceRefs): number {
  const s = refs.settingsRef.current;
  return lunarRadialScaleForMode(s.bodyScaleMode, s.radialMagnify);
}

// ---------------------------------------------------------------------------
// 地球（日食 SpaceEarth 范式减影斑分支；姿态矩阵每帧写入 + 档位统一缩放）
// ---------------------------------------------------------------------------

const LUNAR_EARTH_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** 表面 fragment（日食 SpaceEarth 同式，去掉影斑锥投影分支——差异登记 ①） */
const LUNAR_EARTH_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform sampler2D uCloudMap;
  uniform float uHasDayMap;
  uniform float uHasNightMap;
  uniform float uHasCloudMap;
  uniform vec3 uSunDir;
  uniform float uCloudShiftU;
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vec3 geoN = normalize(vNormalW);
    float ndl = dot(geoN, uSunDir);
    float day = smoothstep(-0.08, 0.08, ndl);
    vec3 dayColor = mix(vec3(0.045, 0.08, 0.16), texture2D(uDayMap, vUv).rgb, uHasDayMap);
    vec2 cloudUv = vec2(fract(vUv.x + uCloudShiftU), vUv.y);
    vec3 cloudTex = texture2D(uCloudMap, cloudUv).rgb;
    float cloud = dot(cloudTex, vec3(0.299, 0.587, 0.114)) * uHasCloudMap;
    dayColor = mix(dayColor, vec3(0.94, 0.95, 0.97), cloud * 0.85);
    float light = 0.06 + 0.94 * day;
    vec3 color = dayColor * light;
    float night = smoothstep(0.08, -0.18, ndl);
    color += texture2D(uNightMap, vUv).rgb * night * 1.5 * uHasNightMap;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const LUNAR_ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const LUNAR_ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 geoN = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float limb = pow(1.0 - abs(dot(viewDir, geoN)), 2.2);
    float dayFactor = clamp(dot(geoN, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 color = mix(vec3(0.10, 0.22, 0.38) * 0.4, vec3(0.36, 0.62, 1.0), dayFactor);
    float alpha = limb * (0.22 + 0.68 * dayFactor);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

/** 地球（表面 + 大气壳；姿态矩阵 + 档位缩放每帧写入） */
function LunarSpaceEarth({ refs }: { refs: LunarSpaceRefs }): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const dayMap = useBitmapTexture(textureUrl('earth', 'surface'), SPACE_TEXTURE_PRIORITY, true);
  const nightMap = useBitmapTexture(textureUrl('earth', 'night'), SPACE_TEXTURE_PRIORITY, true);
  const cloudMap = useBitmapTexture(textureUrl('earth', 'clouds'), SPACE_TEXTURE_PRIORITY, true);

  const surfaceMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uDayMap: { value: null },
          uNightMap: { value: null },
          uCloudMap: { value: null },
          uHasDayMap: { value: 0 },
          uHasNightMap: { value: 0 },
          uHasCloudMap: { value: 0 },
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uCloudShiftU: { value: 0 },
        },
        vertexShader: LUNAR_EARTH_VERTEX_SHADER,
        fragmentShader: LUNAR_EARTH_FRAGMENT_SHADER,
      }),
    []
  );
  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) } },
        vertexShader: LUNAR_ATMOSPHERE_VERTEX_SHADER,
        fragmentShader: LUNAR_ATMOSPHERE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    []
  );

  useEffect(() => {
    surfaceMaterial.uniforms.uDayMap.value = dayMap;
    surfaceMaterial.uniforms.uHasDayMap.value = dayMap ? 1 : 0;
  }, [surfaceMaterial, dayMap]);
  useEffect(() => {
    surfaceMaterial.uniforms.uNightMap.value = nightMap;
    surfaceMaterial.uniforms.uHasNightMap.value = nightMap ? 1 : 0;
  }, [surfaceMaterial, nightMap]);
  useEffect(() => {
    surfaceMaterial.uniforms.uCloudMap.value = cloudMap;
    surfaceMaterial.uniforms.uHasCloudMap.value = cloudMap ? 1 : 0;
  }, [surfaceMaterial, cloudMap]);
  useEffect(() => {
    return () => {
      surfaceMaterial.dispose();
      atmosphereMaterial.dispose();
    };
  }, [surfaceMaterial, atmosphereMaterial]);

  const scratch = useMemo(() => ({ m4: new THREE.Matrix4() }), []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const space = refs.spaceRef.current;
    const m = space.earthMatrix3;
    scratch.m4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    group.setRotationFromMatrix(scratch.m4);
    // 档位统一径向因子（地球在影轴上——球体各向同性缩放即横向缩放，B12/B13）
    group.scale.setScalar(frameRadialFactor(refs));
    (surfaceMaterial.uniforms.uSunDir.value as THREE.Vector3).set(...space.sunDirScene);
    surfaceMaterial.uniforms.uCloudShiftU.value =
      (refs.tSecRef.current * CLOUD_DRIFT_REV_PER_SEC) % 1;
    (atmosphereMaterial.uniforms.uSunDir.value as THREE.Vector3).set(...space.sunDirScene);
  });

  return (
    <group ref={groupRef}>
      <mesh material={surfaceMaterial}>
        <sphereGeometry args={[SPACE_EARTH_RADIUS_UNITS, 96, 96]} />
      </mesh>
      <mesh material={atmosphereMaterial}>
        <sphereGeometry
          args={[(EARTH_MEAN_RADIUS_KM + SPACE_ATMOSPHERE_TOP_KM) * SPACE_UNITS_PER_KM, 96, 96]}
        />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// 月球（血月球体：契约 C4 GLSL 镜像共享注入；潮汐锁定近似 + 各向异性显示位）
// ---------------------------------------------------------------------------

const LUNAR_MOON_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * 月球血月 fragment（契约 C4：与地面 quad 同一 GLSL_UMBRA_SHADING 镜像 +
 * bloodMoonIlluminationRgb 同式两段照度——rNorm = 世界位到影轴垂距 ÷ 本影
 * 显示半径，显示域两量同因子 → rNorm 恒等于 km 域真值）：
 * 直射项 penumbraShading 同式（红线 ② 幅度上限带外原样）；本影段丹戎色表
 * ÷ 平均反照；本影缘窄混合带（几何软化登记同 M3-1）；朗伯昼夜项（血月
 * 折射光与直射光同来自太阳方向半球——远侧月面自然变暗）；LOLA 法线经
 * 屏幕导数切线基扰动（B11 静态姿态近似不变）。
 */
const LUNAR_MOON_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMoonTex;
  uniform float uHasTex;
  uniform sampler2D uNormalTex;
  uniform float uHasNormal;
  uniform vec3 uSunDir;
  uniform vec3 uAxisDir;
  uniform float uUmbraR;
  uniform float uPenR;
  uniform float uDanjonL;
  uniform float uExposure;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  ${GLSL_UMBRA_SHADING}

  vec3 perturbNormal(vec3 n, vec3 pos, vec2 uv) {
    vec3 mapN = texture2D(uNormalTex, uv).xyz * 2.0 - 1.0;
    vec3 q0 = dFdx(pos);
    vec3 q1 = dFdy(pos);
    vec2 st0 = dFdx(uv);
    vec2 st1 = dFdy(uv);
    vec3 S = normalize(q0 * st1.t - q1 * st0.t);
    vec3 T = normalize(-q0 * st1.s + q1 * st0.s);
    return normalize(mat3(S, T, n) * mapN);
  }

  void main() {
    vec3 albedo = uHasTex > 0.5
      ? texture2D(uMoonTex, vUv).rgb
      : vec3(${LUNAR_ALBEDO_MEAN.toFixed(2)});
    vec3 n = normalize(vNormalW);
    if (uHasNormal > 0.5) n = perturbNormal(n, vPosW, vUv);
    // 影轴垂距（显示域；轴过地心原点）
    float axial = dot(vPosW, uAxisDir);
    vec3 perp = vPosW - axial * uAxisDir;
    float rho = length(perp);
    // 血月照度（bloodMoonIlluminationRgb GLSL 镜像；契约 C4 禁双套）
    vec3 illum = vec3(1.0);
    if (uPenR - uUmbraR > 1e-9) {
      float rp = clamp((rho - uUmbraR) / (uPenR - uUmbraR), 0.0, 1.0);
      illum = vec3(1.0 - ${PENUMBRA_SHADING_MAX_DIM.toFixed(2)} * (1.0 - rp) * (1.0 - rp));
      if (uUmbraR > 0.0) {
        vec3 blood = umbraShading(rho / uUmbraR, uDanjonL)
          / ${LUNAR_ALBEDO_MEAN.toFixed(2)};
        float w = uUmbraR * ${UMBRA_EDGE_BLEND_FRAC.toFixed(3)};
        float s = smoothstep(uUmbraR - w, uUmbraR + w, rho);
        illum = mix(blood, illum, s);
      }
    }
    // 朗伯昼夜项（直射与折射光同来自太阳方向半球；微弱底光防远侧纯黑）
    float lambert = 0.015 + 0.985 * clamp(dot(n, uSunDir), 0.0, 1.0);
    vec3 col = albedo * ${LUNAR_MOON_BASE_GAIN.toFixed(2)} * uExposure * illum * lambert;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function LunarSpaceMoon({ refs }: { refs: LunarSpaceRefs }): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const surface = useBitmapTexture(textureUrl('moon', 'surface'), SPACE_TEXTURE_PRIORITY, true);
  const normal = useBitmapTexture(normalMapUrl('moon'), SPACE_TEXTURE_PRIORITY, true);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uMoonTex: { value: null },
          uHasTex: { value: 0 },
          uNormalTex: { value: null },
          uHasNormal: { value: 0 },
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uAxisDir: { value: new THREE.Vector3(-1, 0, 0) },
          uUmbraR: { value: 0 },
          uPenR: { value: 0 },
          uDanjonL: { value: 2 },
          uExposure: { value: 1 },
        },
        vertexShader: LUNAR_MOON_VERTEX_SHADER,
        fragmentShader: LUNAR_MOON_FRAGMENT_SHADER,
      }),
    []
  );
  useEffect(() => {
    material.uniforms.uMoonTex.value = surface;
    material.uniforms.uHasTex.value = surface ? 1 : 0;
  }, [material, surface]);
  useEffect(() => {
    material.uniforms.uNormalTex.value = normal;
    material.uniforms.uHasNormal.value = normal ? 1 : 0;
  }, [material, normal]);
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  const scratch = useMemo(
    () => ({
      pos: [0, 0, 0] as MutableVec3,
      toEarth: new THREE.Vector3(),
      xAxis: new THREE.Vector3(1, 0, 0),
    }),
    []
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const space = refs.spaceRef.current;
    const s = refs.settingsRef.current;
    const factor = frameRadialFactor(refs);
    // 叙事模式：示意轨道位置不施加横向因子（差异登记 ②）
    const posFactor = s.inclinationDemo ? 1 : factor;
    lunarDisplayMoonPos(space, posFactor, scratch.pos);
    mesh.position.set(scratch.pos[0], scratch.pos[1], scratch.pos[2]);
    mesh.scale.setScalar(factor);
    // 潮汐锁定近似：贴图经度 0°（局部 +X）指向地心（无天平动，B11）
    scratch.toEarth.set(-scratch.pos[0], -scratch.pos[1], -scratch.pos[2]);
    if (scratch.toEarth.lengthSq() > 1e-9) {
      scratch.toEarth.normalize();
      mesh.quaternion.setFromUnitVectors(scratch.xAxis, scratch.toEarth);
    }
    const u = material.uniforms;
    (u.uSunDir.value as THREE.Vector3).set(...space.sunDirScene);
    (u.uAxisDir.value as THREE.Vector3).set(...space.shadowAxisScene);
    // 显示域影半径 = 真值 × 同一因子（rNorm 与 km 域恒等——比例恒等红线）
    u.uUmbraR.value = space.umbraRadiusAtMoonUnits * posFactor;
    u.uPenR.value = space.penumbraRadiusAtMoonUnits * posFactor;
    u.uDanjonL.value = turbidityToDanjonL(s.turbidity01);
    u.uExposure.value = lunarExposureGain(s.exposure01);
  });

  return (
    <mesh ref={meshRef} material={material}>
      <sphereGeometry args={[MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM, 64, 64]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 地影锥（C1 半径函数逐距离剖面 lathe；轴向真比例，每帧只写姿态/径向缩放）
// ---------------------------------------------------------------------------

/** 锥面环向分段 */
const CONE_RADIAL_SEGMENTS = 48;

const EARTH_CONE_VERTEX_SHADER = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EARTH_CONE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vT;
  void main() {
    // additive 远端渐隐（本影向锥尖收敛处淡出，避免尖端过曝）
    float alpha = uAlpha * (1.0 - vT * 0.55);
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/** 剖面 → 开放 lathe 几何（局部 +Y = 轴向距离；一次性构建，档位切换不重建） */
function buildConeProfileGeometry(profile: Float64Array): THREE.BufferGeometry {
  const stations = profile.length / 2;
  const ringVerts = CONE_RADIAL_SEGMENTS + 1;
  const positions = new Float32Array(stations * ringVerts * 3);
  const ts = new Float32Array(stations * ringVerts);
  for (let i = 0; i < stations; i += 1) {
    const d = profile[i * 2];
    const r = profile[i * 2 + 1];
    const t = i / (stations - 1);
    for (let j = 0; j < ringVerts; j += 1) {
      const phi = (j / CONE_RADIAL_SEGMENTS) * Math.PI * 2;
      const k = (i * ringVerts + j) * 3;
      positions[k] = Math.cos(phi) * r;
      positions[k + 1] = d;
      positions[k + 2] = Math.sin(phi) * r;
      ts[i * ringVerts + j] = t;
    }
  }
  const indices = new Uint32Array((stations - 1) * CONE_RADIAL_SEGMENTS * 6);
  let cursor = 0;
  for (let i = 0; i < stations - 1; i += 1) {
    for (let j = 0; j < CONE_RADIAL_SEGMENTS; j += 1) {
      const a = i * ringVerts + j;
      const b = a + 1;
      const c = a + ringVerts;
      const dIdx = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = dIdx;
      cursor += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/** 地影单锥（本影/半影；几何按事件一次性构建，每帧姿态 + 径向缩放） */
function EarthShadowCone({
  refs,
  kind,
}: {
  refs: LunarSpaceRefs;
  kind: 'umbra' | 'penumbra';
}): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const geo = refs.eventRef.current.event.geo;

  // 剖面几何（km 域 C1 函数逐站采样后统一缩放；日地距取序列中点——
  // 窗内变化 <0.1%，一次性构建登记）
  const geometry = useMemo(() => {
    const midRow = geo.rows[Math.floor(geo.rows.length / 2)];
    const sunDistKm = midRow[3];
    return buildConeProfileGeometry(shadowConeProfileUnits(kind, sunDistKm));
  }, [geo, kind]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(kind === 'umbra' ? '#5a6a9a' : '#3a4a72') },
          uAlpha: { value: kind === 'umbra' ? 0.3 : 0.09 },
        },
        vertexShader: EARTH_CONE_VERTEX_SHADER,
        fragmentShader: EARTH_CONE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [kind]
  );
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const scratch = useMemo(
    () => ({ up: new THREE.Vector3(0, 1, 0), dir: new THREE.Vector3() }),
    []
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const space = refs.spaceRef.current;
    const f = frameRadialFactor(refs);
    scratch.dir.set(...space.shadowAxisScene);
    mesh.quaternion.setFromUnitVectors(scratch.up, scratch.dir);
    // 横向统一因子、轴向真比例不动（B12/B13；比例恒等红线）
    mesh.scale.set(f, 1, f);
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />;
}

/** 地影双锥 */
function EarthShadowCones({ refs }: { refs: LunarSpaceRefs }): JSX.Element {
  return (
    <>
      <EarthShadowCone refs={refs} kind="umbra" />
      <EarthShadowCone refs={refs} kind="penumbra" />
    </>
  );
}

// ---------------------------------------------------------------------------
// 月距处影盘剖面（单 quad shader 双圆；随档径向因子同倍缩放——比例恒等）
// ---------------------------------------------------------------------------

const SECTION_DISK_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 半透明双圆：本影盘（实）+ 半影盘（淡）+ 双缘描线（quad 半宽 = 半影显示半径 × 1.06）
 *
 * LE-M6 补丁 P4：**补回 `varying vec2 vUv` 声明**——此前片元侧漏声明导致
 * program 编译失败（`ERROR: 'vUv' : undeclared identifier`），「月距处影盘
 * 剖面」自 M4-2 起从未真正渲染过（WebGL 编译在运行时，Jest/构建都拦不住）。
 * 配套 `__tests__/glslVaryings.test.ts` 静态扫描全仓 glsl 模板串防同类静默失效。
 */
const SECTION_DISK_FRAGMENT_SHADER = /* glsl */ `
  uniform float uRatio;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0 * 1.06;
    float penFill = (1.0 - smoothstep(0.985, 1.0, r)) * 0.05;
    float penEdge = (1.0 - smoothstep(0.008, 0.016, abs(r - 1.0))) * 0.35;
    float umbFill = (1.0 - smoothstep(uRatio * 0.985, uRatio, r)) * 0.13;
    float umbEdge = (1.0 - smoothstep(0.008, 0.016, abs(r - uRatio))) * 0.5;
    vec3 pen = vec3(0.45, 0.55, 0.85);
    vec3 umb = vec3(0.85, 0.45, 0.35);
    vec3 col = pen * (penFill + penEdge) + umb * (umbFill + umbEdge);
    float alpha = penFill + penEdge + umbFill + umbEdge;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

function ShadowSectionDisk({ refs }: { refs: LunarSpaceRefs }): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uRatio: { value: 0.56 } },
        vertexShader: SECTION_DISK_VERTEX_SHADER,
        fragmentShader: SECTION_DISK_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    []
  );
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  const scratch = useMemo(
    () => ({ z: new THREE.Vector3(0, 0, 1), dir: new THREE.Vector3() }),
    []
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const space = refs.spaceRef.current;
    if (!space.sectionExists || space.penumbraRadiusAtMoonUnits <= 0) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const f = frameRadialFactor(refs);
    const ax = space.shadowAxisScene;
    mesh.position.set(
      ax[0] * space.moonAxialUnits,
      ax[1] * space.moonAxialUnits,
      ax[2] * space.moonAxialUnits
    );
    scratch.dir.set(ax[0], ax[1], ax[2]);
    mesh.quaternion.setFromUnitVectors(scratch.z, scratch.dir);
    // quad 半宽 = 半影显示半径 × 1.06（shader 内 r 已含该裕量）
    const half = space.penumbraRadiusAtMoonUnits * f * 1.06;
    mesh.scale.set(half, half, 1);
    material.uniforms.uRatio.value =
      space.umbraRadiusAtMoonUnits / space.penumbraRadiusAtMoonUnits;
  });

  return (
    <mesh ref={meshRef} material={material} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 月球轨迹线（时间窗均匀采样 + 已走过段变色；径向因子变化一次性重建）
// ---------------------------------------------------------------------------

const TRAJECTORY_VERTEX_SHADER = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAJECTORY_FRAGMENT_SHADER = /* glsl */ `
  uniform float uSwept01;
  varying float vT;
  void main() {
    // 已走过段：暖橙；未走段：青蓝（日食中心线同色语义）
    vec3 swept = vec3(1.0, 0.62, 0.2);
    vec3 ahead = vec3(0.35, 0.75, 1.0);
    vec3 col = mix(ahead, swept, step(vT, uSwept01));
    gl_FragColor = vec4(col, 0.85);
  }
`;

function MoonTrajectoryLine({
  refs,
  radialFactor,
}: {
  refs: LunarSpaceRefs;
  /** 统一径向因子（React 状态入参——变化触发一次性重建，档位切换允许） */
  radialFactor: number;
}): JSX.Element {
  const { geo } = refs.eventRef.current.event;
  const window_ = refs.eventRef.current.window;

  const geometry = useMemo(() => {
    const positions = moonTrajectoryPositions(geo, window_, radialFactor);
    const n = positions.length / 3;
    const ts = new Float32Array(n);
    for (let i = 0; i < n; i += 1) ts[i] = n > 1 ? i / (n - 1) : 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
    return g;
  }, [geo, window_, radialFactor]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSwept01: { value: 0 } },
        vertexShader: TRAJECTORY_VERTEX_SHADER,
        fragmentShader: TRAJECTORY_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
      }),
    []
  );
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(() => {
    material.uniforms.uSwept01.value = trajectorySweep01(
      refs.tSecRef.current,
      refs.eventRef.current.window
    );
  });

  const line = useMemo(() => {
    const l = new THREE.Line(geometry, material);
    l.frustumCulled = false;
    return l;
  }, [geometry, material]);

  return <primitive object={line} />;
}

// ---------------------------------------------------------------------------
// 朔态月影锥（§M4-5 影锥方向反转可视侧；日食 ShadowCone 单位锥同手法）
// ---------------------------------------------------------------------------

/** 单位锥几何（锥尖原点、底 y=−1、底半径 1；日食 ShadowCone 同式） */
function useUnitConeGeometry(): THREE.ConeGeometry {
  const geometry = useMemo(() => {
    const geo = new THREE.ConeGeometry(1, 1, 64, 1, true);
    geo.translate(0, -0.5, 0);
    return geo;
  }, []);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);
  return geometry;
}

const MOON_CONE_VERTEX_SHADER = /* glsl */ `
  varying float vFade;
  void main() {
    vFade = -position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MOON_CONE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vFade;
  void main() {
    float alpha = uAlpha * (1.0 - vFade * 0.85);
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

function MoonShadowCone({
  refs,
  kind,
  geometry,
}: {
  refs: LunarSpaceRefs;
  kind: 'umbra' | 'penumbra';
  geometry: THREE.ConeGeometry;
}): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(kind === 'umbra' ? '#9a6a5a' : '#72483a') },
          uAlpha: { value: kind === 'umbra' ? 0.34 : 0.1 },
        },
        vertexShader: MOON_CONE_VERTEX_SHADER,
        fragmentShader: MOON_CONE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [kind]
  );
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  const scratch = useMemo(
    () => ({ down: new THREE.Vector3(0, -1, 0), dir: new THREE.Vector3() }),
    []
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const space = refs.spaceRef.current;
    if (!space.moonShadowActive) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const f = frameRadialFactor(refs);
    const tip = kind === 'umbra' ? space.msUmbraTipScene : space.msPenTipScene;
    const dir = kind === 'umbra' ? space.msUmbraDirScene : space.msPenDirScene;
    const len = kind === 'umbra' ? space.msUmbraLenUnits : space.msPenLenUnits;
    const baseR = kind === 'umbra' ? space.msUmbraBaseRadiusUnits : space.msPenBaseRadiusUnits;
    mesh.position.set(tip[0], tip[1], tip[2]);
    scratch.dir.set(dir[0], dir[1], dir[2]);
    mesh.quaternion.setFromUnitVectors(scratch.down, scratch.dir);
    mesh.scale.set(baseR * f, len, baseR * f);
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />;
}

/** 朔态月影双锥（望↔朔切换时「影锥方向反转」的可视载体） */
function MoonShadowCones({ refs }: { refs: LunarSpaceRefs }): JSX.Element {
  const geometry = useUnitConeGeometry();
  return (
    <>
      <MoonShadowCone refs={refs} kind="umbra" geometry={geometry} />
      <MoonShadowCone refs={refs} kind="penumbra" geometry={geometry} />
    </>
  );
}

// ---------------------------------------------------------------------------
// 组合导出
// ---------------------------------------------------------------------------

export interface LunarEclipseSpaceViewProps {
  refs: LunarSpaceRefs;
  /** 星穹数据（Yale 亮星；未就绪时 null 跳过挂载） */
  stars: readonly YaleBrightStar[] | null;
  /** 星点尺寸上限（labQualityParams 同链） */
  starPointMaxPx: number;
  /** 银河带（reduced 档随 labQualityParams 关闭，B14/A15） */
  milkyWay: boolean;
  /** 天体比例档（默认艺术化，决策 ⑦；B13） */
  bodyScaleMode: EclipseBodyScaleMode;
  /** 真实档径向放大 ×4 开关（默认开，决策 ⑨；B12） */
  radialMagnify: boolean;
  /** 月距处影盘剖面开关（§M4-2） */
  sectionDisk: boolean;
  /** 行星轨道远景层（默认开；倾角叙事时父级传 false——日食同口径） */
  planetOrbits: boolean;
  /** 交点几何叙事模式（§M4-5） */
  inclinationDemo: boolean;
  /** 朔↔望档（叙事模式内；'new' 时月影锥可见——影锥方向反转） */
  syzygy: LunarSyzygyMode;
  /** 小行星带（艺术化档专属；reduced 档由父级关闭，B14/A18） */
  asteroidBelt: boolean;
}

/** 月食太空视角场景组（挂载于 LunarEclipseLab 的 viewMode==='space' 分支） */
export function LunarEclipseSpaceView({
  refs,
  stars,
  starPointMaxPx,
  milkyWay,
  bodyScaleMode,
  radialMagnify,
  sectionDisk,
  planetOrbits,
  inclinationDemo,
  syzygy,
  asteroidBelt,
}: LunarEclipseSpaceViewProps): JSX.Element {
  const art = bodyScaleMode === 'art';
  const factor = lunarRadialScaleForMode(bodyScaleMode, radialMagnify);
  return (
    <>
      {stars && <SpaceStarDome stars={stars} starPointMaxPx={starPointMaxPx} />}
      {milkyWay && <MilkyWayBand />}
      <LunarSpaceEarth refs={refs} />
      <LunarSpaceMoon refs={refs} />
      <SpaceSun frameRef={refs.spaceRef} art={art} />
      <EarthShadowCones refs={refs} />
      {sectionDisk && !inclinationDemo && <ShadowSectionDisk refs={refs} />}
      {!inclinationDemo && <MoonTrajectoryLine refs={refs} radialFactor={factor} />}
      {planetOrbits && !inclinationDemo && (
        <PlanetOrbitLayer
          tSecRef={refs.tSecRef}
          frameRef={refs.spaceRef}
          art={art}
          belt={art && asteroidBelt}
        />
      )}
      {/* 月球绕地轨道环（P7「过月圆环」终态，三档恒挂）：放大档下月球位置
          横向 ×f，真实半径圆环不穿过显示月球（P3 曾因整圈各向异性映射产出
          巨椭圆而藏环）。现环取显示月位的方向与模长——每帧严格穿过月球、
          半径窗内微幅呼吸（艺术化档 373→410 单位），远侧为圆形轨道示意
          （详见 MoonPathRing 头注释；用户可见口径并入 lunarScaleCard）。
          真实档关 ×4 时 f=1，显示位 = 真实位——与日食同款真圆环恒等。 */}
      {!inclinationDemo && (
        <MoonPathRing
          tSecRef={refs.tSecRef}
          frameRef={refs.spaceRef}
          geoRef={refs.eventRef}
          getDisplayPos={(out) =>
            lunarDisplayMoonPos(
              refs.spaceRef.current,
              frameRadialFactor(refs),
              out,
            )
          }
        />
      )}
      {inclinationDemo && (
        <MoonOrbitRing
          tSecRef={refs.tSecRef}
          windowRef={refs.eventRef}
          incRad={NARRATIVE_INC_RAD}
          orbitRadiusKm={NARRATIVE_ORBIT_RADIUS_KM}
        />
      )}
      {inclinationDemo && syzygy === 'new' && <MoonShadowCones refs={refs} />}
    </>
  );
}
