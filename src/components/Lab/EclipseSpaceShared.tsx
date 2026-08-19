'use client';

/**
 * 日食/月食实验室共享太空视角叶组件（LE 迭代 M4-0 抽取，纯重构零行为变化；
 * IMPROVEMENT_REQUIREMENTS_LUNAR_ECLIPSE 决策 ⑪ / 日食条目契约 C7 登记）
 *
 * 来源：全部组件自 `EclipseSpaceView.tsx`（日食版本 1.1 M7/M8 终态）逐行
 * 迁入，日食侧改 import——shader 字符串/uniform/常量逐字保持（M2 抽
 * TrackpadLookControls 先例）。**唯一改动**：日食专属 `EclipseSpaceRefs`
 * 入参泛化为最小结构化接口（SharedTimeRef / SharedSpaceFrameRef /
 * SharedGeoEventRef / SharedWindowRef）——两条目的 refs 均结构化满足，
 * 日食侧传参等价（差异登记回写两份需求文档）。
 *
 * 组件清单（艺术化登记口径继承日食 A15/A17/A18，月食侧 B14 同口径）：
 * - SpaceStarDome：J2000 固定朝向真实星穹（Yale 亮星，极限星等固定深空档，A15）；
 * - MilkyWayBand：程序化银河带（银道面方位真实、形态艺术再现，A15）；
 * - SpaceSun：方向光 + 远景日盘辉光 billboard + 艺术化发光球 + 常显标签
 *   （距离压缩登记 A3 / 月食 B3）；
 * - PlanetOrbitLayer（含 ArtPlanetBody / AsteroidBelt）：行星轨道远景层
 *   （compressAuToUnits 压缩域，A17；小行星带示意点云，A18）；
 * - MoonPathRing：月球绕地真轨道环（星历轨道面，日食 M8 补丁 P4）；
 * - MoonOrbitRing：倾角叙事夸张轨道环（A5；倾角经 incRad 入参——日食朔态/
 *   月食望态共用几何，契约 C7 朔望参数化在 utils 层）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { textureUrl } from '@/data/textures';
import { useBitmapTexture } from '@/hooks/useBitmapTexture';
import { PLANETS, SUN } from '@/data/planets';
import type { PlanetData } from '@/types';
import type { MessageKey } from '@/i18n';
import type { YaleBrightStar } from '@/utils/bakedData';
import { heliocentricPosition, sampleOrbitPoints } from '@/utils/physics';
import { equatorialUnitVector } from '@/utils/meteorShower';
import { bvToTeffK, srgbToLinear01 } from '@/utils/pleiadesCatalog';
import { blackbodyRGB } from '@/utils/starPhysics';
import { fovPointScaleFactor } from '@/utils/labGestures';
import { J2000_UNIX_SEC } from '@/utils/solarEclipseLab';
import type { EphemerisSeries } from '@/utils/solarEclipse';
import {
  GALACTIC_CENTER_DEC_DEG,
  GALACTIC_CENTER_RA_DEG,
  GALACTIC_POLE_DEC_DEG,
  GALACTIC_POLE_RA_DEG,
  J2000_SCENE_MATRIX3,
  SPACE_MILKY_WAY_RADIUS_UNITS,
  SPACE_STAR_DOME_RADIUS_UNITS,
  SPACE_SUN_DISK_DISTANCE_UNITS,
  SPACE_SUN_DISK_RADIUS_UNITS,
  SPACE_UNITS_PER_KM,
  artBodyRadiusUnits,
  asteroidBeltLocalPoints,
  compressAuToUnits,
  equatorialSceneDir,
  j2000ToSceneVec,
  moonOrbitRingBasis,
  narrativeAngles,
  narrativeOrbitBasis,
  planetLayerSceneMatrix3,
  type MutableVec3,
  type NarrativeAngles,
} from '@/utils/solarEclipseSpace';
import { LabelText } from '@/components/Scene/LocalizedLabelText';

/** 度 → 弧度 */
const DEG = Math.PI / 180;

/** 纹理加载优先级（低；LabEarth 同值口径） */
export const SPACE_TEXTURE_PRIORITY = 20;

// ---------------------------------------------------------------------------
// 最小结构化入参接口（M4-0 泛化：两条目 refs 均结构化满足，日食侧传参等价）
// ---------------------------------------------------------------------------

/** 时间轴秒 ref（tSecRef 结构子集） */
export interface SharedTimeRef {
  current: number;
}

