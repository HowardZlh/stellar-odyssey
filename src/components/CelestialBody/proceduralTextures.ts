/**
 * 程序化天体纹理生成（Canvas 2D，纯 canvas 模块，不依赖 three.js）
 *
 * 登记说明（需求 4.1）：
 * - 程序化纹理为基于 NASA 观测特征的艺术化近似；真实 NASA 纹理可后续替换，
 *   生成风格参考真实观测（如木星云带、火星水手号峡谷、冥王星汤博区等）。
 * - 投影方式：等距圆柱投影（equirectangular），宽:高 = 2:1。
 * - 确定性生成：所有随机均来自 createSeededRandom（seed 由 bodyId 哈希派生），
 *   同一输入必得同一纹理（需求 4.5）。
 *
 * 目标：行星视角（L1）下可辨识各行星的真实表面特征（需求 3.1.1）；
 * 星系精灵图四类形态视觉差异明显、不共用同一贴图（需求 3.1.3）。
 */

import { createSeededRandom } from '@/utils/random';
import type { GalaxyMorphology } from '@/types';

/** RGB 颜色（0-255 分量） */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/** 字符串哈希 → 32 位无符号种子（FNV-1a，确定性） */
function hashStringToSeed(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 创建指定尺寸的 canvas */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** 获取 2D 上下文（浏览器环境必有；取不到时抛错以便尽早暴露问题） */
function getContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法获取 Canvas 2D 上下文');
  }
  return ctx;
}

/** 解析 #rgb / #rrggbb 十六进制颜色为 RGB 分量 */
function hexToRgb(hex: string): Rgb {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) {
    return { r: 128, g: 128, b: 128 };
  }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** RGB → CSS rgba 字符串 */
