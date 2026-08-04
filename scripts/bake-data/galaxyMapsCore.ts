/**
 * R5-1 星系影像烘焙纯逻辑核（无 fs/IO，供 galaxyMaps.ts 与单元测试消费）
 *
 * 管线（IMPROVEMENT_REQUIREMENTS_5 §R5-1 A）：
 *   公版影像（1024² RGBA，TAN 投影北上东左）
 *     → 前景星去除（局部中值对比钳制）
 *     → 污染源遮罩（伴系/前景球状星团按天球坐标圆形遮罩 + 宿主径向剖面填充）
 *     → 背景扣除（边框中值）
 *     → 几何重采样（M31：77° 倾角反投影到盘面坐标；其余：中心裁剪）
 *     → 密度（亮度归一化）/ 颜色（色调归一化）/ 尘埃（暗带遮罩）三通道 256²
 *     → 远景贴图 512px（alpha 羽化）
 *
 * ── 方法与残差登记（附录 A §3 真实数据失真登记）─────────────────────────
 * - 反投影方法：薄盘假设——沿短轴方向按 1/cos i 拉伸（逆映射双线性采样，
 *   4×4 超采样抗混叠）；核球为球状结构不满足薄盘假设，若全图等比拉伸会被
 *   拉成雪茄状 → 采用径向缓和：r01 < bulgeInner01 不拉伸（球状近似），
 *   r01 > bulgeOuter01 全拉伸（薄盘），中间 smoothstep 过渡（几何混合档，
 *   拉伸过渡带内旋臂几何存在轻度径向畸变，登记）。
 * - 残差度量：反投影后盘环带（r01 ∈ [0.45, 0.9]）流量加权二阶矩轴比
 *   b/a——理想薄盘圆盘应 ≈1，实测值写入 meta 登记。
 * - 前景星去除为局部中值对比钳制（点源半径 ≲2px），星系内延展亮结
 *   （NGC 206/NGC 604/30 Dor）因抬高局部中值而保留；亮星残芯可能残留
 *   （登记，对 256² 降采样后不可辨）。
 */

import type { RasterImage } from './pngCodec.ts';

