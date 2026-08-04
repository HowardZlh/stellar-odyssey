/**
 * R5-3 真实巡天目录核心纯函数单测：坐标链（赤道→银道→超星系）已知值锚定 /
 * 红移距离 / 亮度与形态档 / w 打包往返 / 实体星系去重 / 锥计数与超密度
 */
import {
  CZ_MIN_KM_S,
  DEDUP_MATCH_RADIUS_DEG,
  ENTITY_GALAXY_SKY,
  H0_KM_S_MPC,
  KMAG_BRIGHT,
  KMAG_FAINT,
  LY_PER_MPC,
  VIRGO_CONE_RADIUS_DEG,
  VIRGO_DEC_DEG,
  VIRGO_OVERDENSITY_MIN_RATIO,
  VIRGO_RA_DEG,
  VIRGO_SHELL_MAX_MPC,
  VIRGO_SHELL_MIN_MPC,
  angularSeparationDeg,
  brightness01FromKmag,
  coneSolidAngleFraction,
  countInCone,
  countInShell,
  czToDistanceMpc,
  equatorialToGalacticUnit,
  equatorialToSupergalacticUnit,
  equatorialUnit,
  galacticLatitudeDeg,
  matchEntityGalaxy,
  morphTierFromType,
  packCatalogW,
  unpackCatalogW,
} from '../galaxyCatalogCore';
import { HUBBLE_H0_PER_MYR } from '../universe';
import { PARSEC_LY } from '../scale';

describe('坐标链（赤道 J2000 → 银道 → 超星系）', () => {
  it('赤道单位矢量：基本方位与非法输入', () => {
    const v = equatorialUnit(0, 0);
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.y).toBeCloseTo(0, 12);
    const pole = equatorialUnit(123, 90);
    expect(pole.z).toBeCloseTo(1, 12);
    expect(() => equatorialUnit(Number.NaN, 0)).toThrow(RangeError);
    expect(() => equatorialUnit(0, 91)).toThrow(RangeError);
  });

  it('北银极（RA 192.8595, Dec 27.1283）→ 银纬 ≈ +90°', () => {
    expect(galacticLatitudeDeg(192.8595, 27.1283)).toBeCloseTo(90, 1);
  });

  it('LMC（RA 80.8942, Dec −69.7561）→ 银纬 ≈ −32.9°（SIMBAD）', () => {
    expect(galacticLatitudeDeg(80.8942, -69.7561)).toBeCloseTo(-32.89, 1);
  });

  it('银道系旋转保范数（正交矩阵；发表矩阵舍入至 1e-10 量级）', () => {
    const g = equatorialToGalacticUnit(37.5, -12.25);
    expect(Math.hypot(g.x, g.y, g.z)).toBeCloseTo(1, 9);
  });

  it('M87 超星系坐标 ≈ (SGL 102.9°, SGB −2.3°)（NED 锚定）', () => {
    const u = equatorialToSupergalacticUnit(187.7059, 12.3911);
    const sgb = (Math.asin(u.z) * 180) / Math.PI;
    const sgl = ((Math.atan2(u.y, u.x) * 180) / Math.PI + 360) % 360;
    expect(sgl).toBeCloseTo(102.9, 0);
    expect(sgb).toBeCloseTo(-2.3, 0);
  });

  it('超星系旋转保范数且保角（M31–M87 真实角距 ≈ 126.3° 不变）', () => {
    const m31 = equatorialToSupergalacticUnit(10.6847, 41.269);
    const m87 = equatorialToSupergalacticUnit(187.7059, 12.3911);
    expect(Math.hypot(m31.x, m31.y, m31.z)).toBeCloseTo(1, 9);
    const eqSep = angularSeparationDeg(
      equatorialUnit(10.6847, 41.269),
      equatorialUnit(187.7059, 12.3911),
    );
    expect(angularSeparationDeg(m31, m87)).toBeCloseTo(eqSep, 8);
    expect(eqSep).toBeCloseTo(126.27, 1);
  });
});