function rgbToCss(c: Rgb, alpha: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

/** 线性插值两个颜色 */
function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** 颜色整体乘以亮度系数 */
function scaleRgb(c: Rgb, factor: number): Rgb {
  return {
    r: Math.min(255, c.r * factor),
    g: Math.min(255, c.g * factor),
    b: Math.min(255, c.b * factor),
  };
}

/** 限制在 [0, 1] */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 平滑插值曲线（smoothstep 核） */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// 种子化值噪声与 fBm（经度方向可平铺，保证球面接缝处纹理连续）
// ---------------------------------------------------------------------------

/**
 * 创建 2D 值噪声采样函数：
 * - 晶格随机值由 createSeededRandom 预生成（确定性）；
 * - u ∈ [0,1) 方向按 gridW 周期回绕（经度平铺）；v ∈ [0,1] 方向钳制；
 * - 采用 smoothstep 双线性插值。
 */
function createValueNoise2D(
  seed: number,
  gridW: number,
  gridH: number
): (u: number, v: number) => number {
  const rand = createSeededRandom(seed);
  const lattice = new Float32Array(gridW * (gridH + 1));
  for (let i = 0; i < lattice.length; i += 1) {
    lattice[i] = rand();
  }
  return (u: number, v: number): number => {
    const x = (u - Math.floor(u)) * gridW;
    const y = clamp01(v) * gridH;
    const x0 = Math.floor(x) % gridW;
    const x1 = (x0 + 1) % gridW;
    const y0 = Math.min(Math.floor(y), gridH);
    const y1 = Math.min(y0 + 1, gridH);
    const tx = smooth(x - Math.floor(x));
    const ty = smooth(y - y0);
    const v00 = lattice[y0 * gridW + x0];
    const v10 = lattice[y0 * gridW + x1];
    const v01 = lattice[y1 * gridW + x0];
    const v11 = lattice[y1 * gridW + x1];
    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
  };
}

/**
 * 创建 fBm（分形布朗运动）采样函数：叠加 octaves 层值噪声，
 * 每层频率 ×2、振幅 ×0.5，结果归一化到 [0,1]。
 * freqX/freqY 为第一层晶格密度（freqX 同时是经度平铺周期）。
 */
function createFbm(
  seed: number,
  octaves: number,
  freqX: number,
  freqY: number
): (u: number, v: number) => number {
  const layers: Array<(u: number, v: number) => number> = [];
  const seedRand = createSeededRandom(seed);
  for (let o = 0; o < octaves; o += 1) {
    const layerSeed = Math.floor(seedRand() * 0xffffffff);
    layers.push(createValueNoise2D(layerSeed, freqX << o, freqY << o));
  }
  let totalAmp = 0;
  for (let o = 0; o < octaves; o += 1) {
    totalAmp += 1 / 2 ** o;
  }
  return (u: number, v: number): number => {
    let sum = 0;
    let amp = 1;
    for (let o = 0; o < octaves; o += 1) {
      sum += layers[o](u, v) * amp;
      amp *= 0.5;
    }
    return sum / totalAmp;
  };
}

// ---------------------------------------------------------------------------
// 逐像素基底绘制与矢量叠加辅助
// ---------------------------------------------------------------------------

/**
 * 逐像素填充不透明基底：colorAt 接收归一化坐标 (u, v)，
 * u = 经度比例 [0,1)，v = 纬度比例 [0,1]（0 为北极，1 为南极）。
 */
function paintBase(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colorAt: (u: number, v: number) => Rgb
): void {
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const c = colorAt(u, v);
      const idx = (y * width + x) * 4;
      data[idx] = c.r;
      data[idx + 1] = c.g;
      data[idx + 2] = c.b;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * 撒陨石坑：暗色坑底 + 亮色坑缘（简化的撞击坑视觉），位置/大小由 seeded random 决定。
 * minR01/maxR01 为坑半径占纹理宽度的比例。
 */
function drawCraters(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  count: number,
  width: number,
  height: number,
  minR01: number,
  maxR01: number
): void {
  for (let i = 0; i < count; i += 1) {
    const cx = rand() * width;
    const cy = height * (0.06 + 0.88 * rand());
    const r = width * (minR01 + rand() * (maxR01 - minR01));
    // 坑底：半透明暗圆
    ctx.fillStyle = 'rgba(20, 15, 10, 0.28)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // 坑缘：亮色细环
    ctx.strokeStyle = 'rgba(255, 250, 240, 0.30)';
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * 柔边椭圆斑（径向渐变实现，可旋转）：用于大红斑、月海、暗斑、极冠补丁等。
 * edge01 控制实心核占比（0-1，越小边缘越柔）。
 */
function drawSoftEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  color: Rgb,
  alpha: number,
  edge01 = 0.45
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgbToCss(color, alpha));
  gradient.addColorStop(clamp01(edge01), rgbToCss(color, alpha * 0.85));
  gradient.addColorStop(1, rgbToCss(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 气态巨行星纬度条带取色：按扰动后的纬度选取条带颜色，
 * wobble 为经向噪声扰动幅度（波浪化条带边界），bright 为亮度噪声系数。
 */
function bandColorAt(
  bands: Rgb[],
  v: number,
  wobbleNoise: number,
  wobbleAmp: number,
  bright: number
): Rgb {
  const vv = clamp01(v + (wobbleNoise - 0.5) * wobbleAmp);
  const idx = Math.min(Math.floor(vv * bands.length), bands.length - 1);
  return scaleRgb(bands[idx], bright);
}

/** 纬度（度，赤道为 0，北正南负）→ v 坐标换算的逆函数：由 v 得纬度绝对值 */
function absLatitudeDeg(v: number): number {
  return Math.abs((0.5 - v) * 180);
}

// ---------------------------------------------------------------------------
// 各天体表面绘制（bodyId 分支）
// ---------------------------------------------------------------------------

/** 地球：深蓝海洋 + 噪声大陆（绿/棕混合、浅海边缘）+ 噪声化极地冰盖 */
function paintEarth(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const continentNoise = createFbm(seed, 4, 10, 5);
  const detailNoise = createFbm(seed + 101, 3, 20, 10);
  const iceNoise = createFbm(seed + 202, 2, 16, 8);
  const ocean = hexToRgb('#123c6e');
  const oceanDeep = hexToRgb('#0c2c55');
  const shallow = hexToRgb('#5f93be');
  const green = hexToRgb('#5a7a4a');
  const brown = hexToRgb('#8a7a55');
  const ice = hexToRgb('#eef2f6');
  const landThreshold = 0.56;
  paintBase(ctx, width, height, (u: number, v: number): Rgb => {
    const n = continentNoise(u, v);
    const d = detailNoise(u, v);
    // 极地冰盖：|纬度| > 75°，边界用噪声扰动
    const iceEdge = 75 + (iceNoise(u, v) - 0.5) * 10;
    if (absLatitudeDeg(v) > iceEdge) {
      return scaleRgb(ice, 0.94 + d * 0.06);
    }
    if (n > landThreshold + 0.02) {
      // 大陆：绿/棕按细节噪声混合，海拔感由 n 提供
      const land = mixRgb(green, brown, smooth(clamp01((d - 0.35) * 2.2)));
      return scaleRgb(land, 0.85 + (n - landThreshold) * 1.2 + d * 0.1);
    }
    if (n > landThreshold - 0.025) {
      // 大陆边缘：浅色浅海过渡，使海岸轮廓清晰可辨
      const t = smooth(clamp01((n - (landThreshold - 0.025)) / 0.045));
      return mixRgb(ocean, shallow, t);
    }
    // 开阔海洋：深浅随噪声轻微变化
    return mixRgb(oceanDeep, ocean, clamp01(n / landThreshold));
  });
}

/** 火星：红橙基底 fBm 明暗 + 小极冠 + 赤道偏南的水手号峡谷暗带 */
function paintMars(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 4, 12, 6);
  const iceNoise = createFbm(seed + 77, 2, 16, 8);
  const base = hexToRgb('#c1572f');
  const dark = hexToRgb('#8a3c20');
  const cap = hexToRgb('#f2ede6');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => {
    const iceEdge = 81 + (iceNoise(u, v) - 0.5) * 6;
    if (absLatitudeDeg(v) > iceEdge) {
      return cap;
    }
    const n = fbm(u, v);
    return scaleRgb(mixRgb(dark, base, n), 0.86 + n * 0.28);
  });
  // 水手号峡谷：赤道偏南（约 -8°，v≈0.545）横向细长暗带，位置固定保证辨识度
  const canyonRand = createSeededRandom(seed + 300);
  const canyonY = height * 0.545;
  const canyonColor = hexToRgb('#5a2814');
  for (let i = 0; i < 9; i += 1) {
    const t = i / 8;
    const cx = width * (0.22 + 0.24 * t);
    const cy = canyonY + Math.sin(t * Math.PI) * height * 0.012 + (canyonRand() - 0.5) * height * 0.008;
    drawSoftEllipse(ctx, cx, cy, width * (0.02 + canyonRand() * 0.012), height * 0.016, 0, canyonColor, 0.75, 0.35);
  }
}

/** 气态巨行星（木星/土星共用）：噪声波浪化的水平云带 + 亮度噪声 */
function paintGasBands(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  bands: Rgb[],
  wobbleAmp: number,
  brightAmp: number
): void {
  const wobble = createFbm(seed, 3, 8, 4);
  const brightNoise = createFbm(seed + 55, 3, 16, 8);
  paintBase(ctx, width, height, (u: number, v: number): Rgb => {
    const bright = 1 - brightAmp / 2 + brightNoise(u, v) * brightAmp;
    return bandColorAt(bands, v, wobble(u, v), wobbleAmp, bright);
  });
}

/** 木星：8-10 条奶油/棕/白交替云带 + 南纬约 20° 大红斑（约宽度 8%） */
function paintJupiter(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const bands = [
    '#e8d9b8',
    '#a67c52',
    '#f0e6d0',
    '#b5834f',
    '#e8d9b8',
    '#caa06a',
    '#f0e6d0',
    '#a67c52',
    '#e8d9b8',
    '#c19a63',
  ].map(hexToRgb);
  paintGasBands(ctx, width, height, seed, bands, 0.06, 0.12);
  // 大红斑：南纬约 20°（v≈0.61），直径约宽度 8%，先画同色系晕圈再画本体
  const spotX = width * 0.68;
  const spotY = height * 0.61;
  const spotRx = width * 0.04;
  const spotRy = spotRx * 0.62;
  drawSoftEllipse(ctx, spotX, spotY, spotRx * 1.7, spotRy * 1.8, 0, hexToRgb('#d9a06a'), 0.5, 0.3);
  drawSoftEllipse(ctx, spotX, spotY, spotRx, spotRy, 0, hexToRgb('#b5502e'), 0.95, 0.55);
  drawSoftEllipse(ctx, spotX, spotY, spotRx * 0.45, spotRy * 0.45, 0, hexToRgb('#c96a42'), 0.8, 0.4);
}

/** 土星：与木星同构但对比更低、更柔和的淡金色条带 */
function paintSaturn(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const bands = [
    '#d8c193',
    '#cbb385',
    '#e0cda4',
    '#d2ba8c',
    '#dcc79c',
    '#c8ae7e',
    '#e2d0ac',
    '#d5bd90',
  ].map(hexToRgb);
  paintGasBands(ctx, width, height, seed, bands, 0.04, 0.06);
}

/** 金星：均匀淡黄云层 + 横向拉伸的柔和 fBm 漩涡（无地表细节） */
function paintVenus(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  // 纵向晶格密度大于横向 → 特征横向拉伸，模拟高速环流云
  const swirl = createFbm(seed, 3, 4, 10);
  const base = hexToRgb('#e8cda2');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => {
    const n = swirl(u, v);
    return scaleRgb(base, 0.93 + n * 0.12);
  });
}

/** 水星：灰色基底 + 密集陨石坑 */
function paintMercury(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 3, 12, 6);
  const base = hexToRgb('#9c8e82');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.85 + fbm(u, v) * 0.3));
  drawCraters(ctx, createSeededRandom(seed + 400), 80, width, height, 0.004, 0.03);
}