/** 灰度浮点图（0-1 或任意非负标度） */
export interface FloatMap {
  size: number;
  data: Float32Array;
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

const DEG_TO_RAD = Math.PI / 180;

/** Rec.709 亮度权重（sRGB 编码值上直接加权的近似档，登记） */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** smoothstep（与 GLSL 同式） */
export function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// 天球坐标 → 像素（TAN/gnomonic，北上东左，目标居中——hips2fits 约定）
// ---------------------------------------------------------------------------

export interface SkyImageFrame {
  centerRaDeg: number;
  centerDecDeg: number;
  fovDeg: number;
  sizePx: number;
}

/**
 * 天球坐标 → 像素坐标（gnomonic 切平面投影；x 右 = 西、y 下 = 南，
 * 即北上东左）。返回浮点像素（可在图外）。
 */
export function skyToPixel(
  raDeg: number,
  decDeg: number,
  frame: SkyImageFrame,
): { x: number; y: number } {
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  const ra0 = frame.centerRaDeg * DEG_TO_RAD;
  const dec0 = frame.centerDecDeg * DEG_TO_RAD;
  const cosC =
    Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
  // gnomonic 标准式（单位：弧度切平面）
  const xi = (Math.cos(dec) * Math.sin(ra - ra0)) / cosC;
  const eta =
    (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / cosC;
  const pxPerRad = frame.sizePx / (frame.fovDeg * DEG_TO_RAD);
  return {
    x: frame.sizePx / 2 - xi * pxPerRad, // 东 = −x（东左）
    y: frame.sizePx / 2 - eta * pxPerRad, // 北 = −y（北上）
  };
}

// ---------------------------------------------------------------------------
// 前景星去除（局部中值对比钳制）
// ---------------------------------------------------------------------------

/** 半径 r 窗口中值（越界钳制到边缘）；scratch 复用避免逐像素分配 */
function windowMedian(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
  ch: number,
  x: number,
  y: number,
  radius: number,
  scratch: Float64Array,
): number {
  let n = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    const yy = Math.max(0, Math.min(height - 1, y + dy));
    for (let dx = -radius; dx <= radius; dx += 1) {
      const xx = Math.max(0, Math.min(width - 1, x + dx));
      scratch[n] = data[(yy * width + xx) * channels + ch];
      n += 1;
    }
  }
  const view = scratch.subarray(0, n);
  view.sort();
  return view[n >> 1];
}

export interface StarRemovalOptions {
  /** 中值窗半径（px；点源 FWHM ~2px → 2 即 5×5 窗） */
  radius: number;
  /** 判定为点源的对比系数：L > medL×factor + bias */
  contrastFactor: number;
  contrastBias: number;
}

/**
 * 前景星去除：亮度显著高于局部中值的像素（致密点源）RGB 替换为局部
 * 各通道中值。延展结构（旋臂/HII 复合体）抬高局部中值而保留（登记）。
 */
export function removeForegroundStars(
  image: RasterImage,
  options: StarRemovalOptions,
): RasterImage {
  const { width, height, channels, data } = image;
  const out = new Uint8Array(data); // 副本语义
  const { radius, contrastFactor, contrastBias } = options;
  const windowLen = (radius * 2 + 1) ** 2;
  const scratch = new Float64Array(windowLen);
  const lumaScratch = new Float64Array(windowLen);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * channels;
      const l = luminance(data[idx], data[idx + 1], data[idx + 2]);
      // 亮度中值：窗口内逐像素亮度
      let n = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = Math.max(0, Math.min(width - 1, x + dx));
          const j = (yy * width + xx) * channels;
          lumaScratch[n] = luminance(data[j], data[j + 1], data[j + 2]);
          n += 1;
        }
      }
      const lumaView = lumaScratch.subarray(0, n);
      lumaView.sort();
      const medL = lumaView[n >> 1];
      if (l > medL * contrastFactor + contrastBias) {
        for (let ch = 0; ch < Math.min(3, channels); ch += 1) {
          out[idx + ch] = windowMedian(data, width, height, channels, ch, x, y, radius, scratch);
        }
      }
    }
  }
  return { width, height, channels, data: out };
}

// ---------------------------------------------------------------------------
// 污染源遮罩（圆形遮罩 + 宿主径向剖面填充）
// ---------------------------------------------------------------------------

export interface PixelMaskCircle {
  x: number;
  y: number;
  radiusPx: number;
}

/** 矩形域可分离盒式模糊（Float64，宽 width 高 height，钳制边界） */
function boxBlurField(
  field: Float64Array,
  width: number,
  height: number,
  radius: number,
): Float64Array {
  const tmp = new Float64Array(field.length);
  const out = new Float64Array(field.length);
  const norm = 1 / (radius * 2 + 1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let d = -radius; d <= radius; d += 1) {
        sum += field[y * width + Math.max(0, Math.min(width - 1, x + d))];
      }
      tmp[y * width + x] = sum * norm;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let d = -radius; d <= radius; d += 1) {
        sum += tmp[Math.max(0, Math.min(height - 1, y + d)) * width + x];
      }
      out[y * width + x] = sum * norm;
    }
  }
  return out;
}

/**
 * 圆形遮罩修补（归一化卷积 inpainting）：遮罩像素以"遮罩外邻域的
 * mask-aware 模糊插值"填充——blur(v·w)/blur(w)（w = 遮罩外 1/内 0，
 * 双重盒式模糊 ≈ 高斯核，半径 = 遮罩半径），边界连续且保留宿主大尺度
 * 亮度梯度（登记：填充为平滑插值近似，非真实背景恢复；伴系/前景
 * 球状星团位置的旋臂细节不可恢复，256² 降采样后不可辨）。
 */