/** 太空帧状态源（spaceRef 结构子集——只消费太阳方向与月距两字段） */
export interface SharedSpaceFrameRef {
  current: { sunDirScene: MutableVec3; moonDistKm: number };
}

/** 事件 geo 星历源（eventRef 结构子集） */
export interface SharedGeoEventRef {
  current: { event: { geo: EphemerisSeries } };
}

/** 时间窗起点源（eventRef 结构子集；倾角叙事相位 t0） */
export interface SharedWindowRef {
  current: { window: { startSec: number } };
}

// ---------------------------------------------------------------------------
// 太阳（方向光 + 远景日盘；A3 距离压缩登记见 solarEclipseSpace 文件头）
// ---------------------------------------------------------------------------

/** M7-2 辉光展幅（quad 相对日盘半径的放大倍数；核心盘几何尺寸不变） */
const SUN_DISK_GLOW_EXTENT = 3;

const SUN_DISK_FRAGMENT_SHADER = /* glsl */ `
  uniform float uGlowGain;
  uniform float uGlowFall;
  varying vec2 vUv;
  void main() {
    // r 以日盘半径为单位（quad 半宽 = ${SUN_DISK_GLOW_EXTENT} × 半径——M7-2
    // 辉光展幅上调增强远机位可辨性；核心盘几何不变）
    float r = length(vUv - 0.5) * 2.0 * ${SUN_DISK_GLOW_EXTENT.toFixed(1)};
    // 核心 HDR 白盘（Bloom 拾取）+ 径向暖色辉光（M8 补丁 P3：艺术化档增益
    // 降档/衰减收紧，防太阳球过曝白团——增益经 uniform 按档写入）
    float core = 1.0 - smoothstep(0.42, 0.5, r);
    float glow = exp(-r * uGlowFall) * 0.8 * uGlowGain;
    vec3 col = vec3(1.0, 0.95, 0.85) * (core * 6.0) + vec3(1.0, 0.75, 0.4) * glow;
    float alpha = max(core, glow);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** 艺术化太阳球半径（visualBodyRadius 同源 ×150 ≈ 381 单位，A18） */
const SUN_ART_RADIUS_UNITS = artBodyRadiusUnits(SUN.radiusKm);

/** 艺术化档辉光 quad 相对真实档的缩放（核心盘半径对齐太阳球半径） */
const SUN_ART_DISK_SCALE = SUN_ART_RADIUS_UNITS / SPACE_SUN_DISK_RADIUS_UNITS;

/** 艺术化太阳球顶点（uv + 世界法向/位置） */
const SUN_ART_SPHERE_VERTEX_SHADER = /* glsl */ `
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

/** 艺术化太阳球 fragment（M8-2 + 补丁 P3：2k 太阳纹理质感 × 临边渐变，
 * HDR 峰值 ~1.5 轻拾取 Bloom 不爆白；纹理未就绪暖色渐变兜底；主场景 Sun
 * 观感轻量再现——不复用其重 shader，源文件零改动） */
const SUN_ART_SPHERE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float mu = clamp(dot(n, v), 0.0, 1.0);
    vec3 tex = mix(vec3(1.0, 0.80, 0.52), texture2D(uMap, vUv).rgb, uHasMap);
    vec3 col = tex * mix(0.85, 1.5, pow(mu, 0.6));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 艺术化档辉光增益/衰减（P3：降档收紧防过曝；真实档维持 M7 观感） */
const SUN_GLOW_GAIN_REAL = 1;
const SUN_GLOW_GAIN_ART = 0.35;
const SUN_GLOW_FALL_REAL = 1.4;
const SUN_GLOW_FALL_ART = 2.2;

