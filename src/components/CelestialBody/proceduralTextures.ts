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
 * 矮行星程序化增强登记（P5 §3.4，艺术化推测部分）：
 * 阋神星/鸟神星/妊神星无探测器实拍表面图，纹理仅颜色/反照率/光谱特征
 * 基于真实观测，斑块/纹路的具体形态与位置均为艺术化推测——
 * - 阋神星：高反照率 0.96（Sicardy et al. 2011 掩星测量，太阳系反照率最高
 *   天体之一）亮白基调 + 甲烷冰霜低对比斑驳（斑块形态为推测）
 * - 鸟神星：表面甲烷/乙烷冰，观测色指数偏红 → 红棕基调 + 低对比度斑块
 *   （斑块位置为推测）
 * - 妊神星：高反照率结晶水冰亮面 + "暗红斑"（观测到的表面特征，
 *   Lacerda et al. 2008 光变曲线；斑的具体位置/形状为推测）
 * - 谷神星/冥王星：真实 NASA 贴图为首选（data/textures.ts），此处程序化
 *   版本仅为加载失败降级路径（谷神星欧卡托亮斑/冥王星心形汤博区按
 *   真实地貌大致经纬示意）
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

/**
 * 谷神星（P5，真实贴图加载失败的降级路径）：灰色多坑表面 +
 * 欧卡托撞击坑亮斑（碳酸钠沉积，约 20°N / 240°E → u≈0.665、v≈0.39）
 */
function paintCeres(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 4, 12, 6);
  const base = hexToRgb('#8f8579');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => scaleRgb(base, 0.84 + fbm(u, v) * 0.3));
  drawCraters(ctx, createSeededRandom(seed + 410), 70, width, height, 0.004, 0.025);
  // 欧卡托亮斑：暗坑底 + 中心亮白沉积（Cerealia Facula）+ 次级亮斑
  const ox = width * 0.665;
  const oy = height * 0.39;
  drawSoftEllipse(ctx, ox, oy, width * 0.022, height * 0.04, 0, hexToRgb('#4d463d'), 0.6, 0.4);
  drawSoftEllipse(ctx, ox, oy, width * 0.007, height * 0.013, 0, hexToRgb('#f5f2ea'), 0.95, 0.5);
  drawSoftEllipse(ctx, ox + width * 0.009, oy + height * 0.008, width * 0.003, height * 0.006, 0, hexToRgb('#e8e4da'), 0.8, 0.5);
}

/**
 * 阋神星（P5 程序化增强，艺术化推测已登记于文件头）：
 * 反照率 0.96 的亮白甲烷冰霜表面——高亮基调 + 低对比冰霜斑驳 + 极少陨坑
 * （冰霜持续更新覆盖表面，观测推断表面非常均匀）
 */
function paintEris(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const frost = createFbm(seed, 4, 10, 5);
  const patch = createFbm(seed + 41, 3, 5, 3);
  const bright = hexToRgb('#f7f7f3');
  const dim = hexToRgb('#dcdad2');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => {
    // 大尺度极淡斑块 + 细尺度冰霜颗粒感，整体保持高反照率
    const p = smooth(clamp01((patch(u, v) - 0.35) * 1.6));
    const c = mixRgb(dim, bright, p);
    return scaleRgb(c, 0.96 + frost(u, v) * 0.06);
  });
  // 极少量浅坑（冰霜覆盖下依稀可辨）
  drawCraters(ctx, createSeededRandom(seed + 420), 6, width, height, 0.004, 0.012);
}

/**
 * 鸟神星（P5 程序化增强，艺术化推测已登记于文件头）：
 * 表面甲烷/乙烷冰、色指数偏红——红棕基调 + 低对比度托林斑块
 */
function paintMakemake(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const fbm = createFbm(seed, 4, 8, 4);
  const tholin = createFbm(seed + 61, 3, 6, 3);
  const red = hexToRgb('#b0714e');
  const dark = hexToRgb('#8a5138');
  const pale = hexToRgb('#c9a284');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => {
    const t = smooth(clamp01((tholin(u, v) - 0.3) * 1.8));
    const c = mixRgb(mixRgb(dark, red, t), pale, smooth(clamp01((fbm(u, v) - 0.55) * 2)) * 0.35);
    return scaleRgb(c, 0.9 + fbm(u, v) * 0.18);
  });
}

/**
 * 妊神星（P5 程序化增强，艺术化推测已登记于文件头）：
 * 高反照率结晶水冰亮面 + 观测到的"暗红斑"（位置/形状为推测）
 */