export function maskContaminants(
  image: RasterImage,
  circles: readonly PixelMaskCircle[],
): RasterImage {
  if (circles.length === 0) return image;
  const { width, height, channels, data } = image;
  const out = new Uint8Array(data);
  // 权重图（全图一次构建；多遮罩共享）
  const w = new Float64Array(width * height).fill(1);
  for (const c of circles) {
    const x0 = Math.max(0, Math.floor(c.x - c.radiusPx));
    const x1 = Math.min(width - 1, Math.ceil(c.x + c.radiusPx));
    const y0 = Math.max(0, Math.floor(c.y - c.radiusPx));
    const y1 = Math.min(height - 1, Math.ceil(c.y + c.radiusPx));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - c.x;
        const dy = y - c.y;
        if (dx * dx + dy * dy <= c.radiusPx * c.radiusPx) w[y * width + x] = 0;
      }
    }
  }
  const radius = Math.max(4, Math.round(Math.max(...circles.map((c) => c.radiusPx)) * 0.75));
  const wBlur = boxBlurField(boxBlurField(w, width, height, radius), width, height, radius);
  for (let ch = 0; ch < 3; ch += 1) {
    const vw = new Float64Array(width * height);
    for (let i = 0; i < width * height; i += 1) {
      vw[i] = data[i * channels + ch] * w[i];
    }
    const vBlur = boxBlurField(boxBlurField(vw, width, height, radius), width, height, radius);
    for (let i = 0; i < width * height; i += 1) {
      if (w[i] === 0 && wBlur[i] > 1e-9) {
        out[i * channels + ch] = Math.max(0, Math.min(255, Math.round(vBlur[i] / wBlur[i])));
      }
    }
  }
  return { width, height, channels, data: out };
}

// ---------------------------------------------------------------------------
// 背景扣除（边框中值）
// ---------------------------------------------------------------------------

/** 边框区逐通道中值（borderFrac = 边框宽占图宽比例） */
export function estimateBorderBackground(
  image: RasterImage,
  borderFrac: number,
): [number, number, number] {
  const { width, height, channels, data } = image;
  const border = Math.max(1, Math.round(width * borderFrac));
  const values: [number[], number[], number[]] = [[], [], []];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= border && x < width - border && y >= border && y < height - border) continue;
      const idx = (y * width + x) * channels;
      for (let ch = 0; ch < 3; ch += 1) values[ch].push(data[idx + ch]);
    }
  }
  const median = (arr: number[]): number => {
    arr.sort((a, b) => a - b);
    return arr[arr.length >> 1];
  };
  return [median(values[0]), median(values[1]), median(values[2])];
}

// ---------------------------------------------------------------------------
// 几何重采样（裁剪 / 反投影，双线性 + 超采样）
// ---------------------------------------------------------------------------

/** 输出 uv ∈ [−1,1]² → 源像素坐标 的映射 */
export type ResampleMapFn = (u: number, v: number) => { x: number; y: number };

