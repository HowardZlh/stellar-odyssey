'use client';

/**
 * 日全食实验室太空视角场景叶组件（E-M4 + M7 观感增强，需求 §M4-1/M4-2/
 * M4-4 / §M7 / §2.2 / §4.4）
 *
 * 组成（合计 ≤12 draw call ≤ §4.1「太空视角同量级 ≤15」预算：地球表面/
 * 大气/中心线 3 + 月球 1 + 日盘 1 + 双影锥 2 + 星穹 1 + 银河带 1 +
 * 轨道线合批 1 + 行星点合批 1 + 倾角轨道环 1）：
 * - 地球：LabEarth 范式纹理球（昼/夜 2K + terminator 单 shader 混合 + 大气
 *   辉光薄壳），差异登记：①云层并入表面 shader 按亮度混合（太空档比例下
 *   +8 km 独立壳层 < 远距深度分辨率会 z-fighting，LabEarth M3.8-4③ 同类
 *   问题的结构性消解）；②本影/半影地表影斑在表面 shader 内**解析投影**
 *   （真锥参数作 uniform，逐像素锥内判定——契约 C1 真锥同式，禁止贴花网格；
 *   边缘 smoothstep 软化沿 earthShadow.ts 登记口径 0.92/1.12）；③姿态由
 *   earthGroupSceneMatrix3（岁差+GMST）每帧写矩阵，贴图地理与影斑物理
 *   配准 <5 km（solarEclipseSpace 单测锚点）。
 * - 月球：2K 月面贴图 + LOLA 4K 法线（data/textures.ts 清单），方向光照亮；
 *   姿态近似潮汐锁定（局部 +X 指向地心；无天平动，登记近似）。
 * - 太阳：方向光 + 远景日盘 billboard——**A3 登记**：真实日地距离 1.496 亿
 *   km（149,600 场景单位）超出场景域，日盘置于 1,500 单位处、半径按真实
 *   视半径 0.267° 折算（方向真实、距离压缩），科普卡 lab.eclipseSpaceCard
 *   注明；影锥渲染为可见半透明实体亦属表达辅助（真实影锥不可见，同卡注明）。
 * - 影锥：本影/半影两层单位锥几何 + 每帧矩阵变换（位置/四元数/缩放——
 *   渲染循环零 buffer 更新），additive 远端渐隐；本影实、半影淡；
 *   **A4 登记**：本影放大开关径向 ×UMBRA_MAGNIFY_FACTOR（默认关 = 真实
 *   比例，HUD 注明倍率），地表影斑 shader 同倍率同源。
 * - 食带中心线：path 数据 → 地球网格局部折线（随地球自转天然贴地地理），
 *   已扫过段变色（uSwept01 uniform + aT attribute，零 buffer 更新）。
 * - 倾角叙事轨道环（§M4-4，**A5 登记**：5.145° 白道倾角夸张
 *   ×INCLINATION_DISPLAY_FACTOR 显示，HUD 标真实值与倍率；轨道/交点回归
 *   为叙事节奏非真实周期）：单位圆 LineLoop + 每帧基向量矩阵（契约 C7：
 *   朔望参数化留月食条目扩展点，几何取点函数收 syzygyOffsetRad 参）。
 *
 * M7 观感增强（版本 1.1）：
 * - 背景星空：J2000 固定朝向星穹（Yale 8,404 亮星消费链照抄地面版，
 *   uEqToScene 常量矩阵替换地平旋转——太空档无周日旋转；极限星等固定
 *   深空档不接天光/曝光链，**A15 登记**）+ 程序化银河带（银道面方位按
 *   真实北银极/银心 J2000 常量取向，带宽/亮度/尘埃暗带形态为艺术再现，
 *   A15；reduced 档随 labQualityParams 关闭）。
 * - 月球放大 ×MOON_MAGNIFY_FACTOR **默认开**（**A16 登记**：真实比例月球
 *   ~0.5° 视径近似亮点；开启时本影/半影锥基部经 coneRadialScale 同倍随动
 *   保持「锥从月缘收敛」视觉连贯，锥角失真登记；地表影斑 shader 不随动
 *   ——物理真值仍由真锥/A4 开关独立控制；面板徽标常显倍率）。
 * - 行星轨道远景层 **默认开**（**A17 登记**：方向与轨道相位按 J2000 平
 *   轨道要素真实（physics.heliocentricPosition，A14 同口径），日心距离经
 *   compressAuToUnits 压缩绘制——1 AU = 1,500 单位线性 + 外行星对数收域，
 *   太阳日盘即日心锚（A3 同源）；轨道线八行星合批单 LineSegments、行星点
 *   合批单 Points；行星位置/对齐矩阵按 300s 时间轴粒度缓存重算（低频
 *   attribute 写登记为 §M7-4 允许取舍，渲染循环其余零 buffer 更新）；
 *   契约 C7：组件只消费 sunDirScene + tSec 通用入参，未写死日食假设）。
 * - 太阳存在感：日盘辉光展幅上调 + 常显名称标签（M7-2）。
 *
 * 状态流：全部量由 refs.spaceRef（EclipseTimeDriver 每帧经 spaceFrameState
 * 重建，tSec 单值可重建红线）读取；本组件 useFrame 只写 uniform/矩阵。
 * locale 纪律：标签经叶组件 LabelText（内部订阅），本组件不订阅 locale。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { textureUrl, normalMapUrl } from '@/data/textures';
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
import { EARTH_MEAN_RADIUS_KM, MOON_MEAN_RADIUS_KM } from '@/utils/solarEclipse';
import {
  ANTUMBRA_DARKEN_DEPTH,
  GALACTIC_CENTER_DEC_DEG,
  GALACTIC_CENTER_RA_DEG,
  GALACTIC_POLE_DEC_DEG,
  GALACTIC_POLE_RA_DEG,
  INCLINATION_DISPLAY_FACTOR,
  J2000_SCENE_MATRIX3,
  MOON_MAGNIFY_FACTOR,
  MOON_ORBIT_INCLINATION_DEG,
  NARRATIVE_ORBIT_RADIUS_KM,
  PATH_LINE_ALTITUDE_KM,
  PENUMBRA_DARKEN_DEPTH,
  SHADOW_EDGE_SOFT_INNER,
  SHADOW_EDGE_SOFT_OUTER,
  SPACE_EARTH_RADIUS_UNITS,
  SPACE_MILKY_WAY_RADIUS_UNITS,
  SPACE_STAR_DOME_RADIUS_UNITS,
  SPACE_SUN_DISK_DISTANCE_UNITS,
  SPACE_SUN_DISK_RADIUS_UNITS,
  SPACE_UNITS_PER_KM,
  UMBRA_DARKEN_DEPTH,
  UMBRA_MAGNIFY_FACTOR,
  SPACE_ART_EARTH_SCALE,
  SPACE_ART_MOON_SCALE,
  artBodyRadiusUnits,
  artShadowCap,
  asteroidBeltLocalPoints,
  buildPathLocalUnits,
  compressAuToUnits,
  coneRadialScaleForMode,
  emptyArtShadowCapState,
  equatorialSceneDir,
  j2000KmToGeodetic,
  j2000ToSceneVec,
  narrativeAngles,
  narrativeOrbitBasis,
  pathSweepProgress01,
  planetLayerSceneMatrix3,
  type ArtShadowCapState,
  type EclipseBodyScaleMode,
  type EclipseSpaceFrameState,
  type GeodeticLatLon,
  type MutableVec3,
  type NarrativeAngles,
} from '@/utils/solarEclipseSpace';
import { LabelText } from '@/components/Scene/LocalizedLabelText';

/** 度 → 弧度 */
const DEG = Math.PI / 180;