describe('红移距离（哈勃流近似）', () => {
  it('d = cz/H₀：cz=7000 → 100 Mpc；H₀ 与 utils/universe 同源（70 km/s/Mpc）', () => {
    expect(czToDistanceMpc(7000)).toBeCloseTo(100, 10);
    // HUBBLE_H0_PER_MYR ≈ H₀[km/s/Mpc] × KM_S→ly/Myr ÷ (Mpc→ly)
    const kmSToLyPerMyr = 3.3356;
    expect((HUBBLE_H0_PER_MYR * PARSEC_LY * 1e6) / kmSToLyPerMyr).toBeCloseTo(H0_KM_S_MPC, 0);
    expect(LY_PER_MPC).toBeCloseTo(PARSEC_LY * 1e6, 6);
  });

  it('cz ≤ 0 或非有限抛 RangeError（近距失真登记：CZ_MIN=100 km/s 剔除）', () => {
    expect(() => czToDistanceMpc(0)).toThrow(RangeError);
    expect(() => czToDistanceMpc(-300)).toThrow(RangeError);
    expect(() => czToDistanceMpc(Number.NaN)).toThrow(RangeError);
    expect(CZ_MIN_KM_S).toBe(100);
  });
});

describe('亮度档 / 形态档 / w 打包', () => {
  it('亮度档：亮端 4.0 → 1、完备极限 11.75 → 0、越界钳制、NaN 拒绝', () => {
    expect(brightness01FromKmag(KMAG_BRIGHT)).toBe(1);
    expect(brightness01FromKmag(KMAG_FAINT)).toBe(0);
    expect(brightness01FromKmag(2)).toBe(1);
    expect(brightness01FromKmag(13)).toBe(0);
    expect(brightness01FromKmag(7.875)).toBeCloseTo(0.5, 10);
    expect(() => brightness01FromKmag(Number.NaN)).toThrow(RangeError);
  });

  it('形态档：T ≤ 0 早型、1–19 晚型、≥20/不可解析未知（2MRS type 码）', () => {
    expect(morphTierFromType('-5')).toBe(0);
    expect(morphTierFromType(' 0B')).toBe(0);
    expect(morphTierFromType(' 3B_R')).toBe(1);
    expect(morphTierFromType('10')).toBe(1);
    expect(morphTierFromType('19')).toBe(1);
    expect(morphTierFromType('20')).toBe(2);
    expect(morphTierFromType('98')).toBe(2);
    expect(morphTierFromType('99')).toBe(2);
    expect(morphTierFromType('??')).toBe(2);
    expect(morphTierFromType('')).toBe(2);
  });

  it('w 打包为整数值浮点（Float32 精确 → 幂等）且往返一致', () => {
    for (const tier of [0, 1, 2] as const) {
      for (const b of [0, 0.25, 0.5, 0.999, 1]) {
        const w = packCatalogW(tier, b);
        expect(Number.isInteger(w)).toBe(true);
        expect(Math.fround(w)).toBe(w);
        const back = unpackCatalogW(w);
        expect(back.tier).toBe(tier);
        expect(back.brightness01).toBeCloseTo(b, 2);
      }
    }
    expect(packCatalogW(2, 1)).toBe(2999);
    expect(() => packCatalogW(0, 1.5)).toThrow(RangeError);
    expect(() => unpackCatalogW(3000)).toThrow(RangeError);
    expect(() => unpackCatalogW(1.5)).toThrow(RangeError);
    expect(() => unpackCatalogW(-1)).toThrow(RangeError);
  });
});

describe('实体星系去重（防重影）', () => {
  it('登记 8 个实体（银河系身处其中不在目录，登记）；实体方位全部命中', () => {
    expect(ENTITY_GALAXY_SKY).toHaveLength(8);
    for (const e of ENTITY_GALAXY_SKY) {
      // M32 距 M31 仅 ~0.4° < 匹配半径，命中先登记者 m31（同被剔除，语义等价）
      const hit = matchEntityGalaxy(e.raDeg, e.decDeg);
      expect(hit).not.toBeNull();
    }
    expect(matchEntityGalaxy(187.7059, 12.3911)).toBe('m87');
    expect(matchEntityGalaxy(80.8942, -69.7561)).toBe('lmc');
    expect(matchEntityGalaxy(13.1866, -72.8286)).toBe('smc');
    expect(matchEntityGalaxy(10.6743, 40.8652)).toBe('m31');
  });

  it('匹配半径 0.5°（登记）：边界内命中、边界外不命中', () => {
    expect(DEDUP_MATCH_RADIUS_DEG).toBe(0.5);
    // M87 偏移 0.4°（赤纬向）命中；偏移 0.6° 不命中
    expect(matchEntityGalaxy(187.7059, 12.3911 + 0.4)).toBe('m87');
    expect(matchEntityGalaxy(187.7059, 12.3911 + 0.6)).toBeNull();
    // 远离任何实体的天区
    expect(matchEntityGalaxy(150, -40)).toBeNull();
  });
});

