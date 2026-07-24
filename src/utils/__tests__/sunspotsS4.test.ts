/**
 * 太阳黑子群复杂度分级 / 不规则形态 / 群形态演化单测
 * （S4，IMPROVEMENT_REQUIREMENTS_SOLAR §4.7-A / §7-S4）：
 * - A1 McIntosh 简化分级（单极/双极/复杂群）+ 群展开（1 前导 + N 卫星）
 * - A2 不规则本影边界 + 丝状半影（纯逻辑镜像，shader 同款计算）
 * - A3 群形态演化（角半径生长/衰退、前导-后随自行分离、卫星先消散）
 * 不破坏 S2/S3 既有行为（成对性/纬度带/较差自转/周期门控仍由既有套件覆盖）。
 */

import {
  PENUMBRA_FIBRIL_AMP,
  SUNSPOT_GROUP_CLASS_THRESHOLDS,
  SUNSPOT_GROUP_MAX_SATELLITES,
  SUNSPOT_GROUP_SLOTS,
  SUNSPOT_GROWTH_MIN_SCALE,
  SUNSPOT_MAX_RENDERED,
  SUNSPOT_MAX_SPOTS_PER_GROUP,
  SUNSPOT_PAIR_SLOTS,
  SUNSPOT_PROPER_MOTION_FRAC,
  UMBRA_IRREGULAR_AMP,
  createSunspotGroup,
  fillSunspotGroupData,
  fillSunspotShaderData,
  penumbraFibrilOffset,
  sunspotGroupClass,
  sunspotGroupInto,
  sunspotGroupSpotCount,
  sunspotGroupState,
  sunspotGrowthScale,
  sunspotProperMotionFactor,
  sunspotSatelliteStrength,
  umbraIrregularRadius,
} from '@/utils/sunspots';

const TWO_PI = Math.PI * 2;

describe('sunspotGroupClass（McIntosh 简化分级）', () => {
  it('按阈值确定性映射到 A/B/C 三档', () => {
    // 扫描多个槽位/周期，验证仅产生三种合法分级
    const seen = new Set<string>();
    for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
      for (let cycle = 0; cycle < 40; cycle += 1) {
        const cls = sunspotGroupClass(slot, cycle);
        expect(['A', 'B', 'C']).toContain(cls);
        seen.add(cls);
      }
    }
    // 概率倾斜下三档均应出现
    expect(seen.size).toBe(3);
  });

  it('阈值单调：a < b < 1', () => {
    expect(SUNSPOT_GROUP_CLASS_THRESHOLDS.a).toBeLessThan(SUNSPOT_GROUP_CLASS_THRESHOLDS.b);
    expect(SUNSPOT_GROUP_CLASS_THRESHOLDS.b).toBeLessThan(1);
  });

  it('同 (槽位,周期) 结果确定可复现', () => {
    expect(sunspotGroupClass(2, 7)).toBe(sunspotGroupClass(2, 7));
  });
});

describe('sunspotGroupSpotCount（分级 → 群内黑子颗数）', () => {
  it('单极 A 恒为 1 颗', () => {
    expect(sunspotGroupSpotCount('A', 0)).toBe(1);
    expect(sunspotGroupSpotCount('A', 0.99)).toBe(1);
  });

  it('双极 B 恒为 2 颗', () => {
    expect(sunspotGroupSpotCount('B', 0)).toBe(2);
    expect(sunspotGroupSpotCount('B', 0.99)).toBe(2);
  });

  it('复杂 C 为 2 + [1, 最大卫星数]', () => {
    for (let i = 0; i <= 10; i += 1) {
      const roll = i / 10;
      const n = sunspotGroupSpotCount('C', roll);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(2 + SUNSPOT_GROUP_MAX_SATELLITES);
    }
  });

  it('复杂 C 卫星数钳制上限（roll=1 不越界）', () => {
    expect(sunspotGroupSpotCount('C', 1)).toBeLessThanOrEqual(2 + SUNSPOT_GROUP_MAX_SATELLITES);
  });
});