/** 纹理加载优先级（低；LabEarth 同值口径） */
const SPACE_TEXTURE_PRIORITY = 20;

/** 云层相对地表 uv 漂移速率（圈/秒；地固系 0.12× 恒星日角速率，LabEarth 同源换算） */
const CLOUD_DRIFT_REV_PER_SEC = 0.12 / 86164;

/** 大气辉光壳顶高（km；LabEarth ATMOSPHERE_TOP 同量级） */
const SPACE_ATMOSPHERE_TOP_KM = 120;

/**
 * 本组件消费的帧循环 refs 子集（SolarEclipseLab 的 EclipseFrameRefs 结构
 * 超集兼容——结构化类型，避免组件间循环 import）。
 */
export interface EclipseSpaceRefs {
  tSecRef: { current: number };
  eventRef: {
    current: {
      event: { contacts: { max: number }; path: number[][] };
      window: { startSec: number };
    };
  };
  settingsRef: {
    current: {
      umbraMagnify: boolean;
      inclinationDemo: boolean;
      moonMagnify: boolean;
      planetOrbits: boolean;
      bodyScaleMode: EclipseBodyScaleMode;
    };
  };
  spaceRef: { current: EclipseSpaceFrameState };
}

// ---------------------------------------------------------------------------
// 地球（表面 + 大气 + 中心线折线；姿态矩阵每帧写入）
// ---------------------------------------------------------------------------