/** 天王星：近均匀淡青 + 极淡横向条带 */
function paintUranus(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 2, 6, 4);
  const base = hexToRgb('#9bd4d9');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => {
    const band = 1 + Math.sin(v * Math.PI * 5) * 0.02;
    return scaleRgb(base, band * (0.98 + fbm(u, v) * 0.04));
  });
}

/** 海王星：深蓝 + 几条淡条带 + 中纬深蓝大暗斑 */
function paintNeptune(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 3, 8, 4);
  const base = hexToRgb('#4666e0');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => {
    const band = 1 + Math.sin(v * Math.PI * 6) * 0.05;
    return scaleRgb(base, band * (0.92 + fbm(u, v) * 0.14));
  });
  // 大暗斑：中纬固定位置（辨识度优先）
  drawSoftEllipse(ctx, width * 0.35, height * 0.4, width * 0.05, height * 0.06, 0, hexToRgb('#223c8f'), 0.85, 0.45);
}

/** 月球：浅灰 + 月海大暗斑 + 大量陨石坑 */
function paintMoon(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 3, 12, 6);
  const base = hexToRgb('#b8b4a9');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.88 + fbm(u, v) * 0.24));
  // 月海：几个大的暗灰椭圆（先画，再撒坑）
  const mare = hexToRgb('#6f6c64');
  const mareRand = createSeededRandom(seed + 500);
  for (let i = 0; i < 5; i += 1) {
    const cx = width * (0.15 + mareRand() * 0.7);
    const cy = height * (0.3 + mareRand() * 0.4);
    drawSoftEllipse(
      ctx,
      cx,
      cy,
      width * (0.05 + mareRand() * 0.06),
      height * (0.08 + mareRand() * 0.1),
      mareRand() * Math.PI,
      mare,
      0.55,
      0.4
    );
  }
  drawCraters(ctx, createSeededRandom(seed + 501), 100, width, height, 0.003, 0.025);
}