describe('sunspotGrowthScale（A3 群角半径生长/衰退）', () => {
  it('强度 0 → 下限、强度 1 → 1，单调递增', () => {
    expect(sunspotGrowthScale(0)).toBeCloseTo(SUNSPOT_GROWTH_MIN_SCALE, 6);
    expect(sunspotGrowthScale(1)).toBeCloseTo(1, 6);
    expect(sunspotGrowthScale(0.5)).toBeGreaterThan(sunspotGrowthScale(0.2));
  });

  it('输入越界钳制', () => {
    expect(sunspotGrowthScale(-1)).toBeCloseTo(SUNSPOT_GROWTH_MIN_SCALE, 6);
    expect(sunspotGrowthScale(2)).toBeCloseTo(1, 6);
  });
});

describe('sunspotProperMotionFactor（A3 前导-后随自行分离）', () => {
  it('生成时为 1、生命周期末为 1+分离比例，单调递增', () => {
    expect(sunspotProperMotionFactor(0)).toBeCloseTo(1, 6);
    expect(sunspotProperMotionFactor(1)).toBeCloseTo(1 + SUNSPOT_PROPER_MOTION_FRAC, 6);
    expect(sunspotProperMotionFactor(0.7)).toBeGreaterThan(sunspotProperMotionFactor(0.3));
  });

  it('输入越界钳制到 [0,1]', () => {
    expect(sunspotProperMotionFactor(-5)).toBeCloseTo(1, 6);
    expect(sunspotProperMotionFactor(9)).toBeCloseTo(1 + SUNSPOT_PROPER_MOTION_FRAC, 6);
  });
});

describe('sunspotSatelliteStrength（A3 卫星先消散）', () => {
  it('衰退期前卫星与主体同强度', () => {
    expect(sunspotSatelliteStrength(0.8, 0, 3, 0.3)).toBeCloseTo(0.8, 6);
    expect(sunspotSatelliteStrength(0.8, 2, 3, 0.6)).toBeCloseTo(0.8, 6);
  });

  it('衰退末外围卫星先归零（序号越大越早消散）', () => {
    const t = 0.9;
    const s0 = sunspotSatelliteStrength(1, 0, 3, t);
    const s2 = sunspotSatelliteStrength(1, 2, 3, t);
    // 序号 2（更外围）应比序号 0 更弱或已归零
    expect(s2).toBeLessThanOrEqual(s0);
  });

  it('生命周期末全部归零', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(sunspotSatelliteStrength(1, i, 3, 1)).toBe(0);
    }
  });

  it('卫星数为 0 或非正时返回 0', () => {
    expect(sunspotSatelliteStrength(1, 0, 0, 0.5)).toBe(0);
  });

  it('主体强度越界钳制', () => {
    expect(sunspotSatelliteStrength(2, 0, 3, 0.1)).toBeLessThanOrEqual(1);
    expect(sunspotSatelliteStrength(-1, 0, 3, 0.1)).toBe(0);
  });
});

describe('umbraIrregularRadius（A2 不规则本影边界）', () => {
  it('扰动幅度在 ±UMBRA_IRREGULAR_AMP 范围内', () => {
    const base = 0.05;
    for (let a = 0; a < TWO_PI; a += TWO_PI / 64) {
      const r = umbraIrregularRadius(base, a, 1.3);
      expect(r).toBeGreaterThanOrEqual(base * (1 - UMBRA_IRREGULAR_AMP - 1e-6));
      expect(r).toBeLessThanOrEqual(base * (1 + UMBRA_IRREGULAR_AMP + 1e-6));
    }
  });

  it('不同方位产生不同半径（非正圆）', () => {
    const base = 0.05;
    const r1 = umbraIrregularRadius(base, 0.3, 2);
    const r2 = umbraIrregularRadius(base, 1.9, 2);
    expect(Math.abs(r1 - r2)).toBeGreaterThan(1e-4);
  });

  it('不同种子相位不同形态', () => {
    expect(umbraIrregularRadius(0.05, 1.0, 0)).not.toBeCloseTo(
      umbraIrregularRadius(0.05, 1.0, 3.14),
      6,
    );
  });

  it('非正本影半径抛错', () => {
    expect(() => umbraIrregularRadius(0, 1, 1)).toThrow(RangeError);
    expect(() => umbraIrregularRadius(-1, 1, 1)).toThrow(RangeError);
  });
});

