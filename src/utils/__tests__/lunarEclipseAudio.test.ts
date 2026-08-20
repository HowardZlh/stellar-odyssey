/**
 * 月食声景纯函数单测（LE 迭代 M6-1，需求 §5）：
 * - 食深归一：半影段/食外恒 0（红线 ② 的听觉侧）、偏食段单调、全食饱和；
 * - 包络：食外基线、全食最深锚点、单调性、「微妙」幅度上限（B15）；
 * - 接触点跨越：正向触发 / 反向与跳变不补播 / 缺省锚点自动跳过 /
 *   音色分组与定义序；
 * - 音色参数表：半影最轻 < 食甚 < 本影（可听化设计口径）。
 */

import type { LunarEclipseContacts } from "../bakedData";
import {
  LUNAR_AIR_BASE_GAIN,
  LUNAR_AIR_DEEP_GAIN,
  LUNAR_CHIME_MAX_FRAME_SPAN_SEC,
  LUNAR_CHIME_TONE_PARAMS,
  LUNAR_NIGHT_DEEP_FACTOR,
  LUNAR_NIGHT_PEAK_GAIN,
  emptyLunarSoundscapeGains,
  lunarChimeCrossing,
  lunarContactChimeCrossings,
  lunarEclipseDepth01,
  lunarSoundscapeGains,
} from "../lunarEclipseAudio";

/** 全食事件接触点（相对秒；2029 量级——全程 ~4h、全食段 ~102min） */
const TOTAL: LunarEclipseContacts = {
  p1: 0,
  u1: 3600,
  u2: 6600,
  max: 9660,
  u3: 12720,
  u4: 15720,
  p4: 19320,
};

/** 偏食事件（无 U2/U3；2026 量级） */
const PARTIAL: LunarEclipseContacts = {
  p1: 0,
  u1: 3300,
  u2: null,
  max: 7200,
  u3: null,
  u4: 11100,
  p4: 14400,
};

/** 半影食事件（仅 P1/食甚/P4；2027 量级） */
const PENUMBRAL: LunarEclipseContacts = {
  p1: 0,
  u1: null,
  u2: null,
  max: 6000,
  u3: null,
  u4: null,
  p4: 12000,
};

function gainsAt(umbralMag: number): { night01: number; air01: number } {
  return lunarSoundscapeGains(umbralMag, emptyLunarSoundscapeGains());
}

