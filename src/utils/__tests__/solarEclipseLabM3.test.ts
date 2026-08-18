/**
 * E-M3 场景侧纯逻辑单测（§M3 / 契约 C5 / §3.1 / §3.3 / §4.3）：
 * 曝光状态机（filtered/naked-eye 双基准 + C2/C3 自动切换）、导览变速曲线
 * （A1）、假想模式月地距离重算（真实烘焙 geo 星历喂入——全食 ↔ 环食连续
 * 退化）、99% 时刻反解、全食沉浸因子、影带时段包络（A7）、日珥布点（A6）、
 * 月缘纹理帧旋转、贝利珠高亮窗、阶段科普卡区段、行星地心赤道视位置、
 * 环境气温拟合。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateSolarEclipses, type SolarEclipsesData } from '@/utils/bakedData';
import { PLANETS } from '@/data/planets';
import {
  BEADS_HIGHLIGHT_HALF_SEC,
  ECLIPSE_PLANETS,
  ECLIPSE_PROMINENCE_COUNT_MAX,
  ECLIPSE_PROMINENCE_COUNT_MIN,
  ECLIPSE_PROMINENCE_HEIGHT_MAX_FRAC,
  ECLIPSE_PROMINENCE_HEIGHT_MIN_FRAC,
  ECLIPSE_PROMINENCE_SPAN_MAX_RAD,
  ECLIPSE_PROMINENCE_SPAN_MIN_RAD,
  EXPOSURE_FILTERED_PHOTO_GAIN,
  EXPOSURE_FILTERED_STAR_GAIN,
  EXPOSURE_NAKED_LEAD_SEC,
  EXPOSURE_NAKED_PHOTO_GAIN,
  EXPOSURE_TRANSITION_SEC,
  HYPO_MOON_DIST_MAX_KM,
  HYPO_MOON_DIST_MIN_KM,
  TOTALITY_TEMP_DROP_C,
  TOUR_RATE_FAST,
  TOUR_SLOWDOWN_LEAD_SEC,
  activePhaseCardKey,
  autoExposure01,
  beadsHighlightWindows,
  eclipseEventSeed,
  eclipseFrameState,
  eclipsePlayRate,
  eclipseProminences,
  eclipseTempDropC,
  emptyEclipseExposureUniforms,
  exposureUniforms,
  hypotheticalFrameState,
  limbTexRotationRad,
  obscurationCrossingTimeSec,
  planetGeocentricEquatorial,
  shadowBandsStrength01,
  totalityImmersion01,
  tourPlayRate,
  type EclipseContacts,
} from '@/utils/solarEclipseLab';

const DEG = Math.PI / 180;

const eclipses = validateSolarEclipses(
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/solar_eclipses.json'), 'utf8'))
) as SolarEclipsesData;

const e2027 = eclipses.events[0];
const contacts: EclipseContacts = e2027.contacts;

// ---------------------------------------------------------------------------
// M3-1 曝光状态机（契约 C5）
// ---------------------------------------------------------------------------

describe('autoExposure01（契约 C5：C2/C3 跨越自动切换基准）', () => {
  it('偏食段恒 filtered（0）、全食段恒 naked-eye（1）', () => {
    expect(autoExposure01(contacts.c1, contacts)).toBe(0);
    expect(autoExposure01(contacts.max, contacts)).toBe(1);
    expect(autoExposure01(contacts.c4, contacts)).toBe(0);
  });

  it('C2 前提前量就位（贝利珠时段裸眼），过渡宽度 = EXPOSURE_TRANSITION_SEC', () => {
    const riseStart = contacts.c2 - EXPOSURE_NAKED_LEAD_SEC - EXPOSURE_TRANSITION_SEC;
    expect(autoExposure01(riseStart, contacts)).toBe(0);
    expect(autoExposure01(riseStart + EXPOSURE_TRANSITION_SEC, contacts)).toBe(1);
    const mid = autoExposure01(riseStart + EXPOSURE_TRANSITION_SEC / 2, contacts);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    // C2−60s（贝利珠窗内）已是裸眼基准
    expect(autoExposure01(contacts.c2 - 60, contacts)).toBe(0);
    expect(autoExposure01(contacts.c2 - EXPOSURE_NAKED_LEAD_SEC, contacts)).toBe(1);
  });

  it('C3 后对称回切 filtered', () => {
    const fallStart = contacts.c3 + EXPOSURE_NAKED_LEAD_SEC;
    expect(autoExposure01(fallStart, contacts)).toBe(1);
    expect(autoExposure01(fallStart + EXPOSURE_TRANSITION_SEC, contacts)).toBe(0);
  });

  it('非有限 tSec 抛 RangeError', () => {
    expect(() => autoExposure01(Number.NaN, contacts)).toThrow(RangeError);
  });
});

describe('exposureUniforms（双基准增益组）', () => {
  it('filtered 端：光球 0.55（< Bloom 阈值不过曝）、日冕恰 0、星穹 0.02', () => {
    const u = exposureUniforms(0);
    expect(u.photoGain).toBeCloseTo(EXPOSURE_FILTERED_PHOTO_GAIN, 10);
    expect(u.coronaGain).toBe(0);
    expect(u.starGain).toBeCloseTo(EXPOSURE_FILTERED_STAR_GAIN, 10);
    // 验收基准：filtered 档光球不过曝（ACES 前色值低于 Bloom 阈值 0.6）
    expect(u.photoGain).toBeLessThan(0.6);
  });

  it('naked-eye 端：光球 ×15 HDR、日冕/星穹全开', () => {
    const u = exposureUniforms(1);
    expect(u.photoGain).toBeCloseTo(EXPOSURE_NAKED_PHOTO_GAIN, 10);
    expect(u.coronaGain).toBe(1);
    expect(u.starGain).toBeCloseTo(1, 10);
    expect(u.photoGain).toBeGreaterThan(1);
  });

  it('对数插值单调 + 中点为几何均值', () => {
    const mid = exposureUniforms(0.5);
    expect(mid.photoGain).toBeCloseTo(
      Math.sqrt(EXPOSURE_FILTERED_PHOTO_GAIN * EXPOSURE_NAKED_PHOTO_GAIN),
      6
    );
    let prev = -1;
    for (let e = 0; e <= 1.0001; e += 0.1) {
      const u = exposureUniforms(Math.min(e, 1));
      expect(u.photoGain).toBeGreaterThan(prev);
      prev = u.photoGain;
    }
  });

  it('out 复用（渲染循环零 GC）+ 越界钳制 + 非有限抛错', () => {
    const out = emptyEclipseExposureUniforms();
    expect(exposureUniforms(2, out)).toBe(out);
    expect(out.photoGain).toBeCloseTo(EXPOSURE_NAKED_PHOTO_GAIN, 10);
    exposureUniforms(-1, out);
    expect(out.coronaGain).toBe(0);
    expect(() => exposureUniforms(Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// M3-6 导览变速（A1）
// ---------------------------------------------------------------------------

describe('tourPlayRate / eclipsePlayRate（§3.1 导览变速曲线）', () => {
  it('偏食段 ×60、全食段 ×1 实时、C3+90s 后回 ×60', () => {
    expect(tourPlayRate(contacts.c1, contacts)).toBe(TOUR_RATE_FAST);
    expect(tourPlayRate(contacts.c2 - TOUR_SLOWDOWN_LEAD_SEC - 1, contacts)).toBe(TOUR_RATE_FAST);
    expect(tourPlayRate(contacts.c2, contacts)).toBe(1);
    expect(tourPlayRate(contacts.max, contacts)).toBe(1);
    expect(tourPlayRate(contacts.c3, contacts)).toBe(1);
    expect(tourPlayRate(contacts.c3 + TOUR_SLOWDOWN_LEAD_SEC, contacts)).toBeCloseTo(
      TOUR_RATE_FAST,
      6
    );
    expect(tourPlayRate(contacts.c4, contacts)).toBe(TOUR_RATE_FAST);
  });

  it('C2−90s 起单调降速（对数域平滑）', () => {
    let prev = TOUR_RATE_FAST + 1;
    for (let t = contacts.c2 - TOUR_SLOWDOWN_LEAD_SEC; t <= contacts.c2; t += 10) {
      const r = tourPlayRate(t, contacts);
      expect(r).toBeLessThanOrEqual(prev);
      expect(r).toBeGreaterThanOrEqual(1);
      prev = r;
    }
  });

  it("eclipsePlayRate：'real' 恒 ×1、'tour' 走曲线；非有限抛错", () => {
    expect(eclipsePlayRate('real', contacts.c1, contacts)).toBe(1);
    expect(eclipsePlayRate('tour', contacts.c1, contacts)).toBe(TOUR_RATE_FAST);
    expect(() => tourPlayRate(Number.NaN, contacts)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// M3-6 假想模式（§3.3：真实 geo 星历 + 月地距离改写）
// ---------------------------------------------------------------------------

describe('hypotheticalFrameState（月地距离滑杆全食 ↔ 环食连续退化）', () => {
  it('食甚时刻：近地点端全食、远地点端环食（eclipseKind 实时判定）', () => {
    const near = hypotheticalFrameState(e2027, contacts.max, HYPO_MOON_DIST_MIN_KM);
    const far = hypotheticalFrameState(e2027, contacts.max, HYPO_MOON_DIST_MAX_KM);
    expect(near.kind).toBe('total');
    expect(far.kind).toBe('annular');
    // 环食：食分 = 视直径比 < 1（伪本影金环的几何来源）
    expect(far.magnitude).toBeLessThan(1);
    expect(near.magnitude).toBeGreaterThan(1);
  });

  it('月视半径随距离单调减小（视差/视半径经 topocentricSunMoon 自洽重算）', () => {
    let prev = Infinity;
    for (let d = HYPO_MOON_DIST_MIN_KM; d <= HYPO_MOON_DIST_MAX_KM; d += 10000) {
      const frame = hypotheticalFrameState(e2027, contacts.max, d);
      expect(frame.moonSdDeg).toBeLessThan(prev);
      prev = frame.moonSdDeg;
    }
  });

  it('与真实路径量级自洽：2027 真实月距下食分接近烘焙 topo 解', () => {
    // 真实 geo 行给出的食甚地心月距（滑杆域内）：假想路径喂入同距离应复现
    // 全食；地心 vs 站心距离差 ≤6378 km → 视半径偏差 ≤1.8%（登记简化）
    const realFrame = eclipseFrameState(e2027, contacts.max);
    const geoRow = e2027.geo.rows[Math.round((contacts.max - e2027.geo.t0) / e2027.geo.dtSec)];
    const realDistKm = geoRow[7];
    const hypo = hypotheticalFrameState(e2027, contacts.max, realDistKm);
    expect(hypo.kind).toBe('total');
    expect(Math.abs(hypo.magnitude - realFrame.magnitude)).toBeLessThan(0.03);
  });

  it('非法距离抛 RangeError', () => {
    expect(() => hypotheticalFrameState(e2027, contacts.max, 0)).toThrow(RangeError);
    expect(() => hypotheticalFrameState(e2027, contacts.max, Number.NaN)).toThrow(RangeError);
  });
});

describe('obscurationCrossingTimeSec（99%/100% 一键对比反解）', () => {
  it('99% 时刻落在 C1–C2 间且遮挡率 ≈ 0.99', () => {
    const t99 = obscurationCrossingTimeSec(e2027, contacts, 0.99);
    expect(t99).toBeGreaterThan(contacts.c1);
    expect(t99).toBeLessThan(contacts.c2);
    const frame = eclipseFrameState(e2027, t99);
    expect(Math.abs(frame.obscuration01 - 0.99)).toBeLessThan(0.005);
  });

  it('99% → 100% 天光断崖（§1.4 专项：因子比 ≥5×）', () => {
    const t99 = obscurationCrossingTimeSec(e2027, contacts, 0.99);
    const at99 = eclipseFrameState(e2027, t99);
    const at100 = eclipseFrameState(e2027, contacts.max);
    expect(at99.skyFactor01 / at100.skyFactor01).toBeGreaterThanOrEqual(5);
  });

  it('目标越界抛 RangeError', () => {
    expect(() => obscurationCrossingTimeSec(e2027, contacts, 0)).toThrow(RangeError);
    expect(() => obscurationCrossingTimeSec(e2027, contacts, 1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// M3-4 暮光沉浸 + M3-5 影带包络
// ---------------------------------------------------------------------------

describe('totalityImmersion01（360° 暮光带混合权重，quartic 断崖镜像）', () => {
  it('≤90% 为 0；99% ≈ 0.656；100% = 1', () => {
    expect(totalityImmersion01(0)).toBe(0);
    expect(totalityImmersion01(0.9)).toBe(0);
    expect(totalityImmersion01(0.99)).toBeCloseTo(0.6561, 3);
    expect(totalityImmersion01(1)).toBe(1);
    expect(totalityImmersion01(2)).toBe(1);
  });

  it('非有限抛 RangeError', () => {
    expect(() => totalityImmersion01(Number.NaN)).toThrow(RangeError);
  });
});

describe('shadowBandsStrength01（A7：仅 C2 前/C3 后数十秒非零）', () => {
  it('窗内非零、全食段与偏食深处为零', () => {
    expect(shadowBandsStrength01(contacts.c2 - 20, contacts)).toBeGreaterThan(0.9);
    expect(shadowBandsStrength01(contacts.c3 + 10, contacts)).toBeGreaterThan(0.9);
    expect(shadowBandsStrength01(contacts.c2, contacts)).toBe(0);
    expect(shadowBandsStrength01(contacts.max, contacts)).toBe(0);
    expect(shadowBandsStrength01(contacts.c1, contacts)).toBe(0);
    expect(shadowBandsStrength01(contacts.c4, contacts)).toBe(0);
    expect(shadowBandsStrength01(contacts.c3 + 60, contacts)).toBe(0);
  });

  it('非有限抛 RangeError', () => {
    expect(() => shadowBandsStrength01(Number.NaN, contacts)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// M3-2 日珥布点（A6）+ M3-3 月缘纹理帧旋转
// ---------------------------------------------------------------------------

describe('eclipseProminences / eclipseEventSeed（A6：事件种子固定方位）', () => {
  it('同种子确定性、数量/高度/跨度落域', () => {
    const a = eclipseProminences(42);
    const b = eclipseProminences(42);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(ECLIPSE_PROMINENCE_COUNT_MIN);
    expect(a.length).toBeLessThanOrEqual(ECLIPSE_PROMINENCE_COUNT_MAX);
    for (const p of a) {
      expect(p.heightFrac).toBeGreaterThanOrEqual(ECLIPSE_PROMINENCE_HEIGHT_MIN_FRAC);
      expect(p.heightFrac).toBeLessThanOrEqual(ECLIPSE_PROMINENCE_HEIGHT_MAX_FRAC);
      expect(p.spanRad).toBeGreaterThanOrEqual(ECLIPSE_PROMINENCE_SPAN_MIN_RAD);
      expect(p.spanRad).toBeLessThanOrEqual(ECLIPSE_PROMINENCE_SPAN_MAX_RAD);
    }
  });

  it('不同事件种子布点不同；种子哈希确定且互异', () => {
    expect(eclipseEventSeed('e2027')).toBe(eclipseEventSeed('e2027'));
    const seeds = new Set(['e2027', 'e2035', 'e1919'].map(eclipseEventSeed));
    expect(seeds.size).toBe(3);
    const a = eclipseProminences(eclipseEventSeed('e2027'));
    const b = eclipseProminences(eclipseEventSeed('e2035'));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('非有限种子抛 RangeError', () => {
    expect(() => eclipseProminences(Number.NaN)).toThrow(RangeError);
  });
});

describe('limbTexRotationRad（剖面索引系 ↔ quad 本地系桥接）', () => {
  it('偏移正上 + 位置角 0°（月在日北）→ 旋转 0', () => {
    expect(limbTexRotationRad(0, 0.001, 0)).toBeCloseTo(0, 10);
  });

  it('偏移正东 + 位置角 90° → 旋转 0（本地东向角 = π/2 抵消）', () => {
    expect(limbTexRotationRad(0.001, 0, 90)).toBeCloseTo(0, 10);
  });

  it('折返域 (−π, π]：位置角 350° 偏移正上 → −10°', () => {
    expect(limbTexRotationRad(0, 0.001, 350)).toBeCloseTo(-10 * DEG, 10);
    expect(limbTexRotationRad(0, 0.001, 180)).toBeCloseTo(Math.PI, 10);
  });

  it('非有限入参抛 RangeError', () => {
    expect(() => limbTexRotationRad(Number.NaN, 0, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// M3-6 时间轴高亮 + 阶段科普卡区段
// ---------------------------------------------------------------------------

describe('beadsHighlightWindows（§3.1：C2±60s / C3±60s 高亮刻度）', () => {
  it('两窗对称居中于 C2/C3', () => {
    const wins = beadsHighlightWindows(contacts);
    expect(wins).toHaveLength(2);
    expect(wins[0].key).toBe('beads-c2');
    expect((wins[0].startSec + wins[0].endSec) / 2).toBeCloseTo(contacts.c2, 6);
    expect(wins[0].endSec - wins[0].startSec).toBe(BEADS_HIGHLIGHT_HALF_SEC * 2);
    expect((wins[1].startSec + wins[1].endSec) / 2).toBeCloseTo(contacts.c3, 6);
  });
});

describe('activePhaseCardKey（五接触点科普卡区段）', () => {
  it('区段判定覆盖 c1/c2/max/c3/c4', () => {
    expect(activePhaseCardKey(contacts.c1, contacts)).toBe('c1');
    expect(activePhaseCardKey(contacts.c2 - 60, contacts)).toBe('c2');
    expect(activePhaseCardKey(contacts.max, contacts)).toBe('max');
    expect(activePhaseCardKey(contacts.c3, contacts)).toBe('c3');
    expect(activePhaseCardKey(contacts.c4, contacts)).toBe('c4');
  });

  it('非有限抛 RangeError', () => {
    expect(() => activePhaseCardKey(Number.NaN, contacts)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// M3-4 行星真实方位 + 环境数值
// ---------------------------------------------------------------------------

describe('planetGeocentricEquatorial（§2.1 physics 链）', () => {
  const orbitOf = (id: string) => {
    const p = PLANETS.find((pl) => pl.id === id);
    if (!p) throw new Error(`行星数据缺失：${id}`);
    return p.orbit;
  };

  it('ECLIPSE_PLANETS 的轨道要素均在 data/planets 注册（接线防守）', () => {
    for (const p of ECLIPSE_PLANETS) {
      expect(PLANETS.some((pl) => pl.id === p.id)).toBe(true);
    }
    expect(PLANETS.some((pl) => pl.id === 'earth')).toBe(true);
  });

  it('RA ∈ [0, 360)、|Dec| 有界（黄赤交角 + 轨道倾角）', () => {
    const earth = orbitOf('earth');
    for (const p of ECLIPSE_PLANETS) {
      const eq = planetGeocentricEquatorial(orbitOf(p.id), earth, contacts.max);
      expect(eq.raDeg).toBeGreaterThanOrEqual(0);
      expect(eq.raDeg).toBeLessThan(360);
      expect(Math.abs(eq.decDeg)).toBeLessThan(35);
    }
  });

  it('反对称：交换双星视线方向相反（RA 差 180°、Dec 反号）', () => {
    const earth = orbitOf('earth');
    const venus = orbitOf('venus');
    const a = planetGeocentricEquatorial(venus, earth, contacts.max);
    const b = planetGeocentricEquatorial(earth, venus, contacts.max);
    // 与 180° 的回绕差（RA 差应恰为半圈）
    const dFrom180 = Math.abs(((((a.raDeg - b.raDeg - 180) % 360) + 540) % 360) - 180);
    expect(dFrom180).toBeCloseTo(0, 6);
    expect(a.decDeg).toBeCloseTo(-b.decDeg, 6);
  });

  it('out 复用 + 非有限 tSec 抛错', () => {
    const earth = orbitOf('earth');
    const out = { raDeg: 0, decDeg: 0 };
    expect(planetGeocentricEquatorial(orbitOf('venus'), earth, contacts.max, out)).toBe(out);
    expect(() => planetGeocentricEquatorial(orbitOf('venus'), earth, Number.NaN)).toThrow(
      RangeError
    );
  });
});

describe('eclipseTempDropC（§1.4 环境数值条）', () => {
  it('0 遮挡无降幅、全食 −3°C、单调', () => {
    expect(eclipseTempDropC(0)).toBe(0);
    expect(eclipseTempDropC(1)).toBeCloseTo(TOTALITY_TEMP_DROP_C, 10);
    let prev = -1;
    for (let o = 0; o <= 1.0001; o += 0.1) {
      const d = eclipseTempDropC(Math.min(o, 1));
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    expect(eclipseTempDropC(2)).toBeCloseTo(TOTALITY_TEMP_DROP_C, 10);
  });

  it('非有限抛 RangeError', () => {
    expect(() => eclipseTempDropC(Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// eclipseFrameState M3 扩展（posAngleDeg 透传——月缘纹理帧旋转输入）
// ---------------------------------------------------------------------------

describe('eclipseFrameState.posAngleDeg（M3 扩展字段）', () => {
  it('位置角落 [0, 360)，假想路径透传同一 topo 列（视对齐保持口径）', () => {
    const frame = eclipseFrameState(e2027, contacts.max);
    expect(frame.posAngleDeg).toBeGreaterThanOrEqual(0);
    expect(frame.posAngleDeg).toBeLessThan(360);
    const hypo = hypotheticalFrameState(e2027, contacts.max, 384400);
    expect(hypo.posAngleDeg).toBeCloseTo(frame.posAngleDeg, 10);
  });

  it('偏食段位置角随时间连续（月缘纹理帧旋转输入的良态区）', () => {
    // C1 后 20–40 分钟角距良态（≥0.1°），相邻分钟位置角互差 < 2°
    let prev = eclipseFrameState(e2027, contacts.c1 + 20 * 60).posAngleDeg;
    for (let m = 21; m <= 40; m += 1) {
      const pa = eclipseFrameState(e2027, contacts.c1 + m * 60).posAngleDeg;
      const wrapped = ((pa - prev + 540) % 360) - 180;
      expect(Math.abs(wrapped)).toBeLessThan(2);
      prev = pa;
    }
  });
});
