/**
 * E-M1 烘焙产物集成锚点（§M1-5，产物随仓库提交）：
 * public/data/solar_eclipses.json + lunar_limb_profile.json 喂真实纯函数——
 * 接触时刻反解 vs 权威值 <30s、食甚遮挡率≈1 且 kind=total、本影锥长域、
 * 2027 食甚足印短轴 ∈ [200, 300] km、真实天光断崖、LOLA 剖面驱动贝利珠。
 * 同时锁定 bake 侧镜像公式与 src 纯函数不漂移（单一事实源互锁）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  validateSolarEclipses,
  validateLunarLimbProfile,
  type SolarEclipsesData,
  type SolarEclipseEventData,
  type LunarLimbProfileData,
} from '@/utils/bakedData';
import {
  interpolateEphemeris,
  geoSampleFromRow,
  topoAngularSepDeg,
  deriveContactTimes,
  eclipseObscuration,
  eclipseKind,
  eclipseMagnitude,
  umbraCone,
  penumbraCone,
  umbraFootprint,
  beadsLeakProfile,
  eclipseSkyDarkening,
  TOPO_ANGULAR_COLUMNS,
  EARTH_MEAN_RADIUS_KM,
  type EphemerisSeries,
} from '@/utils/solarEclipse';

const DEG = Math.PI / 180;

const eclipses = validateSolarEclipses(
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/solar_eclipses.json'), 'utf8'))
) as SolarEclipsesData;

const limb = validateLunarLimbProfile(
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/lunar_limb_profile.json'), 'utf8'))
) as LunarLimbProfileData;

/** 食甚时刻的插值 topo 行（细采样段优先） */
function rowAtMax(ev: SolarEclipseEventData): number[] {
  const { max } = ev.contacts;
  const fine =
    max <= ev.fineC2.t0 + (ev.fineC2.rows.length - 1) * ev.fineC2.dtSec ? ev.fineC2 : ev.fineC3;
  return interpolateEphemeris(fine as EphemerisSeries, max, TOPO_ANGULAR_COLUMNS);
}

describe('烘焙产物结构（契约 C2/C3）', () => {
  it('产物通过运行时校验且三事件齐全', () => {
    expect(eclipses).not.toBeNull();
    expect(eclipses.events.map((e) => e.id)).toEqual(['e2027', 'e2035', 'e1919']);
    expect(limb).not.toBeNull();
    expect(limb.samples).toHaveLength(720);
    expect(limb.meanRadiusKm).toBe(1737.4);
  });

  it('事件元数据与 Espenak 发布值一致（γ/食分/沙罗）', () => {
    const [e2027, e2035, e1919] = eclipses.events;
    expect(e2027.magnitude).toBeCloseTo(1.079, 3);
    expect(e2027.gammaAbs).toBeCloseTo(0.1421, 3);
    expect(e2027.saros).toBe(136);
    expect(e2035.magnitude).toBeCloseTo(1.032, 3);
    expect(e2035.saros).toBe(145);
    expect(e1919.magnitude).toBeCloseTo(1.072, 3);
    expect(e1919.gammaAbs).toBeCloseTo(0.2955, 3);
    expect(e1919.saros).toBe(136);
  });

  it('观测点定稿登记：埃及新河谷 / 北京市郊中心线 / Sobral', () => {
    const [e2027, e2035, e1919] = eclipses.events;
    expect(e2027.observer.latDeg).toBeCloseTo(26.816, 2);
    expect(e2035.observer.latDeg).toBeCloseTo(40.105, 2);
    expect(e2035.observer.lonDeg).toBeCloseTo(116.858, 2);
    expect(e1919.observer.label).toContain('Sobral');
  });

  it('全食时长锚点：2027≈6m23s、2035≈1m51s、1919 Sobral≈5m14s', () => {
    const dur = (ev: SolarEclipseEventData): number => ev.contacts.c3 - ev.contacts.c2;
    expect(dur(eclipses.events[0])).toBeGreaterThan(380);
    expect(dur(eclipses.events[0])).toBeLessThan(386);
    expect(dur(eclipses.events[1])).toBeGreaterThan(108);
    expect(dur(eclipses.events[1])).toBeLessThan(114);
    expect(dur(eclipses.events[2])).toBeGreaterThan(310);
    expect(dur(eclipses.events[2])).toBeLessThan(318);
  });
});

