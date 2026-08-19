/**
 * LE-M2/M3 场景侧纯逻辑单测（utils/lunarEclipseLab）：
 * - 时间轴窗口/七锚点缺省（契约 C7：全食 7 / 偏食 5 / 半影食 3）；
 * - 加速回放倍率（B1：全程 → ~90s、real ×1、下限钳制）；
 * - 阶段科普卡区段（缺省锚点跳过）；
 * - 逐帧状态（真实烘焙数据锚点）：食甚食分/食型 vs 目录值、影半径视角量
 *   量级、影盘偏移 |off| ≈ 垂距/月距、U1↔U4 缺口方位反向（影轴几何随
 *   时间变化——M2-CP「缺口方位非固定」的机器防守）、向日侧/天极防御分支；
 * - 视差角（子午圈 q=0、东西反号）；
 * - （M3-1）血月照度镜像 bloodMoonIlluminationRgb：本影段 = 丹戎色表 ÷
 *   平均反照（红线 ① 径向梯度：影心 → 影缘感知亮度严格递增，禁均匀变暗）、
 *   半影段幅度受限（红线 ② 机器防守——penumbraShading 直接消费）、
 *   本影缘混合带、L0↔L4 悬殊、limbGain 只乘直射分量；
 * - （M3-3/M3-4）月面物理亮度积分（星空显现链）/丹戎残余亮度锚点/月光
 *   环境项/月缘增亮因子；（M3-2）浑浊度逆映射与曝光增益。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateLunarEclipses, type LunarEclipseEventData } from '../bakedData';
import {
  NO_ECLIPSE_MAGNITUDE,
  oppositionSurgeFactor,
  penumbraShading,
  shadowAxisOffsetKm,
  turbidityToDanjonL,
  umbraShading,
} from '../lunarEclipse';
import { interpolateEphemeris } from '../solarEclipse';
import { TIMELINE_PAD_SEC, lstRadFromUnixSec } from '../solarEclipseLab';
import { labSkyColors } from '../labSky';
import {
  LUNAR_ALBEDO_MEAN,
  LUNAR_BASE_LIMITING_MAG,
  LUNAR_EXPOSURE_GAIN_MAX,
  LUNAR_EXPOSURE_GAIN_MIN,
  LUNAR_FAST_PLAYBACK_TARGET_SEC,
  LUNAR_QUAD_HALF_ANGLE_RAD,
  MOONLIGHT_HORIZON_GAIN,
  MOONLIGHT_ZENITH_GAIN,
  UMBRA_EDGE_BLEND_FRAC,
  activeLunarPhaseKey,
  bloodMoonIlluminationRgb,
  danjonResidualBrightness01,
  defaultTurbidityForDanjonL,
  emptyLunarFrameState,
  lunarEclipseAnchors,
  lunarExposureGain,
  lunarFrameState,
  lunarMoonBrightness01,
  lunarPlayRate,
  lunarSkyColorsWithMoonlight,
  lunarTimelineWindow,
  moonLimbSurgeGain,
  parallacticAngleRad,
  type LunarSeriesGroup,
} from '../lunarEclipseLab';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/lunar_eclipses.json'), 'utf8')
) as unknown;
const data = validateLunarEclipses(raw);
if (!data) throw new Error('真实产物未通过 validateLunarEclipses');
const events = new Map(data.events.map((e) => [e.id, e]));
const l2029 = events.get('l2029') as LunarEclipseEventData;
const l2026 = events.get('l2026') as LunarEclipseEventData;
const l2027 = events.get('l2027') as LunarEclipseEventData;

const DEG = Math.PI / 180;

function groupOf(ev: LunarEclipseEventData): LunarSeriesGroup {
  return { topo: ev.topo, geo: ev.geo };
}

describe('lunarTimelineWindow（P1−15min → P4+15min）', () => {
  it('窗口 = 接触时刻 ± TIMELINE_PAD_SEC', () => {
    const win = lunarTimelineWindow(l2029.contacts);
    expect(win.startSec).toBe(l2029.contacts.p1 - TIMELINE_PAD_SEC);
    expect(win.endSec).toBe(l2029.contacts.p4 + TIMELINE_PAD_SEC);
  });

  it('接触时刻非法即抛错', () => {
    expect(() =>
      lunarTimelineWindow({ ...l2029.contacts, p1: l2029.contacts.p4 + 1 })
    ).toThrow(RangeError);
  });
});

describe('lunarEclipseAnchors（契约 C7：按 contacts 缺省传子集）', () => {
  it('全食事件 7 锚点，时序递增', () => {
    const anchors = lunarEclipseAnchors(l2029.contacts);
    expect(anchors.map((a) => a.key)).toEqual(['p1', 'u1', 'u2', 'max', 'u3', 'u4', 'p4']);
    for (let i = 1; i < anchors.length; i += 1) {
      expect(anchors[i].tSec).toBeGreaterThan(anchors[i - 1].tSec);
    }
    expect(anchors[0].labelKey).toBe('lab.lunarAnchorP1');
    expect(anchors[3].labelKey).toBe('lab.lunarAnchorMax');
  });

  it('偏食事件 5 锚点（无 U2/U3）', () => {
    const anchors = lunarEclipseAnchors(l2026.contacts);
    expect(anchors.map((a) => a.key)).toEqual(['p1', 'u1', 'max', 'u4', 'p4']);
  });

  it('半影食事件 3 锚点（仅 P1/食甚/P4）', () => {
    const anchors = lunarEclipseAnchors(l2027.contacts);
    expect(anchors.map((a) => a.key)).toEqual(['p1', 'max', 'p4']);
  });
});

describe('lunarPlayRate（B1 加速回放）', () => {
  it('real 档恒 ×1', () => {
    expect(lunarPlayRate('real', lunarTimelineWindow(l2029.contacts))).toBe(1);
  });

  it('fast 档 = 窗口跨度 / 90s（四事件全程均压缩到 ~1.5 分钟）', () => {
    for (const ev of [l2029, l2026, l2027]) {
      const win = lunarTimelineWindow(ev.contacts);
      const rate = lunarPlayRate('fast', win);
      expect(rate).toBeCloseTo((win.endSec - win.startSec) / LUNAR_FAST_PLAYBACK_TARGET_SEC, 6);
      // 全程（含前后 pad）回放时长恰为目标值
      expect((win.endSec - win.startSec) / rate).toBeCloseTo(LUNAR_FAST_PLAYBACK_TARGET_SEC, 6);
    }
  });

  it('极短窗口钳制 ×1；非法窗口抛错', () => {
    expect(lunarPlayRate('fast', { startSec: 0, endSec: 30 })).toBe(1);
    expect(() => lunarPlayRate('fast', { startSec: 10, endSec: 10 })).toThrow(RangeError);
  });
});

describe('activeLunarPhaseKey（阶段科普卡区段）', () => {
  it('全食事件：P1 前归 p1，各锚点起切换，P4 后保持 p4', () => {
    const c = l2029.contacts;
    expect(activeLunarPhaseKey(c.p1 - 600, c)).toBe('p1');
    expect(activeLunarPhaseKey(c.p1, c)).toBe('p1');
    expect(activeLunarPhaseKey((c.u1 as number) + 1, c)).toBe('u1');
    expect(activeLunarPhaseKey((c.u2 as number) + 1, c)).toBe('u2');
    expect(activeLunarPhaseKey(c.max, c)).toBe('max');
    expect(activeLunarPhaseKey((c.u3 as number) + 1, c)).toBe('u3');
    expect(activeLunarPhaseKey((c.u4 as number) + 1, c)).toBe('u4');
    expect(activeLunarPhaseKey(c.p4 + 600, c)).toBe('p4');
  });

  it('半影食事件：缺省锚点跳过（u1..u4 不出现）', () => {
    const c = l2027.contacts;
    expect(activeLunarPhaseKey((c.p1 + c.max) / 2, c)).toBe('p1');
    expect(activeLunarPhaseKey(c.max + 1, c)).toBe('max');
    expect(activeLunarPhaseKey(c.p4 + 1, c)).toBe('p4');
  });

  it('非法 tSec 抛错', () => {
    expect(() => activeLunarPhaseKey(NaN, l2029.contacts)).toThrow(RangeError);
  });
});

describe('parallacticAngleRad', () => {
  it('子午圈上（H=0）q=0；东西反号（奇对称）', () => {
    expect(parallacticAngleRad(0, 45, 10)).toBeCloseTo(0, 12);
    const qWest = parallacticAngleRad(0.3, 45, 10);
    const qEast = parallacticAngleRad(-0.3, 45, 10);
    expect(qWest).toBeGreaterThan(0);
    expect(qEast).toBeCloseTo(-qWest, 12);
  });

  it('非法入参抛错', () => {
    expect(() => parallacticAngleRad(NaN, 0, 0)).toThrow(RangeError);
    expect(() => parallacticAngleRad(0, Infinity, 0)).toThrow(RangeError);
  });
});

describe('lunarFrameState（真实烘焙数据锚点）', () => {
  it('l2029 食甚：食型 total、本影食分 ≈ 目录值、影半径视角量落真实量级', () => {
    const f = lunarFrameState(groupOf(l2029), l2029.observer, l2029.contacts.max);
    expect(f.kind).toBe('total');
    expect(Math.abs(f.umbralMag - l2029.umbralMag)).toBeLessThan(0.02);
    expect(Math.abs(f.penumbralMag - l2029.penumbralMag)).toBeLessThan(0.02);
    // 月距处本影 ≈ 0.72 R⊕ / 半影 ≈ 1.28 R⊕ → 视角 ~0.68° / ~1.2°
    expect(f.umbraRadRad / DEG).toBeGreaterThan(0.6);
    expect(f.umbraRadRad / DEG).toBeLessThan(0.8);
    expect(f.penumbraRadRad / DEG).toBeGreaterThan(1.1);
    expect(f.penumbraRadRad / DEG).toBeLessThan(1.4);
    expect(f.penumbraRadRad).toBeGreaterThan(f.umbraRadRad);
    // 观测点选定判据：食甚月高 > 45°（M1 契约 C2 已锁，此处消费侧复证）
    expect(f.moonAltDeg).toBeGreaterThan(45);
    // 夜间：太阳在地平下
    expect(f.sunAltDeg).toBeLessThan(0);
    // γ≈0.012 几乎中心穿越：影盘偏移远小于本影半径
    const off = Math.hypot(f.shadowOffEastRad, f.shadowOffUpRad);
    expect(off).toBeLessThan(f.umbraRadRad * 0.2);
  });

  it('影盘偏移幅值 = 影轴垂距 / 月距（方位链与 C1 垂距互证）', () => {
    const t = l2029.contacts.u1 as number;
    const f = lunarFrameState(groupOf(l2029), l2029.observer, t);
    const row = l2029.geo.rows[Math.round((t - l2029.geo.t0) / l2029.geo.dtSec)];
    // 用最近采样行的垂距做量级校验（插值差 ≪ 5%）
    const sun: [number, number, number] = [row[0] * row[3], row[1] * row[3], row[2] * row[3]];
    const moon: [number, number, number] = [row[4] * row[7], row[5] * row[7], row[6] * row[7]];
    const expected = shadowAxisOffsetKm(sun, moon) / row[7];
    const off = Math.hypot(f.shadowOffEastRad, f.shadowOffUpRad);
    expect(Math.abs(off - expected) / expected).toBeLessThan(0.05);
  });

  /** 测试侧独立求「影盘中心 − 月心」在月位置天空切平面的赤道东/北分量（弧度） */
  function equatorialShadowOffset(
    ev: LunarEclipseEventData,
    tSec: number
  ): { dE: number; dN: number; raRad: number; decDeg: number } {
    const row = interpolateEphemeris(ev.geo, tSec);
    const sun: [number, number, number] = [row[0] * row[3], row[1] * row[3], row[2] * row[3]];
    const moon: [number, number, number] = [row[4] * row[7], row[5] * row[7], row[6] * row[7]];
    const sunDist = Math.hypot(...sun);
    const axisUnit = [-sun[0] / sunDist, -sun[1] / sunDist, -sun[2] / sunDist];
    const axial = moon[0] * axisUnit[0] + moon[1] * axisUnit[1] + moon[2] * axisUnit[2];
    const delta = [
      axisUnit[0] * axial - moon[0],
      axisUnit[1] * axial - moon[1],
      axisUnit[2] * axial - moon[2],
    ];
    const dist = row[7];
    const l = [moon[0] / dist, moon[1] / dist, moon[2] / dist];
    const eLen = Math.hypot(l[0], l[1]);
    const e = [-l[1] / eLen, l[0] / eLen, 0];
    const n = [-l[2] * e[1], l[2] * e[0], l[0] * e[1] - l[1] * e[0]];
    return {
      dE: (delta[0] * e[0] + delta[1] * e[1]) / dist,
      dN: (delta[0] * n[0] + delta[1] * n[1] + delta[2] * n[2]) / dist,
      raRad: Math.atan2(l[1], l[0]),
      decDeg: (Math.asin(Math.min(1, Math.max(-1, l[2]))) * 180) / Math.PI,
    };
  }

  it('U1 ↔ U4 缺口方位在赤道天空系反向（影轴几何随时间变化，M2-CP 机器防守）', () => {
    // 近中心穿越（γ≈0.012）：月球从影盘一侧进、另一侧出——垂距向量反向。
    // 注意反向断言在赤道系成立；地平系方位另叠加视差角旋转（圣保罗近天顶
    // 中天，U1→U4 间 q 摆动近 180°，horizontal 分量不保证反向——物理真实）。
    const o1 = equatorialShadowOffset(l2029, l2029.contacts.u1 as number);
    const o4 = equatorialShadowOffset(l2029, l2029.contacts.u4 as number);
    expect(o1.dE * o4.dE + o1.dN * o4.dN).toBeLessThan(0);
  });

  it('地平系偏移 = 赤道系偏移经视差角旋转（方位全链镜像互证）', () => {
    for (const t of [l2029.contacts.u1 as number, l2029.contacts.u4 as number]) {
      const f = lunarFrameState(groupOf(l2029), l2029.observer, t);
      const eq = equatorialShadowOffset(l2029, t);
      const hourAngle = lstRadFromUnixSec(t, l2029.observer.lonDeg) - eq.raRad;
      const q = parallacticAngleRad(hourAngle, l2029.observer.latDeg, eq.decDeg);
      expect(f.shadowOffUpRad).toBeCloseTo(eq.dE * Math.sin(q) + eq.dN * Math.cos(q), 8);
      expect(f.shadowOffEastRad).toBeCloseTo(eq.dE * Math.cos(q) - eq.dN * Math.sin(q), 8);
    }
  });

  it('l2027 半影食：全程 kind ∈ {none, penumbral}，食甚为 penumbral', () => {
    const g = groupOf(l2027);
    const win = lunarTimelineWindow(l2027.contacts);
    const out = emptyLunarFrameState();
    for (let t = win.startSec; t <= win.endSec; t += 600) {
      const f = lunarFrameState(g, l2027.observer, t, out);
      expect(f.kind === 'none' || f.kind === 'penumbral').toBe(true);
    }
    expect(lunarFrameState(g, l2027.observer, l2027.contacts.max).kind).toBe('penumbral');
  });

  it('l2026 偏食：食甚 kind partial、本影食分 ≈ 0.93 目录值', () => {
    const f = lunarFrameState(groupOf(l2026), l2026.observer, l2026.contacts.max);
    expect(f.kind).toBe('partial');
    expect(Math.abs(f.umbralMag - l2026.umbralMag)).toBeLessThan(0.02);
  });

  it('星空显现链（M3-3）：窗口边缘满月压制 ≈ −4 等、食甚恒星显现（生光后隐去）', () => {
    const g = groupOf(l2029);
    // 窗口起点（P1 前）：满月，月光压制满额
    const win = lunarTimelineWindow(l2029.contacts);
    const full = lunarFrameState(g, l2029.observer, win.startSec);
    expect(full.moonBrightness01).toBeGreaterThan(0.99);
    expect(full.limitingMag).toBeLessThanOrEqual(LUNAR_BASE_LIMITING_MAG - 3.5);
    // 食甚（全食）：月面变暗 ~万倍 → 压制几乎消失 → 恒星浮现
    const max = lunarFrameState(g, l2029.observer, l2029.contacts.max);
    expect(max.moonBrightness01).toBeLessThan(1e-3);
    expect(max.limitingMag).toBeGreaterThan(5.5);
    // 复圆后（U4 → P4 中点）：月面基本回亮，恒星再度被压制
    const late = lunarFrameState(
      g,
      l2029.observer,
      ((l2029.contacts.u4 as number) + l2029.contacts.p4) / 2
    );
    expect(late.limitingMag).toBeLessThan(4);
  });

  it('丹戎 L 驱动全食残余亮度：食甚 L4 亮于 L0（浑浊度链的帧状态侧）', () => {
    const g = groupOf(l2029);
    const t = l2029.contacts.max;
    const l0 = lunarFrameState(g, l2029.observer, t, undefined, 0);
    const l4 = lunarFrameState(g, l2029.observer, t, undefined, 4);
    expect(l4.moonBrightness01).toBeGreaterThan(l0.moonBrightness01 * 10);
  });

  it('out 复用：同一对象重复填充引用不变（渲染循环零 GC）', () => {
    const out = emptyLunarFrameState();
    const r = lunarFrameState(groupOf(l2029), l2029.observer, l2029.contacts.max, out);
    expect(r).toBe(out);
  });

  it('向日侧哨兵：日月同侧 → kind none、食分哨兵、偏移/影半径归零', () => {
    const group: LunarSeriesGroup = {
      topo: { t0: 0, dtSec: 60, rows: [[45, 90, 0.26, -30]] },
      geo: {
        t0: 0,
        dtSec: 300,
        // 月球在向日侧（与太阳同方向）
        rows: [[1, 0, 0, 1.5e8, 1, 0, 0, 384400]],
      },
    };
    const f = lunarFrameState(group, { latDeg: 0, lonDeg: 0 }, 0);
    expect(f.kind).toBe('none');
    expect(f.umbralMag).toBe(NO_ECLIPSE_MAGNITUDE);
    expect(f.penumbralMag).toBe(NO_ECLIPSE_MAGNITUDE);
    expect(f.shadowOffEastRad).toBe(0);
    expect(f.umbraRadRad).toBe(0);
    // 哨兵路径亮度链口径：满月（月光压制满额）
    expect(f.moonBrightness01).toBe(1);
    expect(Number.isFinite(f.limitingMag)).toBe(true);
  });

  it('天极方向防御分支：月位置沿 ±z（背日向）→ 偏移归零不 NaN、亮度链有效', () => {
    const group: LunarSeriesGroup = {
      topo: { t0: 0, dtSec: 60, rows: [[45, 90, 0.26, -30]] },
      geo: {
        t0: 0,
        dtSec: 300,
        // 太阳沿 −z、月球沿 +z（背日向，axial > R⊕ 不触向日哨兵）→ eLen=0
        rows: [[0, 0, -1, 1.5e8, 0, 0, 1, 384400]],
      },
    };
    const f = lunarFrameState(group, { latDeg: 0, lonDeg: 0 }, 0);
    expect(f.shadowOffEastRad).toBe(0);
    expect(f.shadowOffUpRad).toBe(0);
    expect(Number.isFinite(f.umbralMag)).toBe(true);
    expect(Number.isFinite(f.moonBrightness01)).toBe(true);
  });
});

