/**
 * 贡献者宇宙 3D 资源工厂（C2-2，/contributors 页面专用）
 *
 * 与 ContributorUniverse.tsx 组件层分离：本文件不含 React/R3F 依赖，
 * 顶点缓冲/几何/材质的构建与释放均为可在 jsdom 中直接断言的工厂函数
 * （附录 A 测试要求：3D 组件以纯函数断言 + dispose 断言为主）。
 *
 * shader 移植自 Starfield.tsx 范式（柔边圆点 + 双正弦闪烁顶点属性），
 * 差异登记：
 * - 独立页面无 logarithmicDepthBuffer，去除 logdepthbuf include；
 * - 每星独立粒径 aScale + 亮度 aBrightness（C1 金额映射产物直灌）；
 * - fragment 内按亮度扩散光晕（大额星更亮更弥散），零后处理（无 Bloom）。
 */

import * as THREE from 'three';
import type { BoundarySphereSpec, ContributorStar } from '@/utils/contributorUniverse';
import {
  BOUNDARY_SPHERE_COLOR,
  BOUNDARY_SPHERE_OPACITY,
} from '@/utils/contributorUniverse';
import { createSeededRandom } from '@/utils/random';
import { twinkleAmplitude, twinkleFrequencyHz } from '@/utils/starTwinkle';

/** 星点顶点缓冲组（贡献者星与背景星场共用同一 shader/属性布局） */
export interface StarPointBuffers {
  positions: Float32Array;
  colors: Float32Array;
  scales: Float32Array;
  brightness: Float32Array;
  phases: Float32Array;
  freqs: Float32Array;
  amps: Float32Array;
}

/** 几何 + 材质资源对（组件 useMemo 创建、useEffect 卸载 dispose） */
export interface StarPointsResources {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
}

/** 背景星场色板（复用 Starfield 温度色板口径；出处登记同 contributorUniverse.ts） */
const BACKGROUND_STAR_COLORS = [
  '#9bb0ff', '#aabfff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffd2a1', '#ffcc6f',
] as const;

/** 背景星场球壳半径（远大于星团 3σ=90 与相机 maxDistance，纯氛围层） */
export const BACKGROUND_INNER_RADIUS = 700;
export const BACKGROUND_OUTER_RADIUS = 1800;

/** 背景星场默认点数（C2-2 ≤3000；C3 低档减半） */
export const BACKGROUND_STAR_COUNT = 3000;

/** 背景星场确定性种子（固定值，刷新不变） */
export const BACKGROUND_STAR_SEED = 20260805;

