/**
 * LE-M1 烘焙产物锚点单测（public/data/lunar_eclipses.json 真数据）：
 * - 四事件元数据 vs NASA 5MCLE 目录权威值（食分/γ/saros/danjonDefault）；
 * - 接触时刻反解 vs 权威值 <60s（用 src/utils/lunarEclipse 纯函数独立重derive，
 *   与烘焙侧镜像互证；缺省锚点跳过——偏食无 U2/U3、半影食仅 P1/max/P4）；
 * - 食甚食型三态：l2029/l1992 total、l2026 partial、l2027 penumbral（全程不触本影）；
 * - 窗口契约（topo P1−30min→P4+30min @60s、geo 食甚 ±12h @300s）与观测点可见性。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  lunarEclipseKind,
  penumbralMagnitude,
  shadowAxisOffsetKm,
  umbralMagnitude,
  EARTH_EQUATORIAL_RADIUS_KM,
} from '../lunarEclipse';
import { validateLunarEclipses, type LunarEclipseEventData } from '../bakedData';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/lunar_eclipses.json'), 'utf8')
) as unknown;
const data = validateLunarEclipses(raw);
if (!data) throw new Error('真实产物未通过 validateLunarEclipses');
const events = new Map(data.events.map((e) => [e.id, e]));

/** geo 行 → 日/月地心位置（km） */
function positionsOf(row: readonly number[]): {
  sun: [number, number, number];
  moon: [number, number, number];
} {
  return {
    sun: [row[0] * row[3], row[1] * row[3], row[2] * row[3]],
    moon: [row[4] * row[7], row[5] * row[7], row[6] * row[7]],
  };
}

/** 纯函数独立反解七接触点（食分过零线性求根 + 食甚 perp² 抛物线顶点） */
function deriveContacts(ev: LunarEclipseEventData): Record<string, number | null> {
  const { t0, dtSec, rows } = ev.geo;
  const umb = rows.map((row) => {
    const { sun, moon } = positionsOf(row);
    return umbralMagnitude(sun, moon);
  });
  const pen = rows.map((row) => {
    const { sun, moon } = positionsOf(row);
    return penumbralMagnitude(sun, moon);
  });
  const perp = rows.map((row) => {
    const { sun, moon } = positionsOf(row);
    return shadowAxisOffsetKm(sun, moon);
  });
  const crossings = (values: number[], level: number): number[] => {
    const out: number[] = [];
    for (let i = 1; i < values.length; i += 1) {
      const g0 = values[i - 1] - level;
      const g1 = values[i] - level;
      if (g0 === 0 || g0 * g1 < 0) out.push(t0 + (i - 1) * dtSec + (g0 / (g0 - g1)) * dtSec);
    }
    return out;
  };
  const penX = crossings(pen, 0);
  const umbX = crossings(umb, 0);
  const totX = crossings(umb, 1);
  let minIdx = 0;
  for (let i = 1; i < perp.length; i += 1) if (perp[i] < perp[minIdx]) minIdx = i;
  let maxT = t0 + minIdx * dtSec;
  if (minIdx > 0 && minIdx < perp.length - 1) {
    const y0 = perp[minIdx - 1] ** 2;
    const y1 = perp[minIdx] ** 2;
    const y2 = perp[minIdx + 1] ** 2;
    const denom = y0 - 2 * y1 + y2;
    if (denom > 0) maxT += ((y0 - y2) / (2 * denom)) * dtSec;
  }
  return {
    p1: penX.length >= 2 ? penX[0] : null,
    u1: umbX.length >= 2 ? umbX[0] : null,
    u2: totX.length >= 2 ? totX[0] : null,
    max: maxT,
    u3: totX.length >= 2 ? totX[totX.length - 1] : null,
    u4: umbX.length >= 2 ? umbX[umbX.length - 1] : null,
    p4: penX.length >= 2 ? penX[penX.length - 1] : null,
  };
}

describe('四事件权威元数据（NASA 5MCLE / Espenak 一手复核值）', () => {
  it('事件顺序/日期/saros/danjonDefault 与定稿一致', () => {
    expect(data.events.map((e) => e.id)).toEqual(['l2029', 'l2026', 'l2027', 'l1992']);
    const anchors: Array<[string, string, number, number]> = [
      ['l2029', '2029-06-26', 130, 2],
      ['l2026', '2026-08-28', 138, 3],
      ['l2027', '2027-02-20', 143, 3],
      ['l1992', '1992-12-09', 125, 0],
    ];
    for (const [id, dateUtc, saros, danjon] of anchors) {
      const ev = events.get(id as LunarEclipseEventData['id']);
      expect(ev?.dateUtc).toBe(dateUtc);
      expect(ev?.saros).toBe(saros);
      expect(ev?.danjonDefault).toBe(danjon);
    }
  });

  it('食分/γ 为 5MCLE 目录值（维基衍生数值不采信的定稿证据）', () => {
    expect(events.get('l2029')?.umbralMag).toBe(1.8436);
    expect(events.get('l2029')?.penumbralMag).toBe(2.8266);
    expect(events.get('l2029')?.gamma).toBe(0.0124);
    expect(events.get('l2026')?.umbralMag).toBe(0.9299);
    expect(events.get('l2027')?.umbralMag).toBe(-0.0569);
    expect(events.get('l2027')?.gamma).toBe(-1.048);
    expect(events.get('l1992')?.umbralMag).toBe(1.2709);
    expect(events.get('l1992')?.gamma).toBe(0.3144);
  });
});