function paintHaumea(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const ice = createFbm(seed, 4, 10, 5);
  const bright = hexToRgb('#f2f4f8');
  const cool = hexToRgb('#dde2ea');
  paintBase(ctx, width, height, (u: number, v: number): Rgb => {
    const n = ice(u, v);
    return scaleRgb(mixRgb(cool, bright, n), 0.94 + n * 0.08);
  });
  // 暗红斑（Dark Red Spot）：中纬单个低对比暗红区域
  const spot = hexToRgb('#9c6250');
  drawSoftEllipse(ctx, width * 0.32, height * 0.45, width * 0.07, height * 0.12, 0.3, spot, 0.4, 0.35);
  drawSoftEllipse(ctx, width * 0.32, height * 0.45, width * 0.035, height * 0.06, 0.3, spot, 0.35, 0.4);
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
    case 'ceres':
      paintCeres(ctx, width, height, seed);
      break;
    case 'eris':
      paintEris(ctx, width, height, seed);
      break;
    case 'makemake':
      paintMakemake(ctx, width, height, seed);
      break;
    case 'haumea':
      paintHaumea(ctx, width, height, seed);
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
 * 地球夜半球城市灯光纹理（RGBA，可选需求 3.1.1）：
 * 与 paintEarth 使用同一大陆噪声（同 seed 派生），灯光仅出现在大陆上；
 * 城市聚集由高频噪声决定，暖黄色点状光斑，海洋与极地无光。
 * 渲染端 shader 仅在背向太阳的半球显示。
 */
export function createNightLightsCanvas(width: number): HTMLCanvasElement {
  const height = Math.max(2, Math.round(width / 2));
  const canvas = makeCanvas(width, height);
  const ctx = getContext2D(canvas);
  const seed = hashStringToSeed('earth');
  // 与 paintEarth 完全一致的大陆噪声（保证灯光落在大陆上）
  const continentNoise = createFbm(seed, 4, 10, 5);
  const cityNoise = createFbm(seed + 303, 3, 26, 13);
  const landThreshold = 0.56;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    // 高纬度（>65°）人口稀少，灯光淡出
    const latFade = clamp01((65 - absLatitudeDeg(v)) / 12);
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const idx = (y * width + x) * 4;
      const n = continentNoise(u, v);
      let alpha = 0;
      if (n > landThreshold + 0.005 && latFade > 0) {
        // 城市聚集：高频噪声高值处形成灯光斑块；海岸附近（n 接近阈值）更密
        const city = cityNoise(u, v);
        const coastBias = 1 - clamp01((n - landThreshold) / 0.2) * 0.5;
        alpha = smooth(clamp01((city - 0.58) / 0.14)) * coastBias * latFade;
      }
      data[idx] = 255;
      data[idx + 1] = 208;
      data[idx + 2] = 132;
      data[idx + 3] = Math.round(clamp01(alpha) * 255);
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
 * 彗核岩石纹理（P4，需求 §4.7 彗核岩石质感）：
 * 深灰基底 + 多倍频噪声凹凸 + 陨坑暗斑（确定性种子随机，可复现）。
 * 彗核为太阳系反照率最低的天体之一（哈雷 ~0.04，ESA Giotto 观测），
 * 故整体基调偏暗。
 */
export function createCometNucleusTextureCanvas(seed: number, size = 256): HTMLCanvasElement {
  const canvas = makeCanvas(size, size / 2);
  const ctx = getContext2D(canvas);
  const rand = createSeededRandom(seed);
  const h = size / 2;
  // 深灰基底
  ctx.fillStyle = '#3a3835';
  ctx.fillRect(0, 0, size, h);
  // 多倍频噪声斑块（岩石凹凸明暗）
  const image = ctx.getImageData(0, 0, size, h);
  const d = image.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n =
        Math.sin(x * 0.11 + seed) * Math.sin(y * 0.13 - seed * 0.7) * 10 +
        Math.sin(x * 0.31 + y * 0.23 + seed * 1.3) * 6 +
        (rand() - 0.5) * 14;
      const i = (y * size + x) * 4;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.9));
    }
  }
  ctx.putImageData(image, 0, 0);
  // 陨坑暗斑（边缘略亮模拟坑缘受光）
  const craterCount = 26;
  for (let i = 0; i < craterCount; i += 1) {
    const cx = rand() * size;
    const cy = rand() * h;
    const r = 2 + rand() * 9;
    const dark = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    dark.addColorStop(0, 'rgba(12, 11, 10, 0.55)');
    dark.addColorStop(0.75, 'rgba(20, 19, 17, 0.28)');
    dark.addColorStop(1, 'rgba(90, 86, 80, 0.16)');
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
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

/**
 * 圆形软边粒子贴图（P6 全局粒子贴图修复，需求 3.2）：
 * 所有 PointsMaterial 统一设置此贴图消除方形粒子。中心实心、边缘柔和衰减，
 * 比 createGlowSpriteCanvas（三停光晕）中心更实，适合作为"恒星点"。
 */
export function createSoftPointCanvas(size = 64): HTMLCanvasElement {
  const canvas = makeCanvas(size, size);
  const ctx = getContext2D(canvas);
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.75, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(half, half, half, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

/**
 * 核球/银晕辉光贴图（P6 §3.3）：径向渐变基底 + fBm 噪声扰动的多层辉光，
 * 替换纯径向渐变圆斑，消除"贴图圆斑"感。确定性种子。
 */
export function createBulgeGlowCanvas(color: string, size = 256, seed = 7): HTMLCanvasElement {
  const canvas = makeCanvas(size, size);
  const ctx = getContext2D(canvas);
  const c = hexToRgb(color);
  const fbm = createFbm(seed, 4, 6, 6);
  const half = size / 2;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x - half) / half;
      const ny = (y - half) / half;
      const dist = Math.hypot(nx, ny);
      // 径向衰减（中心亮）
      const radial = Math.max(0, 1 - dist);
      // 噪声扰动辉光（团块状而非光滑圆斑）
      const n = fbm(x / size, y / size);
      const alpha = clamp01(radial * radial * (0.55 + 0.9 * n));
      const idx = (y * size + x) * 4;
      const bright = 0.7 + 0.3 * n;
      data[idx] = c.r * bright;
      data[idx + 1] = c.g * bright;
      data[idx + 2] = c.b * bright;
      data[idx + 3] = alpha * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * 衍射芒线贴图（P6 §3.2 白矮星天狼星B）：中心亮点 + 四向十字芒线
 * （观测中致密高亮点星呈现的衍射尖峰质感），程序化生成。
 */
export function createDiffractionSpikeCanvas(color: string, size = 128): HTMLCanvasElement {
  const canvas = makeCanvas(size, size);
  const ctx = getContext2D(canvas);
  const c = hexToRgb(color);
  const half = size / 2;
  // 中心核（软圆点）
  const core = ctx.createRadialGradient(half, half, 0, half, half, half * 0.28);
  core.addColorStop(0, rgbToCss(c, 1));
  core.addColorStop(1, rgbToCss(c, 0));
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);
  // 四向芒线（细长渐变条），含 45° 次级芒线
  ctx.globalCompositeOperation = 'lighter';
  const spikes = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];
  const lengths = [half * 0.95, half * 0.95, half * 0.55, half * 0.55];
  for (let i = 0; i < spikes.length; i += 1) {
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(spikes[i]);
    const len = lengths[i];
    const grad = ctx.createLinearGradient(-len, 0, len, 0);
    grad.addColorStop(0, rgbToCss(c, 0));
    grad.addColorStop(0.5, rgbToCss(c, i < 2 ? 0.7 : 0.4));
    grad.addColorStop(1, rgbToCss(c, 0));
    ctx.fillStyle = grad;
    const w = i < 2 ? size * 0.02 : size * 0.014;
    ctx.fillRect(-len, -w / 2, len * 2, w);
    ctx.restore();
  }
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
    // P6 §3.4：旋臂上散布 HII 区亮点（粉/蓝亮结点，恒星形成区）
    if (rand() < 0.16) {
      const hii: Rgb = rand() < 0.5 ? { r: 255, g: 150, b: 190 } : { r: 180, g: 210, b: 255 };
      drawGlowBlob(ctx, x, y, size * 0.02, hii, 0.5);
    }
  }
}

