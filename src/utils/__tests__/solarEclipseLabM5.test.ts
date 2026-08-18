/**
 * E-M5 Eddington 星光偏折单测（§M5-2 / 契约 C1 starDeflectionArcsec 消费侧 /
 * 登记 A10）：偏折方向（背离日心）、偏折量级（δ = C1 真值 × 夸张倍率）、
 * δ ∝ 1/b 递减关系、日面边缘钳制、退化/边界分支；选星函数以烘焙 e1919 +
 * 真实耶鲁星表锁历史锚点——食甚太阳恰在毕宿星团中（含毕宿五），这正是
 * 1919 年选中这次食的原因。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  validateSolarEclipses,
  validateYaleBrightStars,
  type SolarEclipsesData,
  type YaleBrightStar,
} from '@/utils/bakedData';
import { starDeflectionArcsec, GR_LIMB_DEFLECTION_ARCSEC } from '@/utils/solarEclipse';
import { horizontalFromEquatorial, sceneDirFromAltAz } from '@/utils/meteorShower';
import {
  ARCSEC_TO_RAD,
  DEFLECTION_EASE_SEC,
  EDDINGTON_DEFLECTION_EXAGGERATION,
  EDDINGTON_MARKER_MAG_MAX,
  EDDINGTON_MARKER_MAX_COUNT,
  EDDINGTON_MARKER_MAX_SEP_DEG,
  deflectedStarDirection,
  eclipseFrameState,
  eddingtonMarkerStars,
  lstRadFromUnixSec,
} from '@/utils/solarEclipseLab';

const DEG = Math.PI / 180;

const eclipses = validateSolarEclipses(
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/solar_eclipses.json'), 'utf8'))
) as SolarEclipsesData;

const yaleStars = validateYaleBrightStars(
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/yale_bright_stars.json'), 'utf8'))
) as YaleBrightStar[];

const e1919 = eclipses.events.find((e) => e.id === 'e1919')!;

/** 单位向量夹角（弧度） */
function angleBetween(a: readonly number[], b: readonly number[]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

/** 高度角/方位角（度）→ 场景单位向量 */
function dirOf(altDeg: number, azDeg: number): [number, number, number] {
  return sceneDirFromAltAz({ altRad: altDeg * DEG, azRad: azDeg * DEG });
}

describe('deflectedStarDirection（契约 C1 消费 + A10 夸张倍率）', () => {
  const sunDir = dirOf(40, 180);

  it('输出为单位向量，且沿背离日心方向偏移（与日心夹角增大）', () => {
    const star = dirOf(42, 180); // 日心上方 2°
    const out = deflectedStarDirection(star, sunDir, 1);
    expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 12);
    expect(angleBetween(out, sunDir)).toBeGreaterThan(angleBetween(star, sunDir));
  });

  it('偏折量级 = starDeflectionArcsec(sep) × 夸张倍率（小角近似 <0.1% 偏差）', () => {
    const sepDeg = 2;
    const star = dirOf(40 + sepDeg, 180);
    const out = deflectedStarDirection(star, sunDir, 1);
    const shiftRad = angleBetween(out, star);
    const expected =
      starDeflectionArcsec(sepDeg) * ARCSEC_TO_RAD * EDDINGTON_DEFLECTION_EXAGGERATION;
    expect(shiftRad).toBeGreaterThan(expected * 0.999);
    expect(shiftRad).toBeLessThan(expected * 1.001);
  });

  it('δ ∝ 1/b：角距 2° 恒星的位移约为 4° 恒星的 2 倍（目验检查点的数值锚点）', () => {
    const near = deflectedStarDirection(dirOf(42, 180), sunDir, 1);
    const far = deflectedStarDirection(dirOf(44, 180), sunDir, 1);
    const shiftNear = angleBetween(near, dirOf(42, 180));
    const shiftFar = angleBetween(far, dirOf(44, 180));
    expect(shiftNear / shiftFar).toBeGreaterThan(1.99);
    expect(shiftNear / shiftFar).toBeLessThan(2.01);
  });

  it('日面边缘内钳制：角距 0.1° 的位移与日面边缘 1.7520″ 锚点一致', () => {
    const star = dirOf(40.1, 180);
    const out = deflectedStarDirection(star, sunDir, 1);
    const shiftRad = angleBetween(out, star);
    const limbShift =
      GR_LIMB_DEFLECTION_ARCSEC * ARCSEC_TO_RAD * EDDINGTON_DEFLECTION_EXAGGERATION;
    // 小角近似（dir + away·δ 再归一）在 δ≈0.021 rad 时相对误差 ~δ²/3 ≈ 1.5e-4
    expect(shiftRad).toBeCloseTo(limbShift, 4);
  });

  it('strength01 = 0 或方向与日心重合时原样返回', () => {
    const star = dirOf(43, 170);
    const zero = deflectedStarDirection(star, sunDir, 0);
    expect(zero).toEqual([star[0], star[1], star[2]]);
    const degenerate = deflectedStarDirection(sunDir, sunDir, 1);
    expect(degenerate).toEqual([sunDir[0], sunDir[1], sunDir[2]]);
  });

  it('strength01 = 0.5 位移减半（0↔1 切换动画的中间态）', () => {
    const star = dirOf(42, 180);
    const full = angleBetween(deflectedStarDirection(star, sunDir, 1), star);
    const half = angleBetween(deflectedStarDirection(star, sunDir, 0.5), star);
    expect(half / full).toBeGreaterThan(0.499);
    expect(half / full).toBeLessThan(0.501);
  });

  it('out 参数复用（渲染循环零 GC 口径）', () => {
    const out: [number, number, number] = [0, 0, 0];
    const ret = deflectedStarDirection(dirOf(42, 180), sunDir, 1, out);
    expect(ret).toBe(out);
  });

  it('非有限 strength01 抛 RangeError', () => {
    expect(() => deflectedStarDirection(sunDir, sunDir, Number.NaN)).toThrow(RangeError);
  });

  it('夸张倍率为显式登记常量（A10：HUD/i18n 文案数值与此同步维护）', () => {
    expect(EDDINGTON_DEFLECTION_EXAGGERATION).toBe(2500);
    expect(DEFLECTION_EASE_SEC).toBeGreaterThan(0);
  });
});

