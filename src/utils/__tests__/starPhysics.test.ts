/**
 * 恒星表面物理化纯逻辑测试（R4-6，IMPROVEMENT_REQUIREMENTS_4 §R4-6 验收）
 *
 * 覆盖：黑体色温关键点（3,500 K 橙红 / 5,800 K 白黄 / 9,900 K 蓝白 /
 * 25,000 K 蓝）、临边昏暗系数档位、对流颗粒尺度单调性、
 * FALLBACK_STAR_PARAMS 与 public/data/star-params.json 烘焙产物同步。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BLACKBODY_TEFF_MAX_K,
  BLACKBODY_TEFF_MIN_K,
  FALLBACK_STAR_PARAMS,
  GRANULATION_CELL_SCALE_MAX,
  GRANULATION_CELL_SCALE_MIN,
  LIMB_DARKENING_DEFAULT_U,
  blackbodyRGB,
  granulationCellScale,
  limbDarkeningU,
  stellarSurfacePhysics,
} from '@/utils/starPhysics';
import { STAR_PARAM_KEYS, validateStarParams } from '@/utils/bakedData';

describe('blackbodyRGB 色温关键点（§R4-6 需求指定）', () => {
  it('3,500 K 橙红（r=1 > g > b，蓝分量低）', () => {
    const c = blackbodyRGB(3500);
    expect(c.r).toBe(1);
    expect(c.g).toBeGreaterThan(c.b);
    expect(c.b).toBeLessThan(0.6);
  });

  it('5,800 K 白黄（r=1 ≥ g ≥ b，整体接近白且暖）', () => {
    const c = blackbodyRGB(5800);
    expect(c.r).toBe(1);
    expect(c.g).toBeGreaterThan(0.9);
    expect(c.b).toBeGreaterThan(0.85);
    expect(c.r).toBeGreaterThan(c.b);
  });

  it('9,900 K 蓝白（b=1 > g > r，红分量仍高）', () => {
    const c = blackbodyRGB(9900);
    expect(c.b).toBe(1);
    expect(c.g).toBeGreaterThan(c.r);
    expect(c.r).toBeGreaterThan(0.75);
  });

  it('25,000 K 蓝（b=1，红分量显著低于蓝白档）', () => {
    const c = blackbodyRGB(25000);
    expect(c.b).toBe(1);
    expect(c.r).toBeLessThan(0.67);
    expect(c.r).toBeLessThan(blackbodyRGB(9900).r);
  });
});

describe('blackbodyRGB 域与插值性质', () => {
  it('输出分量均在 [0,1]', () => {
    for (let t = 3000; t <= 50000; t += 731) {
      const c = blackbodyRGB(t);
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('蓝红比 b/r 随温度单调不减（越热越蓝）', () => {
    let prev = -Infinity;
    for (let t = 3000; t <= 50000; t += 500) {
      const c = blackbodyRGB(t);
      const ratio = c.b / c.r;
      expect(ratio).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = ratio;
    }
  });

  it('域外温度钳制到边界（低于 3,000 / 高于 50,000）', () => {
    expect(blackbodyRGB(1200)).toEqual(blackbodyRGB(BLACKBODY_TEFF_MIN_K));
    expect(blackbodyRGB(90000)).toEqual(blackbodyRGB(BLACKBODY_TEFF_MAX_K));
  });

  it('采样点之间线性插值连续（相邻 1 K 差异微小）', () => {
    const a = blackbodyRGB(6499);
    const b = blackbodyRGB(6501);
    expect(Math.abs(a.r - b.r)).toBeLessThan(0.01);
    expect(Math.abs(a.g - b.g)).toBeLessThan(0.01);
    expect(Math.abs(a.b - b.b)).toBeLessThan(0.01);
  });

  it('非正 / 非有限温度抛 RangeError', () => {
    expect(() => blackbodyRGB(0)).toThrow(RangeError);
    expect(() => blackbodyRGB(-3500)).toThrow(RangeError);
    expect(() => blackbodyRGB(Number.NaN)).toThrow(RangeError);
    expect(() => blackbodyRGB(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('limbDarkeningU 光谱型档位（Claret 2000 近似档）', () => {
  it('M → K → G → F → A → B → O 档单调递减（冷星昏暗强）', () => {
    const seq = ['M', 'K', 'G', 'F', 'A', 'B', 'O'].map((s) => limbDarkeningU(s));
    for (let i = 1; i < seq.length; i += 1) {
      expect(seq[i]).toBeLessThan(seq[i - 1]);
    }
  });

  it('全档位落在 [0,1]，太阳 G 档 ≈0.6', () => {
    for (const s of ['M', 'K', 'G', 'F', 'A', 'B', 'O', 'W', 'D']) {
      const u = limbDarkeningU(s);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
    }
    expect(limbDarkeningU('G2V')).toBeCloseTo(0.65, 10);
  });

  it('白矮星 D 档为最弱档且低于 O 档（§R4-6：u 小）', () => {
    expect(limbDarkeningU('DA1.9')).toBeLessThan(limbDarkeningU('O5'));
  });

  it('解析真实光谱型字符串（烘焙产物 6 星）', () => {
    expect(limbDarkeningU('M1-M2Ia-Iab')).toBe(limbDarkeningU('M'));
    expect(limbDarkeningU('B8Ia')).toBe(limbDarkeningU('B'));
    expect(limbDarkeningU('A0mA1Va')).toBe(limbDarkeningU('A'));
    expect(limbDarkeningU('DA1.9')).toBe(limbDarkeningU('D'));
    expect(limbDarkeningU('F5Iab:+B7-8')).toBe(limbDarkeningU('F'));
    expect(limbDarkeningU('WN8h')).toBe(limbDarkeningU('W'));
  });

  it('大小写不敏感、容忍前后空格', () => {
    expect(limbDarkeningU(' m2iii ')).toBe(limbDarkeningU('M'));
  });

  it('Wolf-Rayet W 型归入 O 档高温近似（登记）', () => {
    expect(limbDarkeningU('WN8h')).toBe(limbDarkeningU('O'));
  });

  it('未识别类型回落 G 档默认值（登记）', () => {
    expect(limbDarkeningU('X9')).toBe(LIMB_DARKENING_DEFAULT_U);
    expect(limbDarkeningU('L5')).toBe(LIMB_DARKENING_DEFAULT_U);
  });

  it('空串抛 RangeError', () => {
    expect(() => limbDarkeningU('')).toThrow(RangeError);
    expect(() => limbDarkeningU('   ')).toThrow(RangeError);
  });
});

describe('granulationCellScale 对流颗粒尺度', () => {
  it('半径越大频率越低（巨星颗粒大而少）——单调不增', () => {
    const radii = [0.0084, 0.5, 1, 1.711, 11.93, 43.3, 78.9, 300, 764, 2000];
    for (let i = 1; i < radii.length; i += 1) {
      expect(granulationCellScale(radii[i])).toBeLessThanOrEqual(
        granulationCellScale(radii[i - 1]),
      );
    }
  });

  it('锚点：参宿四 764 R☉ → 2.2（P6 红巨星档现状一致）', () => {
    expect(granulationCellScale(764)).toBeCloseTo(2.2, 1);
  });

  it('输出钳制在 [2,12]（白矮星极小半径 → 上限，超巨星 → 下限）', () => {
    expect(granulationCellScale(0.0084)).toBe(GRANULATION_CELL_SCALE_MAX);
    expect(granulationCellScale(1e6)).toBe(GRANULATION_CELL_SCALE_MIN);
  });

  it('非正 / 非有限半径抛 RangeError', () => {
    expect(() => granulationCellScale(0)).toThrow(RangeError);
    expect(() => granulationCellScale(-1)).toThrow(RangeError);
    expect(() => granulationCellScale(Number.NaN)).toThrow(RangeError);
  });
});

describe('stellarSurfacePhysics 派生三元组', () => {
  it('参宿四：橙红基色 + M 档强昏暗 + 巨对流胞低频', () => {
    const p = stellarSurfacePhysics(FALLBACK_STAR_PARAMS.betelgeuse);
    expect(p.color.r).toBe(1);
    expect(p.color.b).toBeLessThan(0.6);
    expect(p.limbU).toBe(limbDarkeningU('M'));
    expect(p.cellScale).toBeCloseTo(2.2, 1);
  });

  it('天狼星 B：蓝色基色 + 白矮星最弱昏暗档 + 细密颗粒上限频率', () => {
    const p = stellarSurfacePhysics(FALLBACK_STAR_PARAMS.siriusB);
    expect(p.color.b).toBe(1);
    expect(p.color.r).toBeLessThan(0.67);
    expect(p.limbU).toBe(limbDarkeningU('D'));
    expect(p.cellScale).toBe(GRANULATION_CELL_SCALE_MAX);
  });
});

describe('FALLBACK_STAR_PARAMS 降级表（§R4-6：加载失败降级路径）', () => {
  it('键集合与 STAR_PARAM_KEYS 完全一致', () => {
    expect(Object.keys(FALLBACK_STAR_PARAMS).sort()).toEqual(
      [...STAR_PARAM_KEYS].sort(),
    );
  });

  it('与 public/data/star-params.json 烘焙产物逐字段一致（防漂移）', () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), 'public', 'data', 'star-params.json'), 'utf8'),
    ) as unknown;
    const baked = validateStarParams(raw);
    expect(baked).not.toBeNull();
    for (const key of STAR_PARAM_KEYS) {
      expect(FALLBACK_STAR_PARAMS[key]).toEqual(baked!.stars[key]);
    }
  });

  it('每星派生三元组均可求值（无抛错，数值域正确）', () => {
    for (const key of STAR_PARAM_KEYS) {
      const p = stellarSurfacePhysics(FALLBACK_STAR_PARAMS[key]);
      expect(p.limbU).toBeGreaterThan(0);
      expect(p.limbU).toBeLessThan(1);
      expect(p.cellScale).toBeGreaterThanOrEqual(GRANULATION_CELL_SCALE_MIN);
      expect(p.cellScale).toBeLessThanOrEqual(GRANULATION_CELL_SCALE_MAX);
    }
  });
});