describe('penumbraFibrilOffset（A2 丝状半影）', () => {
  it('偏移在 ±PENUMBRA_FIBRIL_AMP 范围内', () => {
    for (let a = 0; a < TWO_PI; a += TWO_PI / 32) {
      for (let rf = 0; rf <= 1; rf += 0.25) {
        const off = penumbraFibrilOffset(a, rf, 0.6);
        expect(Math.abs(off)).toBeLessThanOrEqual(PENUMBRA_FIBRIL_AMP + 1e-6);
      }
    }
  });

  it('径向两端（0/1）包络为 0', () => {
    expect(penumbraFibrilOffset(1.0, 0, 0.5)).toBeCloseTo(0, 6);
    expect(penumbraFibrilOffset(1.0, 1, 0.5)).toBeCloseTo(0, 6);
  });

  it('径向中段包络最强（同角向条纹相位下）', () => {
    const mid = Math.abs(penumbraFibrilOffset(0.5, 0.5, 1));
    const edge = Math.abs(penumbraFibrilOffset(0.5, 0.05, 1));
    expect(mid).toBeGreaterThanOrEqual(edge);
  });

  it('输入越界钳制', () => {
    expect(() => penumbraFibrilOffset(1, -1, 2)).not.toThrow();
    expect(Math.abs(penumbraFibrilOffset(1, 5, 5))).toBeLessThanOrEqual(PENUMBRA_FIBRIL_AMP + 1e-6);
  });
});