const VERTEX_SHADER = /* glsl */ `
  attribute float aScale;
  attribute float aBrightness;
  attribute float aPhase;
  attribute float aFreq;
  attribute float aAmp;
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  varying vec3 vColor;
  varying float vBrightness;
  void main() {
    // 双正弦叠加闪烁（Starfield/utils/starTwinkle 镜像；确定性、无随机数）
    float wave = 0.7 * sin(6.28318 * (aFreq * uTime + aPhase))
               + 0.3 * sin(6.28318 * (2.33 * aFreq * uTime + 2.7 * aPhase));
    float tw = 1.0 + aAmp * wave;
    vColor = color * tw;
    vBrightness = aBrightness;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * aScale * (uScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vBrightness;
  void main() {
    // 柔边核心 + 按亮度扩散的光晕（金额大者更亮更弥散，零后处理）
    float d = length(gl_PointCoord - vec2(0.5));
    float core = 1.0 - smoothstep(0.10, 0.30, d);
    float halo = 1.0 - smoothstep(0.08, 0.5, d);
    float alpha = (core + halo * halo * 0.6 * vBrightness) * vBrightness;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, min(alpha, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 贡献者星顶点缓冲：C1 layoutContributorStars 产物直灌
 * （position/scale/brightness/color/twinkle* 一一对应，组件零重算）。
 */
export function buildContributorStarBuffers(
  stars: readonly ContributorStar[],
): StarPointBuffers {
  const n = stars.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const scales = new Float32Array(n);
  const brightness = new Float32Array(n);
  const phases = new Float32Array(n);
  const freqs = new Float32Array(n);
  const amps = new Float32Array(n);
  const color = new THREE.Color();

  for (let i = 0; i < n; i += 1) {
    const star = stars[i];
    positions[i * 3] = star.position[0];
    positions[i * 3 + 1] = star.position[1];
    positions[i * 3 + 2] = star.position[2];
    color.set(star.color);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    scales[i] = star.scale;
    brightness[i] = star.brightness;
    phases[i] = star.twinklePhase;
    freqs[i] = star.twinkleFreq;
    amps[i] = star.twinkleAmp;
  }

  return { positions, colors, scales, brightness, phases, freqs, amps };
}

/**
 * 背景氛围星场顶点缓冲：确定性种子随机（同种子逐位一致），
 * 球壳均匀分布；比贡献者星更小（scale ≤0.9）更暗（brightness ≤0.5），
 * 视觉上可区分（C2-2）。
 */
export function buildBackgroundStarBuffers(
  count: number = BACKGROUND_STAR_COUNT,
  seed: number = BACKGROUND_STAR_SEED,
): StarPointBuffers {
  const rand = createSeededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const brightness = new Float32Array(count);
  const phases = new Float32Array(count);
  const freqs = new Float32Array(count);
  const amps = new Float32Array(count);
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    // 球壳内均匀分布（Starfield 同式）
    const u = rand();
    const v = rand();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r =
      BACKGROUND_INNER_RADIUS +
      (BACKGROUND_OUTER_RADIUS - BACKGROUND_INNER_RADIUS) * Math.cbrt(rand());
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    color.set(BACKGROUND_STAR_COLORS[Math.floor(rand() * BACKGROUND_STAR_COLORS.length)]);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    // C5-2 适度提亮：粒径 0.4–0.9 → 0.5–1.0、亮度 0.2–0.5 → 0.3–0.55
    // （仍显著小/暗于贡献者星 scale ≥1×基准 3 / brightness ≥0.4，可辨区分）
    scales[i] = 0.5 + rand() * 0.5;
    const b = 0.3 + rand() * 0.25;
    brightness[i] = b;
    phases[i] = rand();
    freqs[i] = twinkleFrequencyHz(rand());
    amps[i] = twinkleAmplitude(b, rand());
  }

  return { positions, colors, scales, brightness, phases, freqs, amps };
}

/** 缓冲组 → BufferGeometry（属性名与 shader 一致） */
export function createStarPointsGeometry(buffers: StarPointBuffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(buffers.scales, 1));
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(buffers.brightness, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(buffers.phases, 1));
  geometry.setAttribute('aFreq', new THREE.BufferAttribute(buffers.freqs, 1));
  geometry.setAttribute('aAmp', new THREE.BufferAttribute(buffers.amps, 1));
  return geometry;
}

/**
 * 星点 ShaderMaterial：uSize 为基准粒径（贡献者星 > 背景星场）；
 * uScale 每帧按画布像素高度更新（sizeAttenuation 语义对齐）。
 */
export function createStarPointsMaterial(baseSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: baseSize },
      uScale: { value: 400 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** 组装一组星点资源（组件 useMemo 消费） */
export function createStarPointsResources(
  buffers: StarPointBuffers,
  baseSize: number,
): StarPointsResources {
  return {
    geometry: createStarPointsGeometry(buffers),
    material: createStarPointsMaterial(baseSize),
  };
}

/** 释放星点资源（组件 useEffect 卸载回调；Starfield dispose 范式） */
export function disposeStarPointsResources(resources: StarPointsResources): void {
  resources.geometry.dispose();
  resources.material.dispose();
}

// ---------------------------------------------------------------------------
// C5-1：网格球体宇宙边界（经纬网格 LineSegments）
// ---------------------------------------------------------------------------

/** 边界球线段资源（几何 + 线材质；组件 useMemo 创建、卸载 dispose） */
export interface BoundarySphereResources {
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
}

/**
 * 边界球经纬网格线段顶点（LineSegments 顶点对布局）：
 * - 纬线：latitudeLines 条闭合圆环，纬度均匀分布于 (-90°, 90°)（含赤道，
 *   不含两极退化点），每环 arcSegments 段；
 * - 经线：longitudeLines 条极到极半圆（方位角均匀分布 [0, 2π)），
 *   每条 arcSegments 段。
 * 全部顶点严格落在半径 spec.radius 球面上（单测断言）；确定性纯函数。
 */
export function buildBoundarySphereBuffers(spec: BoundarySphereSpec): Float32Array {
  const { radius, latitudeLines, longitudeLines, arcSegments } = spec;
  const totalSegments = (latitudeLines + longitudeLines) * arcSegments;
  const positions = new Float32Array(totalSegments * 2 * 3);
  let offset = 0;

  const push = (x: number, y: number, z: number): void => {
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    offset += 3;
  };

  // 纬线圆环（y = R·sinφ 平面上半径 R·cosφ 的闭合圆）
  for (let i = 0; i < latitudeLines; i += 1) {
    const lat = (-Math.PI / 2) + (Math.PI * (i + 1)) / (latitudeLines + 1);
    const y = radius * Math.sin(lat);
    const ringRadius = radius * Math.cos(lat);
    for (let s = 0; s < arcSegments; s += 1) {
      const a0 = (2 * Math.PI * s) / arcSegments;
      const a1 = (2 * Math.PI * (s + 1)) / arcSegments;
      push(ringRadius * Math.cos(a0), y, ringRadius * Math.sin(a0));
      push(ringRadius * Math.cos(a1), y, ringRadius * Math.sin(a1));
    }
  }

  // 经线半圆（北极 → 南极，方位角均匀分布）
  for (let j = 0; j < longitudeLines; j += 1) {
    const azimuth = (2 * Math.PI * j) / longitudeLines;
    const cosA = Math.cos(azimuth);
    const sinA = Math.sin(azimuth);
    for (let s = 0; s < arcSegments; s += 1) {
      const t0 = (Math.PI * s) / arcSegments;
      const t1 = (Math.PI * (s + 1)) / arcSegments;
      push(radius * Math.sin(t0) * cosA, radius * Math.cos(t0), radius * Math.sin(t0) * sinA);
      push(radius * Math.sin(t1) * cosA, radius * Math.cos(t1), radius * Math.sin(t1) * sinA);
    }
  }

  return positions;
}

/**
 * 组装边界球资源：LineSegments 几何 + 加性混合半透明线材质
 * （科幻蓝低透明度发光观感；depthWrite 关闭防遮挡星点）。
 */
export function createBoundarySphereResources(
  spec: BoundarySphereSpec,
): BoundarySphereResources {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(buildBoundarySphereBuffers(spec), 3),
  );
  const material = new THREE.LineBasicMaterial({
    color: BOUNDARY_SPHERE_COLOR,
    transparent: true,
    opacity: BOUNDARY_SPHERE_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return { geometry, material };
}

/** 释放边界球资源（组件 useEffect 卸载回调） */
export function disposeBoundarySphereResources(resources: BoundarySphereResources): void {
  resources.geometry.dispose();
  resources.material.dispose();
}