const SPACE_EARTH_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vPosW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 表面 fragment（LabEarth 表面 shader 复制扩展，来源登记同其文件头）：
 * 昼/夜 terminator 混合 + 云层亮度混合（结构差异登记见本文件头）+
 * 本影/半影解析锥投影（uniform 同源 spaceFrameState；软化因子/压暗深度
 * 模板注入自 solarEclipseSpace——CPU 侧为事实源，照抄勿变形）。
 */
const SPACE_EARTH_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform sampler2D uCloudMap;
  uniform float uHasDayMap;
  uniform float uHasNightMap;
  uniform float uHasCloudMap;
  uniform vec3 uSunDir;
  uniform float uCloudShiftU;
  uniform vec3 uShadowAxis;
  uniform vec3 uUmbraApex;
  uniform float uUmbraTan;
  uniform vec3 uPenApex;
  uniform float uPenTan;
  uniform float uUmbraMag;
  uniform float uArtMode;
  uniform vec3 uUmbraCapDir;
  uniform float uUmbraCapAng;
  uniform float uUmbraCapDepth;
  uniform vec3 uPenCapDir;
  uniform float uPenCapAng;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 geoN = normalize(vNormalW);
    float ndl = dot(geoN, uSunDir);
    float day = smoothstep(-0.08, 0.08, ndl);
    vec3 dayColor = mix(vec3(0.045, 0.08, 0.16), texture2D(uDayMap, vUv).rgb, uHasDayMap);
    // 云层并入表面（亮度即云量；uv 随时间漂移——tSec 派生，seek 一致）
    vec2 cloudUv = vec2(fract(vUv.x + uCloudShiftU), vUv.y);
    vec3 cloudTex = texture2D(uCloudMap, cloudUv).rgb;
    float cloud = dot(cloudTex, vec3(0.299, 0.587, 0.114)) * uHasCloudMap;
    dayColor = mix(dayColor, vec3(0.94, 0.95, 0.97), cloud * 0.85);
    float shadow = 1.0;
    if (uArtMode > 0.5) {
      // ---- M8 艺术化档：影斑角距投影帽（半径无关映射——放大球面上位置与
      //      相对大小仍真实；椭圆取圆形近似，A18 登记；CPU 事实源 artShadowCap，
      //      此处只消费 uniform；边缘软化因子沿真实档同口径）
      if (uUmbraCapAng > 0.0) {
        float angU = acos(clamp(dot(geoN, uUmbraCapDir), -1.0, 1.0));
        float capU = 1.0 - smoothstep(
          uUmbraCapAng * ${SHADOW_EDGE_SOFT_INNER.toFixed(2)},
          uUmbraCapAng * ${SHADOW_EDGE_SOFT_OUTER.toFixed(2)},
          angU
        );
        shadow *= 1.0 - capU * uUmbraCapDepth;
      }
      if (uPenCapAng > 0.0) {
        float angP = acos(clamp(dot(geoN, uPenCapDir), -1.0, 1.0));
        float capP = 1.0 - smoothstep(uUmbraCapAng, uPenCapAng, angP);
        shadow *= 1.0 - capP * ${PENUMBRA_DARKEN_DEPTH.toFixed(2)};
      }
    } else {
      // ---- 真实档：本影/半影解析锥投影（契约 C1 真锥参数逐像素判定；
      //      边缘软化 0.92/1.12 沿 earthShadow.ts 登记口径）
      vec3 relU = vPosW - uUmbraApex;
      float tu = dot(relU, uShadowAxis);
      float ru = length(relU - tu * uShadowAxis);
      float coneRu = abs(tu) * uUmbraTan * uUmbraMag;
      float inUmbra = 1.0 - smoothstep(
        coneRu * ${SHADOW_EDGE_SOFT_INNER.toFixed(2)},
        coneRu * ${SHADOW_EDGE_SOFT_OUTER.toFixed(2)},
        ru
      );
      // t<0 本影体（月球侧，全食）；t>0 伪本影延长区（环食，压暗更浅）
      float depth = tu < 0.0
        ? ${UMBRA_DARKEN_DEPTH.toFixed(2)}
        : ${ANTUMBRA_DARKEN_DEPTH.toFixed(2)};
      shadow *= 1.0 - inUmbra * depth;
      vec3 relP = vPosW - uPenApex;
      float tp = dot(relP, uShadowAxis);
      if (tp > 0.0) {
        float rp = length(relP - tp * uShadowAxis);
        float frac = rp / (tp * uPenTan);
        float inPen = 1.0 - smoothstep(0.55, 1.0, frac);
        shadow *= 1.0 - inPen * ${PENUMBRA_DARKEN_DEPTH.toFixed(2)};
      }
    }
    float light = 0.06 + 0.94 * day * shadow;
    vec3 color = dayColor * light;
    float night = smoothstep(0.08, -0.18, ndl);
    color += texture2D(uNightMap, vUv).rgb * night * 1.5 * uHasNightMap;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** 大气辉光薄壳（LabEarth 大气 shader 同式；uSunDir 换空间帧太阳方向） */