describe("lunarEclipseDepth01（食深归一）", () => {
  it("半影段与食外恒 0——半影段声景零变化（§1.4 红线 ② 的听觉侧）", () => {
    for (const mag of [-3, -1, -0.5, -0.05, 0]) {
      expect(lunarEclipseDepth01(mag)).toBe(0);
    }
  });

  it("全食段（食分 ≥1）饱和为 1", () => {
    for (const mag of [1, 1.2709, 1.8436, 3]) {
      expect(lunarEclipseDepth01(mag)).toBe(1);
    }
  });

  it("偏食段（0–1）严格单调上行", () => {
    let prev = lunarEclipseDepth01(0);
    for (let m = 0.05; m <= 1.0001; m += 0.05) {
      const curr = lunarEclipseDepth01(m);
      expect(curr).toBeGreaterThan(prev);
      prev = curr;
    }
  });

  it("非有限输入安全降级为 0", () => {
    expect(lunarEclipseDepth01(Number.NaN)).toBe(0);
    expect(lunarEclipseDepth01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("lunarSoundscapeGains（§5 夜声景包络）", () => {
  it("食外/半影段：夜声底噪全量、空气感为基线垫层", () => {
    for (const mag of [-2, -0.4, 0]) {
      const g = gainsAt(mag);
      expect(g.night01).toBe(1);
      expect(g.air01).toBeCloseTo(LUNAR_AIR_BASE_GAIN, 12);
    }
  });

  it("全食最深处：夜声降至残留比例、空气感抬至深档（绝不静音）", () => {
    const g = gainsAt(1.8436);
    expect(g.night01).toBeCloseTo(LUNAR_NIGHT_DEEP_FACTOR, 12);
    expect(g.air01).toBeCloseTo(LUNAR_AIR_DEEP_GAIN, 12);
    expect(g.night01).toBeGreaterThan(0);
    expect(g.air01).toBeGreaterThan(0);
  });

  it("「微妙」幅度上限（B15）：夜声层全程衰减不超过 25%，且不做日食式骤静", () => {
    expect(LUNAR_NIGHT_DEEP_FACTOR).toBeGreaterThanOrEqual(0.75);
    expect(LUNAR_NIGHT_DEEP_FACTOR).toBeLessThan(1);
    let min = 1;
    for (let m = -1; m <= 2; m += 0.01) {
      min = Math.min(min, gainsAt(m).night01);
    }
    expect(min).toBeGreaterThanOrEqual(LUNAR_NIGHT_DEEP_FACTOR - 1e-12);
  });

  it("夜声单调下行、空气感单调上行（食分递增）", () => {
    let prevNight = gainsAt(0).night01;
    let prevAir = gainsAt(0).air01;
    for (let m = 0.02; m <= 1.0001; m += 0.02) {
      const g = gainsAt(m);
      expect(g.night01).toBeLessThanOrEqual(prevNight);
      expect(g.air01).toBeGreaterThanOrEqual(prevAir);
      prevNight = g.night01;
      prevAir = g.air01;
    }
  });

  it("out 参复用（零 GC）：返回同一对象引用并原地写入", () => {
    const out = emptyLunarSoundscapeGains();
    const ret = lunarSoundscapeGains(1.5, out);
    expect(ret).toBe(out);
    expect(out.night01).toBeCloseTo(LUNAR_NIGHT_DEEP_FACTOR, 12);
  });

  it("峰值增益为正且克制（月食声景比日食安静，§5）", () => {
    expect(LUNAR_NIGHT_PEAK_GAIN).toBeGreaterThan(0);
    expect(LUNAR_NIGHT_PEAK_GAIN).toBeLessThan(0.2);
  });
});

describe("lunarChimeCrossing（提示音跨越判据）", () => {
  it("正向跨越触发（含右端点闭合）", () => {
    expect(lunarChimeCrossing(3595, 3601, 3600)).toBe(true);
    expect(lunarChimeCrossing(3595, 3600, 3600)).toBe(true);
  });

  it("未跨越不触发", () => {
    expect(lunarChimeCrossing(3500, 3599, 3600)).toBe(false);
    expect(lunarChimeCrossing(3601, 3620, 3600)).toBe(false);
  });

  it("反向/静止不触发（仅正向播放）", () => {
    expect(lunarChimeCrossing(3620, 3590, 3600)).toBe(false);
    expect(lunarChimeCrossing(3600, 3600, 3600)).toBe(false);
  });

  it("帧跨度超限（seek 跳变）不补播", () => {
    const span = LUNAR_CHIME_MAX_FRAME_SPAN_SEC;
    expect(lunarChimeCrossing(3600 - span, 3600, 3600)).toBe(true);
    expect(lunarChimeCrossing(3600 - span - 1, 3600, 3600)).toBe(false);
    expect(lunarChimeCrossing(0, 19320, 3600)).toBe(false);
  });

  it("加速档恒定倍率（×250 @30 FPS ≈ 8.3s/帧）仍在上限内", () => {
    expect(LUNAR_CHIME_MAX_FRAME_SPAN_SEC).toBeGreaterThan(8.4);
  });
});

describe("lunarContactChimeCrossings（七接触点，按 contacts 缺省）", () => {
  it("全食事件七锚点逐个可触发，音色分组正确", () => {
    const expected: Array<[number, string, string]> = [
      [TOTAL.p1, "p1", "penumbral"],
      [TOTAL.u1 as number, "u1", "umbral"],
      [TOTAL.u2 as number, "u2", "umbral"],
      [TOTAL.max, "max", "max"],
      [TOTAL.u3 as number, "u3", "umbral"],
      [TOTAL.u4 as number, "u4", "umbral"],
      [TOTAL.p4, "p4", "penumbral"],
    ];
    for (const [t, key, tone] of expected) {
      const hits = lunarContactChimeCrossings(t - 2, t + 1, TOTAL);
      expect(hits).toEqual([{ key, tone }]);
    }
  });

  it("偏食事件跳过缺省的 U2/U3（仅 5 锚点可触发）", () => {
    const keys = [];
    for (const t of [
      PARTIAL.p1,
      PARTIAL.u1 as number,
      PARTIAL.max,
      PARTIAL.u4 as number,
      PARTIAL.p4,
    ]) {
      const hits = lunarContactChimeCrossings(t - 2, t + 1, PARTIAL);
      expect(hits).toHaveLength(1);
      keys.push(hits[0].key);
    }
    expect(keys).toEqual(["p1", "u1", "max", "u4", "p4"]);
    // 全窗一次性扫过（超限）也不会冒出 U2/U3
    const all = lunarContactChimeCrossings(-1, PARTIAL.p4 + 1, PARTIAL);
    expect(all).toHaveLength(0);
  });

  it("半影食事件仅 P1/食甚/P4 三锚点，且全为最轻音色 + 食甚档", () => {
    const hits = [
      ...lunarContactChimeCrossings(-1, 1, PENUMBRAL),
      ...lunarContactChimeCrossings(PENUMBRAL.max - 1, PENUMBRAL.max, PENUMBRAL),
      ...lunarContactChimeCrossings(PENUMBRAL.p4 - 1, PENUMBRAL.p4, PENUMBRAL),
    ];
    expect(hits.map((h) => h.key)).toEqual(["p1", "max", "p4"]);
    expect(hits.map((h) => h.tone)).toEqual(["penumbral", "max", "penumbral"]);
  });

  it("同帧跨越多个锚点时按定义序返回（U3→U4 相邻窗）", () => {
    const hits = lunarContactChimeCrossings(
      (TOTAL.u3 as number) - 1,
      (TOTAL.u3 as number) + 20,
      { ...TOTAL, u4: (TOTAL.u3 as number) + 10 },
    );
    expect(hits.map((h) => h.key)).toEqual(["u3", "u4"]);
  });

  it("未跨越任何锚点时返回空数组", () => {
    expect(lunarContactChimeCrossings(100, 120, TOTAL)).toEqual([]);
  });
});

describe("LUNAR_CHIME_TONE_PARAMS（音色参数表）", () => {
  it("半影最轻 < 食甚 < 本影（与「半影几乎无感」口径一致）", () => {
    expect(LUNAR_CHIME_TONE_PARAMS.penumbral.peak).toBeLessThan(
      LUNAR_CHIME_TONE_PARAMS.max.peak,
    );
    expect(LUNAR_CHIME_TONE_PARAMS.max.peak).toBeLessThan(
      LUNAR_CHIME_TONE_PARAMS.umbral.peak,
    );
  });

  it("三档参数均为正且衰减在 1–3s 平滑过渡量级（§5）", () => {
    for (const tone of ["penumbral", "umbral", "max"] as const) {
      const p = LUNAR_CHIME_TONE_PARAMS[tone];
      expect(p.freq).toBeGreaterThan(0);
      expect(p.peak).toBeGreaterThan(0);
      expect(p.decaySec).toBeGreaterThanOrEqual(1);
      expect(p.decaySec).toBeLessThanOrEqual(3);
    }
  });
});