/** 木卫一（Io）：硫磺黄 + 橙红色火山小斑点 */
function paintIo(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 3, 10, 5);
  const base = hexToRgb('#d9b13f');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.88 + fbm(u, v) * 0.24));
  const rand = createSeededRandom(seed + 600);
  const volcano = hexToRgb('#c14a1e');
  const caldera = hexToRgb('#6e2410');
  for (let i = 0; i < 30; i += 1) {
    const cx = rand() * width;
    const cy = height * (0.1 + rand() * 0.8);
    const r = width * (0.006 + rand() * 0.012);
    drawSoftEllipse(ctx, cx, cy, r * 2.2, r * 2.2, 0, volcano, 0.55, 0.3);
    drawSoftEllipse(ctx, cx, cy, r, r, 0, caldera, 0.85, 0.5);
  }
}

/** 木卫二（Europa）：米白冰壳 + 棕红色交错冰裂缝细线 */
function paintEuropa(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 3, 10, 5);
  const base = hexToRgb('#c9b696');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.94 + fbm(u, v) * 0.12));
  // 冰裂缝：随机方向的长弧线（二次贝塞尔），棕红色细线
  const rand = createSeededRandom(seed + 700);
  ctx.strokeStyle = 'rgba(150, 78, 58, 0.5)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 25; i += 1) {
    const x0 = rand() * width;
    const y0 = height * (0.08 + rand() * 0.84);
    const angle = rand() * Math.PI * 2;
    const len = width * (0.15 + rand() * 0.3);
    const x1 = x0 + Math.cos(angle) * len;
    const y1 = y0 + Math.sin(angle) * len * 0.5;
    const cx = (x0 + x1) / 2 + (rand() - 0.5) * width * 0.08;
    const cy = (y0 + y1) / 2 + (rand() - 0.5) * height * 0.12;
    ctx.lineWidth = 1 + rand() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
  }
}