const SPACE_ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
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

const SPACE_ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** 中心线折线 shader（aT 顶点参数 + uSwept01 已扫过段变色；零 buffer 更新） */
const PATH_LINE_VERTEX_SHADER = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PATH_LINE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uSwept01;
  varying float vT;
  void main() {
    // 已扫过段：暖橙；未扫段：青蓝（半透明贴地折线）
    vec3 swept = vec3(1.0, 0.62, 0.2);
    vec3 ahead = vec3(0.35, 0.75, 1.0);
    vec3 col = mix(ahead, swept, step(vT, uSwept01));
    gl_FragColor = vec4(col, 0.9);
  }
`;

/** 地球 + 中心线（姿态矩阵/影锥 uniform 每帧写入） */
function SpaceEarth({ refs }: { refs: EclipseSpaceRefs }): JSX.Element {
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
          uShadowAxis: { value: new THREE.Vector3(1, 0, 0) },
          uUmbraApex: { value: new THREE.Vector3(0, 0, 0) },
          uUmbraTan: { value: 0.0046 },
          uPenApex: { value: new THREE.Vector3(0, 0, 0) },
          uPenTan: { value: 0.0046 },
          uUmbraMag: { value: 1 },
          uArtMode: { value: 0 },
          uUmbraCapDir: { value: new THREE.Vector3(0, 0, 0) },
          uUmbraCapAng: { value: 0 },
          uUmbraCapDepth: { value: UMBRA_DARKEN_DEPTH },
          uPenCapDir: { value: new THREE.Vector3(1, 0, 0) },
          uPenCapAng: { value: 0 },
        },
        vertexShader: SPACE_EARTH_VERTEX_SHADER,
        fragmentShader: SPACE_EARTH_FRAGMENT_SHADER,
      }),
    []
  );

  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) } },
        vertexShader: SPACE_ATMOSPHERE_VERTEX_SHADER,
        fragmentShader: SPACE_ATMOSPHERE_FRAGMENT_SHADER,
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

  // 姿态矩阵/艺术化影斑帽草稿（挂载期分配一次；每帧只写矩阵/uniform）
  const scratch = useMemo(
    () => ({ m4: new THREE.Matrix4(), cap: emptyArtShadowCapState() }),
    []
  );

  useFrame(() => {
    const group = groupRef.current;
    const space = refs.spaceRef.current;
    if (!group) return;
    const s = refs.settingsRef.current;
    const art = s.bodyScaleMode === 'art';
    const m = space.earthMatrix3;
    scratch.m4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    group.setRotationFromMatrix(scratch.m4);
    // M8 艺术化档：地球 group 统一缩放（大气壳/中心线子节点随缩放，A18）
    group.scale.setScalar(art ? SPACE_ART_EARTH_SCALE : 1);
    const su = surfaceMaterial.uniforms;
    (su.uSunDir.value as THREE.Vector3).set(...space.sunDirScene);
    su.uCloudShiftU.value = (refs.tSecRef.current * CLOUD_DRIFT_REV_PER_SEC) % 1;
    (su.uShadowAxis.value as THREE.Vector3).set(...space.shadowAxisScene);
    (su.uUmbraApex.value as THREE.Vector3).set(...space.umbraApexScene);
    su.uUmbraTan.value = space.umbraTan;
    (su.uPenApex.value as THREE.Vector3).set(...space.penApexScene);
    su.uPenTan.value = space.penTan;
    su.uUmbraMag.value = s.umbraMagnify ? UMBRA_MAGNIFY_FACTOR : 1;
    // M8 艺术化档影斑帽（角距投影；真实档分支零改动）
    su.uArtMode.value = art ? 1 : 0;
    if (art) {
      artShadowCap(space, scratch.cap);
      (su.uUmbraCapDir.value as THREE.Vector3).set(...scratch.cap.umbraDir);
      su.uUmbraCapAng.value = scratch.cap.umbraAngRad;
      su.uUmbraCapDepth.value = scratch.cap.umbraDepth01;
      (su.uPenCapDir.value as THREE.Vector3).set(...scratch.cap.penDir);
      su.uPenCapAng.value = scratch.cap.penAngRad;
    }
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
      <EclipsePathLine refs={refs} />
    </group>
  );
}

/** 食带中心线折线（地球 group 子节点——随姿态矩阵自然贴地地理） */
function EclipsePathLine({ refs }: { refs: EclipseSpaceRefs }): JSX.Element {
  const path = refs.eventRef.current.event.path;

  const { geometry, localUnits } = useMemo(() => {
    const units = buildPathLocalUnits(path);
    const n = path.length;
    const radius = (EARTH_MEAN_RADIUS_KM + PATH_LINE_ALTITUDE_KM) * SPACE_UNITS_PER_KM;
    const positions = new Float32Array(n * 3);
    const ts = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      positions[i * 3] = units[i * 3] * radius;
      positions[i * 3 + 1] = units[i * 3 + 1] * radius;
      positions[i * 3 + 2] = units[i * 3 + 2] * radius;
      ts[i] = n > 1 ? i / (n - 1) : 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
    return { geometry: geo, localUnits: units };
  }, [path]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSwept01: { value: 0 } },
        vertexShader: PATH_LINE_VERTEX_SHADER,
        fragmentShader: PATH_LINE_FRAGMENT_SHADER,
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

  const scratch = useMemo<{ ll: GeodeticLatLon }>(() => ({ ll: { latDeg: 0, lonDeg: 0 } }), []);

  useFrame(() => {
    const space = refs.spaceRef.current;
    if (!space.footExists) return; // 无足印时保持上次进度（窗端语义）
    j2000KmToGeodetic(space.footCenterKmJ2000, refs.tSecRef.current, scratch.ll);
    material.uniforms.uSwept01.value = pathSweepProgress01(
      localUnits,
      scratch.ll.latDeg,
      scratch.ll.lonDeg
    );
  });

  // primitive line（THREE.Line 非 mesh；frustumCulled 关闭防整线误剔）
  const line = useMemo(() => {
    const l = new THREE.Line(geometry, material);
    l.frustumCulled = false;
    return l;
  }, [geometry, material]);

  return <primitive object={line} />;
}

// ---------------------------------------------------------------------------
// 月球（贴图球 + 方向光照；姿态近似潮汐锁定）
// ---------------------------------------------------------------------------

function SpaceMoon({ refs }: { refs: EclipseSpaceRefs }): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const surface = useBitmapTexture(textureUrl('moon', 'surface'), SPACE_TEXTURE_PRIORITY, true);
  const normal = useBitmapTexture(normalMapUrl('moon'), SPACE_TEXTURE_PRIORITY, true);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#b8b4a9',
        roughness: 0.95,
        metalness: 0,
      }),
    []
  );
  useEffect(() => {
    material.map = surface;
    material.color.set(surface ? '#ffffff' : '#b8b4a9');
    material.needsUpdate = true;
  }, [material, surface]);
  useEffect(() => {
    material.normalMap = normal;
    material.needsUpdate = true;
  }, [material, normal]);
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  const scratch = useMemo(
    () => ({ toEarth: new THREE.Vector3(), xAxis: new THREE.Vector3(1, 0, 0) }),
    []
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const space = refs.spaceRef.current;
    mesh.position.set(...space.moonPosScene);
    // M7-3/M8 月球缩放：艺术化档对数放大（A18）；真实档 ×4 开关（A16）
    const s = refs.settingsRef.current;
    mesh.scale.setScalar(
      s.bodyScaleMode === 'art'
        ? SPACE_ART_MOON_SCALE
        : s.moonMagnify
          ? MOON_MAGNIFY_FACTOR
          : 1
    );
    // 潮汐锁定近似：贴图经度 0°（局部 +X）指向地心（无天平动，登记近似）
    scratch.toEarth.set(-space.moonPosScene[0], -space.moonPosScene[1], -space.moonPosScene[2]);
    if (scratch.toEarth.lengthSq() > 1e-9) {
      scratch.toEarth.normalize();
      mesh.quaternion.setFromUnitVectors(scratch.xAxis, scratch.toEarth);
    }
  });

  return (
    <mesh ref={meshRef} material={material}>
      <sphereGeometry args={[MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM, 64, 64]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 太阳（方向光 + 远景日盘；A3 距离压缩登记见文件头）
// ---------------------------------------------------------------------------

/** M7-2 辉光展幅（quad 相对日盘半径的放大倍数；核心盘几何尺寸不变） */
const SUN_DISK_GLOW_EXTENT = 3;

const SUN_DISK_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    // r 以日盘半径为单位（quad 半宽 = ${SUN_DISK_GLOW_EXTENT} × 半径——M7-2
    // 辉光展幅上调增强远机位可辨性；核心盘几何不变）
    float r = length(vUv - 0.5) * 2.0 * ${SUN_DISK_GLOW_EXTENT.toFixed(1)};
    // 核心 HDR 白盘（Bloom 拾取）+ 径向暖色辉光
    float core = 1.0 - smoothstep(0.42, 0.5, r);
    float glow = exp(-r * 1.4) * 0.8;
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

/** 艺术化太阳球 fragment（临边渐变 + HDR 核供 Bloom 拾取；主场景 Sun 观感
 * 轻量再现——不复用其重 shader，源文件零改动，M8-2） */
const SUN_ART_SPHERE_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float mu = clamp(dot(n, v), 0.0, 1.0);
    vec3 core = vec3(1.0, 0.93, 0.78) * 2.6;
    vec3 edge = vec3(1.0, 0.62, 0.28) * 1.15;
    vec3 col = mix(edge, core, pow(mu, 0.6));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function SpaceSun({ refs, art }: { refs: EclipseSpaceRefs; art: boolean }): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const diskRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {},
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
        vertexShader: SPACE_ATMOSPHERE_VERTEX_SHADER,
        fragmentShader: SUN_ART_SPHERE_FRAGMENT_SHADER,
      }),
    []
  );
  useEffect(() => {
    return () => {
      material.dispose();
      sphereMaterial.dispose();
    };
  }, [material, sphereMaterial]);

  useFrame(() => {
    const space = refs.spaceRef.current;
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
// 影锥（真锥双层：单位几何 + 每帧矩阵变换；渲染循环零 buffer 更新）
// ---------------------------------------------------------------------------

const CONE_VERTEX_SHADER = /* glsl */ `
  varying float vFade;
  void main() {
    // 单位锥：锥尖 y=0 → 底 y=−1；vFade 0（尖）→ 1（底）
    vFade = -position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CONE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vFade;
  void main() {
    // additive 远端（底侧）渐隐（§4.4）
    float alpha = uAlpha * (1.0 - vFade * 0.85);
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/** 单位锥几何（锥尖原点、底 y=−1、底半径 1；两锥共享，挂载期一次） */
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

function ShadowCone({
  refs,
  kind,
  geometry,
}: {
  refs: EclipseSpaceRefs;
  kind: 'umbra' | 'penumbra';
  geometry: THREE.ConeGeometry;
}): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          // 本影实、半影淡（§4.4；冷灰蓝可视化色——影锥可见性属 A3 登记）
          uColor: { value: new THREE.Color(kind === 'umbra' ? '#5a6a9a' : '#3a4a72') },
          uAlpha: { value: kind === 'umbra' ? 0.34 : 0.1 },
        },
        vertexShader: CONE_VERTEX_SHADER,
        fragmentShader: CONE_FRAGMENT_SHADER,
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
    const s = refs.settingsRef.current;
    // 档位径向倍率（coneRadialScaleForMode 单一事实源）：真实档 = A4 本影
    // 放大 × A16 月球放大锥基随动（全关 = 1 真实比例）；艺术化档 = 锥基随
    // 艺术化月球同倍收敛（忽略两开关，A18 差异登记）。地表影斑不消费本值。
    const mag = coneRadialScaleForMode(kind, s.bodyScaleMode, s.umbraMagnify, s.moonMagnify);
    const tip = kind === 'umbra' ? space.umbraTipScene : space.penTipScene;
    const dir = kind === 'umbra' ? space.umbraDirScene : space.penDirScene;
    const len = kind === 'umbra' ? space.umbraLenUnits : space.penLenUnits;
    const baseR = kind === 'umbra' ? space.umbraBaseRadiusUnits : space.penBaseRadiusUnits;
    mesh.position.set(tip[0], tip[1], tip[2]);
    scratch.dir.set(dir[0], dir[1], dir[2]);
    mesh.quaternion.setFromUnitVectors(scratch.down, scratch.dir);
    // 径向放大（锥轴几何不变，倍率经面板徽标注明）
    mesh.scale.set(baseR * mag, len, baseR * mag);
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />;
}

