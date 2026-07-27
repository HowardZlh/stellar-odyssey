'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlanetData } from '@/types';
import { getMoonsByParent } from '@/data/moons';
import { detailTextureUrl, normalMapUrl, textureUrl } from '@/data/textures';
import { useSimulationStore } from '@/store';
import { useBitmapTexture } from '@/hooks/useBitmapTexture';
import {
  DAYS_PER_YEAR,
  DEG_TO_RAD,
  heliocentricPosition,
  normalizeAngle,
  orbitalPeriodYears,
  rotationAngleAtTime,
} from '@/utils/physics';
import {
  advanceClampedPhase,
  equivalentDaysForPhase,
  planetFrozen,
  planetVisibilityWeight,
  reportPlanetRateClamp,
} from '@/utils/freezeGate';
import { rateClampFactor, timeCompressionForContinuousLevel } from '@/utils/time';
import {
  clearRenderedSatellitePhase,
  setRenderedSatellitePhase,
} from '@/utils/satellitePhase';
import { bodyDisplayRadius, eclipticToScene } from '@/utils/scale';
import {
  dwarfDisplayRadius,
  haumeaEllipsoidScale,
  isDwarfPlanetClassification,
} from '@/utils/dwarfPlanets';
import { ringDisplayRadii } from '@/utils/satellites';
import { FLOW_VISUAL_GAIN, flowShaderPhase } from '@/utils/jupiterFlow';
import { detailGateUpdateScoped, detailStrength01 } from '@/utils/planetDetail';
import { focusBodyIdForDetail, planetDetailScopeAllowed } from '@/utils/bodyCycle';
import { getMoonById } from '@/data/moons';
import { ClampedHtmlLabel } from '@/components/Scene/ClampedHtmlLabel';
import { auroraEnhancement01 } from '@/utils/solarActivity';
import {
  RING_SHADOW_STRENGTH,
  TERMINATOR_SOFTNESS,
  axialTiltNormal,
} from '@/utils/planetShading';
import { Moon } from '@/components/CelestialBody/Moon';
import { getTextureManager } from '@/components/CelestialBody/textureManager';
import {
  createBodyTextureCanvas,
  createCloudTextureCanvas,
  createNightLightsCanvas,
  createRingTextureCanvas,
} from '@/components/CelestialBody/proceduralTextures';

interface PlanetProps {
  data: PlanetData;
}

/** 纹理 LOD：远距离低分辨率 / 行星视角高分辨率（需求 3.1.1，切换无突变） */
const TEXTURE_LOW_RES = 256;
const TEXTURE_HIGH_RES = 1024;
/** 进入该连续层级以下时升级高分辨率纹理 */
const HIGH_RES_LEVEL_THRESHOLD = 1.6;
/**
 * 真实位图纹理懒加载阈值（P3-2）：接近行星视角时开始预取
 * （进入 L1 前位图基本就绪；L2 远观使用程序化低清即可）
 */
const BITMAP_LEVEL_THRESHOLD = 2.2;

/** 气态/冰巨行星（明暗界线云带色温渐变较明显，需求 4.6） */
const GAS_GIANTS = new Set(['jupiter', 'saturn', 'uranus', 'neptune']);

/**
 * 行星表面光照 shader（P3-4，需求 4.6 行星光影——物理真实）
 *
 * 光照模型近似（登记）：太阳按方向光处理（自场景原点指向表面点的反方向），
 * 忽略太阳角直径的真实半影，terminator 用 smoothstep 软化近似。
 * 几何解析纯逻辑镜像与单元测试见 utils/planetShading.ts。
 *
 * - 昼夜明暗界线：N·L 经 smoothstep 柔和过渡，自转/公转时随日照方向正确移动
 * - 土星环投影：表面点朝太阳的射线与环平面（赤道面共面圆盘）解析求交，
 *   命中环带时按环纹理 alpha 遮光（卡西尼缝透光）
 * - 气态行星云带在明暗界线处的色温渐变（uWarmth）
 * - 含对数深度缓冲 chunk（与 Canvas logarithmicDepthBuffer 一致，需求 5.1）
 */
