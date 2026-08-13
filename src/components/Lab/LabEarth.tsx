'use client';

/**
 * 实验室真实地球（M3.6-3，决策 C1 真实比例 1:1）：
 * 球心 (0, −6371, 0)、半径 6371 km（表面切原点 y=0）——科学准确性红线，
 * 禁止艺术缩放。太空档与跟随视角可见（常驻挂载 + visible 门控，纹理
 * 页面挂载即低优先级后台预载，切档零等待）。
 *
 * shader 来源登记（主场景零改动）：表面/云层片段复制自
 * src/components/CelestialBody/Planet.tsx 的 SURFACE_ 与 CLOUD_ 系
 * shader 常量（P3-4 行星光影），改动点：
 * - `sunDir = normalize(-vPosW)`（主场景太阳在原点）→ `uSunDir` uniform
 *   （实验室太阳方向由 labSunDirection(当地时钟, 纬度) 每帧推算——历元
 *   ~02:00 → 夜面朝上 + 城市夜灯 + 晨昏线远地平，与实验室地方时自洽）；
 * - 剥离主场景专属分支（土星环投影/法线贴图/木星流动/对数深度 chunk——
 *   实验室 Canvas 无 logarithmicDepthBuffer）；
 * - 结构差异登记：昼/夜贴图在单一表面 shader 内按 terminator 混合
 *   （主场景独立夜灯壳层 ×1.005 在真实比例下 = 浮空 32 km，不适用）；
 *   大气辉光为新写薄壳（半径 6371+120，顶弧贴燃烧层上方——流星在辉光层
 *   内划过；主场景 ×1.07 厚壳 = +446 km 不适用）。
 *
 * 性能登记：表面/云/大气 3 mesh 非粒子系统（§4.1 口径扩展）；纹理 2K×3
 * ≈ 12 MB 显存；后台异步加载不阻塞可交互（未就绪表面用深海蓝纯色兜底）。
 * 4K 近观升级留 M4 可选。
 *
 * 已知近似登记：贴图经纬网以"观测者天顶 = 球面 +Y 极点"放置（观测点
 * 落在贴图极区而非真实纬度圈）——terminator 几何相对观测者天顶严格正确
 * （切点法线 = +Y，dot(N, uSunDir) = sin(太阳高度角)），大陆相对观测者
 * 的具体取向不作约束（太空档目验对象是夜面/晨昏线/辉光 limb，非地理配准）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { textureUrl } from '@/data/textures';
import { useBitmapTexture } from '@/hooks/useBitmapTexture';
import {
  ATMOSPHERE_TOP_KM,
  EARTH_RADIUS_KM,
  EPOCH_LOCAL_HOURS,
  labSunDirection,
  localClockHours,
} from '@/utils/meteorShower';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

/** 地球纹理加载优先级（低——不与主场景细节层/亮星星表抢队列） */
const EARTH_TEXTURE_PRIORITY = 20;

/** 云层壳高度（km；主场景 ×1.02 比例在真实半径下过厚，取真实对流层顶量级） */
const CLOUD_HEIGHT_KM = 8;

/**
 * 云层相对地表漂移角速率（rad/场景秒）：主场景口径"云层自转 1.12×"——
 * 实验室为地固系（星穹旋转、地面静止），云层相对地表转 0.12× 恒星日角速率。
 */
const CLOUD_DRIFT_RAD_PER_SEC = (0.12 * 2 * Math.PI) / 86164;

