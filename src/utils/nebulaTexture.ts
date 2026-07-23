/**
 * 程序化星云纹理生成器（P6，需求 3.2 星云类形态重构）
 *
 * 现状：所有星云复用 createGlowSpriteCanvas 的 128px 三停径向渐变圆斑，
 * 呈"圆形光晕"无丝状/云状/不规则形态。本模块基于**分层 fBm + 域扭曲
 * （domain warping）**生成不规则云状 RGBA 纹理数据（Float32/Uint8），
 * 参数化（颜色梯度 / 丝状强度 / 不规则度 / 双色层），确定性种子保证稳定。
 *
 * 设计要点（需求 §4 硬性约束）：
 * - **全程序化生成，无外部位图**；输出 ≤512px；**生成一次缓存复用**（组件层缓存）。
 * - 生成的是 RGBA 像素数据（Uint8ClampedArray），组件包装为 THREE.DataTexture，
 *   不依赖 DOM canvas，故可在 jsdom 下单测（纯数值）。
 * - 域扭曲：采样坐标先被一层低频 fBm 偏移，再采主 fBm，产生湍流丝状/涡卷形态。
 *
 * ── 艺术化/近似登记（需求 §5）─────────────────────────────────────────
 * - 丝状/云状形态为程序化噪声近似真实观测形态（哈勃/JWST 公开影像仅作形态参考，
 *   非直贴），非物理辐射转移解。
 * - 双色层（内 OIII 蓝绿 / 外 Hα 红等）按半径线性混合，近似真实电离分层。
 */

import { createSeededRandom } from '@/utils/random';

/** 星云纹理生成参数 */
export interface NebulaTextureParams {
  /** 纹理边长（像素，2..512） */
  size: number;
  /** 确定性种子 */
  seed: number;
  /** 内层颜色 #RRGGBB（径向内侧 / 主色） */
  innerColor: string;
  /** 外层颜色 #RRGGBB（径向外侧；与内层按半径混合，实现色层） */
  outerColor: string;
  /** 丝状强度 ∈ [0,1]：越大湍流细丝越明显 */
  filamentStrength: number;
  /** 不规则度 ∈ [0,1]：域扭曲幅度，越大越不规则（偏离圆形） */
  irregularity: number;
  /** fBm 层数（1..6） */
  octaves: number;
  /**
   * 形态：'cloud' 弥散云（发射/反射星云）；'ring' 环壳（行星状星云，
   * alpha 沿环峰值）；'shell' 丝状遗迹壳（蟹状/超新星遗迹，中空+丝网）。
   */
  shape: 'cloud' | 'ring' | 'shell';
}

/** 生成结果：RGBA 像素（size*size*4，0-255）+ 元数据 */
export interface NebulaTextureData {
  size: number;
  /** RGBA，长度 size*size*4 */
  pixels: Uint8ClampedArray;
}

/** #RRGGBB → {r,g,b}（0-255）。仅接受合法 6 位十六进制。 */
function parseHex(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) {
    throw new RangeError(`颜色必须为 #RRGGBB，收到 ${hex}`);
  }
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** 基于预生成晶格的可平铺值噪声 */
function makeValueNoise(seed: number, grid: number): (x: number, y: number) => number {
  const rand = createSeededRandom(seed);
  const g = Math.max(2, Math.floor(grid));
  const lattice = new Float32Array(g * g);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
  return (x: number, y: number): number => {
    const fx = ((x % 1) + 1) % 1;
    const fy = ((y % 1) + 1) % 1;
    const gx = fx * g;
    const gy = fy * g;
    const x0 = Math.floor(gx) % g;
    const y0 = Math.floor(gy) % g;
    const x1 = (x0 + 1) % g;
    const y1 = (y0 + 1) % g;
    const tx = smoothstep01(gx - Math.floor(gx));
    const ty = smoothstep01(gy - Math.floor(gy));
    const v00 = lattice[y0 * g + x0];
    const v10 = lattice[y0 * g + x1];
    const v01 = lattice[y1 * g + x0];
    const v11 = lattice[y1 * g + x1];
    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
  };
}