const SURFACE_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vTangentW;
  varying vec3 vBitangentW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    // 球面 UV 切线基（P4 法线贴图）：dPos/du ∝ (n.z, 0, -n.x)（对象空间，
    // 极点退化时长度 ~0，钳制后扰动自然消失；utils/planetDetail.sphereTangent 镜像）
    vec3 tObj = vec3(normal.z, 0.0, -normal.x);
    vec3 tSafe = tObj / max(length(tObj), 1e-5);
    vTangentW = normalize(mat3(modelMatrix) * tSafe);
    vBitangentW = normalize(cross(vNormalW, vTangentW));
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const SURFACE_FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap;
  uniform float uAmbient;
  uniform float uTerminatorSoftness;
  uniform float uWarmth;
  uniform float uHasRing;
  uniform sampler2D uRingMap;
  uniform float uRingInner;
  uniform float uRingOuter;
  uniform float uRingShadowStrength;
  uniform vec3 uPlanetCenterW;
  uniform vec3 uRingNormalW;
  // P4 近观细节（需求 4.7）：法线贴图 / 海洋高光 / 木星差速流动 / 2K 细节增强
  uniform sampler2D uNormalMap;
  uniform float uHasNormalMap;
  uniform float uDetailStrength;
  uniform float uSpecularStrength;
  uniform float uFlowEnabled;
  uniform float uFlowPhase;
  uniform float uDetailBoost;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vTangentW;
  varying vec3 vBitangentW;
  void main() {
    #include <logdepthbuf_fragment>
    // 光照方向统一：太阳位于场景原点（需求 4.6）
    vec3 sunDir = normalize(-vPosW);
    vec3 geoN = normalize(vNormalW);
    // 木星云层差速流动（P4）：按纬度对 U 附加漂移相位
    // （剖面与 utils/jupiterFlow.jovianDriftRate 镜像一致）
    vec2 uv = vUv;
    if (uFlowEnabled > 0.5) {
      float lat = (vUv.y - 0.5) * 3.14159265;
      float absLat = abs(lat);
      float drift = 0.008 * exp(-pow(lat / 0.21, 2.0))
        - 0.0035 * exp(-pow((absLat - 0.42) / 0.13, 2.0))
        + 0.00245 * exp(-pow((absLat - 0.73) / 0.15, 2.0));
      uv.x = fract(uv.x - drift * uFlowPhase / 6.2831853);
    }
    float geoNdl = dot(geoN, sunDir);
    // 昼夜明暗界线柔和过渡（terminator，几何法线主导——不被法线细节破坏）
    float day = smoothstep(-uTerminatorSoftness, uTerminatorSoftness, geoNdl);
    vec3 base = texture2D(uMap, uv).rgb;
    // 土星环投影：朝太阳的射线与环平面解析求交（utils/planetShading.ts 镜像）
    float shadow = 1.0;
    if (uHasRing > 0.5) {
      float denom = dot(uRingNormalW, sunDir);
      if (abs(denom) > 1e-6) {
        float t = dot(uRingNormalW, uPlanetCenterW - vPosW) / denom;
        if (t > 0.0) {
          vec3 hit = vPosW + sunDir * t;
          float r = length(hit - uPlanetCenterW);
          if (r >= uRingInner && r <= uRingOuter) {
            float radial01 = (r - uRingInner) / (uRingOuter - uRingInner);
            float ringAlpha = texture2D(uRingMap, vec2(radial01, 0.5)).a;
            shadow = 1.0 - ringAlpha * uRingShadowStrength;
          }
        }
      }
    }
    float light = uAmbient + (1.0 - uAmbient) * day * shadow;
    // P4 法线贴图立体细节：昼侧按扰动法线兰伯特比率调制亮度
    // （utils/planetDetail.reliefFactor 镜像；不改变 terminator 位置）
    float detail = uDetailStrength * uHasNormalMap;
    if (detail > 0.001) {
      vec3 mapN = texture2D(uNormalMap, uv).xyz * 2.0 - 1.0;
      vec3 pertN = normalize(vTangentW * mapN.x + vBitangentW * mapN.y + geoN * mapN.z);
      float pertNdl = dot(pertN, sunDir);
      if (geoNdl > 0.0) {
        float ratio = clamp(max(pertNdl, 0.0) / max(geoNdl, 0.05), 0.0, 1.5);
        light *= 1.0 + (ratio - 1.0) * detail;
      }
      // 地球海洋高光（P4：海面反光、陆地不反光；utils/planetDetail.waterMask 镜像）
      if (uSpecularStrength > 0.001) {
        float water = smoothstep(0.05, 0.25, base.b - max(base.r, base.g));
        vec3 viewDir = normalize(cameraPosition - vPosW);
        vec3 halfDir = normalize(viewDir + sunDir);
        float spec = pow(max(dot(pertN, halfDir), 0.0), 80.0);
        base += vec3(1.0, 0.98, 0.92) * spec * water * uSpecularStrength * detail * day * shadow;
      }
    }
    vec3 color = base * light;
    // 2K 源图近观程序化细节增强（天王星/海王星差异登记，
    // utils/planetDetail.bandDetailBoost 镜像）
    if (uDetailBoost > 0.001) {
      float band = sin(vUv.y * 900.0) * sin(vUv.y * 173.0);
      color *= 1.0 + band * 0.015 * uDetailBoost * uDetailStrength;
    }
    // 明暗界线暖色带（气态行星云带色温渐变，utils/planetShading.terminatorWarmBand 镜像）
    float warmBand = smoothstep(0.02, 0.3, day) * (1.0 - smoothstep(0.3, 0.75, day));
    color *= mix(vec3(1.0), vec3(1.1, 0.95, 0.8), warmBand * uWarmth);
    gl_FragColor = vec4(color, 1.0);
    // 与内置材质一致的色调映射与输出色彩空间转换（保持画面基准不变）
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 云层 shader（P3-4 配套）：与表面同一昼夜光照模型（terminator 统一），
 * 支持程序化 RGBA 云图（uUseAlphaMap=0）或真实灰度云图作 alpha（=1）。
 */
const CLOUD_FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap;
  uniform float uUseAlphaMap;
  uniform float uOpacity;
  uniform float uAmbient;
  uniform float uTerminatorSoftness;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 sunDir = normalize(-vPosW);
    float ndl = dot(normalize(vNormalW), sunDir);
    float day = smoothstep(-uTerminatorSoftness, uTerminatorSoftness, ndl);
    vec4 tex = texture2D(uMap, vUv);
    // 真实云图（灰度 JPG）：亮度即云量 → alpha；程序化 RGBA 云图沿用自带 alpha
    float cloudAlpha = mix(tex.a, dot(tex.rgb, vec3(0.299, 0.587, 0.114)), uUseAlphaMap);
    float light = uAmbient + (1.0 - uAmbient) * day;
    gl_FragColor = vec4(vec3(light), cloudAlpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 行星环 shader（P3-4）：行星在环面上的阴影——
 * 环上点朝太阳（原点）的射线被行星球体遮挡时进入阴影，
 * 轮廓边缘 smoothstep 软化（utils/planetShading.planetShadowOnRing 镜像）。
 */
const RING_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const RING_FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uPlanetCenterW;
  uniform float uPlanetRadius;
  varying vec2 vUv;
  varying vec3 vPosW;
  void main() {
    #include <logdepthbuf_fragment>
    vec4 tex = texture2D(uMap, vUv);
    float sunDist = length(vPosW);
    vec3 sunDir = -vPosW / max(sunDist, 1e-6);
    vec3 toC = uPlanetCenterW - vPosW;
    float tca = dot(toC, sunDir);
    float shadow = 1.0;
    if (tca > 0.0 && tca < sunDist) {
      float d = length(toC - sunDir * tca);
      shadow = 0.18 + 0.82 * smoothstep(uPlanetRadius * 0.92, uPlanetRadius * 1.08, d);
    }
    gl_FragColor = vec4(tex.rgb * shadow, tex.a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 行星：开普勒轨道公转 + 真实轴倾角自转 + 表面细节 + 卫星系统
 *
 * - 位置每帧由模拟时间求解开普勒方程得到（匀面速度，需求 3.1.1）
 * - 轴倾角按 NASA 数据设置；金星 177.36°、天王星 97.77° 的"翻转轴"
 *   本身就表现了逆向自转
 * - 表面：真实位图纹理（Solar System Scope CC BY 4.0，P3-1）异步懒加载，
 *   未就绪/加载失败时降级为程序化纹理（LOD 两级切换保留）
 * - 光影（P3-4）：昼夜明暗界线柔和过渡 + 土星环双向投影（shader 解析法）
 * - 地球：独立旋转云层（真实云图）+ 大气边缘辉光 + 真实夜灯贴图
 * - 卫星：赤道面参考平面的卫星挂在轴倾角组内，月球（黄道面例外）挂在外层
 * - 高时间压缩比（L3+）下冻结更新（返回时按共享时间轴重新求值，需求 3.3）
 */
export function Planet({ data }: PlanetProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);
  const nightRef = useRef<THREE.Mesh>(null);
  // S3 §4.3-3：地球极区极光增强层材质（CME 抵达时短暂增亮，克制可退化）
  const auroraMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const camera = useThree((s) => s.camera);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const selectBody = useSimulationStore((s) => s.selectBody);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控（布尔选择器，变化时才重渲染）
  // R2-3：冻结判定收敛至 utils/freezeGate（淡出完毕即冻结，L3 锚点前完成）
  const frozen = useSimulationStore((s) => planetFrozen(s.continuousLevel));
  // 真实比例模式（需求 4.1）：半径按真实线性比例映射（对数压缩的真实开关）
  const realScaleMode = useSimulationStore((s) => s.realScaleMode);
  // 位图纹理懒加载门控（P3-2）：接近行星视角才请求；聚焦/跟随的行星优先。
  // P4 补充：跟随/飞往外行星时相机距原点较远（层级读数 L2），
  // 但语义上是行星近观——跟随目标同样启用位图加载
  const nearPlanetView = useSimulationStore(
    (s) =>
      s.continuousLevel < BITMAP_LEVEL_THRESHOLD ||
      s.followBodyId === data.id ||
      s.flyToBodyId === data.id,
  );
  const isFocused = useSimulationStore(
    (s) => s.followBodyId === data.id || s.selectedBodyId === data.id,
  );
  const [highRes, setHighRes] = useState(false);
  // P4 近观细节门控（需求 4.7）：相机-天体距离进入近观阈值时激活
  // 4K/法线细节层（滞回状态机纯逻辑 utils/planetDetail.detailGateUpdate）
  const [detailActive, setDetailActive] = useState(false);
  // P7 标签避让：相机贴近行星（如卫星近观语境）时隐藏行星标签——
  // Html distanceFactor 在近距离下会将标签放大到遮挡画面
  const [labelHidden, setLabelHidden] = useState(false);
  const labelHiddenRef = useRef(false);
  const detailActiveRef = useRef(false);
  // R2-3 行星速率钳制（淡出区间兜底）：累计相位 / 上帧模拟时间 / 钳制状态
  const clampedPhaseRef = useRef<number | null>(null);
  const lastSimDaysRef = useRef<number | null>(null);
  const clampedRef = useRef(false);
  // R2-3 标签透明度随淡出权重（Html 不随父级 visible/scale 隐藏，直改 DOM 无重渲染）
  const labelElRef = useRef<HTMLSpanElement>(null);

  // 矮行星（P5 §3.2）：默认模式最小可见半径提升至可辨识水平（夸大登记于
  // utils/dwarfPlanets.ts）；真实比例模式与八大行星同规则线性映射
  const isDwarf = isDwarfPlanetClassification(data.classificationZh);
  const radius = isDwarf
    ? dwarfDisplayRadius(data.radiusKm, realScaleMode)
    : bodyDisplayRadius(data.radiusKm, realScaleMode);
  // 妊神星三轴椭球（P5 §3.4）：按真实轴比缩放球体网格（短轴 = 自转轴 Y），
  // 绕 Y 自转时长轴翻滚可见；真实比例/默认模式均生效
  const ellipsoidScale = data.id === 'haumea' ? haumeaEllipsoidScale(data.radiusKm) : null;
  const tiltRad = data.rotation.axialTiltDeg * DEG_TO_RAD;
  // R2-3 速率钳制参数：公转周期由开普勒第三定律从半长轴导出（与轨道演算一致）
  const periodDays = useMemo(
    () => orbitalPeriodYears(data.orbit.semiMajorAxisAu) * DAYS_PER_YEAR,
    [data.orbit.semiMajorAxisAu],
  );
  const moons = useMemo(() => getMoonsByParent(data.id), [data.id]);
  const equatorialMoons = moons.filter((m) => m.referencePlane === 'planetEquator');
  const eclipticMoons = moons.filter((m) => m.referencePlane === 'ecliptic');

  // 真实位图纹理（P3-1）：懒加载，失败/未就绪时为 null → 程序化降级
  const surfacePriority = isFocused ? 0 : 2;
  const detailPriority = isFocused ? 0 : 3;
  const surfaceBitmap = useBitmapTexture(
    textureUrl(data.id, 'surface'),
    surfacePriority,
    nearPlanetView,
  );
  const nightBitmap = useBitmapTexture(textureUrl(data.id, 'night'), detailPriority, nearPlanetView);
  const cloudsBitmap = useBitmapTexture(
    textureUrl(data.id, 'clouds'),
    detailPriority,
    nearPlanetView,
  );
  const ringBitmap = useBitmapTexture(textureUrl(data.id, 'ring'), surfacePriority, nearPlanetView);

  // P4 近观细节层（需求 4.7）：4K 底图 + 法线贴图，仅门控激活时请求
  // （优先级 0/1 最高；2K 底图先显示防空窗，textureManager LRU 管显存）
  const detailUrls = useMemo(
    () => ({
      surface: detailTextureUrl(data.id, 'surface'),
      night: detailTextureUrl(data.id, 'night'),
      clouds: detailTextureUrl(data.id, 'clouds'),
      normal: normalMapUrl(data.id),
    }),
    [data.id],
  );
  const detailSurfaceBitmap = useBitmapTexture(detailUrls.surface, 0, detailActive);
  const detailNightBitmap = useBitmapTexture(detailUrls.night, 1, detailActive);
  const detailCloudsBitmap = useBitmapTexture(detailUrls.clouds, 1, detailActive);
  const normalBitmap = useBitmapTexture(detailUrls.normal, 0, detailActive);
  // 卸载时释放本天体细节层（AGENTS.md 内存管理）
  useEffect(() => {
    const bodyId = data.id;
    return () => {
      getTextureManager().releaseDetail(bodyId);
    };
  }, [data.id]);

  // R2-3：卸载时清除渲染相位注册与钳制提示上报
  useEffect(() => {
    const bodyId = data.id;
    return () => {
      clearRenderedSatellitePhase(bodyId);
      if (clampedRef.current) {
        clampedRef.current = false;
        useSimulationStore
          .getState()
          .setPlanetRateClampNotice(reportPlanetRateClamp(bodyId, false));
      }
    };
  }, [data.id]);

  // 程序化表面纹理（降级路径，确定性生成；位图就绪后不再生成）
  const proceduralTexture = useMemo(() => {
    if (surfaceBitmap) return null;
    const canvas = createBodyTextureCanvas(
      data.id,
      data.color,
      highRes ? TEXTURE_HIGH_RES : TEXTURE_LOW_RES,
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [data.id, data.color, highRes, surfaceBitmap]);

  // 表面纹理分级：4K 细节层（近观激活且就绪）→ 2K 位图 → 程序化降级
  const surfaceTexture =
    (detailActive ? detailSurfaceBitmap : null) ?? surfaceBitmap ?? proceduralTexture;
  const normalTexture = detailActive ? normalBitmap : null;

  // 环平面法线（世界系）：轴倾角绕 Z 旋转后的 +Y（utils/planetShading.axialTiltNormal）
  const ringNormal = useMemo(() => {
    const n = axialTiltNormal(tiltRad);
    return new THREE.Vector3(n.x, n.y, n.z);
  }, [tiltRad]);

  const ringRadii = useMemo(() => {
    if (!data.ring) return null;
    return ringDisplayRadii(
      data.radiusKm,
      data.ring.innerRadiusKm,
      data.ring.outerRadiusKm,
      realScaleMode,
    );
  }, [data.ring, data.radiusKm, realScaleMode]);

  // 环纹理：真实环纹位图（含卡西尼缝 alpha）优先，降级为程序化环纹
  const ringTextureAssets = useMemo(() => {
    if (!data.ring) return null;
    if (ringBitmap) return { texture: ringBitmap, owned: false };
    const tex = new THREE.CanvasTexture(createRingTextureCanvas(data.ring));
    tex.colorSpace = THREE.SRGBColorSpace;
    return { texture: tex, owned: true };
  }, [data.ring, ringBitmap]);

  // 表面材质：自定义光照 shader（terminator + 环投影，P3-4；
  // P4 新增法线细节/海洋高光/木星流动/2K 细节增强 uniform）
  const surfaceMaterial = useMemo(() => {
    if (!surfaceTexture) return null;
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: surfaceTexture },
        uAmbient: { value: 0.32 },
        uTerminatorSoftness: { value: TERMINATOR_SOFTNESS },
        uWarmth: { value: GAS_GIANTS.has(data.id) ? 0.55 : 0.18 },
        uHasRing: { value: ringRadii && ringTextureAssets ? 1 : 0 },
        // 无环时用表面纹理占位（uHasRing=0 分支不采样，但保持 sampler 绑定有效）
        uRingMap: { value: ringTextureAssets?.texture ?? surfaceTexture },
        uRingInner: { value: ringRadii?.innerUnits ?? 1 },
        uRingOuter: { value: ringRadii?.outerUnits ?? 2 },
        uRingShadowStrength: { value: RING_SHADOW_STRENGTH },
        uPlanetCenterW: { value: new THREE.Vector3() },
        uRingNormalW: { value: ringNormal.clone() },
        // P4 近观细节（需求 4.7）：无法线数据时用表面纹理占位 sampler
        uNormalMap: { value: normalTexture ?? surfaceTexture },
        uHasNormalMap: { value: normalTexture ? 1 : 0 },
        uDetailStrength: { value: 0 },
        uSpecularStrength: { value: data.id === 'earth' ? 0.9 : 0 },
        uFlowEnabled: { value: 0 },
        uFlowPhase: { value: 0 },
        // 2K 源图程序化细节增强（天王星/海王星，§4.7 差异登记）
        uDetailBoost: { value: data.id === 'uranus' || data.id === 'neptune' ? 1 : 0 },
      },
      vertexShader: SURFACE_VERTEX_SHADER,
      fragmentShader: SURFACE_FRAGMENT_SHADER,
    });
  }, [surfaceTexture, normalTexture, data.id, ringRadii, ringTextureAssets, ringNormal]);

  // 云层纹理分级（P4）：4K 细节层 → 2K 位图 → 程序化
  const cloudsBestBitmap = (detailActive ? detailCloudsBitmap : null) ?? cloudsBitmap;
  const cloudAssets = useMemo(() => {
    if (!data.surface?.hasCloudLayer) return null;
    // 真实云图（灰度 JPG，亮度作 alpha）优先；降级为程序化 RGBA 云图
    let texture: THREE.Texture;
    let owned: boolean;
    let useAlphaMap: number;
    if (cloudsBestBitmap) {
      texture = cloudsBestBitmap;
      owned = false;
      useAlphaMap = 1;
    } else {
      const canvas = createCloudTextureCanvas(highRes ? 512 : 256);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      owned = true;
      useAlphaMap = 0;
    }
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: texture },
        uUseAlphaMap: { value: useAlphaMap },
        uOpacity: { value: 0.85 },
        uAmbient: { value: 0.32 },
        uTerminatorSoftness: { value: TERMINATOR_SOFTNESS },
      },
      vertexShader: SURFACE_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
    });
    return { material, texture, owned };
  }, [data.surface, highRes, cloudsBestBitmap]);

  // 夜半球城市灯光（可选需求 3.1.1）：仅背向太阳的半球显示暖黄灯光；
  // P3-1：真实城市灯光贴图（SSS night 贴图，亮度作 alpha）与真实大陆对齐
  // P4 夜灯纹理分级：4K 细节层 → 2K 位图 → 程序化
  const nightBestBitmap = (detailActive ? detailNightBitmap : null) ?? nightBitmap;
  const nightAssets = useMemo(() => {
    if (!data.surface?.hasNightLights) return null;
    let texture: THREE.Texture;
    let owned: boolean;
    let alphaFromLuminance: number;
    if (nightBestBitmap) {
      texture = nightBestBitmap;
      owned = false;
      alphaFromLuminance = 1;
    } else {
      texture = new THREE.CanvasTexture(createNightLightsCanvas(highRes ? 1024 : 512));
      texture.colorSpace = THREE.SRGBColorSpace;
      owned = true;
      alphaFromLuminance = 0;
    }
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMap: { value: texture },
        uAlphaFromLuminance: { value: alphaFromLuminance },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vUv = uv;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vPosW = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uMap;
        uniform float uAlphaFromLuminance;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          #include <logdepthbuf_fragment>
          // 太阳位于场景原点：日照方向 = 表面点指向原点（与表面 shader 统一）
          vec3 sunDir = normalize(-vPosW);
          float ndl = dot(normalize(vNormalW), sunDir);
          // 仅夜半球显示（晨昏线附近平滑过渡）
          float night = smoothstep(0.08, -0.18, ndl);
          vec4 tex = texture2D(uMap, vUv);
          // 真实夜灯贴图（RGB 无 alpha）：亮度作为 alpha；程序化贴图沿用自带 alpha
          float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
          float alpha = mix(tex.a, clamp(lum * 1.6, 0.0, 1.0), uAlphaFromLuminance);
          gl_FragColor = vec4(tex.rgb, alpha * night);
        }
      `,
    });
    return { material, texture, owned };
  }, [data.surface, highRes, nightBestBitmap]);

  // 环材质与几何（P3-4：行星在环面上的阴影 shader）
  const ringAssets = useMemo(() => {
    if (!data.ring || !ringRadii || !ringTextureAssets) return null;
    const { innerUnits, outerUnits } = ringRadii;
    const geometry = new THREE.RingGeometry(innerUnits, outerUnits, 128, 1);
    // UV 重映射为径向坐标（环纹理 x 方向 = 内缘 → 外缘）
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      uv.setXY(i, (v.length() - innerUnits) / (outerUnits - innerUnits), 0.5);
    }
    const material = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {
        uMap: { value: ringTextureAssets.texture },
        uOpacity: { value: data.ring.opacity },
        uPlanetCenterW: { value: new THREE.Vector3() },
        uPlanetRadius: { value: radius },
      },
      vertexShader: RING_VERTEX_SHADER,
      fragmentShader: RING_FRAGMENT_SHADER,
    });
    return { geometry, material };
  }, [data.ring, ringRadii, ringTextureAssets, radius]);

  useEffect(() => {
    return () => {
      proceduralTexture?.dispose();
    };
  }, [proceduralTexture]);

  useEffect(() => {
    return () => {
      surfaceMaterial?.dispose();
    };
  }, [surfaceMaterial]);

  useEffect(() => {
    return () => {
      // 位图纹理由 TextureManager 统一持有与释放，仅释放自建 canvas 纹理
      if (cloudAssets) {
        if (cloudAssets.owned) {
          cloudAssets.texture.dispose();
        }
        cloudAssets.material.dispose();
      }
    };
  }, [cloudAssets]);

  useEffect(() => {
    return () => {
      if (nightAssets) {
        if (nightAssets.owned) {
          nightAssets.texture.dispose();
        }
        nightAssets.material.dispose();
      }
    };
  }, [nightAssets]);

  useEffect(() => {
    return () => {
      if (ringTextureAssets?.owned) {
        ringTextureAssets.texture.dispose();
      }
    };
  }, [ringTextureAssets]);

  useEffect(() => {
    return () => {
      if (ringAssets) {
        ringAssets.geometry.dispose();
        ringAssets.material.dispose();
      }
    };
  }, [ringAssets]);

  useFrame(() => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel } = state;

    // R2-3 外层视角下内层运动退化（需求 3.3）：硬阈值改为 2.6→3.0 渐变淡出
    // （utils/freezeGate 统一收敛），淡出完毕即冻结演算并隐藏；返回 L2/L1 时
    // 按共享时间轴重新求值（钳制相位累计一并重置，无时间跳变）。
    // 淡出呈现登记：整组缩放收敛（该层级下行星为亚像素点，观感等效透明度
    // 淡出，且无需给全部材质增加透明通道）；标签按同一权重做透明度淡出。
    const weight = planetVisibilityWeight(continuousLevel);
    if (groupRef.current) {
      groupRef.current.visible = weight > 0;
      groupRef.current.scale.setScalar(Math.max(weight, 1e-6));
    }
    if (labelElRef.current) {
      labelElRef.current.style.opacity = weight.toFixed(3);
    }
    if (weight === 0) {
      if (clampedRef.current) {
        clampedRef.current = false;
        clearRenderedSatellitePhase(data.id);
        const notice = reportPlanetRateClamp(data.id, false);
        if (notice !== state.planetRateClampNotice) state.setPlanetRateClampNotice(notice);
      }
      clampedPhaseRef.current = null;
      lastSimDaysRef.current = null;
      return;
    }

    // 纹理 LOD 升级：首次进入行星视角时切换高分辨率
    if (!highRes && continuousLevel < HIGH_RES_LEVEL_THRESHOLD) {
      setHighRes(true);
    }

    // R2-3 行星速率钳制兜底：淡出区间部分可见时视觉角速度 ≤0.5 圈/秒
    // （与卫星一致，utils/time.rateClampFactor），钳制中按降速角速度累计
    // 相位（无跳变），提示"行星运动已减速显示"（聚合上报防多天体互写抖动）
    const compression = timeCompressionForContinuousLevel(continuousLevel);
    const factor = rateClampFactor(periodDays, compression, state.speedMultiplier);
    const clamped = factor < 1;
    if (clamped !== clampedRef.current) {
      clampedRef.current = clamped;
      if (!clamped) clearRenderedSatellitePhase(data.id);
      const notice = reportPlanetRateClamp(data.id, clamped);
      if (notice !== state.planetRateClampNotice) state.setPlanetRateClampNotice(notice);
    }
    const meanMotion = (Math.PI * 2) / periodDays;
    let orbitDays = simDays;
    if (clamped) {
      const exactPhase = normalizeAngle(
        data.orbit.meanAnomalyAtEpochDeg * DEG_TO_RAD + meanMotion * simDays,
      );
      const last = lastSimDaysRef.current;
      clampedPhaseRef.current = advanceClampedPhase(
        last === null ? null : clampedPhaseRef.current,
        exactPhase,
        last === null ? 0 : simDays - last,
        meanMotion,
        factor,
      );
      // 渲染相位注册（P7 范式）：钳制期间相机跟随/飞往与渲染位置保持一致
      setRenderedSatellitePhase(data.id, clampedPhaseRef.current);
      // 等效时间：使开普勒求解入口得到与累计相位严格一致的位置
      orbitDays = equivalentDaysForPhase(
        clampedPhaseRef.current,
        data.orbit.meanAnomalyAtEpochDeg,
        periodDays,
      );
    } else {
      clampedPhaseRef.current = null;
    }
    lastSimDaysRef.current = simDays;

    // 公转位置：求解开普勒方程（近日点快、远日点慢）
    const ecliptic = heliocentricPosition(data.orbit, orbitDays);
    const scene = eclipticToScene(ecliptic);
    if (groupRef.current) {
      groupRef.current.position.set(scene.x, scene.y, scene.z);
    }
    // P4 近观细节门控（需求 4.7）：相机-天体距离滞回状态机 + LRU 保留
    const dx = camera.position.x - scene.x;
    const dy = camera.position.y - scene.y;
    const dz = camera.position.z - scene.z;
    const distToBody = Math.hypot(dx, dy, dz);
    // P7 标签避让：相机贴近（距离 < 半径×4，如人造卫星近观）时隐藏标签
    const hideLabel = distToBody < radius * 4;
    if (hideLabel !== labelHiddenRef.current) {
      labelHiddenRef.current = hideLabel;
      setLabelHidden(hideLabel);
    }
    // R2-2 §2.2-C：叠加目标行星系统一致显式判定（焦点在其他行星系统时
    // 不激活，防运镜路径擦过本行星时误加载 4K/法线细节层）
    const focusId = focusBodyIdForDetail(
      state.viewLevel,
      state.flyToBodyId,
      state.followBodyId,
      state.anchorBodyId,
    );
    const focusParentId = focusId ? (getMoonById(focusId)?.parentId ?? null) : null;
    const gate = detailGateUpdateScoped(
      detailActiveRef.current,
      distToBody,
      radius,
      continuousLevel,
      planetDetailScopeAllowed(focusId, focusParentId, data.id),
    );
    if (gate.active !== detailActiveRef.current) {
      detailActiveRef.current = gate.active;
      setDetailActive(gate.active);
      if (gate.active) {
        // 登记细节纹理组并触达 LRU（超容量时释放最久未用天体的显存）
        const urls = [
          detailUrls.surface,
          detailUrls.night,
          detailUrls.clouds,
          detailUrls.normal,
        ].filter((u): u is string => u !== null);
        if (urls.length > 0) {
          getTextureManager().retainDetail(data.id, urls);
        }
      }
    }
    if (gate.releaseNow) {
      // 离开 L1 语境：立即释放本天体细节层显存（需求 4.7 硬性门控）
      getTextureManager().releaseDetail(data.id);
    }

    // 光影 uniform 更新（可见时才更新，按可见性门控）：行星中心世界坐标
    if (surfaceMaterial) {
      (surfaceMaterial.uniforms.uPlanetCenterW.value as THREE.Vector3).set(
        scene.x,
        scene.y,
        scene.z,
      );
      // P4 细节强度随距离平滑淡入淡出（4K/2K 切换无突变）
      surfaceMaterial.uniforms.uDetailStrength.value = gate.active
        ? detailStrength01(distToBody, radius)
        : 0;
    }
    if (ringAssets) {
      (ringAssets.material.uniforms.uPlanetCenterW.value as THREE.Vector3).set(
        scene.x,
        scene.y,
        scene.z,
      );
    }
    // 自转：绕倾斜后的自身轴，周期取绝对值（逆向由轴倾角 >90° 表达）；
    // R2-3：钳制中沿等效时间轴推进（与公转位置同一时间轴，防每帧随机角度闪烁）
    const rotation = rotationAngleAtTime(Math.abs(data.rotation.siderealPeriodHours), orbitDays);
    if (bodyRef.current) {
      bodyRef.current.rotation.y = rotation;
    }
    // P4 木星云层差速流动（需求 4.7）：仅近观激活时演算，
    // 漂移相位与自转共用模拟时间轴（暂停/加速全局生效）
    if (surfaceMaterial && data.id === 'jupiter') {
      surfaceMaterial.uniforms.uFlowEnabled.value = gate.active ? 1 : 0;
      if (gate.active) {
        // 相位回卷（bug 防护）：银河系/宇宙视角时间压缩后累计自转角 ~10¹⁰ 弧度，
        // float32 uniform 精度失效致流动错乱（统计近似登记于 utils/jupiterFlow.ts）
        surfaceMaterial.uniforms.uFlowPhase.value = flowShaderPhase(rotation * FLOW_VISUAL_GAIN);
      }
    }
    // 云层独立旋转（比地表略快，体现大气环流）
    if (cloudRef.current) {
      cloudRef.current.rotation.y = rotation * 1.12;
    }
    // S3 §4.3-3：地球极光增强（CME 抵达后极区大气短暂增亮，克制可退化）
    if (auroraMatRef.current && data.id === 'earth') {
      const started = state.auroraStartedAtSimDays;
      const enh = started === null ? 0 : auroraEnhancement01(simDays - started);
      auroraMatRef.current.opacity = 0.5 * enh;
      (auroraMatRef.current as unknown as { visible?: boolean }).visible = enh > 0.001;
    }
    // 夜灯层与地表同步旋转（灯光固定在大陆上）
    if (nightRef.current) {
      nightRef.current.rotation.y = rotation;
    }
  });

  return (
    <group ref={groupRef} name={data.id}>
      {/* 轴倾角组：绕 Z 轴倾斜（相对轨道面，此处近似相对黄道面） */}
      <group rotation={[0, 0, tiltRad]}>
        {surfaceMaterial && (
          <mesh
            ref={bodyRef}
            material={surfaceMaterial}
            scale={ellipsoidScale ?? undefined}
            onClick={(e) => {
              e.stopPropagation();
              selectBody(data.id);
            }}
          >
            <sphereGeometry args={[radius, 48, 48]} />
          </mesh>
        )}

        {/* 夜半球城市灯光（可选需求 3.1.1：背向太阳的半球显示） */}
        {nightAssets && (
          <mesh ref={nightRef} material={nightAssets.material}>
            <sphereGeometry args={[radius * 1.005, 48, 48]} />
          </mesh>
        )}

        {/* 云层（独立旋转，需求 3.1.1 地球；P3-1 真实云图 + 统一昼夜光照） */}
        {cloudAssets && (
          <mesh ref={cloudRef} material={cloudAssets.material}>
            <sphereGeometry args={[radius * 1.02, 48, 48]} />
          </mesh>
        )}

        {/* 大气边缘辉光（蓝色薄层，需求 3.1.1） */}
        {data.surface?.hasAtmosphereGlow && (
          <mesh>
            <sphereGeometry args={[radius * 1.07, 48, 48]} />
            <meshBasicMaterial
              color={data.surface.atmosphereColor ?? '#6ab7ff'}
              transparent
              opacity={0.16}
              side={THREE.BackSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        )}

        {/* S3 §4.3-3 地球极光增强层（CME 抵达时短暂增亮，绿色高层大气辉光） */}
        {data.id === 'earth' && (
          <mesh raycast={() => null}>
            <sphereGeometry args={[radius * 1.05, 32, 32]} />
            <meshBasicMaterial
              ref={auroraMatRef}
              color="#4dffa0"
              transparent
              opacity={0}
              visible={false}
              side={THREE.BackSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        )}

        {/* 行星环（土星：真实环纹 + 卡西尼缝 + 行星阴影，需求 3.1.1/4.6） */}
        {ringAssets && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            geometry={ringAssets.geometry}
            material={ringAssets.material}
          />
        )}

        {/* 赤道面参考平面卫星（需求 3.1.1：参考平面统一为行星赤道面） */}
        {equatorialMoons.map((moon) => (
          <Moon key={moon.id} data={moon} parentRadiusKm={data.radiusKm} />
        ))}
      </group>

      {/* 黄道面参考平面卫星（月球例外：相对黄道面约 5.1°） */}
      {eclipticMoons.map((moon) => (
        <Moon key={moon.id} data={moon} parentRadiusKm={data.radiusKm} />
      ))}

      {showLabels && !frozen && !labelHidden && (
        // R3-4：近距反向缩放钳制（标签不随放大铺屏），近距隐藏（P7）保留
        <ClampedHtmlLabel
          position={[0, radius + 0.6, 0]}
          distanceFactor={60}
          style={{ pointerEvents: 'none' }}
        >
          <span ref={labelElRef} className="whitespace-nowrap text-xs text-gray-200/80">
            {data.nameZh}
          </span>
        </ClampedHtmlLabel>
      )}
    </group>
  );
}