describe('sunspotGroupInto（A1 群展开 + A3 演化整合）', () => {
  it('槽位越界抛错', () => {
    const g = createSunspotGroup();
    expect(() => sunspotGroupInto(-1, 0, g)).toThrow(RangeError);
    expect(() => sunspotGroupInto(SUNSPOT_PAIR_SLOTS, 0, g)).toThrow(RangeError);
  });

  it('活跃群 count 与分级一致（A=1 / B=2 / C≥3）', () => {
    const g = createSunspotGroup();
    let sawActive = false;
    // 扫描时间轴采样多个活跃群
    for (let d = 0; d < 600; d += 2.5) {
      for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
        if (!sunspotGroupInto(slot, d, g)) continue;
        sawActive = true;
        if (g.groupClass === 'A') expect(g.count).toBe(1);
        else if (g.groupClass === 'B') expect(g.count).toBe(2);
        else expect(g.count).toBeGreaterThanOrEqual(3);
        expect(g.count).toBeLessThanOrEqual(SUNSPOT_MAX_SPOTS_PER_GROUP);
      }
    }
    expect(sawActive).toBe(true);
  });

  it('前导/后随方向为单位矢量', () => {
    const g = createSunspotGroup();
    for (let d = 0; d < 300; d += 1.5) {
      for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
        if (!sunspotGroupInto(slot, d, g)) continue;
        const ll = Math.hypot(g.leaderDir.x, g.leaderDir.y, g.leaderDir.z);
        const fl = Math.hypot(g.followerDir.x, g.followerDir.y, g.followerDir.z);
        expect(ll).toBeCloseTo(1, 5);
        expect(fl).toBeCloseTo(1, 5);
      }
    }
  });

  it('单极 A 群前导=后随方向（中性线退化）', () => {
    const g = createSunspotGroup();
    for (let d = 0; d < 800; d += 1.5) {
      for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
        if (!sunspotGroupInto(slot, d, g)) continue;
        if (g.groupClass !== 'A') continue;
        expect(g.leaderDir.x).toBeCloseTo(g.followerDir.x, 6);
        expect(g.leaderDir.y).toBeCloseTo(g.followerDir.y, 6);
        expect(g.leaderDir.z).toBeCloseTo(g.followerDir.z, 6);
        return;
      }
    }
  });

  it('不活跃槽位返回 false 且 count 归零', () => {
    const g = createSunspotGroup();
    g.count = 99;
    // 找一个不活跃时刻/槽位
    let found = false;
    for (let d = 0; d < 200 && !found; d += 0.3) {
      for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
        if (!sunspotGroupInto(slot, d, g)) {
          expect(g.count).toBe(0);
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('sunspotGroupState 返回结构或 null', () => {
    let got = false;
    for (let d = 0; d < 200 && !got; d += 1) {
      const s = sunspotGroupState(0, d);
      if (s) {
        expect(s.spots.length).toBe(SUNSPOT_MAX_SPOTS_PER_GROUP);
        got = true;
      }
    }
    expect(got).toBe(true);
  });
});

describe('fillSunspotShaderData（S4 群展开填充）', () => {
  it('输出数组长度不足抛错', () => {
    expect(() =>
      fillSunspotShaderData(0, new Float32Array(3), new Float32Array(SUNSPOT_MAX_RENDERED * 3)),
    ).toThrow(RangeError);
  });

  it('活跃黑子数 ≤ SUNSPOT_MAX_RENDERED，方向为单位矢量，半径>0', () => {
    const dirs = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    const params = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    let maxSeen = 0;
    for (let d = 0; d < 600; d += 3) {
      const n = fillSunspotShaderData(d, dirs, params);
      expect(n).toBeLessThanOrEqual(SUNSPOT_MAX_RENDERED);
      maxSeen = Math.max(maxSeen, n);
      for (let i = 0; i < n; i += 1) {
        const len = Math.hypot(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
        expect(len).toBeCloseTo(1, 4);
        expect(params[i * 3]).toBeGreaterThan(0);
        expect(params[i * 3 + 1]).toBeGreaterThan(0);
        // A2 方位相位种子 ∈ [0, 2π)
        expect(params[i * 3 + 2]).toBeGreaterThanOrEqual(0);
        expect(params[i * 3 + 2]).toBeLessThan(TWO_PI + 1e-6);
      }
    }
    // 复杂群存在时黑子数应超过纯"5 对=10 颗"的旧上限某些时刻
    expect(maxSeen).toBeGreaterThan(2);
  });

  it('复杂群时刻黑子总数可超过 10（旧固定 2 颗上限）', () => {
    const dirs = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    const params = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    let over10 = false;
    for (let d = 0; d < 3000; d += 1.7) {
      if (fillSunspotShaderData(d, dirs, params) > 10) {
        over10 = true;
        break;
      }
    }
    expect(over10).toBe(true);
  });
});

describe('fillSunspotGroupData（S4 群级中性线填充）', () => {
  it('数组长度不足抛错', () => {
    expect(() =>
      fillSunspotGroupData(
        0,
        new Float32Array(1),
        new Float32Array(SUNSPOT_GROUP_SLOTS * 3),
        new Float32Array(SUNSPOT_GROUP_SLOTS),
      ),
    ).toThrow(RangeError);
  });

  it('活跃群数 ≤ SUNSPOT_GROUP_SLOTS，端点为单位矢量，强度 ∈ [0,1]', () => {
    const ld = new Float32Array(SUNSPOT_GROUP_SLOTS * 3);
    const fd = new Float32Array(SUNSPOT_GROUP_SLOTS * 3);
    const st = new Float32Array(SUNSPOT_GROUP_SLOTS);
    for (let d = 0; d < 600; d += 3) {
      const n = fillSunspotGroupData(d, ld, fd, st);
      expect(n).toBeLessThanOrEqual(SUNSPOT_GROUP_SLOTS);
      for (let i = 0; i < n; i += 1) {
        expect(Math.hypot(ld[i * 3], ld[i * 3 + 1], ld[i * 3 + 2])).toBeCloseTo(1, 4);
        expect(Math.hypot(fd[i * 3], fd[i * 3 + 1], fd[i * 3 + 2])).toBeCloseTo(1, 4);
        expect(st[i]).toBeGreaterThan(0);
        expect(st[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('群数与 fillSunspotShaderData 的活跃槽位一致（每活跃槽位一条中性线）', () => {
    const ld = new Float32Array(SUNSPOT_GROUP_SLOTS * 3);
    const fd = new Float32Array(SUNSPOT_GROUP_SLOTS * 3);
    const st = new Float32Array(SUNSPOT_GROUP_SLOTS);
    const g = createSunspotGroup();
    for (let d = 0; d < 400; d += 5) {
      let activeSlots = 0;
      for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
        if (sunspotGroupInto(slot, d, g)) activeSlots += 1;
      }
      expect(fillSunspotGroupData(d, ld, fd, st)).toBe(activeSlots);
    }
  });
});