describe.each(eclipses.events.map((ev) => [ev.id, ev] as const))(
  '事件 %s 星历自洽性（§M1-5）',
  (_id, ev) => {
    it('接触时刻反解 vs 权威贝塞尔值互差 < 30s（§1.3）', () => {
      const derived = deriveContactTimes(ev.topo as EphemerisSeries);
      expect(derived).not.toBeNull();
      const d = derived as NonNullable<typeof derived>;
      expect(Math.abs(d.c1 - ev.contacts.c1)).toBeLessThan(30);
      expect(Math.abs((d.c2 as number) - ev.contacts.c2)).toBeLessThan(30);
      expect(Math.abs((d.c3 as number) - ev.contacts.c3)).toBeLessThan(30);
      expect(Math.abs(d.c4 - ev.contacts.c4)).toBeLessThan(30);
      expect(Math.abs(d.max - ev.contacts.max)).toBeLessThan(60);
    });

    it('食甚遮挡率 ≈ 1 且 eclipseKind = total（逐时刻视半径判定）', () => {
      const row = rowAtMax(ev);
      const sepRad = topoAngularSepDeg(row) * DEG;
      const sunR = row[2] * DEG;
      const moonR = row[5] * DEG;
      expect(eclipseObscuration(sunR, moonR, sepRad)).toBeGreaterThanOrEqual(0.999);
      expect(eclipseKind(sunR, moonR, sepRad)).toBe('total');
      // 食甚食分 ≈ 事件食分（同为直径比；观测点 vs GE 点差异 < 0.01）
      expect(eclipseMagnitude(sunR, moonR, sepRad)).toBeGreaterThan(1);
      expect(Math.abs(eclipseMagnitude(sunR, moonR, sepRad) - ev.magnitude)).toBeLessThan(0.01);
    });

    it('接触边界：C1 前 none / C1–C2 间 partial（时间轴推进正确性）', () => {
      const kindAt = (tSec: number): string => {
        const row = interpolateEphemeris(ev.topo as EphemerisSeries, tSec, TOPO_ANGULAR_COLUMNS);
        return eclipseKind(row[2] * DEG, row[5] * DEG, topoAngularSepDeg(row) * DEG);
      };
      expect(kindAt(ev.contacts.c1 - 120)).toBe('none');
      expect(kindAt((ev.contacts.c1 + ev.contacts.c2) / 2)).toBe('partial');
      expect(kindAt((ev.contacts.c3 + ev.contacts.c4) / 2)).toBe('partial');
      expect(kindAt(ev.contacts.c4 + 120)).toBe('none');
    });

    it('本影锥长 ∈ [360000, 385000] km（geo 星历，§1.2 锚点）', () => {
      const row = interpolateEphemeris(ev.geo as EphemerisSeries, ev.contacts.max);
      const s = geoSampleFromRow(row, ev.contacts.max);
      const sunPos: [number, number, number] = [
        s.sunDir[0] * s.sunDistKm,
        s.sunDir[1] * s.sunDistKm,
        s.sunDir[2] * s.sunDistKm,
      ];
      const moonPos: [number, number, number] = [
        s.moonDir[0] * s.moonDistKm,
        s.moonDir[1] * s.moonDistKm,
        s.moonDir[2] * s.moonDistKm,
      ];
      const cone = umbraCone(sunPos, moonPos);
      expect(cone.lengthKm).toBeGreaterThanOrEqual(360000);
      expect(cone.lengthKm).toBeLessThanOrEqual(385000);
      // 食甚时刻本影触地（全食事件），半影足印直径 > 6400 km
      const fp = umbraFootprint(cone, [0, 0, 0], EARTH_MEAN_RADIUS_KM);
      expect(fp.exists).toBe(true);
      expect(fp.isAntumbra).toBe(false);
      const pfp = umbraFootprint(penumbraCone(sunPos, moonPos), [0, 0, 0], EARTH_MEAN_RADIUS_KM);
      expect(pfp.exists).toBe(true);
      expect(pfp.minorAxisKm).toBeGreaterThan(6400);
    });

    it('真实天光断崖：99% vs 100%（食甚太阳高度）', () => {
      const row = rowAtMax(ev);
      const sunAlt = row[0];
      const at99 = eclipseSkyDarkening(sunAlt, 0.99).skyFactor01;
      const at100 = eclipseSkyDarkening(sunAlt, 1).skyFactor01;
      expect(at99 / at100).toBeGreaterThanOrEqual(5);
      expect(eclipseSkyDarkening(sunAlt, 1).limitingMag).toBeGreaterThan(3);
    });
  }
);

