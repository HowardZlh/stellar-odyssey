/**
 * P7 地影判定测试（§3.1 可选项：卫星进入地球本影时变暗）
 */

import {
  SHADOW_MIN_LIGHT,
  UMBRA_INNER_FACTOR,
  UMBRA_OUTER_FACTOR,
  earthShadowLight01,
  shadowDimFactor,
} from '@/utils/earthShadow';

const R = 0.56; // 地球显示半径（场景单位量级）
const SUN_DIR = { x: 1, y: 0, z: 0 }; // 行星指向太阳 +X

describe('earthShadowLight01（圆柱本影近似，登记）', () => {
  it('向阳侧全光照', () => {
    expect(earthShadowLight01({ x: 0.9, y: 0, z: 0 }, R, SUN_DIR)).toBe(1);
    expect(earthShadowLight01({ x: 0.1, y: 0.9, z: 0 }, R, SUN_DIR)).toBe(1);
  });

  it('背阳侧本影轴心为全影（0）', () => {
    expect(earthShadowLight01({ x: -0.9, y: 0, z: 0 }, R, SUN_DIR)).toBe(0);
    expect(earthShadowLight01({ x: -2, y: 0.1, z: 0 }, R, SUN_DIR)).toBe(0);
  });

  it('背阳侧但横向偏移超出半影外缘：全光照', () => {
    const perp = R * UMBRA_OUTER_FACTOR + 0.01;
    expect(earthShadowLight01({ x: -0.9, y: perp, z: 0 }, R, SUN_DIR)).toBe(1);
  });

  it('半影区间平滑过渡（0 与 1 之间单调）', () => {
    const inner = R * UMBRA_INNER_FACTOR;
    const outer = R * UMBRA_OUTER_FACTOR;
    const mid = (inner + outer) / 2;
    const light = earthShadowLight01({ x: -1, y: mid, z: 0 }, R, SUN_DIR);
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(1);
    // 越靠外越亮
    const lighter = earthShadowLight01({ x: -1, y: mid + 0.02, z: 0 }, R, SUN_DIR);
    expect(lighter).toBeGreaterThan(light);
  });

  it('晨昏切换连续：轴向 0 边界处向阳返回 1', () => {
    expect(earthShadowLight01({ x: 0, y: R * 2, z: 0 }, R, SUN_DIR)).toBe(1);
  });

  it('非法行星半径抛错', () => {
    expect(() => earthShadowLight01({ x: 1, y: 0, z: 0 }, 0, SUN_DIR)).toThrow(RangeError);
    expect(() => earthShadowLight01({ x: 1, y: 0, z: 0 }, NaN, SUN_DIR)).toThrow(RangeError);
  });
});

describe('shadowDimFactor（本影保留环境底光，登记）', () => {
  it('全光照 → 1，全影 → SHADOW_MIN_LIGHT', () => {
    expect(shadowDimFactor(1)).toBe(1);
    expect(shadowDimFactor(0)).toBe(SHADOW_MIN_LIGHT);
  });

  it('输入钳制在 [0,1]', () => {
    expect(shadowDimFactor(2)).toBe(1);
    expect(shadowDimFactor(-1)).toBe(SHADOW_MIN_LIGHT);
  });

  it('线性插值', () => {
    expect(shadowDimFactor(0.5)).toBeCloseTo(SHADOW_MIN_LIGHT + (1 - SHADOW_MIN_LIGHT) * 0.5, 10);
  });
});