/** 影锥双层（共享单位几何） */
function ShadowCones({ refs }: { refs: EclipseSpaceRefs }): JSX.Element {
  const geometry = useUnitConeGeometry();
  return (
    <>
      <ShadowCone refs={refs} kind="umbra" geometry={geometry} />
      <ShadowCone refs={refs} kind="penumbra" geometry={geometry} />
    </>
  );
}

// ---------------------------------------------------------------------------
// 倾角叙事轨道环（§M4-4；A5 登记 + 契约 C7 朔望参数化——几何见 utils）
// ---------------------------------------------------------------------------

/** 叙事轨道环显示倾角（弧度；真实 5.145° × 显示倍率 4，HUD 标注） */
const NARRATIVE_INC_RAD = MOON_ORBIT_INCLINATION_DEG * INCLINATION_DISPLAY_FACTOR * DEG;

function MoonOrbitRing({ refs }: { refs: EclipseSpaceRefs }): JSX.Element {
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
    narrativeAngles(refs.tSecRef.current, refs.eventRef.current.window.startSec, angles);
    narrativeOrbitBasis(angles.nodeRad, NARRATIVE_INC_RAD, e1, e2);
    j2000ToSceneVec(e1, s1);
    j2000ToSceneVec(e2, s2);
    const r = NARRATIVE_ORBIT_RADIUS_KM * SPACE_UNITS_PER_KM;
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
// M7-1 背景星空：J2000 固定朝向星穹 + 程序化银河带（A15 登记见文件头）
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
function SpaceStarDome({
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
function MilkyWayBand(): JSX.Element {
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
// M7-4 艺术化行星 + 轨道线远景层（A17 登记见文件头；契约 C7 通用入参）
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

/**
 * 艺术化行星球（M8-2；A18 登记：半径 visualBodyRadius 同源对数放大非真实
 * 比例）：主场景纹理低优先级懒加载、未就绪配色球兜底；土星环按主场景 ring
 * 参数轻量绘制（环几何在层局部黄道面，随轴倾角整体倾斜）。挂载于行星标签
 * group 内——位置随缓存 tick 与标签同源更新，零额外位置管理。
 */
function ArtPlanetBody({ planet }: { planet: PlanetData }): JSX.Element {
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
            opacity: 0.7,
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
  // 轴倾角整体倾斜（层局部黄道系 z 为北黄极；环面天然在 x-y 黄道面）
  const tiltRad = planet.rotation.axialTiltDeg * DEG;
  return (
    <group rotation={[tiltRad, 0, 0]}>
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
function AsteroidBelt(): JSX.Element {
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
function PlanetOrbitLayer({
  refs,
  art,
  belt,
}: {
  refs: EclipseSpaceRefs;
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
    const tSec = refs.tSecRef.current;
    if (Math.abs(tSec - scratch.cachedTSec) <= PLANET_LAYER_CACHE_SEC) return;
    scratch.cachedTSec = tSec;
    const space = refs.spaceRef.current;
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

// ---------------------------------------------------------------------------
// 组合导出
// ---------------------------------------------------------------------------

export interface EclipseSpaceViewProps {
  refs: EclipseSpaceRefs;
  /** 倾角叙事模式（React 状态挂载门控；几何由 refs 驱动） */
  inclinationDemo: boolean;
  /** M7-4 行星轨道远景层（默认开；倾角叙事时父级传 false 防视觉混淆） */
  planetOrbits: boolean;
  /** M7-1 星穹数据（Yale 亮星；未就绪时 null 跳过挂载） */
  stars: readonly YaleBrightStar[] | null;
  /** 星点尺寸上限（labQualityParams 同链） */
  starPointMaxPx: number;
  /** M7-1 银河带（reduced 档随 labQualityParams 关闭，A15） */
  milkyWay: boolean;
  /** M8-1 天体比例档（真实 = M7 形态 / 艺术化 = L2 观感，默认艺术化，A18） */
  bodyScaleMode: EclipseBodyScaleMode;
  /** M8-5 小行星带（艺术化档专属；reduced 档由父级关闭） */
  asteroidBelt: boolean;
}

/** 太空视角场景组（§M4 + §M7 + §M8；挂载于 SolarEclipseLab 的 viewMode==='space' 分支） */
export function EclipseSpaceView({
  refs,
  inclinationDemo,
  planetOrbits,
  stars,
  starPointMaxPx,
  milkyWay,
  bodyScaleMode,
  asteroidBelt,
}: EclipseSpaceViewProps): JSX.Element {
  const art = bodyScaleMode === 'art';
  return (
    <>
      {stars && <SpaceStarDome stars={stars} starPointMaxPx={starPointMaxPx} />}
      {milkyWay && <MilkyWayBand />}
      <SpaceEarth refs={refs} />
      <SpaceMoon refs={refs} />
      <SpaceSun refs={refs} art={art} />
      <ShadowCones refs={refs} />
      {planetOrbits && <PlanetOrbitLayer refs={refs} art={art} belt={art && asteroidBelt} />}
      {inclinationDemo && <MoonOrbitRing refs={refs} />}
    </>
  );
}