/** 双线性采样（越界返回 0） */
function bilinear(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
  ch: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = data[(y0 * width + x0) * channels + ch];
  const v10 = data[(y0 * width + x1) * channels + ch];
  const v01 = data[(y1 * width + x0) * channels + ch];
  const v11 = data[(y1 * width + x1) * channels + ch];
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

/**
 * 按映射函数重采样为 outSize² RGB 浮点图（supersample² 网格平均抗混叠；
 * 背景 bg 同步扣除并钳 ≥0）。
 */
export function resampleRegion(
  image: RasterImage,
  mapFn: ResampleMapFn,
  outSize: number,
  supersample: number,
  bg: [number, number, number],
): { size: number; rgb: Float32Array } {
  const { width, height, channels, data } = image;
  const rgb = new Float32Array(outSize * outSize * 3);
  const inv = 1 / (supersample * supersample);
  for (let row = 0; row < outSize; row += 1) {
    for (let col = 0; col < outSize; col += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const u = ((col + (sx + 0.5) / supersample) / outSize) * 2 - 1;
          const v = ((row + (sy + 0.5) / supersample) / outSize) * 2 - 1;
          const p = mapFn(u, v);
          r += bilinear(data, width, height, channels, 0, p.x, p.y);
          g += bilinear(data, width, height, channels, 1, p.x, p.y);
          b += bilinear(data, width, height, channels, 2, p.x, p.y);
        }
      }
      const idx = (row * outSize + col) * 3;
      rgb[idx] = Math.max(0, r * inv - bg[0]);
      rgb[idx + 1] = Math.max(0, g * inv - bg[1]);
      rgb[idx + 2] = Math.max(0, b * inv - bg[2]);
    }
  }
  return { size: outSize, rgb };
}

/** 中心裁剪映射（无反投影：M33/LMC/SMC 与全部远景贴图） */
export function cropMapFn(cx: number, cy: number, radiusPx: number): ResampleMapFn {
  return (u, v) => ({ x: cx + u * radiusPx, y: cy + v * radiusPx });
}

export interface DeprojectionParams {
  /** 星系中心（源图像素） */
  cx: number;
  cy: number;
  /** 盘长轴半径（源图像素；输出 u=±1 对应 ±radiusPx） */
  radiusPx: number;
  inclinationDeg: number;
  /** 长轴方位角（度，N→E） */
  positionAngleDeg: number;
  /** 核球径向缓和（r01 < inner 不拉伸、> outer 全拉伸，登记见文件头） */
  bulgeInner01: number;
  bulgeOuter01: number;
}

/**
 * 倾角反投影映射（M31 §R5-1 A）：盘面坐标 (u,v) → 天空像素。
 * 薄盘假设：短轴按 cos i 压缩（逆映射即拉伸）；核球区径向缓和。
 */
export function deprojectMapFn(params: DeprojectionParams): ResampleMapFn {
  const { cx, cy, radiusPx, inclinationDeg, positionAngleDeg, bulgeInner01, bulgeOuter01 } = params;
  const cosI = Math.cos(inclinationDeg * DEG_TO_RAD);
  const pa = positionAngleDeg * DEG_TO_RAD;
  // 天空切平面基（ξ=东, η=北）：长轴 = (sin PA, cos PA)，短轴 = (cos PA, −sin PA)
  const majXi = Math.sin(pa);
  const majEta = Math.cos(pa);
  const minXi = Math.cos(pa);
  const minEta = -Math.sin(pa);
  return (u, v) => {
    const r01 = Math.hypot(u, v);
    // 核球缓和：c=1（不压缩）→ cos i（薄盘全压缩）
    const w = smoothstep01(bulgeInner01, bulgeOuter01, r01);
    const c = 1 - (1 - cosI) * w;
    const xi = (u * majXi + v * c * minXi) * radiusPx;
    const eta = (u * majEta + v * c * minEta) * radiusPx;
    return { x: cx - xi, y: cy - eta }; // 东左北上
  };
}

// ---------------------------------------------------------------------------
// 通道提取与归一化
// ---------------------------------------------------------------------------

/** RGB 浮点图 → 亮度浮点图 */
export function rgbToLuma(rgb: Float32Array, size: number): FloatMap {
  const data = new Float32Array(size * size);
  for (let i = 0; i < size * size; i += 1) {
    data[i] = luminance(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  }
  return { size, data };
}

/** 分位数（0-1；输入非负） */
export function percentileValue(values: ArrayLike<number>, p01: number): number {
  const sorted = Float32Array.from(values as ArrayLike<number>);
  sorted.sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p01)));
  return sorted[idx];
}

