/**
 * 可选项新增特殊天体数据测试（可选需求 3.1.5 / 7 单元测试）：
 * L3 天鹅座X-1 / WR 124 / 造父一 / 昴星团 / 马头星云 +
 * L4 触须星系 / 引力透镜弧 / GRB 221009A
 */

import { SPECIAL_BODIES, getSpecialBodyById } from '@/data/specialBodies';

const NEW_L3_IDS = ['cygnus-x1', 'wr-124', 'delta-cephei', 'pleiades', 'horsehead-nebula'];
const NEW_L4_IDS = ['antennae-galaxies', 'cluster-lensing', 'grb-221009a'];

describe('可选项新增条目完整性（8 条）', () => {
  it('全部条目存在且 id 唯一', () => {
    for (const id of [...NEW_L3_IDS, ...NEW_L4_IDS]) {
      expect(getSpecialBodyById(id)).toBeDefined();
    }
    const ids = SPECIAL_BODIES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('L3 条目为 sun-relative 且带偏移，L4 条目为 extragalactic 且带方向', () => {
    for (const id of NEW_L3_IDS) {
      const b = getSpecialBodyById(id)!;
      expect(b.level).toBe('L3');
      expect(b.positionMode).toBe('sun-relative');
      expect(b.offsetLy).toBeDefined();
    }
    for (const id of NEW_L4_IDS) {
      const b = getSpecialBodyById(id)!;
      expect(b.level).toBe('L4');
      expect(b.positionMode).toBe('extragalactic');
      expect(b.direction).toBeDefined();
    }
  });

  it('L4 条目方向为单位矢量（±1% 容差）', () => {
    for (const id of NEW_L4_IDS) {
      const d = getSpecialBodyById(id)!.direction!;
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 1);
    }
  });

  it('facts / dynamics / dataSource 完整（信息面板需求 3.5.2）', () => {
    for (const id of [...NEW_L3_IDS, ...NEW_L4_IDS]) {
      const b = getSpecialBodyById(id)!;
      expect(b.factsZh.length).toBeGreaterThanOrEqual(3);
      for (const fact of b.factsZh) {
        expect(fact.label.length).toBeGreaterThan(0);
        expect(fact.value.length).toBeGreaterThan(0);
      }
      expect(b.dynamicsZh.length).toBeGreaterThan(0);
      expect(b.dataSource.length).toBeGreaterThan(0);
    }
  });

  it('kind 与需求对应：黑洞/WR星/造父/疏散星团/暗星云/碰撞/透镜/伽马暴', () => {
    expect(getSpecialBodyById('cygnus-x1')!.kind).toBe('black-hole');
    expect(getSpecialBodyById('wr-124')!.kind).toBe('wolf-rayet');
    expect(getSpecialBodyById('delta-cephei')!.kind).toBe('cepheid');
    expect(getSpecialBodyById('pleiades')!.kind).toBe('open-cluster');
    expect(getSpecialBodyById('horsehead-nebula')!.kind).toBe('dark-nebula');
    expect(getSpecialBodyById('antennae-galaxies')!.kind).toBe('galaxy-collision');
    expect(getSpecialBodyById('cluster-lensing')!.kind).toBe('lensing-cluster');
    expect(getSpecialBodyById('grb-221009a')!.kind).toBe('gamma-ray-burst');
  });
});

describe('科学数据准确性（附录B 数据来源）', () => {
  it('天鹅座X-1：质量约 21 M☉（Miller-Jones 2021）', () => {
    const b = getSpecialBodyById('cygnus-x1')!;
    expect(b.factsZh.some((f) => f.value.includes('21'))).toBe(true);
    expect(b.realDistanceLy).toBe(7200);
  });

  it('WR 124：距离约 2.1 万光年（JWST 2022）', () => {
    expect(getSpecialBodyById('wr-124')!.realDistanceLy).toBe(21000);
  });

  it('造父一：光变周期 5.366 天、量天尺（Leavitt 周光关系）', () => {
    const b = getSpecialBodyById('delta-cephei')!;
    expect(b.factsZh.some((f) => f.value.includes('5.366'))).toBe(true);
    expect(b.factsZh.some((f) => f.label === '量天尺')).toBe(true);
  });

  it('昴星团：距离约 444 光年（Gaia DR3）', () => {
    expect(getSpecialBodyById('pleiades')!.realDistanceLy).toBe(444);
  });

  it('马头星云：距离约 1,375 光年', () => {
    expect(getSpecialBodyById('horsehead-nebula')!.realDistanceLy).toBe(1375);
  });

  it('触须星系：距离约 4,500 万光年', () => {
    expect(getSpecialBodyById('antennae-galaxies')!.realDistanceLy).toBe(4.5e7);
  });

  it('GRB 221009A：约 20 亿光年（z ≈ 0.151）且演示重放已登记', () => {
    const b = getSpecialBodyById('grb-221009a')!;
    expect(b.realDistanceLy).toBe(2.0e9);
    expect(b.factsZh.some((f) => f.value.includes('示意') || f.value.includes('演示'))).toBe(true);
  });

  it('引力透镜弧：示意位置已登记（原型 Abell 370）', () => {
    const b = getSpecialBodyById('cluster-lensing')!;
    expect(b.factsZh.some((f) => f.value.includes('Abell 370'))).toBe(true);
    expect(b.factsZh.some((f) => f.value.includes('示意'))).toBe(true);
  });
});