/** 灰棕冰卫星（木卫三/木卫四共用）：灰棕基底 + 陨石坑（callisto 更密） */
function paintCrateredIcyMoon(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  baseHex: string,
  craterCount: number
): void {
  const fbm = createFbm(seed, 3, 12, 6);
  const base = hexToRgb(baseHex);
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.85 + fbm(u, v) * 0.3));
  drawCraters(ctx, createSeededRandom(seed + 800), craterCount, width, height, 0.003, 0.022);
}

/** 土卫六（Titan）：均匀橙色浓雾，几乎无细节（浓厚大气遮蔽地表） */
function paintTitan(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 2, 4, 3);
  const base = hexToRgb('#d79a3c');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.97 + fbm(u, v) * 0.05));
}

/** 土卫二（Enceladus）：亮白冰面 + 南极附近淡蓝"虎纹"条纹 */
function paintEnceladus(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 2, 8, 4);
  const base = hexToRgb('#eff3f6');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.95 + fbm(u, v) * 0.06));
  // 虎纹：南极附近（v≈0.88）几条大致平行的淡蓝弧线
  const rand = createSeededRandom(seed + 900);
  ctx.strokeStyle = 'rgba(140, 180, 212, 0.6)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i += 1) {
    const y = height * (0.84 + i * 0.035) + (rand() - 0.5) * height * 0.01;
    const x0 = width * (0.25 + rand() * 0.1);
    const x1 = width * (0.65 + rand() * 0.1);
    ctx.lineWidth = Math.max(1, width * 0.003);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo((x0 + x1) / 2, y - height * 0.03, x1, y);
    ctx.stroke();
  }
}

/** 冥王星：浅棕 + 大块浅色心形区域（汤博区示意）+ 暗斑 */
function paintPluto(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 3, 10, 5);
  const base = hexToRgb('#c9ad8f');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.88 + fbm(u, v) * 0.24));
  // 汤博区：心形示意 = 两个上瓣圆 + 下方收窄的椭圆，位置固定保证辨识度
  const heart = hexToRgb('#ecdfc9');
  const hx = width * 0.6;
  const hy = height * 0.52;
  drawSoftEllipse(ctx, hx - width * 0.035, hy - height * 0.035, width * 0.05, height * 0.08, 0, heart, 0.9, 0.5);
  drawSoftEllipse(ctx, hx + width * 0.035, hy - height * 0.035, width * 0.05, height * 0.08, 0, heart, 0.9, 0.5);
  drawSoftEllipse(ctx, hx, hy + height * 0.05, width * 0.055, height * 0.11, 0, heart, 0.9, 0.5);
  // 暗斑：心形以西的暗色区域（克苏鲁区示意）
  const dark = hexToRgb('#5f4632');
  drawSoftEllipse(ctx, width * 0.3, height * 0.55, width * 0.09, height * 0.12, 0, dark, 0.55, 0.4);
  drawSoftEllipse(ctx, width * 0.12, height * 0.5, width * 0.05, height * 0.09, 0, dark, 0.45, 0.4);
}