describe('接触时刻反解 vs 权威值 <60s（缺省锚点跳过）', () => {
  for (const ev of data.events) {
    it(`${ev.id}（${ev.kind}）`, () => {
      const derived = deriveContacts(ev);
      const keys = ['p1', 'u1', 'u2', 'max', 'u3', 'u4', 'p4'] as const;
      for (const key of keys) {
        const authoritative = ev.contacts[key];
        if (authoritative === null) {
          // 缺省锚点：几何反解也不应出现该接触（偏食无全食段、半影食不触本影）
          if (key === 'u2' || key === 'u3') expect(derived[key]).toBeNull();
          continue;
        }
        const derivedT = derived[key];
        expect(derivedT).not.toBeNull();
        expect(Math.abs((derivedT as number) - authoritative)).toBeLessThan(60);
      }
    });
  }
});

describe('食甚食型与半影事件全程判定（几何 ↔ 目录互证）', () => {
  it('l2029/l1992 食甚 kind=total 且本影食分与目录互差 <0.02', () => {
    for (const id of ['l2029', 'l1992'] as const) {
      const ev = events.get(id) as LunarEclipseEventData;
      const idx = Math.round((ev.contacts.max - ev.geo.t0) / ev.geo.dtSec);
      const { sun, moon } = positionsOf(ev.geo.rows[idx]);
      const umb = umbralMagnitude(sun, moon);
      const pen = penumbralMagnitude(sun, moon);
      expect(lunarEclipseKind(umb, pen)).toBe('total');
      expect(Math.abs(umb - ev.umbralMag)).toBeLessThan(0.02);
      expect(Math.abs(pen - ev.penumbralMag)).toBeLessThan(0.02);
      // γ 互证：食甚垂距 / 赤道半径 ≈ |目录 γ|
      const gammaDerived = shadowAxisOffsetKm(sun, moon) / EARTH_EQUATORIAL_RADIUS_KM;
      expect(Math.abs(gammaDerived - Math.abs(ev.gamma))).toBeLessThan(0.02);
    }
  });

  it('l2026 食甚 kind=partial（0 < 食分 < 1，「差一点点就是全食」）', () => {
    const ev = events.get('l2026') as LunarEclipseEventData;
    const idx = Math.round((ev.contacts.max - ev.geo.t0) / ev.geo.dtSec);
    const { sun, moon } = positionsOf(ev.geo.rows[idx]);
    const umb = umbralMagnitude(sun, moon);
    expect(lunarEclipseKind(umb, penumbralMagnitude(sun, moon))).toBe('partial');
    expect(umb).toBeGreaterThan(0.9);
    expect(umb).toBeLessThan(1);
  });

  it('l2027 半影事件全程不触本影（umbralMag < 0 恒成立）且食甚 kind=penumbral', () => {
    const ev = events.get('l2027') as LunarEclipseEventData;
    let maxUmb = -Infinity;
    let anyPenumbral = false;
    for (const row of ev.geo.rows) {
      const { sun, moon } = positionsOf(row);
      const umb = umbralMagnitude(sun, moon);
      maxUmb = Math.max(maxUmb, umb);
      if (lunarEclipseKind(umb, penumbralMagnitude(sun, moon)) === 'penumbral') {
        anyPenumbral = true;
      }
    }
    expect(maxUmb).toBeLessThan(0);
    expect(anyPenumbral).toBe(true);
    const idx = Math.round((ev.contacts.max - ev.geo.t0) / ev.geo.dtSec);
    const { sun, moon } = positionsOf(ev.geo.rows[idx]);
    expect(lunarEclipseKind(umbralMagnitude(sun, moon), penumbralMagnitude(sun, moon))).toBe(
      'penumbral'
    );
  });
});

describe('窗口契约与观测点可见性（契约 C2/C3）', () => {
  for (const ev of data.events) {
    it(`${ev.id}：topo P1−30min→P4+30min @60s、geo ±12h @300s、全窗月高 > 0`, () => {
      expect(ev.topo.dtSec).toBe(60);
      expect(ev.geo.dtSec).toBe(300);
      const topoEnd = ev.topo.t0 + (ev.topo.rows.length - 1) * 60;
      expect(ev.topo.t0).toBeLessThanOrEqual(ev.contacts.p1 - 1800 + 60);
      expect(topoEnd).toBeGreaterThanOrEqual(ev.contacts.p4 + 1800 - 60);
      const geoEnd = ev.geo.t0 + (ev.geo.rows.length - 1) * 300;
      expect(ev.geo.t0).toBeLessThanOrEqual(ev.contacts.max - 12 * 3600);
      expect(geoEnd).toBeGreaterThanOrEqual(ev.contacts.max + 12 * 3600);
      // 选点判据「食全程可见 + 高度角良好」：全窗月高 >0，食甚月高 >45°
      for (const row of ev.topo.rows) expect(row[0]).toBeGreaterThan(0);
      const maxIdx = Math.round((ev.contacts.max - ev.topo.t0) / 60);
      expect(ev.topo.rows[maxIdx][0]).toBeGreaterThan(45);
      // 食甚太阳在地平下（月食夜半球可见的自洽性）
      expect(ev.topo.rows[maxIdx][3]).toBeLessThan(0);
    });
  }
});