/**
 * 尘埃带暗弧（P6 §3.4）：沿旋臂内侧的暗色弧，普通混合下压暗底光，
 * 增强旋臂立体感（旋涡星系尘埃带特征）。
 */
function drawDustLane(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  cx: number,
  cy: number,
  size: number,
  baseAngle: number,
  windRad: number
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const steps = 48;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const theta = baseAngle + t * windRad + 0.18; // 内侧偏移
    const r = size * 0.5 * (0.16 + 0.72 * t ** 0.92);
    const x = cx + Math.cos(theta) * r;
    const y = cy + Math.sin(theta) * r;
    const blobR = size * (0.03 * (1 - t) + 0.008);
    const g = ctx.createRadialGradient(x, y, 0, x, y, blobR);
    g.addColorStop(0, `rgba(0,0,0,${0.35 * (1 - t * 0.6)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, blobR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  seed: number,
  variant?: 'm31' | 'm33'
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

  // P6 §3.4：M31/M33 专属形态（与通用旋涡星系区分）
  if (variant === 'm31') {
    // 仙女座：大而亮的核球 + 紧致缠绕旋臂 + 显著尘埃环
    drawGlowBlob(ctx, cx, cy, size * 0.5, tint, 0.12);
    drawGlowBlob(ctx, cx, cy, size * 0.22, mixRgb(tint, white, 0.55), 0.9);
    drawGlowBlob(ctx, cx, cy, size * 0.1, white, 0.95);
    for (let a = 0; a < 2; a += 1) {
      const baseAngle = a * Math.PI + 0.2;
      drawSpiralArm(ctx, rand, cx, cy, size, baseAngle, 0.2, Math.PI * 2.0, tint);
      drawDustLane(ctx, rand, cx, cy, size, baseAngle, Math.PI * 2.0);
    }
    // 显著尘埃环（Spitzer/Herschel 红外观测形态）
    drawDustLane(ctx, rand, cx, cy, size, 0.5, Math.PI * 1.6);
    return canvas;
  }
  if (variant === 'm33') {
    // 三角座：松散、絮状旋臂 + 弱核球 + 大量 HII 区亮点
    drawGlowBlob(ctx, cx, cy, size * 0.42, tint, 0.12);
    drawGlowBlob(ctx, cx, cy, size * 0.12, mixRgb(tint, white, 0.5), 0.7);
    const armCount = 3;
    for (let a = 0; a < armCount; a += 1) {
      const baseAngle = (a / armCount) * Math.PI * 2 + rand() * 0.6;
      drawSpiralArm(ctx, rand, cx, cy, size, baseAngle, 0.08, Math.PI * 1.1, tint);
    }
    // 额外散布 HII 区（三角座富含恒星形成区）
    for (let i = 0; i < 24; i += 1) {
      const ang = rand() * Math.PI * 2;
      const dist = rand() * size * 0.42;
      drawGlowBlob(
        ctx,
        cx + Math.cos(ang) * dist,
        cy + Math.sin(ang) * dist,
        size * 0.018,
        { r: 255, g: 150, b: 190 },
        0.5
      );
    }
    return canvas;
  }

  switch (morphology) {
    case 'spiral': {
      // 银盘底光 + 亮核 + 2-3 条旋臂 + 尘埃带 + HII 区亮点
      drawGlowBlob(ctx, cx, cy, size * 0.46, tint, 0.1);
      drawGlowBlob(ctx, cx, cy, size * 0.17, mixRgb(tint, white, 0.6), 0.85);
      drawGlowBlob(ctx, cx, cy, size * 0.07, white, 0.9);
      const armCount = 2 + Math.floor(rand() * 2);
      for (let a = 0; a < armCount; a += 1) {
        const baseAngle = (a / armCount) * Math.PI * 2 + rand() * 0.4;
        drawSpiralArm(ctx, rand, cx, cy, size, baseAngle, 0.12, Math.PI * 1.35, tint);
        drawDustLane(ctx, rand, cx, cy, size, baseAngle, Math.PI * 1.35);
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
      // 光度沿 de Vaucouleurs r^(1/4) 轮廓衰减（P6 §3.4）：中心陡峭、外围延展。
      // 用多层嵌套柔边椭圆逼近 r^1/4 falloff（越靠中心层越亮）。轴比/方位角随 seed。
      const ratio = 0.55 + rand() * 0.3;
      const rot = rand() * Math.PI;
      const layers = 6;
      for (let i = layers - 1; i >= 0; i -= 1) {
        const t = i / (layers - 1); // 1=外, 0=中心
        const rr = size * (0.08 + 0.4 * t);
        // de Vaucouleurs：I ∝ exp(−k·r^0.25)，归一化亮度随半径快速下降
        const bright = Math.exp(-3.0 * Math.pow(t, 0.25)) + 0.05;
        const col = mixRgb(tint, white, 0.75 * (1 - t));
        drawSoftEllipse(ctx, cx, cy, rr, rr * ratio, rot, col, Math.min(0.9, bright), 0.2);
      }
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
