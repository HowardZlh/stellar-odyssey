/**
 * E-M2 场景侧纯逻辑单测（§M2 / 契约 C4 / C7）：时间轴窗口/五锚点数据驱动
 * 列表/细采样选序/恒星时/逐帧状态（真实烘焙星历喂入——食甚遮挡率≈1、
 * C1/C4 锚点遮挡率≈0、缺角方位随月球来向翻转 = 位置角接线防守）/HUD 格式化。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateSolarEclipses, type SolarEclipsesData } from '@/utils/bakedData';
import {
  ECLIPSE_PLAY_RATE,
  ECLIPSE_QUAD_HALF_ANGLE_RAD,
  PHOTOSPHERE_HDR_BRIGHTNESS,
  TIMELINE_PAD_SEC,
  eclipseFrameState,
  eclipseTimelineWindow,
  emptyEclipseFrameState,
  formatAngularDiameterDeg,
  formatUtcClock,
  gmstRadFromUnixSec,
  lstRadFromUnixSec,
  pickEclipseSeries,
  solarEclipseAnchors,
  wrapDeg180,
  type EclipseContacts,
  type EclipseSeriesGroup,
} from '@/utils/solarEclipseLab';

const DEG = Math.PI / 180;

const eclipses = validateSolarEclipses(
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/solar_eclipses.json'), 'utf8'))
) as SolarEclipsesData;

const e2027 = eclipses.events[0];

describe('eclipseTimelineWindow（§3.1：C1−15min → C4+15min）', () => {
  it('窗口 = 接触时刻外扩 TIMELINE_PAD_SEC', () => {
    const win = eclipseTimelineWindow(e2027.contacts);
    expect(win.startSec).toBeCloseTo(e2027.contacts.c1 - TIMELINE_PAD_SEC, 6);
    expect(win.endSec).toBeCloseTo(e2027.contacts.c4 + TIMELINE_PAD_SEC, 6);
    expect(TIMELINE_PAD_SEC).toBe(900);
  });

  it('三事件窗口均落在烘焙 topo 采样窗内（插值不越界钳制）', () => {
    for (const ev of eclipses.events) {
      const win = eclipseTimelineWindow(ev.contacts);
      const topoEnd = ev.topo.t0 + (ev.topo.rows.length - 1) * ev.topo.dtSec;
      expect(win.startSec).toBeGreaterThanOrEqual(ev.topo.t0);
      expect(win.endSec).toBeLessThanOrEqual(topoEnd);
    }
  });

  it('c1 ≥ c4 时抛 RangeError（防御）', () => {
    const bad: EclipseContacts = { c1: 100, c2: 90, max: 80, c3: 70, c4: 60 };
    expect(() => eclipseTimelineWindow(bad)).toThrow(RangeError);
  });
});

describe('solarEclipseAnchors（契约 C7：数据驱动锚点列表）', () => {
  it('五锚点按时间线序，key/labelKey/tSec 齐全', () => {
    const anchors = solarEclipseAnchors(e2027.contacts);
    expect(anchors.map((a) => a.key)).toEqual(['c1', 'c2', 'max', 'c3', 'c4']);
    expect(anchors.map((a) => a.labelKey)).toEqual([
      'lab.eclipseAnchorC1',
      'lab.eclipseAnchorC2',
      'lab.eclipseAnchorMax',
      'lab.eclipseAnchorC3',
      'lab.eclipseAnchorC4',
    ]);
    expect(anchors.map((a) => a.tSec)).toEqual([
      e2027.contacts.c1,
      e2027.contacts.c2,
      e2027.contacts.max,
      e2027.contacts.c3,
      e2027.contacts.c4,
    ]);
    // 严格递增（scrubber 刻度前提）
    for (let i = 1; i < anchors.length; i += 1) {
      expect(anchors[i].tSec).toBeGreaterThan(anchors[i - 1].tSec);
    }
  });
});

describe('pickEclipseSeries（契约 C2：细采样段优先）', () => {
  const group: EclipseSeriesGroup = e2027;

  it('C2±3min 窗内选 fineC2、C3±3min 窗内选 fineC3、其余 topo', () => {
    expect(pickEclipseSeries(group, e2027.contacts.c2)).toBe(e2027.fineC2);
    expect(pickEclipseSeries(group, e2027.contacts.c3)).toBe(e2027.fineC3);
    expect(pickEclipseSeries(group, e2027.contacts.c1)).toBe(e2027.topo);
    expect(pickEclipseSeries(group, e2027.contacts.c4)).toBe(e2027.topo);
  });

  it('细采样窗边界（首/末行时刻）命中细采样段', () => {
    const fineEnd = e2027.fineC2.t0 + (e2027.fineC2.rows.length - 1) * e2027.fineC2.dtSec;
    expect(pickEclipseSeries(group, e2027.fineC2.t0)).toBe(e2027.fineC2);
    expect(pickEclipseSeries(group, fineEnd)).toBe(e2027.fineC2);
    expect(pickEclipseSeries(group, e2027.fineC2.t0 - 0.5)).toBe(e2027.topo);
    expect(pickEclipseSeries(group, fineEnd + 0.5)).toBe(e2027.topo);
  });
});

describe('恒星时（星穹矩阵输入；IAU 1982 近似登记）', () => {
  it('J2000 历元（2000-01-01 12:00 UTC）GMST ≈ 280.4606°', () => {
    const j2000UnixSec = 946728000;
    expect(gmstRadFromUnixSec(j2000UnixSec)).toBeCloseTo(280.46061837 * DEG, 6);
  });

  it('LST = GMST + 东经（度→弧度，[0, 2π) 归一）', () => {
    const t = 946728000;
    const gmst = gmstRadFromUnixSec(t);
    expect(lstRadFromUnixSec(t, 0)).toBeCloseTo(gmst, 12);
    expect(lstRadFromUnixSec(t, 90)).toBeCloseTo((gmst + Math.PI / 2) % (2 * Math.PI), 12);
    // 西经与 +360° 东经等价（归一防负）
    expect(lstRadFromUnixSec(t, -40.3497)).toBeCloseTo(lstRadFromUnixSec(t, 319.6503), 9);
    expect(lstRadFromUnixSec(t, -40.3497)).toBeGreaterThanOrEqual(0);
    expect(lstRadFromUnixSec(t, -40.3497)).toBeLessThan(2 * Math.PI);
  });

  it('非有限入参抛 RangeError', () => {
    expect(() => gmstRadFromUnixSec(Number.NaN)).toThrow(RangeError);
    expect(() => lstRadFromUnixSec(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('wrapDeg180（方位角最短弧差）', () => {
  it('折入 (−180°, 180°]', () => {
    expect(wrapDeg180(0)).toBe(0);
    expect(wrapDeg180(190)).toBe(-170);
    expect(wrapDeg180(-190)).toBe(170);
    expect(wrapDeg180(360)).toBe(0);
    expect(wrapDeg180(180)).toBe(180);
    expect(wrapDeg180(-180)).toBe(180);
  });
});

describe('eclipseFrameState（tSec 单值重建；真实烘焙星历）', () => {
  it('食甚：遮挡率 ≈1、kind=total、食分 ≈ 事件权威食分（±0.01）', () => {
    const frame = eclipseFrameState(e2027, e2027.contacts.max);
    expect(frame.obscuration01).toBeGreaterThan(0.999);
    expect(frame.kind).toBe('total');
    expect(frame.magnitude).toBeCloseTo(e2027.magnitude, 2);
    // 全食骤暗（§1.4 断崖；M2 只接线不目验全食景观）
    expect(frame.skyFactor01).toBeLessThan(0.1);
    expect(frame.limitingMag).toBeGreaterThan(3);
  });

  it('C1/C4 锚点：遮挡率 ≈0（验收锚点）；窗口端点无食', () => {
    for (const ev of eclipses.events) {
      expect(eclipseFrameState(ev, ev.contacts.c1).obscuration01).toBeLessThan(0.01);
      expect(eclipseFrameState(ev, ev.contacts.c4).obscuration01).toBeLessThan(0.01);
      const win = eclipseTimelineWindow(ev.contacts);
      expect(eclipseFrameState(ev, win.startSec).kind).toBe('none');
      expect(eclipseFrameState(ev, win.startSec).skyFactor01).toBeGreaterThan(0.9);
    }
  });

  it('偏食渐进：C1→食甚遮挡率单调爬升（无帧间累积，任意 seek 可重建）', () => {
    const { c1, max } = e2027.contacts;
    let prev = -1;
    for (let i = 0; i <= 8; i += 1) {
      const t = c1 + ((max - c1) * i) / 8;
      const obs = eclipseFrameState(e2027, t).obscuration01;
      expect(obs).toBeGreaterThanOrEqual(prev);
      prev = obs;
    }
    expect(prev).toBeGreaterThan(0.999);
  });

  it('缺角方位随月球来向（位置角接线防守：C1 侧靠近、C4 侧远离，方向连续）', () => {
    // 注：C1 与 C4 的偏移向量并非严格反向——地平切平面随周日运动旋转
    // （视差角效应，实测夹角 ~60–120°），故以「径向速度符号」防守方向链：
    // C1 时月盘向日心靠近（offset·d(offset)/dt < 0）、C4 时远离（> 0）。
    for (const ev of eclipses.events) {
      const dtSec = 60;
      const radialDot = (tSec: number): number => {
        const a = eclipseFrameState(ev, tSec);
        const b = eclipseFrameState(ev, tSec + dtSec);
        const vEast = b.offEastRad - a.offEastRad;
        const vUp = b.offUpRad - a.offUpRad;
        return a.offEastRad * vEast + a.offUpRad * vUp;
      };
      expect(radialDot(ev.contacts.c1)).toBeLessThan(0);
      expect(radialDot(ev.contacts.c4)).toBeGreaterThan(0);
      // 偏移方向跨事件持续转动但不突跳（相邻采样夹角 < 5°：uniform 连续性）
      const mid = eclipseFrameState(ev, (ev.contacts.c1 + ev.contacts.max) / 2);
      const mid2 = eclipseFrameState(ev, (ev.contacts.c1 + ev.contacts.max) / 2 + dtSec);
      const cosBetween =
        (mid.offEastRad * mid2.offEastRad + mid.offUpRad * mid2.offUpRad) /
        (Math.hypot(mid.offEastRad, mid.offUpRad) * Math.hypot(mid2.offEastRad, mid2.offUpRad));
      expect(cosBetween).toBeGreaterThan(Math.cos(5 * DEG));
    }
  });

  it('切平面偏移模长 ≈ 球面角距（小角近似自洽，相对误差 <1e-3）', () => {
    const t = (e2027.contacts.c1 + e2027.contacts.max) / 2;
    const f = eclipseFrameState(e2027, t);
    const offNorm = Math.hypot(f.offEastRad, f.offUpRad);
    expect(offNorm).toBeCloseTo(f.sepDeg * DEG, 5);
    expect(Math.abs(offNorm - f.sepDeg * DEG) / (f.sepDeg * DEG)).toBeLessThan(1e-3);
  });

  it('out 参数复用（渲染循环零 GC 口径）：返回同一引用并覆写', () => {
    const out = emptyEclipseFrameState();
    const returned = eclipseFrameState(e2027, e2027.contacts.max, out);
    expect(returned).toBe(out);
    expect(out.kind).toBe('total');
    // 复用后再算另一时刻：无残留
    eclipseFrameState(e2027, eclipseTimelineWindow(e2027.contacts).startSec, out);
    expect(out.kind).toBe('none');
  });

  it('视半径/高度角为烘焙真值域（视直径之比不做几何放大，契约 C4）', () => {
    const f = eclipseFrameState(e2027, e2027.contacts.max);
    expect(f.sunSdDeg).toBeGreaterThan(0.26);
    expect(f.sunSdDeg).toBeLessThan(0.28);
    expect(f.moonSdDeg).toBeGreaterThan(0.27); // 2027 全食：月盘大于日盘
    expect(f.moonSdDeg).toBeGreaterThan(f.sunSdDeg);
    expect(f.sunAltDeg).toBeGreaterThan(0); // 白昼事件
  });

  it('quad 半角覆盖窗内全程月盘（月盘出界会被 quad 裁剪，常量护栏）', () => {
    for (const ev of eclipses.events) {
      const win = eclipseTimelineWindow(ev.contacts);
      for (const t of [win.startSec, win.endSec]) {
        const f = eclipseFrameState(ev, t);
        const offNorm = Math.hypot(f.offEastRad, f.offUpRad);
        expect(offNorm + f.moonSdDeg * DEG).toBeLessThan(ECLIPSE_QUAD_HALF_ANGLE_RAD);
      }
    }
  });
});

describe('HUD 格式化', () => {
  it('formatUtcClock：UTC "HH:MM:SS"（负 Unix 秒/1919 事件同样适用）', () => {
    expect(formatUtcClock(0)).toBe('00:00:00');
    expect(formatUtcClock(86399)).toBe('23:59:59');
    expect(formatUtcClock(-1)).toBe('23:59:59');
    // 2027 食甚 ≈ 10:07 UTC（Espenak 大食时刻口径）
    expect(formatUtcClock(e2027.contacts.max)).toMatch(/^10:0\d:\d\d$/);
    expect(() => formatUtcClock(Number.NaN)).toThrow(RangeError);
  });

  it('formatAngularDiameterDeg：视半径 → 视直径三位小数', () => {
    expect(formatAngularDiameterDeg(0.264)).toBe('0.528°');
    expect(formatAngularDiameterDeg(0)).toBe('0.000°');
    expect(() => formatAngularDiameterDeg(-0.1)).toThrow(RangeError);
    expect(() => formatAngularDiameterDeg(Number.NaN)).toThrow(RangeError);
  });
});

describe('场景常量（契约 C4/C5 基准）', () => {
  it('播放倍率 M2 固定 ×1（变速档随 M3）；光球 HDR 基准 >1 供 Bloom 拾取', () => {
    expect(ECLIPSE_PLAY_RATE).toBe(1);
    expect(PHOTOSPHERE_HDR_BRIGHTNESS).toBeGreaterThan(1);
  });
});