/** 多层 fBm（归一化 [0,1]） */
function makeFbm(seed: number, octaves: number): (x: number, y: number) => number {
  const seedRand = createSeededRandom(seed);
  const layers: Array<(x: number, y: number) => number> = [];
  for (let o = 0; o < octaves; o += 1) {
    layers.push(makeValueNoise(Math.floor(seedRand() * 0xffffffff), 4 << o));
  }
  let total = 0;
  for (let o = 0; o < octaves; o += 1) total += 1 / 2 ** o;
  return (x: number, y: number): number => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    for (let o = 0; o < octaves; o += 1) {
      sum += layers[o](x * freq, y * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / total;
  };
}

/**
 * 生成星云 RGBA 纹理数据（确定性，纯数值，可单测）
 *
 * @throws RangeError 参数越界
 */
export function generateNebulaTextureData(params: NebulaTextureParams): NebulaTextureData {
  const { size, seed, filamentStrength, irregularity, octaves, shape } = params;
  if (!Number.isInteger(size) || size < 2 || size > 512) {
    throw new RangeError(`size 必须为 2..512 的整数，收到 ${size}`);
  }
  if (filamentStrength < 0 || filamentStrength > 1) {
    throw new RangeError(`filamentStrength 必须在 [0,1]，收到 ${filamentStrength}`);
  }
  if (irregularity < 0 || irregularity > 1) {
    throw new RangeError(`irregularity 必须在 [0,1]，收到 ${irregularity}`);
  }
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > 6) {
    throw new RangeError(`octaves 必须为 1..6 的整数，收到 ${octaves}`);
  }
  const inner = parseHex(params.innerColor);
  const outer = parseHex(params.outerColor);

  const baseFbm = makeFbm(seed, octaves);
  const warpFbm = makeFbm(seed ^ 0x9e3779b9, Math.min(octaves, 3));
  const filFbm = makeFbm(seed ^ 0x51ed270b, octaves);

  const pixels = new Uint8ClampedArray(size * size * 4);
  const half = size / 2;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      // 归一化到 [-1,1]
      const nx = (px - half) / half;
      const ny = (py - half) / half;
      const dist = Math.hypot(nx, ny); // 0 中心 → ~1.41 角
      const u = px / size;
      const v = py / size;

      // 域扭曲：坐标被低频 fBm 偏移，产生涡卷/不规则边界
      const warpX = (warpFbm(u * 2, v * 2) - 0.5) * irregularity * 1.2;
      const warpY = (warpFbm(u * 2 + 5.2, v * 2 + 1.3) - 0.5) * irregularity * 1.2;
      const cloud = baseFbm(u * 2.5 + warpX, v * 2.5 + warpY);

      // 丝状细节（脊状噪声：1 − |2n−1| 强化细丝）
      const fil = 1 - Math.abs(2 * filFbm(u * 5 + warpX, v * 5 + warpY) - 1);
      const filament = fil * filamentStrength;

      // 半径包络（不同形态不同）
      let envelope: number;
      if (shape === 'ring') {
        // 环壳：alpha 在 r≈0.6 处峰值
        envelope = Math.exp(-Math.pow((dist - 0.6) / 0.22, 2));
      } else if (shape === 'shell') {
        // 遗迹壳：中空（中心暗）+ 外缘丝网，r∈[0.2,0.95] 亮
        const outerFall = smoothstep01((0.98 - dist) / 0.25);
        const innerRise = smoothstep01((dist - 0.12) / 0.25);
        envelope = outerFall * innerRise;
      } else {
        // 弥散云：中心亮向外衰减
        envelope = smoothstep01((1.0 - dist) / 0.9);
      }

      let intensity = envelope * (0.45 * cloud + 0.55) + filament * envelope * 0.8;
      intensity = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;

      // 颜色分层：内色↔外色按半径混合
      const mix = smoothstep01(dist / 0.9);
      const r = inner.r + (outer.r - inner.r) * mix;
      const g = inner.g + (outer.g - inner.g) * mix;
      const b = inner.b + (outer.b - inner.b) * mix;

      const idx = (py * size + px) * 4;
      pixels[idx] = r * (0.6 + 0.4 * cloud);
      pixels[idx + 1] = g * (0.6 + 0.4 * cloud);
      pixels[idx + 2] = b * (0.6 + 0.4 * cloud);
      pixels[idx + 3] = intensity * 255;
    }
  }

  return { size, pixels };
}

/** 平均 alpha（0-1）——供单测断言纹理非空且形态合理 */
export function averageAlpha(data: NebulaTextureData): number {
  let sum = 0;
  const n = data.size * data.size;
  for (let i = 0; i < n; i += 1) sum += data.pixels[i * 4 + 3];
  return sum / n / 255;
}

/**
 * 环形形态校验：环壳应"中心暗、中环亮"（供单测断言 ring 形态正确）
 * 返回 { center, mid } 两处平均 alpha（0-1）。
 */
export function radialAlphaProfile(data: NebulaTextureData): {
  center: number;
  mid: number;
  edge: number;
} {
  const { size, pixels } = data;
  const half = size / 2;
  const bins = { center: [0, 0], mid: [0, 0], edge: [0, 0] } as Record<string, [number, number]>;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const nx = (px - half) / half;
      const ny = (py - half) / half;
      const d = Math.hypot(nx, ny);
      const a = pixels[(py * size + px) * 4 + 3] / 255;
      const key = d < 0.25 ? 'center' : d < 0.75 ? 'mid' : 'edge';
      bins[key][0] += a;
      bins[key][1] += 1;
    }
  }
  const avg = (k: string): number => (bins[k][1] > 0 ? bins[k][0] / bins[k][1] : 0);
  return { center: avg('center'), mid: avg('mid'), edge: avg('edge') };
}