describe('锥计数与室女座超密度判据', () => {
  // 合成数据：z 轴锥内 20 条（10 Mpc）+ 各向同性壳 80 条（20 Mpc）+ 远景 50 条（100 Mpc）
  const positions: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    positions.push(0.05 * Math.sin(i), 0.05 * Math.cos(i), 10);
  }
  for (let i = 0; i < 80; i += 1) {
    const a = (i / 80) * Math.PI * 2;
    positions.push(20 * Math.cos(a), 20 * Math.sin(a), 0);
  }
  for (let i = 0; i < 50; i += 1) {
    const a = (i / 50) * Math.PI * 2;
    positions.push(100 * Math.cos(a), 0, 100 * Math.sin(a));
  }

  it('锥计数：方向/半径/距离壳过滤正确', () => {
    const zDir = { x: 0, y: 0, z: 1 };
    // 全距离：锥内 20 条 + 远景 100 Mpc 环经过 +z 附近 2 条 = 22（壳过滤后 20）
    expect(countInCone(positions, zDir, 5)).toBe(22);
    expect(countInCone(positions, zDir, 5, 5, 30)).toBe(20);
    expect(countInCone(positions, zDir, 5, 15, 30)).toBe(0);
    // 远景 100 Mpc 环上有一条正好在 +z？环在 xz 面：(100,0,0)...(cos,sin) → z 轴向条目 i=12.5 不精确落轴
    expect(countInCone(positions, { x: 1, y: 0, z: 0 }, 3, 15, 25)).toBeGreaterThan(0);
  });

  it('壳计数与超密度比：合成室女座锥显著超密度', () => {
    expect(countInShell(positions, 5, 30)).toBe(100);
    const ratio =
      countInCone(positions, { x: 0, y: 0, z: 1 }, VIRGO_CONE_RADIUS_DEG, 5, 30) /
      countInShell(positions, 5, 30) /
      coneSolidAngleFraction(VIRGO_CONE_RADIUS_DEG);
    expect(ratio).toBeGreaterThan(VIRGO_OVERDENSITY_MIN_RATIO);
  });

  it('立体角比例：90° 半球 = 0.5；单调性', () => {
    expect(coneSolidAngleFraction(90)).toBeCloseTo(0.5, 12);
    expect(coneSolidAngleFraction(6)).toBeLessThan(coneSolidAngleFraction(12));
    expect(() => coneSolidAngleFraction(0)).toThrow(RangeError);
    expect(() => coneSolidAngleFraction(180)).toThrow(RangeError);
  });

  it('非法输入：零方向/半径越界/距离壳非法抛 RangeError', () => {
    expect(() => countInCone(positions, { x: 0, y: 0, z: 0 }, 5)).toThrow(RangeError);
    expect(() => countInCone(positions, { x: 0, y: 0, z: 1 }, 0)).toThrow(RangeError);
    expect(() => countInCone(positions, { x: 0, y: 0, z: 1 }, 5, 10, 5)).toThrow(RangeError);
    expect(() => countInShell(positions, -1, 5)).toThrow(RangeError);
    expect(() => countInShell(positions, 5, 5)).toThrow(RangeError);
  });

  it('室女座判据常量域（登记判据镜像）', () => {
    expect(VIRGO_RA_DEG).toBeCloseTo(187.7059, 4);
    expect(VIRGO_DEC_DEG).toBeCloseTo(12.3911, 4);
    expect(VIRGO_CONE_RADIUS_DEG).toBe(6);
    expect(VIRGO_SHELL_MIN_MPC).toBeLessThan(16.5);
    expect(VIRGO_SHELL_MAX_MPC).toBeGreaterThan(16.5);
  });
});
