/**
 * R5-1 烘焙管线纯逻辑单测：PNG 编解码 / WCS / 前景星去除 / 遮罩修补 /
 * 倾角反投影（合成盘反投影恢复圆形）/ 通道归一化 / 尘埃遮罩 / 贴图羽化
 *
 * 登记：scripts/ 不计入 src 覆盖率 gate（jest collectCoverageFrom 仅 src），
 * 本套件验证烘焙纯函数行为正确性（§R5-1 验收"反投影纯函数单测"落点）。
 */

import { decodePng, encodePng, type RasterImage } from '../pngCodec.ts';
import {
  annulusAxisRatio,
  boxBlur,
  buildDustMask,
  buildSpriteRgba,
  cropMapFn,
  deprojectMapFn,
  estimateBorderBackground,
  luminance,
  maskContaminants,
  normalizeColorTint,
  normalizeDensity,
  percentileValue,
  removeForegroundStars,
  resampleRegion,
  rgbToLuma,
  skyToPixel,
} from '../galaxyMapsCore.ts';

/** 构造 RGB 图（fill 返回 [r,g,b]） */
function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number],
): RasterImage {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y);
      data[(y * width + x) * 3] = r;
      data[(y * width + x) * 3 + 1] = g;
      data[(y * width + x) * 3 + 2] = b;
    }
  }
  return { width, height, channels: 3, data };
}

describe('pngCodec：编解码往返', () => {
  it.each([1, 3, 4] as const)('channels=%d 编码→解码逐字节一致', (channels) => {
    const width = 23;
    const height = 17;
    const data = new Uint8Array(width * height * channels);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (i * 37 + ((i * i) % 251)) % 256;
    }
    const image: RasterImage = { width, height, channels, data };
    const decoded = decodePng(encodePng(image));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.channels).toBe(channels);
    expect(Buffer.from(decoded.data)).toEqual(Buffer.from(data));
  });

  it('编码确定性：两次编码逐字节一致（幂等性基础）', () => {
    const img = makeImage(16, 16, (x, y) => [x * 10, y * 10, (x + y) * 5]);
    expect(Buffer.from(encodePng(img))).toEqual(Buffer.from(encodePng(img)));
  });

  it('拒绝非 PNG 数据与长度不符的像素数组', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
    expect(() => encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array(5) })).toThrow();
  });
});

describe('skyToPixel（TAN 投影，北上东左）', () => {
  const frame = { centerRaDeg: 100, centerDecDeg: 40, fovDeg: 4, sizePx: 1024 };

  it('中心天球坐标 → 图中心', () => {
    const p = skyToPixel(100, 40, frame);
    expect(p.x).toBeCloseTo(512, 6);
    expect(p.y).toBeCloseTo(512, 6);
  });

  it('偏北 → y 减小（北上）；偏东 → x 减小（东左）', () => {
    const north = skyToPixel(100, 40.5, frame);
    expect(north.y).toBeLessThan(512);
    expect(north.x).toBeCloseTo(512, 3);
    const east = skyToPixel(100.5, 40, frame);
    expect(east.x).toBeLessThan(512);
  });

  it('偏移量与像素比例一致（0.5° ≈ 128px @ 4°/1024px）', () => {
    const north = skyToPixel(100, 40.5, frame);
    expect(512 - north.y).toBeCloseTo(128, 0);
  });
});

describe('removeForegroundStars（局部中值对比钳制）', () => {
  it('孤立点源被替换为局部中值；平坦背景不变', () => {
    const img = makeImage(21, 21, (x, y) => (x === 10 && y === 10 ? [250, 250, 250] : [40, 40, 40]));
    const out = removeForegroundStars(img, { radius: 2, contrastFactor: 1.32, contrastBias: 13 });
    const c = (x: number, y: number): number => out.data[(y * 21 + x) * 3];
    expect(c(10, 10)).toBe(40);
    expect(c(3, 3)).toBe(40);
  });

  it('延展亮结构（7×7 亮块中心）抬高局部中值而保留', () => {
    const img = makeImage(21, 21, (x, y) =>
      Math.abs(x - 10) <= 3 && Math.abs(y - 10) <= 3 ? [200, 200, 200] : [40, 40, 40],
    );
    const out = removeForegroundStars(img, { radius: 2, contrastFactor: 1.32, contrastBias: 13 });
    expect(out.data[(10 * 21 + 10) * 3]).toBe(200);
  });

  it('副本语义：入参不被修改', () => {
    const img = makeImage(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 255, 255] : [10, 10, 10]));
    removeForegroundStars(img, { radius: 2, contrastFactor: 1.32, contrastBias: 13 });
    expect(img.data[(4 * 9 + 4) * 3]).toBe(255);
  });
});