describe('eddingtonMarkerStars（e1919 食甚选星——毕宿星团历史锚点）', () => {
  const markers = eddingtonMarkerStars(yaleStars, e1919, e1919.contacts, e1919.observer);

  it('选星非空且不超上限（≤6），全部落在角距/星等窗内', () => {
    expect(markers.length).toBeGreaterThanOrEqual(3);
    expect(markers.length).toBeLessThanOrEqual(EDDINGTON_MARKER_MAX_COUNT);
    for (const m of markers) {
      expect(m.sepDeg).toBeLessThanOrEqual(EDDINGTON_MARKER_MAX_SEP_DEG);
      expect(m.mag).toBeLessThanOrEqual(EDDINGTON_MARKER_MAG_MAX);
    }
  });

  it('按角距升序排列，偏折角随角距单调递减（1/b 关系）', () => {
    for (let i = 1; i < markers.length; i += 1) {
      expect(markers[i].sepDeg).toBeGreaterThanOrEqual(markers[i - 1].sepDeg);
      expect(markers[i].deflectionArcsec).toBeLessThanOrEqual(markers[i - 1].deflectionArcsec);
    }
  });

  it('deflectionArcsec 为契约 C1 真值（HUD 标注用，A10）', () => {
    for (const m of markers) {
      expect(m.deflectionArcsec).toBeCloseTo(starDeflectionArcsec(m.sepDeg), 12);
      // 真实偏折全部 ≤ 日面边缘 1.7520″（数量级正确性）
      expect(m.deflectionArcsec).toBeLessThanOrEqual(GR_LIMB_DEFLECTION_ARCSEC);
    }
  });

  it('历史锚点：食甚日面附近含毕宿五（mag <1 亮星）——1919 选址原因', () => {
    expect(Math.min(...markers.map((m) => m.mag))).toBeLessThan(1);
  });

  it('全部标记星在食甚时刻位于地平上', () => {
    const lst = lstRadFromUnixSec(e1919.contacts.max, e1919.observer.lonDeg);
    for (const m of markers) {
      const altAz = horizontalFromEquatorial(m.raDeg, m.decDeg, e1919.observer.latDeg, lst);
      expect(altAz.altRad).toBeGreaterThan(0);
    }
  });

  it('选星窗过滤：过暗/过远恒星被剔除（合成星表）', () => {
    const frame = eclipseFrameState(e1919, e1919.contacts.max);
    // 以食甚太阳地平坐标反构造赤道坐标：取标记星 0 作为「近日模板」
    const near = markers[0];
    const synthetic = [
      { ra: near.raDeg, dec: near.decDeg, mag: 5.5 }, // 过暗 → 剔除
      { ra: near.raDeg, dec: near.decDeg, mag: 1.0 }, // 合格
      { ra: (near.raDeg + 60) % 360, dec: near.decDeg, mag: 1.0 }, // 过远 → 剔除
    ];
    const picked = eddingtonMarkerStars(synthetic, e1919, e1919.contacts, e1919.observer);
    expect(picked).toHaveLength(1);
    expect(picked[0].index).toBe(1);
    expect(picked[0].sepDeg).toBeCloseTo(near.sepDeg, 6);
    expect(frame.kind).toBe('total');
  });

  it('近日恒星超过 6 颗时截断到上限', () => {
    const near = markers[0];
    const synthetic = Array.from({ length: 10 }, () => ({
      ra: near.raDeg,
      dec: near.decDeg,
      mag: 2,
    }));
    const picked = eddingtonMarkerStars(synthetic, e1919, e1919.contacts, e1919.observer);
    expect(picked).toHaveLength(EDDINGTON_MARKER_MAX_COUNT);
  });
});