/**
 * 亮度 → 密度字节图：p99.5 分位归一（防单像素定标）+ 噪声地板扣除
 * （floor01 以下归零——外围天光噪声/前景星残余不参与粒子布点）+
 * gamma 压缩（gamma < 1 抬升暗弱旋臂，逐星系配置登记）。
 */
export function normalizeDensity(luma: FloatMap, gamma: number, floor01: number): Uint8Array {
  const scale = percentileValue(luma.data, 0.995);
  const out = new Uint8Array(luma.data.length);
  if (!(scale > 0)) return out;
  for (let i = 0; i < luma.data.length; i += 1) {
    const raw = Math.min(1, luma.data[i] / scale);
    const v = Math.max(0, raw - floor01) / (1 - floor01);
    out[i] = Math.round(255 * Math.pow(v, gamma));
  }
  return out;
}

/**
 * RGB → 色调字节图：逐像素按亮度归一（tint = rgb/(L+pad)，pad 抑制
 * 暗区噪声色偏向中性）+ 饱和度增益（DSS2 彩色合成色彩偏淡，观感档登记）。
 */
export function normalizeColorTint(
  rgb: Float32Array,
  size: number,
  options: { pad: number; saturationBoost: number; gain: number },
): Uint8Array {
  const { pad, saturationBoost, gain } = options;
  const out = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i += 1) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const l = luminance(r, g, b);
    const denom = l + pad;
    let tr = ((r + pad * 0.92) / denom) * gain;
    let tg = ((g + pad * 0.92) / denom) * gain;
    let tb = ((b + pad * 0.92) / denom) * gain;
    const mean = (tr + tg + tb) / 3;
    tr = mean + (tr - mean) * saturationBoost;
    tg = mean + (tg - mean) * saturationBoost;
    tb = mean + (tb - mean) * saturationBoost;
    out[i * 3] = Math.round(255 * Math.max(0, Math.min(1, tr)));
    out[i * 3 + 1] = Math.round(255 * Math.max(0, Math.min(1, tg)));
    out[i * 3 + 2] = Math.round(255 * Math.max(0, Math.min(1, tb)));
  }
  return out;
}

/** 盒式模糊（可分离，两轴各一遍；边界钳制） */
export function boxBlur(map: FloatMap, radius: number): FloatMap {
  const { size, data } = map;
  const tmp = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  const norm = 1 / (radius * 2 + 1);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let d = -radius; d <= radius; d += 1) {
        sum += data[y * size + Math.max(0, Math.min(size - 1, x + d))];
      }
      tmp[y * size + x] = sum * norm;
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let d = -radius; d <= radius; d += 1) {
        sum += tmp[Math.max(0, Math.min(size - 1, y + d)) * size + x];
      }
      out[y * size + x] = sum * norm;
    }
  }
  return { size, data: out };
}

export interface DustMaskOptions {
  /** 大尺度平滑半径（px，256² 域） */
  blurRadiusPx: number;
  /** 信号窗下限：平滑亮度低于该值（相对 p99.5）不判尘埃（图外噪声压制） */
  minSignal01: number;
  /** 输出归一分位 */
  normalizePercentile: number;
}

/**
 * 尘埃暗带遮罩（供 R5-2 体积消光 + 本阶段尘埃粒子布点）：
 * dust = clamp(平滑亮度 − 亮度, 0) / 平滑亮度 × 信号窗——相对局部大尺度
 * 亮度的暗缺损占比（尘埃消光的经验近似档，登记）。
 */