describe('maskContaminants（归一化卷积修补）', () => {
  it('遮罩内被平滑填充（值落在邻域值域内）、遮罩外不变', () => {
    // 水平梯度背景 + 中心亮污染源
    const img = makeImage(64, 64, (x, y) =>
      Math.hypot(x - 32, y - 32) <= 6 ? [255, 255, 255] : [x * 2, x * 2, x * 2],
    );
    const out = maskContaminants(img, [{ x: 32, y: 32, radiusPx: 8 }]);
    const center = out.data[(32 * 64 + 32) * 3];
    // 填充值应接近梯度背景中值（≈64），远离污染源亮度 255
    expect(center).toBeGreaterThan(30);
    expect(center).toBeLessThan(110);
    // 遮罩外像素不变
    expect(out.data[(5 * 64 + 5) * 3]).toBe(10);
  });

  it('空遮罩列表原样返回', () => {
    const img = makeImage(8, 8, () => [7, 8, 9]);
    expect(maskContaminants(img, [])).toBe(img);
  });
});

describe('deprojectMapFn（倾角反投影，§R5-1 A）', () => {
  it('合成 60° 倾斜圆环反投影后恢复圆形（环带轴比 ≈1）', () => {
    // 天空图：盘面圆环 r01 ∈ [0.55, 0.75] 经 60° 倾角/PA 30° 投影
    const inclDeg = 60;
    const paDeg = 30;
    const cosI = Math.cos((inclDeg * Math.PI) / 180);
    const size = 512;
    const radiusPx = 200;
    const pa = (paDeg * Math.PI) / 180;
    const majXi = Math.sin(pa);
    const majEta = Math.cos(pa);
    const minXi = Math.cos(pa);
    const minEta = -Math.sin(pa);
    const img = makeImage(size, size, (x, y) => {
      // 像素 → 切平面（东左北上）→ 盘面坐标（反投影解析式）
      const xi = size / 2 - x;
      const eta = size / 2 - y;
      const u = (xi * majXi + eta * majEta) / radiusPx;
      const v = (xi * minXi + eta * minEta) / (radiusPx * cosI);
      const r01 = Math.hypot(u, v);
      return r01 >= 0.55 && r01 <= 0.75 ? [220, 220, 220] : [0, 0, 0];
    });
    const mapFn = deprojectMapFn({
      cx: size / 2,
      cy: size / 2,
      radiusPx,
      inclinationDeg: inclDeg,
      positionAngleDeg: paDeg,
      bulgeInner01: 0,
      bulgeOuter01: 1e-6,
    });
    const out = resampleRegion(img, mapFn, 128, 2, [0, 0, 0]);
    const luma = rgbToLuma(out.rgb, 128);
    const density = normalizeDensity(luma, 1, 0);
    const ratio = annulusAxisRatio(density, 128, 0.4, 0.9);
    expect(ratio).toBeGreaterThan(0.93);
    expect(ratio).toBeLessThanOrEqual(1.001);
  });

  it('倾角 0 时退化为纯裁剪（与 cropMapFn 同一像素域，仅轴向旋转）', () => {
    const mapFn = deprojectMapFn({
      cx: 512,
      cy: 512,
      radiusPx: 100,
      inclinationDeg: 0,
      positionAngleDeg: 0,
      bulgeInner01: 0,
      bulgeOuter01: 1e-6,
    });
    // PA=0：长轴 = 北（−y）；u=1 → 图上方 100px
    const p = mapFn(1, 0);
    expect(p.x).toBeCloseTo(512, 6);
    expect(p.y).toBeCloseTo(412, 6);
    // 倾角 0 → 短轴不压缩
    const q = mapFn(0, 1);
    expect(Math.hypot(q.x - 512, q.y - 512)).toBeCloseTo(100, 6);
  });

  it('核球径向缓和：核内不拉伸、核外全拉伸（77° 档）', () => {
    const mapFn = deprojectMapFn({
      cx: 0,
      cy: 0,
      radiusPx: 100,
      inclinationDeg: 77,
      positionAngleDeg: 0,
      bulgeInner01: 0.1,
      bulgeOuter01: 0.3,
    });
    const cosI = Math.cos((77 * Math.PI) / 180);
    // 核内（r01=0.05 < inner）：不压缩 → 天空偏移 = v×R
    const inner = mapFn(0, 0.05);
    expect(Math.hypot(inner.x, inner.y)).toBeCloseTo(5, 4);
    // 核外（r01=0.8 > outer）：全压缩 → 天空偏移 = v×R×cos i
    const outer = mapFn(0, 0.8);
    expect(Math.hypot(outer.x, outer.y)).toBeCloseTo(80 * cosI, 4);
  });
});

describe('cropMapFn / resampleRegion / estimateBorderBackground', () => {
  it('裁剪映射线性且背景扣除钳 ≥0', () => {
    const img = makeImage(100, 100, () => [30, 40, 50]);
    const out = resampleRegion(img, cropMapFn(50, 50, 40), 16, 2, [35, 35, 35]);
    // r 通道 30−35 → 钳 0；b 通道 50−35 = 15
    expect(out.rgb[0]).toBe(0);
    expect(out.rgb[2]).toBeCloseTo(15, 3);
  });

  it('边框背景中值：边框区亮、内区暗 → 取边框值', () => {
    const img = makeImage(100, 100, (x, y) =>
      x < 5 || x >= 95 || y < 5 || y >= 95 ? [80, 90, 100] : [10, 10, 10],
    );
    const bg = estimateBorderBackground(img, 0.03);
    expect(bg[0]).toBe(80);
    expect(bg[2]).toBe(100);
  });
});