/** Rec.709 感知亮度（径向梯度/档间悬殊断言的标量化） */
function luma(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

describe('bloodMoonIlluminationRgb（M3-1 契约 C4 CPU 事实源；红线 ①② 机器防守）', () => {
  const u = 0.7 * DEG;
  const p = 1.25 * DEG;

  it('本影深处 = 丹戎色表 ÷ 平均反照（GLSL 镜像的 CPU 端锚点）', () => {
    for (const l of [0, 1.3, 2, 4]) {
      const center = bloodMoonIlluminationRgb(0, u, p, l);
      const expected = umbraShading(0, l);
      for (let c = 0; c < 3; c += 1) {
        expect(center[c]).toBeCloseTo(expected[c] / LUNAR_ALBEDO_MEAN, 10);
      }
    }
  });

  it('红线 ①：本影内径向梯度——影心 → 0.9 影缘感知亮度严格递增且非均匀', () => {
    for (const l of [0, 1, 2, 3, 4]) {
      let prev = -1;
      for (let r = 0; r <= 0.901; r += 0.05) {
        const v = luma(bloodMoonIlluminationRgb(r * u, u, p, l));
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
      // 均匀染红即为错：0.9 影缘至少比影心亮 2 倍（可见性锚点）
      const ratio =
        luma(bloodMoonIlluminationRgb(0.9 * u, u, p, l)) /
        luma(bloodMoonIlluminationRgb(0, u, p, l));
      expect(ratio).toBeGreaterThan(2);
    }
  });

  it('红线 ②：半影段（混合带外）逐点 = penumbraShading，r≥0.6 段变暗 <0.09', () => {
    const rhoEdge = u * (1 + UMBRA_EDGE_BLEND_FRAC) + 1e-9;
    const rPenEdge = (rhoEdge - u) / (p - u);
    const vEdge = bloodMoonIlluminationRgb(rhoEdge, u, p, 3);
    expect(vEdge[1]).toBeCloseTo(penumbraShading(rPenEdge), 6);
    expect(vEdge[0]).toBeCloseTo(vEdge[1], 12); // 直射分量为灰度
    const rOuter = u + 0.6 * (p - u);
    const vOuter = bloodMoonIlluminationRgb(rOuter, u, p, 3);
    expect(1 - vOuter[0]).toBeLessThan(0.09);
    // 半影外全亮
    expect(bloodMoonIlluminationRgb(p * 2, u, p, 3)[0]).toBeCloseTo(1, 12);
  });

  it('丹戎 L0 ↔ L4 悬殊（一键对比目验点的机器侧：本影中带亮度比 > 8）', () => {
    const l0 = luma(bloodMoonIlluminationRgb(0.5 * u, u, p, 0));
    const l4 = luma(bloodMoonIlluminationRgb(0.5 * u, u, p, 4));
    expect(l4 / l0).toBeGreaterThan(8);
  });

  it('limbGain 只乘直射分量：影外/半影随增益、本影深处不受影响（B5 不双计）', () => {
    const g = 1.4;
    expect(bloodMoonIlluminationRgb(p * 1.5, u, p, 2, g)[0]).toBeCloseTo(g, 12);
    const deep = bloodMoonIlluminationRgb(0, u, p, 2, 1);
    const deepG = bloodMoonIlluminationRgb(0, u, p, 2, g);
    expect(deepG[0]).toBeCloseTo(deep[0], 12);
  });

  it('半影食退化（umbraR=0）：全域灰度 penumbraShading，无本影分支', () => {
    const v = bloodMoonIlluminationRgb(0, 0, 1 * DEG, 2);
    expect(v[0]).toBeCloseTo(penumbraShading(0), 12);
    expect(v[2]).toBeCloseTo(v[0], 12);
  });

  it('out 复用引用不变；非法入参抛错', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(bloodMoonIlluminationRgb(0.5 * u, u, p, 2, 1, out)).toBe(out);
    expect(() => bloodMoonIlluminationRgb(-1, u, p, 2)).toThrow(RangeError);
    expect(() => bloodMoonIlluminationRgb(NaN, u, p, 2)).toThrow(RangeError);
    expect(() => bloodMoonIlluminationRgb(0, p, u, 2)).toThrow(RangeError);
    expect(() => bloodMoonIlluminationRgb(0, u, p, 2, -1)).toThrow(RangeError);
  });

  it('quad 半角常量覆盖月盘（最大月视半径 ~0.28° < 0.5°）', () => {
    expect(LUNAR_QUAD_HALF_ANGLE_RAD).toBeGreaterThan(0.29 * DEG);
  });
});

describe('moonLimbSurgeGain（M3-4 月缘增亮；B5 简化逆反射）', () => {
  it('盘心 1、月缘 = 对冲峰值（振幅派生自 oppositionSurgeFactor，勿硬编码）', () => {
    expect(moonLimbSurgeGain(0)).toBe(1);
    expect(moonLimbSurgeGain(1)).toBeCloseTo(oppositionSurgeFactor(0), 12);
  });

  it('径向单调增、越界钳制、非法入参抛错', () => {
    let prev = 0;
    for (let r = 0; r <= 1.001; r += 0.1) {
      const v = moonLimbSurgeGain(Math.min(1, r));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(moonLimbSurgeGain(-1)).toBe(1);
    expect(moonLimbSurgeGain(2)).toBeCloseTo(moonLimbSurgeGain(1), 12);
    expect(() => moonLimbSurgeGain(NaN)).toThrow(RangeError);
  });
});

describe('lunarMoonBrightness01 + danjonResidualBrightness01（M3-3 星空显现链）', () => {
  const moonR = 0.26 * DEG;
  const u = 0.7 * DEG;
  const p = 1.25 * DEG;

  it('danjonResidualBrightness01：L2 = 1e-4（「变暗~万倍」锚点）、端点与钳制', () => {
    expect(danjonResidualBrightness01(2)).toBeCloseTo(1e-4, 10);
    expect(danjonResidualBrightness01(0)).toBeCloseTo(1e-5, 10);
    expect(danjonResidualBrightness01(4)).toBeCloseTo(1e-3, 10);
    expect(danjonResidualBrightness01(-1)).toBeCloseTo(1e-5, 10);
    expect(danjonResidualBrightness01(9)).toBeCloseTo(1e-3, 10);
    expect(() => danjonResidualBrightness01(NaN)).toThrow(RangeError);
  });

  it('无遮挡 → 1；全深本影 → 丹戎残余；偏食居中；随垂距非减', () => {
    expect(lunarMoonBrightness01(5 * DEG, moonR, u, p, 2)).toBe(1);
    expect(lunarMoonBrightness01(0, moonR, u, p, 2)).toBeCloseTo(
      danjonResidualBrightness01(2),
      6
    );
    const partial = lunarMoonBrightness01(u, moonR, u, p, 2);
    expect(partial).toBeGreaterThan(1e-3);
    expect(partial).toBeLessThan(0.9);
    let prev = -1;
    for (let sep = 0; sep <= 2.5 * DEG; sep += 0.05 * DEG) {
      const v = lunarMoonBrightness01(sep, moonR, u, p, 2);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('无影哨兵（penumbraR ≤ 0）→ 1；非法入参抛错', () => {
    expect(lunarMoonBrightness01(0, moonR, 0, 0, 2)).toBe(1);
    expect(() => lunarMoonBrightness01(-1, moonR, u, p, 2)).toThrow(RangeError);
    expect(() => lunarMoonBrightness01(0, 0, u, p, 2)).toThrow(RangeError);
    expect(() => lunarMoonBrightness01(0, moonR, p, u, 2)).toThrow(RangeError);
  });
});

describe('lunarSkyColorsWithMoonlight（M3-3 天光/地面月光联动）', () => {
  it('b=0 等于 labSkyColors 基色（月食深处环境回落到纯夜天光）', () => {
    const base = labSkyColors(6.5, -0.6);
    const sky = lunarSkyColorsWithMoonlight(6.5, -0.6, 0, 60);
    for (let c = 0; c < 3; c += 1) {
      expect(sky.zenith[c]).toBeCloseTo(base.zenith[c], 12);
      expect(sky.horizon[c]).toBeCloseTo(base.horizon[c], 12);
    }
  });

  it('满月 + 月高满效：叠加月光增量（地平/天顶各按登记常量）', () => {
    const base = labSkyColors(6.5, -0.6);
    const sky = lunarSkyColorsWithMoonlight(6.5, -0.6, 1, 90);
    for (let c = 0; c < 3; c += 1) {
      expect(sky.zenith[c]).toBeCloseTo(base.zenith[c] + MOONLIGHT_ZENITH_GAIN[c], 12);
      expect(sky.horizon[c]).toBeCloseTo(base.horizon[c] + MOONLIGHT_HORIZON_GAIN[c], 12);
    }
  });

  it('月亮地平下无月光项；out 复用引用不变；非法入参抛错', () => {
    const base = labSkyColors(6.5, -0.6);
    const sky = lunarSkyColorsWithMoonlight(6.5, -0.6, 1, -5);
    expect(sky.zenith[0]).toBeCloseTo(base.zenith[0], 12);
    const out = labSkyColors(6.5, -0.6);
    expect(lunarSkyColorsWithMoonlight(6.5, -0.6, 0.5, 45, out)).toBe(out);
    expect(() => lunarSkyColorsWithMoonlight(6.5, -0.6, NaN, 45)).toThrow(RangeError);
    expect(() => lunarSkyColorsWithMoonlight(6.5, -0.6, 1, NaN)).toThrow(RangeError);
  });
});

describe('M3-2 控件映射（浑浊度逆映射 / 曝光增益）', () => {
  it('defaultTurbidityForDanjonL 与 turbidityToDanjonL 往返恒等（五档 + 连续值）', () => {
    for (const l of [0, 1, 2, 2.5, 3, 4]) {
      expect(turbidityToDanjonL(defaultTurbidityForDanjonL(l))).toBeCloseTo(l, 12);
    }
    expect(defaultTurbidityForDanjonL(9)).toBe(0);
    expect(defaultTurbidityForDanjonL(-1)).toBe(1);
    expect(() => defaultTurbidityForDanjonL(NaN)).toThrow(RangeError);
  });

  it('lunarExposureGain：端点 ×0.25/×4、中点 ×1、单调、钳制、非法抛错', () => {
    expect(lunarExposureGain(0)).toBeCloseTo(LUNAR_EXPOSURE_GAIN_MIN, 12);
    expect(lunarExposureGain(1)).toBeCloseTo(LUNAR_EXPOSURE_GAIN_MAX, 12);
    expect(lunarExposureGain(0.5)).toBeCloseTo(1, 12);
    let prev = 0;
    for (let x = 0; x <= 1.001; x += 0.1) {
      const v = lunarExposureGain(Math.min(1, x));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(lunarExposureGain(-1)).toBeCloseTo(LUNAR_EXPOSURE_GAIN_MIN, 12);
    expect(lunarExposureGain(2)).toBeCloseTo(LUNAR_EXPOSURE_GAIN_MAX, 12);
    expect(() => lunarExposureGain(NaN)).toThrow(RangeError);
  });
});
