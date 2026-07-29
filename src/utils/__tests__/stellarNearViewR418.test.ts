/**
 * 参宿四非对称巨对流胞 + 恒星近观点缀纯逻辑测试
 * （R4-18，IMPROVEMENT_REQUIREMENTS_4 §R4-18 验收）
 *
 * 覆盖：低阶球谐扰动（周期区间/有界性/30s 演化可辨/确定性/入参校验）、
 * 球谐亮度调制（幅度线性/零幅度零回退）、衍射星芒距离窗口（单调/边界/
 * smoothstep 平滑）、色球环色温联动（红端权重单调/关键恒星档）、
 * 环几何（峰值落点 1.04×半径）与近观增量登记同步（nearView 防漂移）。
 */

import {
  BETELGEUSE_SH_AMPLITUDE_DEFAULT,
  BETELGEUSE_SH_PERIODS_SEC,
  BETELGEUSE_SH_PHASES_RAD,
  BETELGEUSE_SH_WEIGHTS,
  CHROMOSPHERE_RING_OUTSET_RATIO,
  CHROMOSPHERE_RING_PEAK_RADIUS01,
  H_ALPHA_RGB,
  STAR_NEAR_DRESS_SPRITE_COUNTS,
  STAR_SPIKE_FADE_INNER_RATIO,
  STAR_SPIKE_FULL_RATIO,
  STAR_SPIKE_SCALE_RATIO,
  applyShBrightness,
  betelgeuseShCoefficients,
  betelgeuseShPerturbation,
  chromosphereRGB,
  chromosphereRingSpriteScale,
  rgb01ToCss,
  starSpikeSpriteScale,
  starSpikeWindow01,
} from '@/utils/stellarNearView';
import { blackbodyRGB, FALLBACK_STAR_PARAMS } from '@/utils/starPhysics';
import { NEAR_VIEW_PARTICLE_INCREMENTS } from '@/utils/nearView';

/** 单位球面确定性采样方向集（fibonacci 布点，覆盖全球面） */
function sphereDirections(count: number): Array<[number, number, number]> {
  const dirs: Array<[number, number, number]> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    dirs.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return dirs;
}