/** 未知天体：baseColor + fBm 明暗 + 少量陨石坑（通用岩石纹理） */
function paintGenericRock(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  baseColor: string
): void {
  const fbm = createFbm(seed, 4, 10, 5);
  const base = hexToRgb(baseColor);
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.82 + fbm(u, v) * 0.36));
  drawCraters(ctx, createSeededRandom(seed + 999), 15, width, height, 0.004, 0.02);
}

// ---------------------------------------------------------------------------
// 导出 API
// ---------------------------------------------------------------------------

/**
 * 行星/卫星表面纹理（等距圆柱投影，宽:高=2:1）。
 * width 为像素宽（高 = width/2）。未知 id 时用 baseColor 生成带噪点的通用岩石纹理。
 * 确定性：seed 由 bodyId 哈希派生，同一 bodyId 必得同一纹理。
 */
export function createBodyTextureCanvas(
  bodyId: string,
  baseColor: string,
  width: number
): HTMLCanvasElement {
  const height = Math.max(2, Math.round(width / 2));
  const canvas = makeCanvas(width, height);
  const ctx = getContext2D(canvas);
  const seed = hashStringToSeed(bodyId);
  switch (bodyId) {
    case 'earth':
      paintEarth(ctx, width, height, seed);
      break;
    case 'mars':
      paintMars(ctx, width, height, seed);
      break;
    case 'jupiter':
      paintJupiter(ctx, width, height, seed);
      break;
    case 'saturn':
      paintSaturn(ctx, width, height, seed);
      break;
    case 'venus':
      paintVenus(ctx, width, height, seed);
      break;
    case 'mercury':
      paintMercury(ctx, width, height, seed);
      break;
    case 'uranus':
      paintUranus(ctx, width, height, seed);
      break;
    case 'neptune':
      paintNeptune(ctx, width, height, seed);
      break;
    case 'moon':
      paintMoon(ctx, width, height, seed);
      break;
    case 'io':
      paintIo(ctx, width, height, seed);
      break;
    case 'europa':
      paintEuropa(ctx, width, height, seed);
      break;
    case 'ganymede':
      paintCrateredIcyMoon(ctx, width, height, seed, '#8a7f70', 50);
      break;
    case 'callisto':
      paintCrateredIcyMoon(ctx, width, height, seed, '#7a6b58', 90);
      break;
    case 'titan':
      paintTitan(ctx, width, height, seed);
      break;
    case 'enceladus':
      paintEnceladus(ctx, width, height, seed);
      break;
    case 'pluto':
      paintPluto(ctx, width, height, seed);
      break;
    default:
      paintGenericRock(ctx, width, height, seed, baseColor);
      break;
  }
  return canvas;
}

/**
 * 地球云层纹理（RGBA）：透明背景上的白云，覆盖率约 40%，
 * 边缘由 fBm 平滑过渡（柔和）。供独立云层球面独立旋转使用。
 */
