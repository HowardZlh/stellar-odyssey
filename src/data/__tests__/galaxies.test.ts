/**
 * 星系数据准确性测试（需求 3.1.3 / 3.1.4 / 需求 6：数据准确性）
 */

import {
  MILKY_WAY,
  LOCAL_GROUP_GALAXIES,
  VIRGO_CLUSTER,
  LANIAKEA,
  GALAXY_MOTION_NOTE_ZH,
  GREAT_ATTRACTOR_DIRECTION,
  LG_CMB_VELOCITY_KM_S,
  SAGITTARIUS_STREAM,
  SATELLITE_GALAXY_ORBITS,
  getGalaxyById,
} from '@/data/galaxies';
import type { Vec3 } from '@/types';

function magnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

describe('银河系结构', () => {
  it('棒旋星系，直径 10 万光年，盘厚 1000 光年', () => {
    expect(MILKY_WAY.morphology).toBe('barred-spiral');
    expect(MILKY_WAY.diameterLy).toBe(100000);
    expect(MILKY_WAY.diskThicknessLy).toBe(1000);
  });

  it('4 条主旋臂且包含英仙臂、人马臂（全文档统一命名）', () => {
    expect(MILKY_WAY.armNames).toHaveLength(4);
    expect(MILKY_WAY.armNames).toContain('英仙臂');
    expect(MILKY_WAY.armNames).toContain('人马臂');
  });

  it('银心为人马座A* 超大质量黑洞', () => {
    expect(MILKY_WAY.sagittariusAStarZh).toContain('人马座A*');
    expect(MILKY_WAY.dataSource.length).toBeGreaterThan(0);
  });
});

describe('本星系群星系科学性', () => {
  it('M31 距离 250 万光年，直径约为银河系 1.5 倍', () => {
    const m31 = getGalaxyById('m31')!;
    expect(m31.distanceLy).toBe(2.5e6);
    expect(m31.diameterLy / MILKY_WAY.diameterLy).toBeCloseTo(1.5, 1);
  });

  it('M33 直径约为银河系 60%', () => {
    const m33 = getGalaxyById('m33')!;
    expect(m33.diameterLy / MILKY_WAY.diameterLy).toBeCloseTo(0.6, 1);
  });

  it('LMC/SMC 距离 16 万 / 20 万光年', () => {
    expect(getGalaxyById('lmc')!.distanceLy).toBe(160000);
    expect(getGalaxyById('smc')!.distanceLy).toBe(200000);
  });

  it('M31 接近（负速度），M87 退行（正速度）', () => {
    expect(getGalaxyById('m31')!.radialVelocityKmS).toBeLessThan(0);
    expect(getGalaxyById('m87')!.radialVelocityKmS).toBeGreaterThan(0);
  });

  it('四种星系形态均出现（含银河系的棒旋）', () => {
    const morphologies = new Set<string>([
      MILKY_WAY.morphology,
      ...LOCAL_GROUP_GALAXIES.map((g) => g.morphology),
    ]);
    expect(morphologies).toContain('spiral');
    expect(morphologies).toContain('barred-spiral');
    expect(morphologies).toContain('elliptical');
    expect(morphologies).toContain('irregular');
  });

  it('id 唯一且均标注数据来源', () => {
    const ids = LOCAL_GROUP_GALAXIES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of LOCAL_GROUP_GALAXIES) {
      expect(g.dataSource.length).toBeGreaterThan(0);
    }
  });
});

describe('方向矢量', () => {
  it('所有 direction 均为单位矢量（||v| − 1| < 1e-3）', () => {
    for (const g of LOCAL_GROUP_GALAXIES) {
      expect(Math.abs(magnitude(g.direction) - 1)).toBeLessThan(1e-3);
    }
  });

  it('所有 direction 两两不同', () => {
    for (let i = 0; i < LOCAL_GROUP_GALAXIES.length; i += 1) {
      for (let j = i + 1; j < LOCAL_GROUP_GALAXIES.length; j += 1) {
        const a = LOCAL_GROUP_GALAXIES[i].direction;
        const b = LOCAL_GROUP_GALAXIES[j].direction;
        const same = a.x === b.x && a.y === b.y && a.z === b.z;
        expect(same).toBe(false);
      }
    }
  });

  it('巨引源方向为单位矢量', () => {
    expect(Math.abs(magnitude(GREAT_ATTRACTOR_DIRECTION) - 1)).toBeLessThan(1e-3);
  });
});

describe('大尺度结构常量', () => {
  it('室女座星系团距离 5400 万光年', () => {
    expect(VIRGO_CLUSTER.distanceLy).toBe(5.4e7);
    expect(VIRGO_CLUSTER.memberCountNote).toContain('2000');
  });

  it('拉尼亚凯亚超星系团直径 5.2 亿光年，含巨引源', () => {
    expect(LANIAKEA.diameterLy).toBe(5.2e8);
    expect(LANIAKEA.greatAttractorZh).toBe('巨引源');
  });

  it('本星系群相对 CMB 运动速度 620 km/s', () => {
    expect(LG_CMB_VELOCITY_KM_S).toBe(620);
  });
});

describe('卫星星系轨道可视化参数', () => {
  it('LMC/SMC 轨道参数完整（周期为示意近似）', () => {
    expect(SATELLITE_GALAXY_ORBITS.lmc.periodMyr).toBeGreaterThan(0);
    expect(SATELLITE_GALAXY_ORBITS.smc.periodMyr).toBeGreaterThan(
      SATELLITE_GALAXY_ORBITS.lmc.periodMyr,
    );
    expect(SATELLITE_GALAXY_ORBITS.lmc.inclinationDeg).toBe(35);
    expect(SATELLITE_GALAXY_ORBITS.smc.inclinationDeg).toBe(50);
  });

  it('人马座矮星系为极轨道且周期约 9 亿年（R2-10 示意登记）', () => {
    expect(SATELLITE_GALAXY_ORBITS['sagittarius-dwarf'].inclinationDeg).toBe(90);
    expect(SATELLITE_GALAXY_ORBITS['sagittarius-dwarf'].periodMyr).toBe(900);
  });

  it('人马座潮汐流参数：前导+尾随双向、粒子数 ≤1,500（预算登记）', () => {
    expect(SAGITTARIUS_STREAM.backMyr).toBeGreaterThan(0);
    expect(SAGITTARIUS_STREAM.forwardMyr).toBeGreaterThan(0);
    expect(SAGITTARIUS_STREAM.pointCount).toBeLessThanOrEqual(1500);
  });

  it('L4 运动一致性登记：全部本星系群星系均有"运动（模拟）"说明', () => {
    for (const g of LOCAL_GROUP_GALAXIES) {
      expect(GALAXY_MOTION_NOTE_ZH[g.id]).toBeTruthy();
    }
    // 星流澄清（R2-10）：注明星流为历史路径上剥离的物质、非轨道线
    expect(GALAXY_MOTION_NOTE_ZH.lmc).toContain('非轨道线');
    expect(GALAXY_MOTION_NOTE_ZH.m32).toContain('随 M31');
    expect(GALAXY_MOTION_NOTE_ZH.m110).toContain('随 M31');
  });
});

describe('getGalaxyById', () => {
  it('按 id 查找星系', () => {
    expect(getGalaxyById('m31')?.nameZh).toBe('仙女座星系');
  });

  it('未知 id 返回 undefined', () => {
    expect(getGalaxyById('ngc-1300')).toBeUndefined();
  });
});