describe('球谐系数 betelgeuseShCoefficients（§R4-18 需求 1）', () => {
  it('视觉周期常量全部落在需求 40–90 s 登记区间', () => {
    expect(BETELGEUSE_SH_PERIODS_SEC).toHaveLength(4);
    for (const p of BETELGEUSE_SH_PERIODS_SEC) {
      expect(p).toBeGreaterThanOrEqual(40);
      expect(p).toBeLessThanOrEqual(90);
    }
  });

  it('系数 = w_i·cos(2πt·speed/P_i + φ_i)（逐项与常量表一致）', () => {
    const t = 12.5;
    const c = betelgeuseShCoefficients(t);
    for (let i = 0; i < 4; i += 1) {
      const expected =
        BETELGEUSE_SH_WEIGHTS[i] *
        Math.cos((Math.PI * 2 * t) / BETELGEUSE_SH_PERIODS_SEC[i] + BETELGEUSE_SH_PHASES_RAD[i]);
      expect(c[i]).toBeCloseTo(expected, 12);
    }
  });

  it('确定性：同一时刻两次求值逐项一致（附录 A §2）', () => {
    expect(betelgeuseShCoefficients(33.3)).toEqual(betelgeuseShCoefficients(33.3));
  });

  it('演化速度 0 → 系数冻结；速度加倍等价时间加倍', () => {
    expect(betelgeuseShCoefficients(50, 0)).toEqual(betelgeuseShCoefficients(0, 0));
    expect(betelgeuseShCoefficients(10, 2)).toEqual(betelgeuseShCoefficients(20, 1));
  });

  it('非法输入抛 RangeError（非有限时间/负速度）', () => {
    expect(() => betelgeuseShCoefficients(Number.NaN)).toThrow(RangeError);
    expect(() => betelgeuseShCoefficients(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => betelgeuseShCoefficients(1, -0.5)).toThrow(RangeError);
    expect(() => betelgeuseShCoefficients(1, Number.NaN)).toThrow(RangeError);
  });
});

describe('球谐扰动 betelgeuseShPerturbation（shader shPerturb CPU 镜像）', () => {
  const DIRS = sphereDirections(200);

  it('全球面 × 多时刻扰动值有界 ∈ [−1, 1]', () => {
    for (const t of [0, 15, 30, 60, 120, 500]) {
      for (const [x, y, z] of DIRS) {
        const s = betelgeuseShPerturbation(x, y, z, t);
        expect(s).toBeGreaterThanOrEqual(-1);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });

  it('非归一化输入自动归一（方向等价，模长无关）', () => {
    const a = betelgeuseShPerturbation(0.3, 0.4, 0.5, 10);
    const b = betelgeuseShPerturbation(3, 4, 5, 10);
    expect(a).toBeCloseTo(b, 12);
  });

  it('30 s 间隔两帧斑块构型可辨演化（验收标准 1：全球面均方差显著）', () => {
    // 任取三组起始时刻，30s 后扰动场均方根变化 > 0.1（大尺度斑块重分布）
    for (const t0 of [0, 40, 100]) {
      let sumSq = 0;
      for (const [x, y, z] of DIRS) {
        const d = betelgeuseShPerturbation(x, y, z, t0 + 30) - betelgeuseShPerturbation(x, y, z, t0);
        sumSq += d * d;
      }
      expect(Math.sqrt(sumSq / DIRS.length)).toBeGreaterThan(0.1);
    }
  });

  it('同一时刻盘面存在亮/暗两极（不对称：极值符号相反且幅度可辨）', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const [x, y, z] of DIRS) {
      const s = betelgeuseShPerturbation(x, y, z, 20);
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    expect(max).toBeGreaterThan(0.15);
    expect(min).toBeLessThan(-0.15);
  });

  it('零向量/非有限向量抛 RangeError', () => {
    expect(() => betelgeuseShPerturbation(0, 0, 0, 1)).toThrow(RangeError);
    expect(() => betelgeuseShPerturbation(Number.NaN, 1, 0, 1)).toThrow(RangeError);
  });
});

describe('球谐亮度调制 applyShBrightness（幅度纯函数，验收标准 3）', () => {
  it('零幅度 = 行为零回退（其余 5 类恒星不受影响）', () => {
    expect(applyShBrightness(0.8, 0.7, 0)).toBe(0.8);
    expect(applyShBrightness(1.2, -1, 0)).toBe(1.2);
  });

  it('调制量随幅度线性缩放：bright·(1 + amp·s)', () => {
    expect(applyShBrightness(1, 0.5, 0.4)).toBeCloseTo(1.2, 12);
    expect(applyShBrightness(1, 0.5, 0.8)).toBeCloseTo(1.4, 12);
    expect(applyShBrightness(2, -0.5, 0.5)).toBeCloseTo(1.5, 12);
  });

  it('默认幅度 ∈ (0,1]，输出钳制非负；扰动越界内部钳制', () => {
    expect(BETELGEUSE_SH_AMPLITUDE_DEFAULT).toBeGreaterThan(0);
    expect(BETELGEUSE_SH_AMPLITUDE_DEFAULT).toBeLessThanOrEqual(1);
    expect(applyShBrightness(1, -5, 1)).toBe(0);
    expect(applyShBrightness(1, 5, 1)).toBeCloseTo(2, 12);
  });

  it('幅度不在 [0,1] 抛 RangeError', () => {
    expect(() => applyShBrightness(1, 0, -0.1)).toThrow(RangeError);
    expect(() => applyShBrightness(1, 0, 1.1)).toThrow(RangeError);
    expect(() => applyShBrightness(1, 0, Number.NaN)).toThrow(RangeError);
  });
});

describe('衍射星芒距离窗口 starSpikeWindow01（§R4-18 需求 2 + 验收标准 3）', () => {
  const R = 13; // 参宿四视觉半径（场景单位）

  it('边界：≤2.2r 全隐 0、≥4.0r 全显 1', () => {
    expect(starSpikeWindow01(0, R)).toBe(0);
    expect(starSpikeWindow01(R * STAR_SPIKE_FADE_INNER_RATIO, R)).toBe(0);
    expect(starSpikeWindow01(R * STAR_SPIKE_FULL_RATIO, R)).toBe(1);
    expect(starSpikeWindow01(R * 100, R)).toBe(1);
  });

  it('窗口内单调不减且平滑（smoothstep 中点 0.5）', () => {
    const mid = (R * (STAR_SPIKE_FADE_INNER_RATIO + STAR_SPIKE_FULL_RATIO)) / 2;
    expect(starSpikeWindow01(mid, R)).toBeCloseTo(0.5, 12);
    let prev = -1;
    for (let d = 0; d <= R * 6; d += R * 0.05) {
      const w = starSpikeWindow01(d, R);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      prev = w;
    }
  });

  it('飞往观察距离（≈6×半径）处全显——驻留视角星芒完整可见', () => {
    expect(starSpikeWindow01(R * 6, R)).toBe(1);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => starSpikeWindow01(-1, R)).toThrow(RangeError);
    expect(() => starSpikeWindow01(Number.NaN, R)).toThrow(RangeError);
    expect(() => starSpikeWindow01(10, 0)).toThrow(RangeError);
    expect(() => starSpikeWindow01(10, -2)).toThrow(RangeError);
  });

  it('星芒 sprite 边长 = STAR_SPIKE_SCALE_RATIO×半径；非法半径抛 RangeError', () => {
    expect(starSpikeSpriteScale(13)).toBe(13 * STAR_SPIKE_SCALE_RATIO);
    expect(STAR_SPIKE_SCALE_RATIO).toBeGreaterThan(5); // 长于辉光 sprite 半程（目验登记）
    expect(() => starSpikeSpriteScale(0)).toThrow(RangeError);
  });
});

describe('色球环色温联动 chromosphereRGB（§R4-18 需求 2）', () => {
  it('冷星（参宿四 3,600 K）显著向 Hα 红端偏移；热星趋近黑体基色', () => {
    const cool = chromosphereRGB(FALLBACK_STAR_PARAMS.betelgeuse.teffK);
    const coolBase = blackbodyRGB(FALLBACK_STAR_PARAMS.betelgeuse.teffK);
    // 红端混合：绿/蓝通道低于纯黑体
    expect(cool.g).toBeLessThan(coolBase.g);
    expect(cool.b).toBeLessThan(coolBase.b);
    // 热星（≥8,000 K 归零阈值）：与黑体基色逐通道一致
    for (const teff of [9940, 12100, 25200, 44700]) {
      const hot = chromosphereRGB(teff);
      const base = blackbodyRGB(teff);
      expect(hot.r).toBeCloseTo(base.r, 12);
      expect(hot.g).toBeCloseTo(base.g, 12);
      expect(hot.b).toBeCloseTo(base.b, 12);
    }
  });

  it('红色占比随 Teff 单调不增（色温联动方向正确）', () => {
    const redFraction = (teff: number): number => {
      const c = chromosphereRGB(teff);
      return c.r / (c.r + c.g + c.b);
    };
    let prev = Infinity;
    for (let teff = 3000; teff <= 50000; teff += 1000) {
      const f = redFraction(teff);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it('输出通道均 ∈ [0,1]；Hα 参考色本身合法', () => {
    for (const teff of [3000, 3600, 5960, 9940, 50000]) {
      const c = chromosphereRGB(teff);
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(H_ALPHA_RGB.r).toBe(1);
    expect(H_ALPHA_RGB.g).toBeLessThan(0.5);
  });

  it('非法 Teff 抛 RangeError（blackbodyRGB 校验透传）', () => {
    expect(() => chromosphereRGB(0)).toThrow(RangeError);
    expect(() => chromosphereRGB(Number.NaN)).toThrow(RangeError);
  });

  it('rgb01ToCss 输出 #rrggbb（canvas 贴图生成消费）且分量钳制', () => {
    expect(rgb01ToCss({ r: 1, g: 0, b: 0 })).toBe('#ff0000');
    expect(rgb01ToCss({ r: 0.5, g: 0.5, b: 0.5 })).toBe('#808080');
    expect(rgb01ToCss({ r: 2, g: -1, b: 0.2 })).toBe('#ff0033');
  });
});

describe('色球环几何（limb 外薄发射环）', () => {
  it('sprite 边长使贴图环峰值半径 = 1.04×恒星半径', () => {
    const r = 13;
    const scale = chromosphereRingSpriteScale(r);
    // 贴图峰值位于半边长 62% → 环半径 = scale/2 × 0.62
    expect((scale / 2) * CHROMOSPHERE_RING_PEAK_RADIUS01).toBeCloseTo(
      r * CHROMOSPHERE_RING_OUTSET_RATIO,
      10,
    );
    // 环峰值在恒星盘面之外（limb 外）
    expect(CHROMOSPHERE_RING_OUTSET_RATIO).toBeGreaterThan(1);
  });

  it('非法半径抛 RangeError', () => {
    expect(() => chromosphereRingSpriteScale(0)).toThrow(RangeError);
    expect(() => chromosphereRingSpriteScale(Number.NaN)).toThrow(RangeError);
  });
});

describe('近观增量登记同步（附录 A 粒子预算防漂移）', () => {
  it('5 个恒星站 sprite 计数与 nearView.NEAR_VIEW_PARTICLE_INCREMENTS 一致', () => {
    for (const [bodyId, count] of Object.entries(STAR_NEAR_DRESS_SPRITE_COUNTS)) {
      expect(NEAR_VIEW_PARTICLE_INCREMENTS[bodyId]).toBe(count);
    }
  });

  it('计数登记：普通恒星站 2（环+芒）、天狼星站 3（A 环+A 芒+B 环）', () => {
    expect(STAR_NEAR_DRESS_SPRITE_COUNTS.betelgeuse).toBe(2);
    expect(STAR_NEAR_DRESS_SPRITE_COUNTS.rigel).toBe(2);
    expect(STAR_NEAR_DRESS_SPRITE_COUNTS['delta-cephei']).toBe(2);
    expect(STAR_NEAR_DRESS_SPRITE_COUNTS['wr-124']).toBe(2);
    expect(STAR_NEAR_DRESS_SPRITE_COUNTS.sirius).toBe(3);
  });
});
