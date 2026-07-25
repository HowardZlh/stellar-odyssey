/**
 * R2-7 §7.1-A：日球层顶近观三层结构 + 旅行者标记纯函数单测
 */

import {
  HELIOPAUSE_REAL_DISTANCE_AU,
  HELIOPAUSE_SHAPE_NOTE_ZH,
  HELIOPAUSE_VISUAL_RADIUS_UNITS,
  HELIOSHEATH_SHELL_COUNT,
  TERMINATION_SHOCK_REAL_DISTANCE_AU,
  VOYAGER_MARKERS,
  heliopauseLayerColor01,
  heliosheathShellRadiusUnits,
  heliosphereLayerRadiusUnits,
  isHeliopauseNearFocusId,
  terminationShockRadiusUnits,
  voyagerMarkerPositionUnits,
} from '@/utils/heliopause';

describe('日球层结构层半径（压缩比例沿用现有登记）', () => {
  it('120 AU（日球层顶）恰为示意球壳半径', () => {
    expect(heliosphereLayerRadiusUnits(HELIOPAUSE_REAL_DISTANCE_AU)).toBe(
      HELIOPAUSE_VISUAL_RADIUS_UNITS,
    );
  });

  it('终端激波内壳按 94/120 比例换算', () => {
    expect(TERMINATION_SHOCK_REAL_DISTANCE_AU).toBe(94);
    expect(terminationShockRadiusUnits()).toBeCloseTo(
      HELIOPAUSE_VISUAL_RADIUS_UNITS * (94 / 120),
      10,
    );
  });

  it('层半径与真实距离成正比（同一压缩比例，禁止两套参数）', () => {
    const r60 = heliosphereLayerRadiusUnits(60);
    expect(r60).toBeCloseTo(HELIOPAUSE_VISUAL_RADIUS_UNITS / 2, 10);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => heliosphereLayerRadiusUnits(0)).toThrow(RangeError);
    expect(() => heliosphereLayerRadiusUnits(-1)).toThrow(RangeError);
    expect(() => heliosphereLayerRadiusUnits(Number.NaN)).toThrow(RangeError);
  });
});

describe('日鞘渐变壳层（终端激波与日球层顶之间）', () => {
  it('壳层半径严格递增且全部位于终端激波与日球层顶之间', () => {
    const inner = terminationShockRadiusUnits();
    const outer = HELIOPAUSE_VISUAL_RADIUS_UNITS;
    let prev = inner;
    for (let i = 0; i < HELIOSHEATH_SHELL_COUNT; i += 1) {
      const r = heliosheathShellRadiusUnits(i);
      expect(r).toBeGreaterThan(prev);
      expect(r).toBeLessThan(outer);
      prev = r;
    }
  });

  it('等距插值：单层时位于中点', () => {
    const inner = terminationShockRadiusUnits();
    const outer = HELIOPAUSE_VISUAL_RADIUS_UNITS;
    expect(heliosheathShellRadiusUnits(0, 1)).toBeCloseTo((inner + outer) / 2, 10);
  });

  it('非法序号/层数抛 RangeError', () => {
    expect(() => heliosheathShellRadiusUnits(-1)).toThrow(RangeError);
    expect(() => heliosheathShellRadiusUnits(HELIOSHEATH_SHELL_COUNT)).toThrow(RangeError);
    expect(() => heliosheathShellRadiusUnits(0.5)).toThrow(RangeError);
    expect(() => heliosheathShellRadiusUnits(0, 0)).toThrow(RangeError);
  });
});

describe('结构着色渐变（琥珀 → 蓝）', () => {
  it('t=0 为暖色（终端激波，r > b）、t=1 为蓝色（日球层顶，b > r）', () => {
    const ts = heliopauseLayerColor01(0);
    const hp = heliopauseLayerColor01(1);
    expect(ts.r).toBeGreaterThan(ts.b);
    expect(hp.b).toBeGreaterThan(hp.r);
  });

  it('通道随 t 单调渐变且在 [0,1] 内', () => {
    let prevB = -1;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const c = heliopauseLayerColor01(t);
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(c.b).toBeGreaterThan(prevB);
      prevB = c.b;
    }
  });

  it('t 超出 [0,1] 或非有限抛 RangeError', () => {
    expect(() => heliopauseLayerColor01(-0.1)).toThrow(RangeError);
    expect(() => heliopauseLayerColor01(1.1)).toThrow(RangeError);
    expect(() => heliopauseLayerColor01(Number.NaN)).toThrow(RangeError);
  });
});

describe('旅行者 1/2 号标记（NASA/JPL Voyager Interstellar Mission）', () => {
  it('两条标记：穿越年份/距离与 NASA 登记一致', () => {
    expect(VOYAGER_MARKERS).toHaveLength(2);
    const v1 = VOYAGER_MARKERS.find((m) => m.id === 'voyager-1')!;
    const v2 = VOYAGER_MARKERS.find((m) => m.id === 'voyager-2')!;
    expect(v1.crossedYear).toBe(2012);
    expect(v2.crossedYear).toBe(2018);
    expect(v1.crossedDistanceAu).toBeCloseTo(121.6, 5);
    expect(v2.crossedDistanceAu).toBeCloseTo(119.0, 5);
  });

  it('方向为单位向量（模块加载时归一化）', () => {
    for (const m of VOYAGER_MARKERS) {
      const len = Math.hypot(m.direction.x, m.direction.y, m.direction.z);
      expect(len).toBeCloseTo(1, 9);
    }
  });

  it('V1 在黄道以北（y>0）、V2 在黄道以南（y<0），与穿越黄纬示意一致', () => {
    const v1 = VOYAGER_MARKERS.find((m) => m.id === 'voyager-1')!;
    const v2 = VOYAGER_MARKERS.find((m) => m.id === 'voyager-2')!;
    expect(v1.direction.y).toBeGreaterThan(0);
    expect(v2.direction.y).toBeLessThan(0);
  });

  it('标记位置模长 = 按穿越距离换算的层半径', () => {
    for (const m of VOYAGER_MARKERS) {
      const p = voyagerMarkerPositionUnits(m.id);
      const len = Math.hypot(p.x, p.y, p.z);
      expect(len).toBeCloseTo(
        HELIOPAUSE_VISUAL_RADIUS_UNITS * (m.crossedDistanceAu / HELIOPAUSE_REAL_DISTANCE_AU),
        8,
      );
    }
  });

  it('未知 id 抛 RangeError', () => {
    expect(() => voyagerMarkerPositionUnits('voyager-3')).toThrow(RangeError);
  });
});

describe('近观语境判定与形态登记', () => {
  it('日球层顶/旅行者标记为近观语境焦点，其余不是', () => {
    expect(isHeliopauseNearFocusId('heliopause')).toBe(true);
    expect(isHeliopauseNearFocusId('voyager-1')).toBe(true);
    expect(isHeliopauseNearFocusId('voyager-2')).toBe(true);
    expect(isHeliopauseNearFocusId('sun')).toBe(false);
    expect(isHeliopauseNearFocusId(null)).toBe(false);
  });

  it('球形示意的不对称形态登记文案存在（可选项取舍登记）', () => {
    expect(HELIOPAUSE_SHAPE_NOTE_ZH).toContain('不对称');
    expect(HELIOPAUSE_SHAPE_NOTE_ZH).toContain('彗尾');
  });
});