export function createCloudTextureCanvas(width: number, seed = 20240601): HTMLCanvasElement {
  const height = Math.max(2, Math.round(width / 2));
  const canvas = makeCanvas(width, height);
  const ctx = getContext2D(canvas);
  const fbm = createFbm(seed, 4, 8, 4);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  // 阈值 0.5、过渡带 0.18：实测覆盖率约 40%，边缘柔和
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const n = fbm(u, v);
      const alpha = smooth(clamp01((n - 0.5) / 0.18));
      const idx = (y * width + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * 行星环径向纹理条（width×8 像素横条，x 方向为环内缘→外缘）：
 * - 卡西尼缝：gapCenter01 处 alpha 显著下降（高斯凹陷）；
 * - 多条细密环纹：1D 值噪声 + 若干随机小缝；
 * - 内外缘平滑淡出。确定性 seed 由环参数派生。
 */
export function createRingTextureCanvas(
  ring: { gapCenter01: number; gapWidth01: number; color: string; opacity: number },
  width = 512
): HTMLCanvasElement {
  const height = 8;
  const canvas = makeCanvas(width, height);
  const ctx = getContext2D(canvas);
  const color = hexToRgb(ring.color);
  const seed = hashStringToSeed(
    `ring:${ring.color}:${Math.round(ring.gapCenter01 * 1000)}:${Math.round(ring.gapWidth01 * 1000)}`
  );
  const rand = createSeededRandom(seed);
  // 细密环纹：1D 值噪声晶格（48 点，smoothstep 插值）
  const latticeSize = 48;
  const lattice = new Float32Array(latticeSize + 1);
  for (let i = 0; i <= latticeSize; i += 1) {
    lattice[i] = rand();
  }
  // 若干随机窄小缝（次级环缝）
  const minorGaps: Array<{ pos: number; width: number; depth: number }> = [];
  for (let i = 0; i < 6; i += 1) {
    minorGaps.push({ pos: 0.08 + rand() * 0.84, width: 0.004 + rand() * 0.01, depth: 0.35 + rand() * 0.4 });
  }
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const halfGap = Math.max(ring.gapWidth01 / 2, 1e-4);
  for (let x = 0; x < width; x += 1) {
    const t = x / (width - 1);
    // 细密环纹亮度：值噪声插值
    const fx = t * latticeSize;
    const i0 = Math.min(Math.floor(fx), latticeSize - 1);
    const noise = lattice[i0] + (lattice[i0 + 1] - lattice[i0]) * smooth(fx - i0);
    let alpha = ring.opacity * (0.55 + 0.45 * noise);
    // 卡西尼缝：高斯凹陷，缝中心 alpha 显著下降
    const gapDist = (t - ring.gapCenter01) / halfGap;
    alpha *= 1 - 0.92 * Math.exp(-gapDist * gapDist);
    // 次级小缝
    for (const gap of minorGaps) {
      const d = (t - gap.pos) / gap.width;
      alpha *= 1 - gap.depth * Math.exp(-d * d);
    }
    // 内外缘平滑淡出
    alpha *= smooth(clamp01(t / 0.05)) * smooth(clamp01((1 - t) / 0.05));
    const a = Math.round(clamp01(alpha) * 255);
    for (let y = 0; y < height; y += 1) {
      const idx = (y * width + x) * 4;
      data[idx] = color.r;
      data[idx + 1] = color.g;
      data[idx + 2] = color.b;
      data[idx + 3] = a;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * 径向渐变光晕精灵（中心亮 → 边缘透明）：
 * 用于彗发、银河核球、标记光点等（与 Sun.tsx 光晕同风格）。
 */
export function createGlowSpriteCanvas(color: string, size = 128): HTMLCanvasElement {
  const canvas = makeCanvas(size, size);
  const ctx = getContext2D(canvas);
  const c = hexToRgb(color);
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, rgbToCss(c, 0.9));
  gradient.addColorStop(0.35, rgbToCss(c, 0.32));
  gradient.addColorStop(1, rgbToCss(c, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** 柔和光斑（星系内部构件：核球、旋臂团块等） */
function drawGlowBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: Rgb,
  alpha: number
): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, rgbToCss(color, alpha));
  gradient.addColorStop(1, rgbToCss(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** 螺旋臂：沿对数螺线撒亮团块，内亮外暗、内粗外细 */
function drawSpiralArm(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  cx: number,
  cy: number,
  size: number,
  baseAngle: number,
  startR01: number,
  windRad: number,
  tint: Rgb
): void {
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const steps = 60;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const theta = baseAngle + t * windRad;
    const r = size * 0.5 * (startR01 + (0.9 - startR01) * t ** 0.92);
    const jx = (rand() - 0.5) * size * 0.025;
    const jy = (rand() - 0.5) * size * 0.025;
    const x = cx + Math.cos(theta) * r + jx;
    const y = cy + Math.sin(theta) * r + jy;
    const blobR = size * (0.05 * (1 - t) + 0.014);
    const color = mixRgb(tint, white, (1 - t) * 0.45);
    drawGlowBlob(ctx, x, y, blobR, color, 0.16 * (1 - t * 0.75) + 0.03);
  }
}

/**
 * 星系形态精灵图（俯视，透明背景，size×size）。
 * 四类形态视觉差异明显（需求 3.1.3，不共用同一贴图）：
 * - spiral：2-3 条清晰旋臂 + 亮核；
 * - barred-spiral：中央亮棒 + 从棒两端伸出的旋臂；
 * - elliptical：光滑椭圆径向渐变（无内部结构）；
 * - irregular：不对称团块状。
 * 确定性：同一 (morphology, seed) 必得同一贴图。
 */
export function createGalaxySpriteCanvas(
  morphology: GalaxyMorphology,
  tintColor: string,
  size: number,
  seed: number
): HTMLCanvasElement {
  const canvas = makeCanvas(size, size);
  const ctx = getContext2D(canvas);
  const rand = createSeededRandom(seed);
  const tint = hexToRgb(tintColor);
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const cx = size / 2;
  const cy = size / 2;
  // 叠加发光：团块相互增亮，接近真实星光叠加
  ctx.globalCompositeOperation = 'lighter';
  switch (morphology) {
    case 'spiral': {
      // 银盘底光 + 亮核 + 2-3 条旋臂
      drawGlowBlob(ctx, cx, cy, size * 0.46, tint, 0.1);
      drawGlowBlob(ctx, cx, cy, size * 0.17, mixRgb(tint, white, 0.6), 0.85);
      drawGlowBlob(ctx, cx, cy, size * 0.07, white, 0.9);
      const armCount = 2 + Math.floor(rand() * 2);
      for (let a = 0; a < armCount; a += 1) {
        const baseAngle = (a / armCount) * Math.PI * 2 + rand() * 0.4;
        drawSpiralArm(ctx, rand, cx, cy, size, baseAngle, 0.12, Math.PI * 1.35, tint);
      }
      break;
    }
    case 'barred-spiral': {
      // 银盘底光 + 中央亮棒（旋转柔边椭圆）+ 从棒两端伸出的旋臂
      drawGlowBlob(ctx, cx, cy, size * 0.46, tint, 0.1);
      const barAngle = rand() * Math.PI;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawSoftEllipse(ctx, cx, cy, size * 0.3, size * 0.07, barAngle, mixRgb(tint, white, 0.55), 0.8, 0.3);
      ctx.restore();
      drawGlowBlob(ctx, cx, cy, size * 0.08, white, 0.9);
      // 旋臂起点在棒的两端（半径 ≈ 棒半长）
      const barHalf01 = 0.52; // 相对 size*0.5 的起始半径比例（0.26*size / 0.5*size）
      drawSpiralArm(ctx, rand, cx, cy, size, barAngle, barHalf01, Math.PI * 1.1, tint);
      drawSpiralArm(ctx, rand, cx, cy, size, barAngle + Math.PI, barHalf01, Math.PI * 1.1, tint);
      break;
    }
    case 'elliptical': {
      // 光滑椭圆径向渐变，无内部结构；轴比与方位角随 seed 变化
      const ratio = 0.55 + rand() * 0.3;
      const rot = rand() * Math.PI;
      drawSoftEllipse(ctx, cx, cy, size * 0.45, size * 0.45 * ratio, rot, tint, 0.35, 0.15);
      drawSoftEllipse(ctx, cx, cy, size * 0.28, size * 0.28 * ratio, rot, mixRgb(tint, white, 0.4), 0.55, 0.2);
      drawSoftEllipse(ctx, cx, cy, size * 0.12, size * 0.12 * ratio, rot, mixRgb(tint, white, 0.75), 0.85, 0.3);
      break;
    }
    case 'irregular': {
      // 不对称团块：整体质心偏移 + 随机分布的亮团块，无对称结构
      const offX = (rand() - 0.5) * size * 0.16;
      const offY = (rand() - 0.5) * size * 0.16;
      const clumpCount = 14 + Math.floor(rand() * 6);
      for (let i = 0; i < clumpCount; i += 1) {
        const ang = rand() * Math.PI * 2;
        const dist = rand() * size * 0.3;
        const x = cx + offX + Math.cos(ang) * dist;
        const y = cy + offY + Math.sin(ang) * dist * (0.6 + rand() * 0.6);
        const r = size * (0.04 + rand() * 0.09);
        const color = mixRgb(tint, white, rand() * 0.5);
        drawGlowBlob(ctx, x, y, r, color, 0.2 + rand() * 0.25);
      }
      // 少量亮结点（恒星形成区示意）
      for (let i = 0; i < 4; i += 1) {
        const x = cx + offX + (rand() - 0.5) * size * 0.4;
        const y = cy + offY + (rand() - 0.5) * size * 0.4;
        drawGlowBlob(ctx, x, y, size * 0.03, white, 0.6);
      }
      break;
    }
  }
  return canvas;
}