export function buildDustMask(luma: FloatMap, options: DustMaskOptions): Uint8Array {
  const { size } = luma;
  const smooth = boxBlur(luma, options.blurRadiusPx);
  const peak = percentileValue(smooth.data, 0.995);
  const raw = new Float32Array(size * size);
  for (let i = 0; i < size * size; i += 1) {
    const s = smooth.data[i];
    const deficit = Math.max(0, s - luma.data[i]);
    const window = smoothstep01(
      options.minSignal01 * peak,
      options.minSignal01 * 2 * peak,
      s,
    );
    raw[i] = s > 0 ? (deficit / s) * window : 0;
  }
  const scale = percentileValue(raw, options.normalizePercentile);
  const out = new Uint8Array(size * size);
  if (!(scale > 0)) return out;
  for (let i = 0; i < size * size; i += 1) {
    out[i] = Math.round(255 * Math.min(1, raw[i] / scale));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 远景贴图（512px sprite，alpha 羽化）
// ---------------------------------------------------------------------------

export interface SpriteOptions {
  /** 亮度→alpha 定标分位（如 0.98） */
  alphaPercentile: number;
  /** alpha 噪声地板分位：该分位以下亮度 alpha 归零（天光噪声/板缝压制） */
  alphaFloorPercentile: number;
  /** alpha gamma（<1 抬升外围延展） */
  alphaGamma: number;
  /** RGB 增益 */
  rgbGain: number;
  /** 径向羽化起点（r01；1.0 处归零） */
  featherStart01: number;
  /** 颜色量化位深（16 级 = posterize 到 4 bit 提高 PNG 压缩率，登记） */
  quantizeLevels: number;
}

/** RGB 浮点图 → RGBA sprite 字节（亮度 alpha × 径向羽化，边缘平滑归零） */
export function buildSpriteRgba(
  rgb: Float32Array,
  size: number,
  options: SpriteOptions,
): Uint8Array {
  const luma = rgbToLuma(rgb, size);
  const scale = percentileValue(luma.data, options.alphaPercentile);
  const floor = percentileValue(luma.data, options.alphaFloorPercentile);
  const span = Math.max(1e-6, scale - floor);
  const out = new Uint8Array(size * size * 4);
  const q = options.quantizeLevels - 1;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const i = row * size + col;
      const u = (col / (size - 1)) * 2 - 1;
      const v = (row / (size - 1)) * 2 - 1;
      const r01 = Math.hypot(u, v);
      const feather = 1 - smoothstep01(options.featherStart01, 1.0, r01);
      const a01 = Math.max(0, Math.min(1, (luma.data[i] - floor) / span));
      const alpha = Math.pow(a01, options.alphaGamma) * feather;
      const norm = scale > 0 ? options.rgbGain / scale : 0;
      for (let ch = 0; ch < 3; ch += 1) {
        const c01 = Math.max(0, Math.min(1, rgb[i * 3 + ch] * norm));
        out[i * 4 + ch] = Math.round(Math.round(c01 * q) * (255 / q));
      }
      out[i * 4 + 3] = Math.round(Math.round(Math.max(0, Math.min(1, alpha)) * q) * (255 / q));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 反投影残差度量（附录 A §3 登记）
// ---------------------------------------------------------------------------

/**
 * 环带流量加权二阶矩轴比 b/a（r01 ∈ [rMin01, rMax01]）：
 * 理想圆盘反投影后 ≈1；偏离量为反投影残差登记值。
 */
export function annulusAxisRatio(
  density: Uint8Array,
  size: number,
  rMin01: number,
  rMax01: number,
): number {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let total = 0;
  const c = (size - 1) / 2;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const u = (col - c) / c;
      const v = (row - c) / c;
      const r01 = Math.hypot(u, v);
      if (r01 < rMin01 || r01 > rMax01) continue;
      const w = density[row * size + col];
      sxx += w * u * u;
      syy += w * v * v;
      sxy += w * u * v;
      total += w;
    }
  }
  if (total <= 0) return 0;
  const mxx = sxx / total;
  const myy = syy / total;
  const mxy = sxy / total;
  const tr = mxx + myy;
  const det = mxx * myy - mxy * mxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const lam1 = tr / 2 + disc;
  const lam2 = tr / 2 - disc;
  if (lam1 <= 0) return 0;
  return Math.sqrt(Math.max(0, lam2) / lam1);
}