/** 太阳层（方向光 + 辉光 billboard + 艺术化发光球 + 常显标签；1–2 draw call） */
export function SpaceSun({
  frameRef,
  art,
}: {
  frameRef: SharedSpaceFrameRef;
  art: boolean;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const diskRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const sunMap = useBitmapTexture(textureUrl('sun', 'surface'), SPACE_TEXTURE_PRIORITY, true);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uGlowGain: { value: SUN_GLOW_GAIN_REAL },
          uGlowFall: { value: SUN_GLOW_FALL_REAL },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: SUN_DISK_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );
  const sphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: null },
          uHasMap: { value: 0 },
        },
        vertexShader: SUN_ART_SPHERE_VERTEX_SHADER,
        fragmentShader: SUN_ART_SPHERE_FRAGMENT_SHADER,
      }),
    []
  );
  useEffect(() => {
    sphereMaterial.uniforms.uMap.value = sunMap;
    sphereMaterial.uniforms.uHasMap.value = sunMap ? 1 : 0;
  }, [sphereMaterial, sunMap]);
  useEffect(() => {
    material.uniforms.uGlowGain.value = art ? SUN_GLOW_GAIN_ART : SUN_GLOW_GAIN_REAL;
    material.uniforms.uGlowFall.value = art ? SUN_GLOW_FALL_ART : SUN_GLOW_FALL_REAL;
  }, [material, art]);
  useEffect(() => {
    return () => {
      material.dispose();
      sphereMaterial.dispose();
    };
  }, [material, sphereMaterial]);

  useFrame(() => {
    const space = frameRef.current;
    const group = groupRef.current;
    if (group) {
      group.position.set(
        space.sunDirScene[0] * SPACE_SUN_DISK_DISTANCE_UNITS,
        space.sunDirScene[1] * SPACE_SUN_DISK_DISTANCE_UNITS,
        space.sunDirScene[2] * SPACE_SUN_DISK_DISTANCE_UNITS
      );
    }
    const disk = diskRef.current;
    if (disk) disk.lookAt(0, 0, 0);
    const light = lightRef.current;
    if (light) {
      light.position.set(
        space.sunDirScene[0] * 2000,
        space.sunDirScene[1] * 2000,
        space.sunDirScene[2] * 2000
      );
    }
  });

  return (
    <>
      {/* 方向光（月面/标准材质照明；地球为自定义 shader 不消费） */}
      <directionalLight ref={lightRef} intensity={2.6} color="#fff4e0" />
      <ambientLight intensity={0.06} />
      <group ref={groupRef}>
        {/* 辉光 billboard（真实档即日盘本体；艺术化档缩放为太阳球外围光晕） */}
        <mesh
          ref={diskRef}
          material={material}
          frustumCulled={false}
          scale={art ? SUN_ART_DISK_SCALE : 1}
        >
          <planeGeometry
            args={[
              SPACE_SUN_DISK_RADIUS_UNITS * 2 * SUN_DISK_GLOW_EXTENT,
              SPACE_SUN_DISK_RADIUS_UNITS * 2 * SUN_DISK_GLOW_EXTENT,
            ]}
          />
        </mesh>
        {art && (
          <>
            {/* M8-2 艺术化太阳球 + 日心点光源（艺术化行星球标准材质照明） */}
            <mesh material={sphereMaterial} frustumCulled={false}>
              <sphereGeometry args={[SUN_ART_RADIUS_UNITS, 48, 24]} />
            </mesh>
            <pointLight intensity={2.4} decay={0} distance={0} color="#fff4e0" />
          </>
        )}
        {/* M7-2 常显名称标签（任意机位可循标签找到太阳；locale 经叶组件） */}
        <Html
          position={[
            0,
            art ? -SUN_ART_RADIUS_UNITS * 1.25 : -SPACE_SUN_DISK_RADIUS_UNITS * 2.2,
            0,
          ]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-amber-100/90 backdrop-blur">
            <LabelText k="lab.eclipseSunLabel" />
          </span>
        </Html>
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// 倾角叙事轨道环（A5 登记 + 契约 C7 朔望参数化——几何见 utils）
// ---------------------------------------------------------------------------

/** 倾角叙事夸张轨道环（显示倾角经 incRad 入参；HUD 标真实值与倍率） */
export function MoonOrbitRing({
  tSecRef,
  windowRef,
  incRad,
  orbitRadiusKm,
}: {
  tSecRef: SharedTimeRef;
  windowRef: SharedWindowRef;
  incRad: number;
  orbitRadiusKm: number;
}): JSX.Element {
  const ring = useMemo(() => {
    const segments = 128;
    const positions = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i += 1) {
      const phi = (i / segments) * Math.PI * 2;
      positions[i * 3] = Math.cos(phi);
      positions[i * 3 + 1] = Math.sin(phi);
      positions[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#f0b45a',
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.matrixAutoUpdate = false;
    return line;
  }, []);
  useEffect(() => {
    return () => {
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    };
  }, [ring]);

  const scratch = useMemo(
    () => ({
      angles: { phaseRad: 0, nodeRad: 0 } as NarrativeAngles,
      e1: [0, 0, 0] as MutableVec3,
      e2: [0, 0, 0] as MutableVec3,
      s1: [0, 0, 0] as MutableVec3,
      s2: [0, 0, 0] as MutableVec3,
    }),
    []
  );

  useFrame(() => {
    const { angles, e1, e2, s1, s2 } = scratch;
    narrativeAngles(tSecRef.current, windowRef.current.window.startSec, angles);
    narrativeOrbitBasis(angles.nodeRad, incRad, e1, e2);
    j2000ToSceneVec(e1, s1);
    j2000ToSceneVec(e2, s2);
    const r = orbitRadiusKm * SPACE_UNITS_PER_KM;
    // 法向 = s1 × s2（列 Z；LineLoop z=0，仅保持矩阵正交）
    const nx = s1[1] * s2[2] - s1[2] * s2[1];
    const ny = s1[2] * s2[0] - s1[0] * s2[2];
    const nz = s1[0] * s2[1] - s1[1] * s2[0];
    ring.matrix.set(
      s1[0] * r, s2[0] * r, nx, 0,
      s1[1] * r, s2[1] * r, ny, 0,
      s1[2] * r, s2[2] * r, nz, 0,
      0, 0, 0, 1
    );
  });

  return <primitive object={ring} />;
}

// ---------------------------------------------------------------------------
// 月球绕地轨道环（星历轨道面真实取向；日食 M8 补丁 P4）
// ---------------------------------------------------------------------------

/** 月轨环基向量刷新粒度（时间轴秒；轨道面小时尺度近静止） */
const MOON_RING_REFRESH_SEC = 60;

/** 月球绕地真轨道环（星历轨道面；半径随当前月距逐帧缩放） */
export function MoonPathRing({
  tSecRef,
  frameRef,
  geoRef,
}: {
  tSecRef: SharedTimeRef;
  frameRef: SharedSpaceFrameRef;
  geoRef: SharedGeoEventRef;
}): JSX.Element {
  const ring = useMemo(() => {
    const segments = 128;
    const positions = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i += 1) {
      const phi = (i / segments) * Math.PI * 2;
      positions[i * 3] = Math.cos(phi);
      positions[i * 3 + 1] = Math.sin(phi);
      positions[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#9db4d8',
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.matrixAutoUpdate = false;
    return line;
  }, []);
  useEffect(() => {
    return () => {
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    };
  }, [ring]);

  const scratch = useMemo(
    () => ({
      cachedTSec: Number.NEGATIVE_INFINITY,
      e1: [1, 0, 0] as MutableVec3,
      e2: [0, 1, 0] as MutableVec3,
    }),
    []
  );

  useFrame(() => {
    const tSec = tSecRef.current;
    // 基向量按 60s 时间轴粒度缓存（环过当前月球位置由 e1 = 月球方向保证）
    if (Math.abs(tSec - scratch.cachedTSec) > MOON_RING_REFRESH_SEC) {
      scratch.cachedTSec = tSec;
      moonOrbitRingBasis(geoRef.current.event.geo, tSec, scratch.e1, scratch.e2);
    }
    // 半径随当前月距（含假想改写）逐帧缩放（矩阵写，零 buffer 更新）
    const r = frameRef.current.moonDistKm * SPACE_UNITS_PER_KM;
    const { e1, e2 } = scratch;
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    ring.matrix.set(
      e1[0] * r, e2[0] * r, nx, 0,
      e1[1] * r, e2[1] * r, ny, 0,
      e1[2] * r, e2[2] * r, nz, 0,
      0, 0, 0, 1
    );
  });

  return <primitive object={ring} />;
}

// ---------------------------------------------------------------------------
// M7-1 背景星空：J2000 固定朝向星穹 + 程序化银河带（A15 登记）
// ---------------------------------------------------------------------------

/** 星穹基准点尺寸/透视系数（地面版 EclipseStarDome 同值口径） */
const SPACE_STAR_SIZE = 30;

/** 星穹亮度增益（固定深空档——不接天光/曝光链，A15） */
const SPACE_STAR_GAIN = 0.9;

const SPACE_STAR_VERTEX_SHADER = /* glsl */ `
  attribute float aMag;
  uniform mat3 uEqToScene;
  uniform float uSize;
  uniform float uScale;
  uniform float uDomeRadius;
  uniform float uPointMax;
  uniform float uGain;
  varying vec3 vColor;
  void main() {
    // J2000 固定朝向（uEqToScene 常量矩阵——太空档无周日旋转，M7-1）
    vec3 dir = uEqToScene * position;
    vec4 mvPosition = modelViewMatrix * vec4(dir * uDomeRadius, 1.0);
    float size = uSize * pow(1.32, -aMag);
    gl_PointSize = clamp(size * (uScale / -mvPosition.z), 1.0, uPointMax);
    float brightness = clamp(pow(10.0, -0.2 * aMag), 0.03, 1.6);
    vColor = color * brightness * uGain;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SPACE_STAR_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = 1.0 - smoothstep(0.2, 0.5, d);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;

/**
 * 太空档真实星穹（1 draw call；Yale 亮星 attribute 链照抄地面版）：
 * attribute 初始化一次，每帧只写 FOV 像素尺度 uniform——J2000 朝向矩阵/
 * 极限星等均为常量（全星表入渲染，白昼剔除不适用于太空档）。
 */
export function SpaceStarDome({
  stars,
  starPointMaxPx,
}: {
  stars: readonly YaleBrightStar[];
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
    const eqToScene = new THREE.Matrix3();
    eqToScene.set(...(J2000_SCENE_MATRIX3 as [number, number, number, number, number, number, number, number, number]));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uEqToScene: { value: eqToScene },
        uSize: { value: SPACE_STAR_SIZE },
        uScale: { value: 400 },
        uDomeRadius: { value: SPACE_STAR_DOME_RADIUS_UNITS },
        uPointMax: { value: starPointMaxPx },
        uGain: { value: SPACE_STAR_GAIN },
      },
      vertexShader: SPACE_STAR_VERTEX_SHADER,
      fragmentShader: SPACE_STAR_FRAGMENT_SHADER,
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
    material.uniforms.uScale.value =
      state.gl.domElement.height *
      0.5 *
      fovPointScaleFactor((state.camera as THREE.PerspectiveCamera).fov);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

const MILKY_WAY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 程序化银河带（A15 登记：银道面方位按真实北银极/银心 J2000 常量取向，
 * 带宽/亮度分布/尘埃暗带/斑驳纹理均为艺术再现）：高斯银纬带 × 银心核球
 * 增亮 × 中央尘埃暗带压暗 × 双频正弦斑驳；additive 无深度写。
 */
const MILKY_WAY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uPole;
  uniform vec3 uCenter;
  uniform float uIntensity;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float sinB = dot(dir, uPole);
    // 银纬高斯带（σ ≈ 12°）
    float band = exp(-sinB * sinB * 22.0);
    // 中央尘埃暗带（形态艺术化）
    band *= 1.0 - 0.45 * exp(-sinB * sinB * 260.0);
    // 银心核球增亮（方位真实：人马座方向）
    float toward = clamp(dot(dir, uCenter) * 0.5 + 0.5, 0.0, 1.0);
    float bulge = 0.55 + 0.85 * toward * toward;
    // 双频正弦斑驳（艺术纹理，非真实云气分布）
    float m1 = sin(dot(dir, vec3(7.1, 3.7, 5.3)) * 6.0);
    float m2 = sin(dot(dir, vec3(2.9, 8.3, 4.1)) * 13.0);
    float mottle = 0.82 + 0.12 * m1 + 0.06 * m2;
    vec3 col = vec3(0.58, 0.64, 0.78) * band * bulge * mottle * uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 银河带弥散亮度（additive 叠加系数；观感克制不喧宾夺主） */
const MILKY_WAY_INTENSITY = 0.16;

/** 银河带壳（1 draw call；uniform 全常量，零帧更新） */
export function MilkyWayBand(): JSX.Element {
  const material = useMemo(() => {
    const pole: MutableVec3 = [0, 0, 0];
    const center: MutableVec3 = [0, 0, 0];
    equatorialSceneDir(GALACTIC_POLE_RA_DEG, GALACTIC_POLE_DEC_DEG, pole);
    equatorialSceneDir(GALACTIC_CENTER_RA_DEG, GALACTIC_CENTER_DEC_DEG, center);
    return new THREE.ShaderMaterial({
      uniforms: {
        uPole: { value: new THREE.Vector3(...pole) },
        uCenter: { value: new THREE.Vector3(...center) },
        uIntensity: { value: MILKY_WAY_INTENSITY },
      },
      vertexShader: MILKY_WAY_VERTEX_SHADER,
      fragmentShader: MILKY_WAY_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
  }, []);
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return (
    <mesh material={material} frustumCulled={false}>
      <sphereGeometry args={[SPACE_MILKY_WAY_RADIUS_UNITS, 48, 48]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// M7-4 艺术化行星 + 轨道线远景层（A17 登记；契约 C7 通用入参）
// ---------------------------------------------------------------------------

/** 行星位置/对齐矩阵缓存粒度（时间轴秒；A14 同口径——数小时窗内位移微小） */
const PLANET_LAYER_CACHE_SEC = 300;

/** 轨道线每行星分段数（静态椭圆，挂载期构建一次） */
const PLANET_ORBIT_SEGMENTS = 192;

/** 行星点固定像素尺寸（远景标注点，非真实比例——A17） */
const PLANET_POINT_PX = 9;

/** 行星名标签键（水金火木既有键复用；土天海 M7 新增） */
const PLANET_LABEL_KEYS: Record<string, MessageKey> = {
  mercury: 'lab.eclipsePlanetMercury',
  venus: 'lab.eclipsePlanetVenus',
  mars: 'lab.eclipsePlanetMars',
  jupiter: 'lab.eclipsePlanetJupiter',
  saturn: 'lab.eclipsePlanetSaturn',
  uranus: 'lab.eclipsePlanetUranus',
  neptune: 'lab.eclipsePlanetNeptune',
};

/** 标注行星（地球本体为纹理球不入点层） */
const LAYER_PLANETS = PLANETS.filter((p) => p.id !== 'earth');

const PLANET_POINT_VERTEX_SHADER = /* glsl */ `
  uniform float uPx;
  varying vec3 vColor;
  void main() {
    vColor = color;
    gl_PointSize = uPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PLANET_POINT_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = 1.0 - smoothstep(0.28, 0.5, d);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;

/** 轨道线透明度（按档；艺术化档上调至 L2 观感，§M8-4） */
const ORBIT_LINE_OPACITY_REAL = 0.38;
const ORBIT_LINE_OPACITY_ART = 0.55;

/** 行星近相机淡出域（P2：×行星半径——巨型外行星与相机机位空间重叠时的
 * 黑色遮挡盘修复；< NEAR 全透明、> FAR 全显，线性渐隐） */
const PLANET_FADE_NEAR_RADII = 2;
const PLANET_FADE_FAR_RADII = 6;

/** 行星夜面补光强度（P2：微弱自发光防背光面纯黑洞——登记艺术化补光，非物理照明） */
const PLANET_NIGHT_FILL_INTENSITY = 0.08;

/** 土星环基础透明度 */
const PLANET_RING_OPACITY = 0.7;

/**
 * 艺术化行星球（M8-2；A18 登记：半径 visualBodyRadius 同源对数放大非真实
 * 比例）：主场景纹理低优先级懒加载、未就绪配色球兜底；土星环按主场景 ring
 * 参数轻量绘制（环几何在层局部黄道面，随轴倾角整体倾斜）。挂载于行星标签
 * group 内——位置随缓存 tick 与标签同源更新，零额外位置管理。
 * M8 补丁 P2：① 近相机线性淡出（球体与环同步，逐帧写 opacity）；
 * ② 夜面微弱自发光补光（背光面呈暗色轮廓而非纯黑遮挡盘）。
 */
function ArtPlanetBody({ planet }: { planet: PlanetData }): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const surface = useBitmapTexture(
    textureUrl(planet.id, 'surface'),
    SPACE_TEXTURE_PRIORITY,
    true
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: planet.color,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        emissive: new THREE.Color(planet.color),
        emissiveIntensity: PLANET_NIGHT_FILL_INTENSITY,
      }),
    [planet]
  );
  useEffect(() => {
    material.map = surface;
    material.color.set(surface ? '#ffffff' : planet.color);
    material.needsUpdate = true;
  }, [material, surface, planet]);
  const ringMaterial = useMemo(
    () =>
      planet.ring
        ? new THREE.MeshBasicMaterial({
            color: planet.ring.color,
            transparent: true,
            opacity: PLANET_RING_OPACITY,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        : null,
    [planet]
  );
  useEffect(() => {
    return () => {
      material.dispose();
      ringMaterial?.dispose();
    };
  }, [material, ringMaterial]);

  const radius = artBodyRadiusUnits(planet.radiusKm);
  const scratch = useMemo(() => ({ world: new THREE.Vector3() }), []);

  // P2 近相机淡出（每帧只写 opacity/visible，零 buffer 更新）
  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    group.getWorldPosition(scratch.world);
    const dist = scratch.world.distanceTo(state.camera.position);
    const fade = Math.min(
      1,
      Math.max(0, (dist / radius - PLANET_FADE_NEAR_RADII) / (PLANET_FADE_FAR_RADII - PLANET_FADE_NEAR_RADII))
    );
    material.opacity = fade;
    if (ringMaterial) ringMaterial.opacity = PLANET_RING_OPACITY * fade;
    group.visible = fade > 0.01;
  });

  // 轴倾角整体倾斜（层局部黄道系 z 为北黄极；环面天然在 x-y 黄道面）
  const tiltRad = planet.rotation.axialTiltDeg * DEG;
  return (
    <group ref={groupRef} rotation={[tiltRad, 0, 0]}>
      <mesh material={material} frustumCulled={false}>
        <sphereGeometry args={[radius, 48, 24]} />
      </mesh>
      {planet.ring && ringMaterial && (
        <mesh material={ringMaterial} frustumCulled={false}>
          <ringGeometry
            args={[
              radius * (planet.ring.innerRadiusKm / planet.radiusKm),
              radius * (planet.ring.outerRadiusKm / planet.radiusKm),
              64,
            ]}
          />
        </mesh>
      )}
    </group>
  );
}

const BELT_POINT_VERTEX_SHADER = /* glsl */ `
  uniform float uPx;
  void main() {
    gl_PointSize = uPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BELT_POINT_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.2, 0.5, d)) * 0.55;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/**
 * 小行星带弥散点云（M8-5；A18 登记：分布示意非真实星表）：确定性种子
 * 挂载期构建一次，1 draw call；层局部黄道坐标随行星层 group 姿态。
 */
export function AsteroidBelt(): JSX.Element {
  const { geometry, material, points } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(asteroidBeltLocalPoints(), 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPx: { value: 2 },
        uColor: { value: new THREE.Color('#cfc4a2') },
      },
      vertexShader: BELT_POINT_VERTEX_SHADER,
      fragmentShader: BELT_POINT_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const obj = new THREE.Points(geo, mat);
    obj.frustumCulled = false;
    return { geometry: geo, material: mat, points: obj };
  }, []);
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);
  return <primitive object={points} />;
}

/** 黄道 AU 位置 → 层局部坐标（compressAuToUnits 径向压缩，方向保持） */
function compressEclPoint(
  x: number,
  y: number,
  z: number,
  out: MutableVec3
): MutableVec3 {
  const r = Math.hypot(x, y, z);
  if (!(r > 0)) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const s = compressAuToUnits(r) / r;
  out[0] = x * s;
  out[1] = y * s;
  out[2] = z * s;
  return out;
}

/**
 * 行星轨道远景层（2 draw call + ≤7 Html 标签）：
 * - 轨道线：八行星静态椭圆逐点压缩后合批单 LineSegments（挂载期一次）；
 * - 行星点：合批单 Points，位置按 PLANET_LAYER_CACHE_SEC 粒度缓存重算
 *   （低频 attribute 写，§M7-4 登记取舍；开普勒解仅缓存失效时执行）；
 * - 层姿态：planetLayerSceneMatrix3 对齐矩阵 + 日心锚位（太阳日盘同源
 *   sunDirScene；地球轨道层位置与场景原点重合，残差 <1 单位单测锁定）。
 */
export function PlanetOrbitLayer({
  tSecRef,
  frameRef,
  art,
  belt,
}: {
  tSecRef: SharedTimeRef;
  frameRef: SharedSpaceFrameRef;
  /** M8 艺术化档（行星点 → 艺术化球体、轨道线透明度上调） */
  art: boolean;
  /** M8-5 小行星带（艺术化档专属；reduced 档由父级关闭） */
  belt: boolean;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const labelRefs = useRef<(THREE.Group | null)[]>([]);

  const { orbitGeometry, pointsGeometry } = useMemo(() => {
    // 轨道线合批（含地球轨道；每行星 segments 段 → 段对顶点）
    const segCount = PLANETS.length * PLANET_ORBIT_SEGMENTS;
    const linePositions = new Float32Array(segCount * 2 * 3);
    const lineColors = new Float32Array(segCount * 2 * 3);
    const v: MutableVec3 = [0, 0, 0];
    let cursor = 0;
    for (const planet of PLANETS) {
      const pts = sampleOrbitPoints(planet.orbit, PLANET_ORBIT_SEGMENTS);
      const color = new THREE.Color(planet.color);
      for (let i = 0; i < PLANET_ORBIT_SEGMENTS; i += 1) {
        for (const p of [pts[i], pts[i + 1]]) {
          compressEclPoint(p.x, p.y, p.z, v);
          linePositions[cursor] = v[0];
          linePositions[cursor + 1] = v[1];
          linePositions[cursor + 2] = v[2];
          lineColors[cursor] = color.r;
          lineColors[cursor + 1] = color.g;
          lineColors[cursor + 2] = color.b;
          cursor += 3;
        }
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    // 行星点合批（地球除外；位置由缓存 tick 写入）
    const n = LAYER_PLANETS.length;
    const pointPositions = new Float32Array(n * 3);
    const pointColors = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const color = new THREE.Color(LAYER_PLANETS[i].color);
      pointColors[i * 3] = color.r;
      pointColors[i * 3 + 1] = color.g;
      pointColors[i * 3 + 2] = color.b;
    }
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
    pointGeo.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));
    return { orbitGeometry: lineGeo, pointsGeometry: pointGeo };
  }, []);

  const { lineMaterial, pointMaterial, lines, points } = useMemo(() => {
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: ORBIT_LINE_OPACITY_REAL,
      depthWrite: false,
    });
    const pointMat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: PLANET_POINT_PX } },
      vertexShader: PLANET_POINT_VERTEX_SHADER,
      fragmentShader: PLANET_POINT_FRAGMENT_SHADER,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lineObj = new THREE.LineSegments(orbitGeometry, lineMat);
    lineObj.frustumCulled = false;
    const pointObj = new THREE.Points(pointsGeometry, pointMat);
    pointObj.frustumCulled = false;
    return { lineMaterial: lineMat, pointMaterial: pointMat, lines: lineObj, points: pointObj };
  }, [orbitGeometry, pointsGeometry]);

  useEffect(() => {
    return () => {
      orbitGeometry.dispose();
      pointsGeometry.dispose();
      lineMaterial.dispose();
      pointMaterial.dispose();
    };
  }, [orbitGeometry, pointsGeometry, lineMaterial, pointMaterial]);

  // M8 档位观感：轨道线透明度上调 + 行星合批点仅真实档可见（艺术化档由
  // ArtPlanetBody 球体接管；档切换为交互事件路径，非渲染循环）
  useEffect(() => {
    lineMaterial.opacity = art ? ORBIT_LINE_OPACITY_ART : ORBIT_LINE_OPACITY_REAL;
    points.visible = !art;
  }, [lineMaterial, points, art]);

  const scratch = useMemo(
    () => ({
      cachedTSec: Number.NEGATIVE_INFINITY,
      m9: new Float64Array(9),
      m4: new THREE.Matrix4(),
      v: [0, 0, 0] as MutableVec3,
    }),
    []
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const tSec = tSecRef.current;
    if (Math.abs(tSec - scratch.cachedTSec) <= PLANET_LAYER_CACHE_SEC) return;
    scratch.cachedTSec = tSec;
    const space = frameRef.current;
    const d = (tSec - J2000_UNIX_SEC) / 86400;
    // 地球日心位置 → 对齐矩阵 + 日心锚（开普勒解仅缓存失效时执行，低频分配登记）
    const earthOrbit = PLANETS.find((p) => p.id === 'earth');
    if (!earthOrbit) return;
    const pe = heliocentricPosition(earthOrbit.orbit, d);
    const rE = Math.hypot(pe.x, pe.y, pe.z);
    if (!(rE > 0)) return;
    planetLayerSceneMatrix3([pe.x, pe.y, pe.z], space.sunDirScene, scratch.m9);
    const m = scratch.m9;
    scratch.m4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    group.setRotationFromMatrix(scratch.m4);
    const anchor = compressAuToUnits(rE);
    group.position.set(
      space.sunDirScene[0] * anchor,
      space.sunDirScene[1] * anchor,
      space.sunDirScene[2] * anchor
    );
    // 行星点 + 标签位（层局部黄道坐标；attribute 整批一次性写，低频登记）
    const attr = pointsGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < LAYER_PLANETS.length; i += 1) {
      const p = heliocentricPosition(LAYER_PLANETS[i].orbit, d);
      compressEclPoint(p.x, p.y, p.z, scratch.v);
      attr.setXYZ(i, scratch.v[0], scratch.v[1], scratch.v[2]);
      const label = labelRefs.current[i];
      if (label) label.position.set(scratch.v[0], scratch.v[1], scratch.v[2]);
    }
    attr.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <primitive object={lines} />
      <primitive object={points} />
      {art && belt && <AsteroidBelt />}
      {LAYER_PLANETS.map((planet, i) => (
        <group
          key={planet.id}
          ref={(node) => {
            labelRefs.current[i] = node;
          }}
        >
          {art && <ArtPlanetBody planet={planet} />}
          <Html center style={{ pointerEvents: 'none' }}>
            <span className="whitespace-nowrap rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-sky-100/80 backdrop-blur">
              <LabelText k={PLANET_LABEL_KEYS[planet.id]} />
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}
