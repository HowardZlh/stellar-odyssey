/**
 * SC4-2 本星系群程序化星系色调测试（REQUIREMENTS_STAR_COLORS §SC4-2）
 *
 * 覆盖：B−V → hex 转色（格式/单调性/域外抛错）、影像贴图星系历史双色
 * 零改动红线、B−V 登记表与消费出口一致性、未登记星系回退行为。
 */

import { GALAXY_BV_COLOR_INDEX, LOCAL_GROUP_GALAXIES } from '@/data/galaxies';
import {
  LEGACY_DISK_TINT_HEX,
  LEGACY_ELLIPTICAL_TINT_HEX,
  bvTintHex,
  galaxySpriteTintHex,
  legacyGalaxyTintHex,
} from '../galaxyTint';
import { IMAGE_DRIVEN_GALAXY_IDS, isImageDrivenGalaxy } from '../galaxyNearView';
import { bvToTeffK } from '../pleiadesCatalog';
import { blackbodyRGB } from '../starPhysics';

/** hex → 0–255 RGB 三元组 */
function parseHex(hex: string): { r: number; g: number; b: number } {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

describe('SC4-2 bvTintHex（B−V → Teff → blackbodyRGB → hex）', () => {
  it('输出为合法 6 位 hex，且与转色链路逐值一致（同源断言防漂移）', () => {
    for (const bv of [0.2, 0.75, 0.88, 0.93]) {
      const c = blackbodyRGB(bvToTeffK(bv));
      const parsed = parseHex(bvTintHex(bv));
      expect(parsed.r).toBe(Math.round(c.r * 255));
      expect(parsed.g).toBe(Math.round(c.g * 255));
      expect(parsed.b).toBe(Math.round(c.b * 255));
    }
  });

  it('B−V 越大越偏红黄（R−B 单调不减，色温单调降）', () => {
    let prev = Number.NEGATIVE_INFINITY;
    for (const bv of [0.0, 0.4, 0.75, 0.85, 0.93, 1.2]) {
      const { r, b } = parseHex(bvTintHex(bv));
      expect(r - b).toBeGreaterThanOrEqual(prev);
      prev = r - b;
    }
  });

  it('非有限 B−V 抛 RangeError（bvToTeffK 域校验透传）', () => {
    expect(() => bvTintHex(Number.NaN)).toThrow(RangeError);
    expect(() => bvTintHex(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('SC4-2 galaxySpriteTintHex（GalaxyObject 程序化贴图色调唯一出口）', () => {
  it('影像贴图星系（R5-1 覆盖清单）恒返回历史双色（零改动红线）', () => {
    for (const id of IMAGE_DRIVEN_GALAXY_IDS) {
      const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id);
      expect(g).toBeDefined();
      expect(galaxySpriteTintHex(id, g!.morphology)).toBe(legacyGalaxyTintHex(g!.morphology));
    }
    // 历史双色常量与 SC4 前 Universe.tsx 硬编码逐字一致
    expect(LEGACY_ELLIPTICAL_TINT_HEX).toBe('#ffe2b8');
    expect(LEGACY_DISK_TINT_HEX).toBe('#cfd8ff');
    expect(legacyGalaxyTintHex('elliptical')).toBe('#ffe2b8');
    expect(legacyGalaxyTintHex('spiral')).toBe('#cfd8ff');
    expect(legacyGalaxyTintHex('barred-spiral')).toBe('#cfd8ff');
    expect(legacyGalaxyTintHex('irregular')).toBe('#cfd8ff');
  });

  it('登记 B−V 的程序化星系走文献转色（暖色 R>B，与 bvTintHex 同源）', () => {
    for (const [id, bv] of Object.entries(GALAXY_BV_COLOR_INDEX)) {
      const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id);
      expect(g).toBeDefined();
      const tint = galaxySpriteTintHex(id, g!.morphology);
      expect(tint).toBe(bvTintHex(bv));
      // 早型/老年星族 B−V 均 > 0.6 → 定性暖色
      const { r, b } = parseHex(tint);
      expect(r).toBeGreaterThan(b);
    }
  });

  it('未登记 B−V 的星系回退历史双色（行为与 SC4 前一致）', () => {
    expect(galaxySpriteTintHex('unknown-galaxy', 'elliptical')).toBe(LEGACY_ELLIPTICAL_TINT_HEX);
    expect(galaxySpriteTintHex('unknown-galaxy', 'spiral')).toBe(LEGACY_DISK_TINT_HEX);
  });
});

describe('SC5 星系色彩增强（程序化星系 canvas 色调路径）', () => {
  it('关闭态零回归：缺省与 enhanced=false 与 SC4-2 输出逐字一致', () => {
    for (const [id, bv] of Object.entries(GALAXY_BV_COLOR_INDEX)) {
      const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id);
      expect(galaxySpriteTintHex(id, g!.morphology, false)).toBe(bvTintHex(bv));
      expect(galaxySpriteTintHex(id, g!.morphology)).toBe(bvTintHex(bv));
    }
    expect(bvTintHex(0.75, false)).toBe(bvTintHex(0.75));
  });

  it('增强态：B−V 路径饱和提升（R−B 色差放大、色相取向不变）', () => {
    for (const [id, bv] of Object.entries(GALAXY_BV_COLOR_INDEX)) {
      const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id);
      const enhanced = galaxySpriteTintHex(id, g!.morphology, true);
      expect(enhanced).toBe(bvTintHex(bv, true));
      const base = parseHex(bvTintHex(bv));
      const boosted = parseHex(enhanced);
      // 登记 B−V 均为暖色（R>B）→ 增强后 R−B 色差不减且严格增大
      expect(boosted.r - boosted.b).toBeGreaterThan(base.r - base.b);
      expect(boosted.r).toBeGreaterThan(boosted.b);
    }
  });

  it('历史双色回退路径两模式同款（影像贴图星系/未登记 B−V 不参与开关）', () => {
    for (const id of IMAGE_DRIVEN_GALAXY_IDS) {
      const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id);
      expect(galaxySpriteTintHex(id, g!.morphology, true)).toBe(
        legacyGalaxyTintHex(g!.morphology),
      );
    }
    expect(galaxySpriteTintHex('unknown-galaxy', 'elliptical', true)).toBe(
      LEGACY_ELLIPTICAL_TINT_HEX,
    );
    expect(galaxySpriteTintHex('unknown-galaxy', 'spiral', true)).toBe(LEGACY_DISK_TINT_HEX);
  });
});

describe('SC4-2 GALAXY_BV_COLOR_INDEX 登记表完备性', () => {
  it('登记键恰为全部无影像贴图的本星系群配置星系（不多不少）', () => {
    const programmatic = LOCAL_GROUP_GALAXIES.filter((g) => !isImageDrivenGalaxy(g.id)).map(
      (g) => g.id,
    );
    expect(Object.keys(GALAXY_BV_COLOR_INDEX).sort()).toEqual([...programmatic].sort());
  });

  it('影像贴图星系不在登记表内；B−V 值在星系合理域 (0, 1.5)', () => {
    for (const id of IMAGE_DRIVEN_GALAXY_IDS) {
      expect(GALAXY_BV_COLOR_INDEX[id]).toBeUndefined();
    }
    for (const bv of Object.values(GALAXY_BV_COLOR_INDEX)) {
      expect(bv).toBeGreaterThan(0);
      expect(bv).toBeLessThan(1.5);
    }
  });
});