/** 表面 shader（Planet.tsx SURFACE_* 复制精简 + uSunDir + 昼夜单 shader 混合） */
const EARTH_SURFACE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EARTH_SURFACE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform float uHasDayMap;
  uniform float uHasNightMap;
  uniform vec3 uSunDir;
  uniform float uAmbient;
  uniform float uTerminatorSoftness;
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vec3 geoN = normalize(vNormalW);
    float ndl = dot(geoN, uSunDir);
    // 昼夜明暗界线柔和过渡（Planet.tsx 同式；光照方向换 uSunDir uniform）
    float day = smoothstep(-uTerminatorSoftness, uTerminatorSoftness, ndl);
    // 昼面：真实贴图（未就绪时深海蓝纯色兜底）
    vec3 dayColor = mix(vec3(0.045, 0.08, 0.16), texture2D(uDayMap, vUv).rgb, uHasDayMap);
    float light = uAmbient + (1.0 - uAmbient) * day;
    vec3 color = dayColor * light;
    // 夜灯：单一表面 shader 内按 terminator 混合（Planet.tsx 夜灯壳层
    // 片段的混合公式同式；真实比例下独立壳层浮空 32 km，结构差异登记）
    float night = smoothstep(0.08, -0.18, ndl);
    vec3 nightTex = texture2D(uNightMap, vUv).rgb;
    color += nightTex * night * 1.5 * uHasNightMap;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** 云层 shader（Planet.tsx CLOUD_FRAGMENT_SHADER 复制精简 + uSunDir） */
const EARTH_CLOUD_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uSunDir;
  uniform float uAmbient;
  uniform float uTerminatorSoftness;
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vec3 geoN = normalize(vNormalW);
    float ndl = dot(geoN, uSunDir);
    float day = smoothstep(-uTerminatorSoftness, uTerminatorSoftness, ndl);
    vec4 tex = texture2D(uMap, vUv);
    // 真实云图（灰度 JPG）：亮度即云量 → alpha（Planet.tsx uUseAlphaMap=1 分支）
    float cloudAlpha = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    float light = uAmbient + (1.0 - uAmbient) * day;
    gl_FragColor = vec4(vec3(light), cloudAlpha * uOpacity);
  }
