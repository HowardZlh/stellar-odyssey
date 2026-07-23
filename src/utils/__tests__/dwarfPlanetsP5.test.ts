/**
 * 矮行星显示策略测试（P5 §3.2 最小可见尺寸 / §3.4 妊神星椭球）
 */

import {
  DWARF_MIN_VISUAL_RADIUS,
  HAUMEA_ELLIPSOID_AXES_KM,
  dwarfDisplayRadius,
  haumeaEllipsoidScale,
  isDwarfPlanetClassification,
} from '@/utils/dwarfPlanets';
import { MIN_VISUAL_RADIUS, realBodyRadius, visualBodyRadius } from '@/utils/scale';
import { DWARF_PLANETS } from '@/data/smallBodies';

describe('矮行星最小可见尺寸（P5 §3.2，默认模式视觉夸大已登记）', () => {
  it('钳制下限 0.42 高于全局下限 0.3 与柯伊伯带粒子尺寸 0.4', () => {
    expect(DWARF_MIN_VISUAL_RADIUS).toBe(0.42);
    expect(DWARF_MIN_VISUAL_RADIUS).toBeGreaterThan(MIN_VISUAL_RADIUS);
    expect(DWARF_MIN_VISUAL_RADIUS).toBeGreaterThan(0.4);
  });

  it('与水星 L2 视觉尺寸同量级（水星 ≈ 0.35 场景单位）', () => {
    const mercury = visualBodyRadius(2439.7);
    expect(DWARF_MIN_VISUAL_RADIUS / mercury).toBeGreaterThan(0.8);
    expect(DWARF_MIN_VISUAL_RADIUS / mercury).toBeLessThan(2);
  });

  it('默认模式：5 颗矮行星显示半径均不低于钳制下限（可辨识）', () => {
    for (const d of DWARF_PLANETS) {
      expect(dwarfDisplayRadius(d.radiusKm, false)).toBeGreaterThanOrEqual(
        DWARF_MIN_VISUAL_RADIUS,
      );
    }
  });

  it('默认模式：对数压缩值超过下限时不额外夸大（与行星公式一致）', () => {
    // 远大于矮行星的假想半径：压缩值 > 0.42，应原样返回
    expect(dwarfDisplayRadius(6000, false)).toBeCloseTo(visualBodyRadius(6000), 10);
  });

  it('真实比例模式：与八大行星同规则线性映射，不夸大（不可见属科学事实）', () => {
    for (const d of DWARF_PLANETS) {
      const real = dwarfDisplayRadius(d.radiusKm, true);
      expect(real).toBeCloseTo(realBodyRadius(d.radiusKm), 12);
      // 冥王星 1188 km ≈ 7.9e-5 场景单位，远小于可见阈值
      expect(real).toBeLessThan(1e-3);
    }
  });

  it('非法半径抛出 RangeError', () => {
    expect(() => dwarfDisplayRadius(0, false)).toThrow(RangeError);
    expect(() => dwarfDisplayRadius(-1, true)).toThrow(RangeError);
  });
});

describe('妊神星三轴椭球缩放（P5 §3.4，Ortiz et al. 2017）', () => {
  it('轴径登记为 2100×1680×1074 km', () => {
    expect(HAUMEA_ELLIPSOID_AXES_KM).toEqual({ a: 2100, b: 1680, c: 1074 });
  });

  it('缩放系数比例与真实轴比一致（x:z:y = a:b:c）', () => {
    const [sx, sy, sz] = haumeaEllipsoidScale(816);
    expect(sx / sz).toBeCloseTo(2100 / 1680, 10);
    expect(sx / sy).toBeCloseTo(2100 / 1074, 10);
  });

  it('短轴为 Y（自转轴），长轴在赤道面内（自转时翻滚可见）', () => {
    const [sx, sy, sz] = haumeaEllipsoidScale(816);
    expect(sy).toBeLessThan(sz);
    expect(sz).toBeLessThan(sx);
  });

  it('以平均半径 816 km 为基准：长半轴放大、短半轴缩小', () => {
    const [sx, sy] = haumeaEllipsoidScale(816);
    expect(sx).toBeGreaterThan(1); // 1050/816 ≈ 1.287
    expect(sy).toBeLessThan(1); // 537/816 ≈ 0.658
  });

  it('非法平均半径抛出 RangeError', () => {
    expect(() => haumeaEllipsoidScale(0)).toThrow(RangeError);
    expect(() => haumeaEllipsoidScale(-100)).toThrow(RangeError);
  });
});

describe('矮行星分类判定', () => {
  it('classificationZh 为"矮行星"时按矮行星策略处理', () => {
    expect(isDwarfPlanetClassification('矮行星')).toBe(true);
    for (const d of DWARF_PLANETS) {
      expect(isDwarfPlanetClassification(d.classificationZh)).toBe(true);
    }
  });

  it('行星（undefined）与其他分类不按矮行星处理', () => {
    expect(isDwarfPlanetClassification(undefined)).toBe(false);
    expect(isDwarfPlanetClassification('行星')).toBe(false);
  });
});
