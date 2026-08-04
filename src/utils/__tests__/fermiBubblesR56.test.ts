/**
 * R5-6 费米气泡纯逻辑单测（IMPROVEMENT_REQUIREMENTS_5 §R5-6）
 *
 * 覆盖：双极椭球密度采样器（泡心高密 / 银道面远端零密度 / 上下对称 /
 * 盒外零 / 确定性逐点一致）、包围盒尺寸换算、各向异性光程缩放、
 * 非法输入 RangeError、64³ 纹理数据构建（单纹理双泡）。
 */

import {
  FERMI_BUBBLE_HALF_EXTENT_XZ_LY,
  FERMI_BUBBLE_HALF_EXTENT_Y_LY,
  FERMI_BUBBLE_LOBE_CENTER_Y_LY,
  FERMI_BUBBLE_LOBE_SEMI_XZ_LY,
  FERMI_BUBBLE_LOBE_SEMI_Y_LY,
  FERMI_BUBBLES_SOURCE_ZH,
  FERMI_BUBBLES_TEXTURE_SIZE,
  fermiBubblesBoxScaleUnits,
  fermiBubblesWorldStepScale,
  makeFermiBubblesSampler,
} from '@/utils/fermiBubbles';
import { buildDensityData, volumeSeed } from '@/utils/volume';

const SEED = volumeSeed('fermi-bubbles');

describe('R5-6 费米气泡密度采样器（双极椭球，Su et al. 2010 形态登记）', () => {
  const sampler = makeFermiBubblesSampler(SEED);
  const cy = FERMI_BUBBLE_LOBE_CENTER_Y_LY / FERMI_BUBBLE_HALF_EXTENT_Y_LY;

  it('南北泡心密度显著为正', () => {
    expect(sampler(0, cy, 0)).toBeGreaterThan(0.3);
    expect(sampler(0, -cy, 0)).toBeGreaterThan(0.3);
  });

  it('银道面（y=0）远离银心处零密度（双泡不覆盖盘面外缘）', () => {
    expect(sampler(0.95, 0, 0)).toBe(0);
    expect(sampler(0, 0, -0.95)).toBe(0);
  });

  it('盒角/泡外零密度', () => {
    expect(sampler(0.98, 0.98, 0.98)).toBe(0);
    expect(sampler(-0.98, -0.98, -0.98)).toBe(0);
  });

  it('双极形态（8 字侧向轮廓）：泡心纬度横向半宽 > 银道面收腰半宽', () => {
    // 泡心纬度：x = 0.55（≈6,600 ly）仍在泡内；银道面同 x 处已在颈外
    const rxLobe = sampler(0.55, cy, 0);
    const rxWaist = sampler(0.55, 0, 0);
    expect(rxLobe).toBeGreaterThan(0.1);
    expect(rxWaist).toBeLessThan(rxLobe * 0.5);
  });

  it('确定性：同种子两采样器逐点一致；不同种子斑驳调制不同', () => {
    const again = makeFermiBubblesSampler(SEED);
    const other = makeFermiBubblesSampler(SEED + 1);
    let diff = 0;
    for (const [x, y, z] of [
      [0, cy, 0],
      [0.2, cy + 0.1, -0.15],
      [-0.3, -cy, 0.2],
      [0.1, -cy - 0.2, 0.05],
    ] as const) {
      expect(sampler(x, y, z)).toBe(again(x, y, z));
      if (sampler(x, y, z) !== other(x, y, z)) diff += 1;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('非法种子抛 RangeError', () => {
    expect(() => makeFermiBubblesSampler(Number.NaN)).toThrow(RangeError);
    expect(() => makeFermiBubblesSampler(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('R5-6 费米气泡几何常量与换算', () => {
  it('形态量级（Su et al. 2010 登记）：单泡顶端 ≈ 25,500 ly、包围盒收纳双泡', () => {
    expect(FERMI_BUBBLE_LOBE_CENTER_Y_LY + FERMI_BUBBLE_LOBE_SEMI_Y_LY).toBe(25500);
    expect(FERMI_BUBBLE_HALF_EXTENT_Y_LY).toBeGreaterThan(
      FERMI_BUBBLE_LOBE_CENTER_Y_LY + FERMI_BUBBLE_LOBE_SEMI_Y_LY,
    );
    expect(FERMI_BUBBLE_HALF_EXTENT_XZ_LY).toBeGreaterThan(FERMI_BUBBLE_LOBE_SEMI_XZ_LY);
  });

  it('包围盒世界尺寸：非立方 (24,000 × 54,000 × 24,000) ly × unitsPerLy', () => {
    expect(fermiBubblesBoxScaleUnits(0.05)).toEqual([1200, 2700, 1200]);
    expect(fermiBubblesBoxScaleUnits(1)).toEqual([24000, 54000, 24000]);
  });

  it('包围盒换算非法比例抛 RangeError', () => {
    expect(() => fermiBubblesBoxScaleUnits(0)).toThrow(RangeError);
    expect(() => fermiBubblesBoxScaleUnits(-1)).toThrow(RangeError);
    expect(() => fermiBubblesBoxScaleUnits(Number.NaN)).toThrow(RangeError);
  });

  it('各向异性光程缩放：最长轴（y）归一，x/z = 24/54', () => {
    const [sx, sy, sz] = fermiBubblesWorldStepScale();
    expect(sy).toBe(1);
    expect(sx).toBeCloseTo(24000 / 54000, 9);
    expect(sz).toBe(sx);
  });

  it('数据来源文案登记 Su et al. 2010 与艺术化说明', () => {
    expect(FERMI_BUBBLES_SOURCE_ZH).toContain('Su, Slatyer & Finkbeiner 2010');
    expect(FERMI_BUBBLES_SOURCE_ZH).toContain('艺术化');
  });
});

describe('R5-6 64³ 单纹理双泡数据构建', () => {
  it('64³ R8 数据：总量正确、上下半区均有体素、逐字节确定', () => {
    const size = FERMI_BUBBLES_TEXTURE_SIZE;
    expect(size).toBe(64);
    const a = buildDensityData(size, makeFermiBubblesSampler(SEED));
    const b = buildDensityData(size, makeFermiBubblesSampler(SEED));
    expect(a.length).toBe(size * size * size);
    expect(a).toEqual(b);
    // 上半区（北泡）与下半区（南泡）各存在非零体素——单纹理双泡
    let north = 0;
    let south = 0;
    for (let zi = 0; zi < size; zi += 1) {
      for (let yi = 0; yi < size; yi += 1) {
        for (let xi = 0; xi < size; xi += 1) {
          const v = a[(zi * size + yi) * size + xi];
          if (v > 0) {
            if (yi >= size / 2) north += 1;
            else south += 1;
          }
        }
      }
    }
    expect(north).toBeGreaterThan(1000);
    expect(south).toBeGreaterThan(1000);
  });
});