describe('通道归一化与尘埃遮罩', () => {
  it('normalizeDensity：地板以下归零、峰值≈255、gamma 单调', () => {
    const luma = { size: 4, data: Float32Array.from([0, 2, 50, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100]) };
    const out = normalizeDensity(luma, 0.8, 0.05);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0); // 2/100 = 0.02 < 0.05 地板
    expect(out[3]).toBe(255);
    expect(out[2]).toBeGreaterThan(0);
    expect(out[2]).toBeLessThan(255);
  });

  it('normalizeDensity：全零输入返回全零（不除零）', () => {
    const luma = { size: 2, data: new Float32Array(4) };
    expect(Array.from(normalizeDensity(luma, 1, 0.05))).toEqual([0, 0, 0, 0]);
  });

  it('normalizeColorTint：饱和度增强方向正确且值域 [0,255]', () => {
    const rgb = Float32Array.from([100, 60, 30, 10, 10, 10]);
    const out = normalizeColorTint(rgb, Math.sqrt(2) as never, {
      pad: 12,
      saturationBoost: 2.0,
      gain: 0.88,
    });
    // 第一像素偏红 → 增强后 r 通道显著大于 b
    expect(out[0]).toBeGreaterThan(out[2]);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('buildDustMask：亮场中的暗带被标记、无信号背景为零', () => {
    const size = 64;
    const data = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // 左半亮场（100），其中 x∈[20,24) 一条暗带（30）；右半近零背景
        let v = 0.5;
        if (x < 32) v = x >= 20 && x < 24 ? 30 : 100;
        data[y * size + x] = v;
      }
    }
    const dust = buildDustMask(
      { size, data },
      { blurRadiusPx: 6, minSignal01: 0.05, normalizePercentile: 0.995 },
    );
    // 暗带中心显著、亮场平坦区低、近零背景为 0
    expect(dust[(32 * size + 22)]).toBeGreaterThan(120);
    expect(dust[(32 * size + 10)]).toBeLessThan(dust[32 * size + 22]);
    expect(dust[(32 * size + 56)]).toBe(0);
  });

  it('percentileValue / boxBlur 基础语义', () => {
    expect(percentileValue([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    const blurred = boxBlur({ size: 3, data: Float32Array.from([0, 0, 0, 0, 9, 0, 0, 0, 0]) }, 1);
    expect(blurred.data[4]).toBeCloseTo(1, 6);
  });

  it('luminance：Rec.709 加权', () => {
    expect(luminance(255, 0, 0)).toBeCloseTo(255 * 0.2126, 6);
    expect(luminance(0, 0, 255)).toBeCloseTo(255 * 0.0722, 6);
  });
});

describe('buildSpriteRgba（远景贴图 alpha 羽化）', () => {
  it('角点 alpha = 0（径向羽化）、中心 alpha 高、量化档位生效', () => {
    const size = 64;
    const rgb = new Float32Array(size * size * 3);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const r01 = Math.hypot((x / (size - 1)) * 2 - 1, (y / (size - 1)) * 2 - 1);
        const v = Math.max(0, 200 * (1 - r01));
        rgb[(y * size + x) * 3] = v;
        rgb[(y * size + x) * 3 + 1] = v;
        rgb[(y * size + x) * 3 + 2] = v;
      }
    }
    const sprite = buildSpriteRgba(rgb, size, {
      alphaPercentile: 0.985,
      alphaFloorPercentile: 0.55,
      alphaGamma: 0.7,
      rgbGain: 1.12,
      featherStart01: 0.78,
      quantizeLevels: 16,
    });
    expect(sprite[3]).toBe(0); // 左上角
    const centerAlpha = sprite[((size / 2) * size + size / 2) * 4 + 3];
    expect(centerAlpha).toBeGreaterThan(200);
    // 4bit 量化：全部字节 ∈ {round(k×255/15)}
    const allowed = new Set(Array.from({ length: 16 }, (_, k) => Math.round((k * 255) / 15)));
    for (let i = 0; i < sprite.length; i += 1) {
      expect(allowed.has(sprite[i])).toBe(true);
    }
  });
});

describe('annulusAxisRatio（反投影残差度量）', () => {
  function ringDensity(size: number, axisRatioY: number): Uint8Array {
    const out = new Uint8Array(size * size);
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = (x - c) / c;
        const v = (y - c) / c / axisRatioY;
        const r = Math.hypot(u, v);
        if (r >= 0.6 && r <= 0.8) out[y * size + x] = 200;
      }
    }
    return out;
  }

  it('圆环 ≈1；2:1 椭圆环显著 <1；空图为 0', () => {
    expect(annulusAxisRatio(ringDensity(128, 1), 128, 0.4, 0.95)).toBeGreaterThan(0.97);
    expect(annulusAxisRatio(ringDensity(128, 0.5), 128, 0.2, 0.95)).toBeLessThan(0.7);
    expect(annulusAxisRatio(new Uint8Array(128 * 128), 128, 0.4, 0.9)).toBe(0);
  });
});
