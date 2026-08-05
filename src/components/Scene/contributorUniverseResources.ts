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
import type { ContributorStar } from '@/utils/contributorUniverse';
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

    scales[i] = 0.4 + rand() * 0.5;
    const b = 0.2 + rand() * 0.3;
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