`;

/**
 * 大气辉光薄壳（M3.6-3 新写，非主场景复制）：半径 6371+120（顶弧贴
 * 燃烧层 80–115 上方）；BackSide + limb 边缘渐变（视线与法线近切向时
 * 最亮）+ 加性混合 + depthWrite:false；昼侧偏亮蓝、夜侧余微弱气辉。
 */
const EARTH_ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 geoN = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vPosW);
    // limb 渐变：视线掠切球面（|N·V| → 0）时最亮
    float limb = pow(1.0 - abs(dot(viewDir, geoN)), 2.2);
    // 昼夜调制：昼侧瑞利散射蓝、夜侧微弱气辉（夜面不至全黑）
    float dayFactor = clamp(dot(geoN, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 color = mix(vec3(0.10, 0.22, 0.38) * 0.4, vec3(0.36, 0.62, 1.0), dayFactor);
    float alpha = limb * (0.22 + 0.68 * dayFactor);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

const EARTH_ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

interface LabEarthProps {
  refs: LabFrameRefs;
  /** 可见门控（太空档 || 跟随期间；常驻挂载防切档重建/纹理重传） */
  visible: boolean;
}

/** 实验室真实地球（表面 + 云层 + 大气辉光 3 mesh；每帧只动 uniforms/旋转） */
export function LabEarth({ refs, visible }: LabEarthProps): JSX.Element {
  const cloudRef = useRef<THREE.Mesh>(null);

  // 纹理复用主场景管线（2K 昼/夜/云；挂载即请求 → 后台预载）
  const dayMap = useBitmapTexture(textureUrl('earth', 'surface'), EARTH_TEXTURE_PRIORITY, true);
  const nightMap = useBitmapTexture(textureUrl('earth', 'night'), EARTH_TEXTURE_PRIORITY, true);
  const cloudMap = useBitmapTexture(textureUrl('earth', 'clouds'), EARTH_TEXTURE_PRIORITY, true);

  const surfaceMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uDayMap: { value: null },
          uNightMap: { value: null },
          uHasDayMap: { value: 0 },
          uHasNightMap: { value: 0 },
          uSunDir: { value: new THREE.Vector3(0, -1, 0) },
          uAmbient: { value: 0.06 },
          uTerminatorSoftness: { value: 0.08 },
        },
        vertexShader: EARTH_SURFACE_VERTEX_SHADER,
        fragmentShader: EARTH_SURFACE_FRAGMENT_SHADER,
      }),
    []
  );

  const cloudMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: null },
          uOpacity: { value: 0.85 },
          uSunDir: { value: new THREE.Vector3(0, -1, 0) },
          uAmbient: { value: 0.05 },
          uTerminatorSoftness: { value: 0.08 },
        },
        vertexShader: EARTH_SURFACE_VERTEX_SHADER,
        fragmentShader: EARTH_CLOUD_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
      }),
    []
  );

  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: new THREE.Vector3(0, -1, 0) },
        },
        vertexShader: EARTH_ATMOSPHERE_VERTEX_SHADER,
        fragmentShader: EARTH_ATMOSPHERE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    []
  );

  // 纹理到位即挂 uniforms（位图由 TextureManager 统一持有，本组件不 dispose）
  useEffect(() => {
    surfaceMaterial.uniforms.uDayMap.value = dayMap;
    surfaceMaterial.uniforms.uHasDayMap.value = dayMap ? 1 : 0;
  }, [surfaceMaterial, dayMap]);
  useEffect(() => {
    surfaceMaterial.uniforms.uNightMap.value = nightMap;
    surfaceMaterial.uniforms.uHasNightMap.value = nightMap ? 1 : 0;
  }, [surfaceMaterial, nightMap]);
  useEffect(() => {
    cloudMaterial.uniforms.uMap.value = cloudMap;
  }, [cloudMaterial, cloudMap]);

  useEffect(() => {
    return () => {
      surfaceMaterial.dispose();
      cloudMaterial.dispose();
      atmosphereMaterial.dispose();
    };
  }, [surfaceMaterial, cloudMaterial, atmosphereMaterial]);

  useFrame(() => {
    if (!visible) return; // 隐藏期零 uniform 更新（visible 由 props 门控）
    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    // 太阳方向 = 当地时钟推算（与 HUD 时钟/星穹旋转共用同一时间输入自洽）
    const clock = localClockHours(
      EPOCH_LOCAL_HOURS[shower.id],
      s.hourOffset,
      refs.timeSecRef.current / 3600
    );
    const sunDir = labSunDirection(clock, s.observerLat);
    (surfaceMaterial.uniforms.uSunDir.value as THREE.Vector3).set(...sunDir);
    (cloudMaterial.uniforms.uSunDir.value as THREE.Vector3).set(...sunDir);
    (atmosphereMaterial.uniforms.uSunDir.value as THREE.Vector3).set(...sunDir);
    // 云层相对地表漂移（主场景"云层 1.12× 自转"的地固系换算）
    if (cloudRef.current) {
      cloudRef.current.rotation.y = refs.timeSecRef.current * CLOUD_DRIFT_RAD_PER_SEC;
    }
  });

  return (
    <group position={[0, -EARTH_RADIUS_KM, 0]} visible={visible}>
      {/* 表面（96×96 分段；昼/夜贴图单 shader terminator 混合） */}
      <mesh material={surfaceMaterial}>
        <sphereGeometry args={[EARTH_RADIUS_KM, 96, 96]} />
      </mesh>
      {/* 云层：+8 km 真实对流层顶量级，独立漂移 */}
      <mesh ref={cloudRef} material={cloudMaterial}>
        <sphereGeometry args={[EARTH_RADIUS_KM + CLOUD_HEIGHT_KM, 96, 96]} />
      </mesh>
      {/* 大气辉光薄壳：顶弧 +120 km 贴燃烧层上方（流星在辉光层内划过） */}
      <mesh material={atmosphereMaterial}>
        <sphereGeometry args={[EARTH_RADIUS_KM + ATMOSPHERE_TOP_KM, 96, 96]} />
      </mesh>
    </group>
  );
}
