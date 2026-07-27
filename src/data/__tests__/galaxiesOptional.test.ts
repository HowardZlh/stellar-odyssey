/**
 * 可选项新增星系数据测试（可选需求 3.1.3 / 7 单元测试）：
 * M32 / M110 / 人马座矮星系 + M31 伴星系偏移 + 麦哲伦星流配置
 */

import {
  LOCAL_GROUP_GALAXIES,
  M31_COMPANION_OFFSETS_LY,
  MAGELLANIC_STREAM,
  getGalaxyById,
} from '@/data/galaxies';

describe('新增星系条目（M32 / M110 / 人马座矮星系）', () => {
  it('全部存在且为椭圆星系', () => {
    for (const id of ['m32', 'm110', 'sagittarius-dwarf']) {
      const g = getGalaxyById(id)!;
      expect(g).toBeDefined();
      expect(g.morphology).toBe('elliptical');
      expect(g.dataSource.length).toBeGreaterThan(0);
    }
  });

  it('方向矢量已归一化（±1% 容差）', () => {
    for (const id of ['m32', 'm110', 'sagittarius-dwarf']) {
      const d = getGalaxyById(id)!.direction;
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 1);
    }
  });

  it('M32 / M110 距离与 M31 相当（约 250 万光年，仙女座卫星）', () => {
    const m31 = getGalaxyById('m31')!;
    for (const id of ['m32', 'm110']) {
      const g = getGalaxyById(id)!;
      expect(Math.abs(g.distanceLy - m31.distanceLy) / m31.distanceLy).toBeLessThan(0.1);
      expect(g.groupZh).toContain('仙女座');
      // 伴星系直径远小于 M31（22 万光年）
      expect(g.diameterLy).toBeLessThan(m31.diameterLy / 5);
    }
  });

  it('人马座矮星系为最近的卫星星系之一（距离 < 大麦哲伦云）', () => {
    const sgr = getGalaxyById('sagittarius-dwarf')!;
    const lmc = getGalaxyById('lmc')!;
    expect(sgr.distanceLy).toBeLessThan(lmc.distanceLy);
    expect(sgr.descriptionZh).toContain('潮汐');
  });

  it('id 全局唯一', () => {
    const ids = LOCAL_GROUP_GALAXIES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('M31_COMPANION_OFFSETS_LY（伴星系示意偏移）', () => {
  it('键与伴星系条目一一对应', () => {
    expect(Object.keys(M31_COMPANION_OFFSETS_LY).sort()).toEqual(['m110', 'm32']);
  });

  it('偏移非零且两伴星系分列两侧（偏移方向相反）', () => {
    const m32 = M31_COMPANION_OFFSETS_LY.m32;
    const m110 = M31_COMPANION_OFFSETS_LY.m110;
    expect(Math.hypot(m32.x, m32.y, m32.z)).toBeGreaterThan(0);
    expect(Math.hypot(m110.x, m110.y, m110.z)).toBeGreaterThan(0);
    // 点积为负：大致相反方向
    expect(m32.x * m110.x + m32.y * m110.y + m32.z * m110.z).toBeLessThan(0);
  });
});

describe('MAGELLANIC_STREAM（麦哲伦星流配置）', () => {
  it('采样点数 ≥ 2、种子确定、来源标注', () => {
    expect(MAGELLANIC_STREAM.pointCount).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(MAGELLANIC_STREAM.seed)).toBe(true);
    expect(MAGELLANIC_STREAM.dataSource).toContain('Nidever');
    expect(MAGELLANIC_STREAM.nameZh).toBe('麦哲伦星流');
  });
});