describe('2027 食甚足印短轴（§1.2 / §M1-5 锚点）', () => {
  it('短轴 ∈ [240, 275] km（§1.2 🔶 一手数值收紧：实测 257.8 km vs Espenak 路径宽 258 km）', () => {
    const ev = eclipses.events[0];
    const row = interpolateEphemeris(ev.geo as EphemerisSeries, ev.contacts.max);
    const s = geoSampleFromRow(row, ev.contacts.max);
    const cone = umbraCone(
      [s.sunDir[0] * s.sunDistKm, s.sunDir[1] * s.sunDistKm, s.sunDir[2] * s.sunDistKm],
      [s.moonDir[0] * s.moonDistKm, s.moonDir[1] * s.moonDistKm, s.moonDir[2] * s.moonDistKm]
    );
    const fp = umbraFootprint(cone, [0, 0, 0], EARTH_MEAN_RADIUS_KM);
    expect(fp.exists).toBe(true);
    expect(fp.isAntumbra).toBe(false);
    expect(fp.minorAxisKm).toBeGreaterThanOrEqual(240);
    expect(fp.minorAxisKm).toBeLessThanOrEqual(275);
    expect(fp.majorAxisKm).toBeGreaterThanOrEqual(fp.minorAxisKm);
  });
});

describe('LOLA 月缘剖面 → 贝利珠（契约 C3 消费链）', () => {
  it('C2 时刻真实几何：漏光剖面非均匀（真实月缘凹凸驱动珠分布）', () => {
    const ev = eclipses.events[0];
    const row = interpolateEphemeris(
      ev.fineC2 as EphemerisSeries,
      ev.contacts.c2,
      TOPO_ANGULAR_COLUMNS
    );
    const leak = beadsLeakProfile(
      row[2] * DEG,
      row[5] * DEG,
      topoAngularSepDeg(row) * DEG,
      row[6] * DEG,
      limb.samples
    );
    expect(leak).toHaveLength(720);
    const positive = leak.filter((v) => v > 0);
    // C2 内切时刻：局部山谷漏光，非全缘也非零
    expect(positive.length).toBeGreaterThan(0);
    expect(positive.length).toBeLessThan(720);
    // 珠间不均匀（真实剖面 vs 均匀月缘的本质差异）
    const uniform = beadsLeakProfile(
      row[2] * DEG,
      row[5] * DEG,
      topoAngularSepDeg(row) * DEG,
      row[6] * DEG,
      new Array(720).fill(0)
    );
    expect(leak).not.toEqual(uniform);
  });

  it('剖面偏差在 LOLA 真实地形量级（±9 km 内、非平凡起伏）', () => {
    const min = Math.min(...limb.samples);
    const max = Math.max(...limb.samples);
    expect(min).toBeGreaterThanOrEqual(-9);
    expect(max).toBeLessThanOrEqual(9);
    expect(max - min).toBeGreaterThan(2); // 月缘高差至少 km 量级（山脉/盆地）
  });
});
