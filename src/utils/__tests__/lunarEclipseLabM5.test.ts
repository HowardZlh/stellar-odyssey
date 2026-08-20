/**
 * LE-M5 场景侧纯逻辑单测（utils/lunarEclipseLab M5 段）：
 * - 月球视角帧态 lunarMoonViewState（§2.3/B8）：地球/太阳视半径真值、
 *   太阳视偏移与影盘偏移的镜像关系、太阳可见比例（全食段 0 / 窗外 1）、
 *   红环色 = 契约 C1 earthRingColor **同源**（因果闭环：与血月同一浑浊度
 *   状态源，禁双滑杆的机器防守）、月面环境色全食段红移；
 * - selenelion 帧态（M5-3/B9，l1992 北京真实组合）：站心几何锚点
 *   （M5 精算：~23:25 UT 几何月落/日升交叉；23:27 UT 双体几何均在地平下、
 *   经 0.6° 折射抬升双双可见——真实组合的机器证据）、双地平线方位
 *   （月西北 / 日东南）、全程全食段、折射抬升曲线；
 * - 防御分支（非有限入参/距离非法）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateLunarEclipses, type LunarEclipseEventData } from '../bakedData';
import { earthRingColor, turbidityToDanjonL } from '../lunarEclipse';
import { EARTH_EQUATORIAL_RADIUS_KM } from '../lunarEclipse';
import {
  MOON_VIEW_EARTH_ALT_DEG,
  MOON_VIEW_EDGE_FADE_END_FRAC,
  MOON_VIEW_EDGE_FADE_START_FRAC,
  MOON_VIEW_INTRO_FOV_DEG,
  MOON_VIEW_MILKY_WAY_INTENSITY,
  MOON_VIEW_QUAD_HALF_ANGLE_RAD,
  MOON_VIEW_STAR_GAIN,
  MOON_VIEW_SUN_GLOW_GAIN,
  MOON_VIEW_SUN_GLOW_SCALE,
  MOON_VIEW_SUN_ROAM_MAX_RAD,
  SELENELION_DEFAULT_SEC,
  SELENELION_END_SEC,
  SELENELION_EVENT_ID,
  SELENELION_OBSERVER,
  SELENELION_REFRACTION_HORIZON_DEG,
  SELENELION_START_SEC,
  emptyLunarFrameState,
  emptyLunarMoonViewState,
  emptySelenelionFrameState,
  lunarFrameState,
  lunarMoonViewState,
  lunarTimelineWindow,
  refractionLiftDeg,
  selenelionFrameState,
  type LunarSeriesGroup,
} from '../lunarEclipseLab';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/lunar_eclipses.json'), 'utf8')
) as unknown;
const data = validateLunarEclipses(raw);
if (!data) throw new Error('真实产物未通过 validateLunarEclipses');
const events = new Map(data.events.map((e) => [e.id, e]));
const l2029 = events.get('l2029') as LunarEclipseEventData;
const l1992 = events.get(SELENELION_EVENT_ID) as LunarEclipseEventData;

const DEG = Math.PI / 180;

function groupOf(ev: LunarEclipseEventData): LunarSeriesGroup {
  return { topo: ev.topo, geo: ev.geo };
}

/** Rec.709 感知亮度（红环深浅单调性的比较尺度） */
function luma(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

describe('lunarMoonViewState（M5-1 月球视角；B8）', () => {
  const group = groupOf(l2029);

  it('地球/太阳视半径为距离真值（R⊕/R月 视半径比 ≈ 3.67）', () => {
    const frame = lunarFrameState(group, l2029.observer, l2029.contacts.max);
    const view = lunarMoonViewState(frame, 0.5);
    // 地球视半径 ≈ asin(6378/moonDist geocentric)；月视半径为站心口径
    // （圣保罗近天顶 → 站心距近 ~R⊕、sd 略大）——比值 ≈ 3.67 允差站心差
    const ratio = view.earthRadRad / (frame.moonSdDeg * DEG);
    expect(ratio).toBeGreaterThan((EARTH_EQUATORIAL_RADIUS_KM / 1737.4) * 0.97);
    expect(ratio).toBeLessThan((EARTH_EQUATORIAL_RADIUS_KM / 1737.4) * 1.03);
    // 太阳视半径与地面所见同量级（~0.26°）
    expect(view.sunRadRad / DEG).toBeGreaterThan(0.25);
    expect(view.sunRadRad / DEG).toBeLessThan(0.28);
  });

  it('食甚（全食）：太阳全隐于地球后（sunVisibleFrac = 0——「月球上的日食」）', () => {
    const frame = lunarFrameState(group, l2029.observer, l2029.contacts.max);
    const view = lunarMoonViewState(frame, 0.5);
    expect(view.sunVisibleFrac01).toBe(0);
  });

  it('窗口起点（P1 前，未入半影）：太阳完全露出（sunVisibleFrac = 1）', () => {
    const win = lunarTimelineWindow(l2029.contacts);
    const frame = lunarFrameState(group, l2029.observer, win.startSec);
    const view = lunarMoonViewState(frame, 0.5);
    expect(view.sunVisibleFrac01).toBe(1);
  });

  it('太阳视偏移与影盘偏移互为镜像：(E, U)_月 = (offE, −offU)', () => {
    const frame = lunarFrameState(group, l2029.observer, l2029.contacts.u1 as number);
    const view = lunarMoonViewState(frame, 0.5);
    expect(view.sunOffEastRad).toBe(frame.shadowOffEastRad);
    expect(view.sunOffUpRad).toBe(-frame.shadowOffUpRad);
    // 偏移量级 = 影盘偏移量级（同一 p/a 小角）
    expect(Math.hypot(view.sunOffEastRad, view.sunOffUpRad)).toBeCloseTo(
      Math.hypot(frame.shadowOffEastRad, frame.shadowOffUpRad),
      12
    );
  });

  it('太阳漫游域落在 quad 半角内（窗口两端 |偏移| + 太阳视半径 < 半角）', () => {
    const win = lunarTimelineWindow(l2029.contacts);
    for (const t of [win.startSec, win.endSec]) {
      const frame = lunarFrameState(group, l2029.observer, t);
      const view = lunarMoonViewState(frame, 0.5);
      const sep = Math.hypot(view.sunOffEastRad, view.sunOffUpRad);
      expect(sep + view.sunRadRad).toBeLessThan(MOON_VIEW_QUAD_HALF_ANGLE_RAD);
    }
  });

  it('红环色 = 契约 C1 earthRingColor 同源（因果闭环：同一浑浊度状态源）', () => {
    const frame = lunarFrameState(group, l2029.observer, l2029.contacts.max);
    for (const turbidity of [0, 0.35, 1]) {
      const view = lunarMoonViewState(frame, turbidity);
      const expected = earthRingColor(turbidity);
      expect(view.ringRgb[0]).toBe(expected[0]);
      expect(view.ringRgb[1]).toBe(expected[1]);
      expect(view.ringRgb[2]).toBe(expected[2]);
    }
  });

  it('浑浊度 ↑ → 红环变暗（与血月 L0↔L4 深浅同向——目验清单的机器侧）', () => {
    const frame = lunarFrameState(group, l2029.observer, l2029.contacts.max);
    const clean = lunarMoonViewState(frame, 0, emptyLunarMoonViewState());
    const dusty = lunarMoonViewState(frame, 1, emptyLunarMoonViewState());
    expect(luma(dusty.ringRgb)).toBeLessThan(luma(clean.ringRgb) * 0.3);
  });

  it('月面环境色：全食段红移（r > b）、无食段中性灰（通道差 < 15%）', () => {
    const danjonL = turbidityToDanjonL(0.5);
    const total = lunarFrameState(group, l2029.observer, l2029.contacts.max, undefined, danjonL);
    const viewTotal = lunarMoonViewState(total, 0.5);
    expect(viewTotal.surfaceRgb[0]).toBeGreaterThan(viewTotal.surfaceRgb[2] * 1.5);
    const win = lunarTimelineWindow(l2029.contacts);
    const full = lunarFrameState(group, l2029.observer, win.startSec, undefined, danjonL);
    const viewFull = lunarMoonViewState(full, 0.5);
    expect(viewFull.surfaceRgb[0] / viewFull.surfaceRgb[2]).toBeLessThan(1.15);
  });

  it('out 复用零 GC（同 out 两次调用返回同引用）', () => {
    const frame = lunarFrameState(group, l2029.observer, l2029.contacts.max);
    const out = emptyLunarMoonViewState();
    expect(lunarMoonViewState(frame, 0.5, out)).toBe(out);
  });

  it('防御分支：非有限浑浊度/非法距离抛错', () => {
    const frame = lunarFrameState(group, l2029.observer, l2029.contacts.max);
    expect(() => lunarMoonViewState(frame, Number.NaN)).toThrow(RangeError);
    const bad = emptyLunarFrameState();
    bad.moonDistKm = 0;
    expect(() => lunarMoonViewState(bad, 0.5)).toThrow(RangeError);
  });

  it('地球固定高度常量在山脊线之上（封面构图结构约束）', () => {
    // 山脊仰角上限 ~1.7°（labSky RIDGE 域）；地球需高于山脊且低垂近地平
    expect(MOON_VIEW_EARTH_ALT_DEG).toBeGreaterThan(3);
    expect(MOON_VIEW_EARTH_ALT_DEG).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// LE-M6 补丁 P2：quad 边缘淡出窗 + 构图（月壤前景入画）
// ---------------------------------------------------------------------------

describe('LE-M6 P2 月球视角 quad 边缘窗与构图', () => {
  it('边缘淡出窗完全在太阳漫游域之外（防淡出吃掉日盘/红环）', () => {
    const fadeStartRad =
      MOON_VIEW_QUAD_HALF_ANGLE_RAD * MOON_VIEW_EDGE_FADE_START_FRAC;
    expect(MOON_VIEW_SUN_ROAM_MAX_RAD).toBeLessThan(fadeStartRad);
  });

  it('淡出窗在 quad 几何边界内闭合（边界处输出恒 0——方块的结构性根治）', () => {
    expect(MOON_VIEW_EDGE_FADE_START_FRAC).toBeGreaterThan(0);
    expect(MOON_VIEW_EDGE_FADE_START_FRAC).toBeLessThan(
      MOON_VIEW_EDGE_FADE_END_FRAC,
    );
    expect(MOON_VIEW_EDGE_FADE_END_FRAC).toBeLessThanOrEqual(1);
  });

  it('太阳辉光收紧：衰减尺度落在日盘近旁（quad 半角内充分衰减，不再被硬切）', () => {
    // 角落处（√2 × 半角）的辉光残余必须可忽略（<1% 幅度）
    const sunRadRad = 0.267 * (Math.PI / 180);
    const cornerRad = Math.SQRT2 * MOON_VIEW_QUAD_HALF_ANGLE_RAD;
    const residual =
      Math.exp(-cornerRad / (sunRadRad * MOON_VIEW_SUN_GLOW_SCALE)) *
      MOON_VIEW_SUN_GLOW_GAIN;
    expect(residual).toBeLessThan(0.01);
  });

  it('默认机位让月壤前景入画（画面下缘落到地平线以下）', () => {
    // 地球居中 → 画面下缘 = 地球高度 − FOV/2，须为负（地平线在画面内）
    expect(MOON_VIEW_EARTH_ALT_DEG - MOON_VIEW_INTRO_FOV_DEG / 2).toBeLessThan(0);
    // 但地球仍完整在画面内（视半径 ~0.95° + 红环）
    expect(MOON_VIEW_EARTH_ALT_DEG).toBeGreaterThan(2);
  });

  it('背景提亮走物理正确路径：星穹增益与银河带强度高于太空档', () => {
    expect(MOON_VIEW_STAR_GAIN).toBeGreaterThan(0.9);
    expect(MOON_VIEW_MILKY_WAY_INTENSITY).toBeGreaterThan(0.16);
    // 克制口径：不是把画面整体抬亮（月面天空仍是纯黑）
    expect(MOON_VIEW_STAR_GAIN).toBeLessThan(2.5);
    expect(MOON_VIEW_MILKY_WAY_INTENSITY).toBeLessThan(0.6);
  });
});

describe('refractionLiftDeg（B9 折射抬升示意曲线）', () => {
  it('地平及以下恒定 0.6°、10° 高度归零、中点线性', () => {
    expect(refractionLiftDeg(0)).toBeCloseTo(SELENELION_REFRACTION_HORIZON_DEG, 12);
    expect(refractionLiftDeg(-2)).toBeCloseTo(SELENELION_REFRACTION_HORIZON_DEG, 12);
    expect(refractionLiftDeg(10)).toBe(0);
    expect(refractionLiftDeg(20)).toBe(0);
    expect(refractionLiftDeg(5)).toBeCloseTo(SELENELION_REFRACTION_HORIZON_DEG / 2, 12);
  });

  it('高度 ↑ → 抬升量单调不增', () => {
    let prev = refractionLiftDeg(-5);
    for (let alt = -4; alt <= 12; alt += 1) {
      const lift = refractionLiftDeg(alt);
      expect(lift).toBeLessThanOrEqual(prev + 1e-12);
      prev = lift;
    }
  });

  it('防御分支：非有限入参抛错', () => {
    expect(() => refractionLiftDeg(Number.NaN)).toThrow(RangeError);
  });
});

describe('selenelionFrameState（M5-3 l1992 北京真实组合；B9）', () => {
  const group = groupOf(l1992);
  const danjonL = 0; // l1992 皮纳图博实测档

  it('时间窗常量自洽（窗内含默认时刻；窗口在 U2–U3 全食段内）', () => {
    expect(SELENELION_START_SEC).toBeLessThan(SELENELION_DEFAULT_SEC);
    expect(SELENELION_DEFAULT_SEC).toBeLessThan(SELENELION_END_SEC);
    expect(SELENELION_START_SEC).toBeGreaterThan(l1992.contacts.u2 as number);
    expect(SELENELION_END_SEC).toBeLessThan(l1992.contacts.u3 as number);
  });

  it('站心几何锚点：~23:25 UT 几何月落/日升交叉（M5 精算值 ±0.5°）', () => {
    // UT 1992-12-09 23:25（北京时 12-10 07:25）——几何月高 ≈ 0.0°、日高 ≈ −0.9°
    const s = selenelionFrameState(group, 723943500, danjonL);
    expect(Math.abs(s.frame.moonAltDeg - 0.0)).toBeLessThan(0.5);
    expect(Math.abs(s.frame.sunAltDeg - -0.9)).toBeLessThan(0.5);
  });

  it('高光时刻（默认 23:27 UT）：双体几何均在地平下、经折射抬升双双可见', () => {
    const s = selenelionFrameState(group, SELENELION_DEFAULT_SEC, danjonL);
    expect(s.frame.moonAltDeg).toBeLessThan(0);
    expect(s.frame.sunAltDeg).toBeLessThan(0);
    expect(s.moonAppAltDeg).toBeGreaterThan(0);
    expect(s.sunAppAltDeg).toBeGreaterThan(0);
    expect(s.moonLiftDeg).toBeCloseTo(SELENELION_REFRACTION_HORIZON_DEG, 6);
    expect(s.sunLiftDeg).toBeCloseTo(SELENELION_REFRACTION_HORIZON_DEG, 6);
  });

  it('双地平线方位：血月西北沉落、太阳东南升起（方位差 > 140°）', () => {
    const s = selenelionFrameState(group, SELENELION_DEFAULT_SEC, danjonL);
    expect(s.frame.moonAzDeg).toBeGreaterThan(285);
    expect(s.frame.moonAzDeg).toBeLessThan(315);
    expect(s.sunAzDeg).toBeGreaterThan(105);
    expect(s.sunAzDeg).toBeLessThan(135);
    const dAz = Math.abs(s.frame.moonAzDeg - s.sunAzDeg);
    expect(Math.min(dAz, 360 - dAz)).toBeGreaterThan(140);
  });

  it('窗内全程为全食段（被食之月 + 日升同现的叙事前提）', () => {
    for (const t of [SELENELION_START_SEC, SELENELION_DEFAULT_SEC, SELENELION_END_SEC]) {
      const s = selenelionFrameState(group, t, danjonL);
      expect(s.frame.kind).toBe('total');
      expect(s.frame.umbralMag).toBeGreaterThan(1);
    }
  });

  it('沉落/升起趋势：窗内月高单调下降、日高单调上升（站心速率 ~0.16°/min）', () => {
    const a = selenelionFrameState(group, SELENELION_START_SEC, danjonL, emptySelenelionFrameState());
    const b = selenelionFrameState(group, SELENELION_END_SEC, danjonL, emptySelenelionFrameState());
    expect(b.frame.moonAltDeg).toBeLessThan(a.frame.moonAltDeg - 4);
    expect(b.frame.sunAltDeg).toBeGreaterThan(a.frame.sunAltDeg + 4);
  });

  it('站心月视半径 ≈ 0.265°（近地平站心距离口径）', () => {
    const s = selenelionFrameState(group, SELENELION_DEFAULT_SEC, danjonL);
    expect(Math.abs(s.frame.moonSdDeg - 0.265)).toBeLessThan(0.01);
  });

  it('晨光蒙影极限星等（北京站心太阳高度重算——星空几乎全隐）', () => {
    const s = selenelionFrameState(group, SELENELION_DEFAULT_SEC, danjonL);
    expect(s.frame.limitingMag).toBeLessThan(0);
  });

  it('观测点常量为北京（M1 评估结论 + 中文受众文化叙事）', () => {
    expect(SELENELION_OBSERVER.latDeg).toBeCloseTo(39.9, 1);
    expect(SELENELION_OBSERVER.lonDeg).toBeCloseTo(116.4, 1);
  });

  it('out 复用零 GC（同 out 两次调用返回同引用）', () => {
    const out = emptySelenelionFrameState();
    expect(selenelionFrameState(group, SELENELION_DEFAULT_SEC, danjonL, out)).toBe(out);
  });
});
