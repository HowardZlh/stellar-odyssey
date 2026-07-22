/**
 * 信息目录 P2 扩展测试：特殊天体条目 + 超新星动态条目（需求 3.1.5 通用要求）
 */

import { getBodyInfoById } from '@/data/catalog';
import { SPECIAL_BODIES } from '@/data/specialBodies';
import { SN_REAL_FREQUENCY_NOTE_ZH } from '@/utils/supernova';

describe('特殊天体信息条目', () => {
  it('全部特殊天体可查询（可点选 → 信息面板）', () => {
    for (const b of SPECIAL_BODIES) {
      const info = getBodyInfoById(b.id);
      expect(info).toBeDefined();
      expect(info!.nameZh).toBe(b.nameZh);
      expect(info!.typeZh).toBe(b.typeZh);
      expect(info!.dataSource).toBe(b.dataSource);
    }
  });

  it('条目包含距离、关键参数与动态效果科学解释', () => {
    const info = getBodyInfoById('sgr-a-star')!;
    const labels = info.lines.map((l) => l.label);
    expect(labels).toContain('距离');
    expect(labels).toContain('动态效果');
    expect(labels).toContain('质量');
    const dynamics = info.lines.find((l) => l.label === '动态效果')!;
    expect(dynamics.value).toContain('引力透镜');
  });

  it('参宿四条目注明"置于太阳位置将吞没火星轨道"（需求 3.1.5）', () => {
    const info = getBodyInfoById('betelgeuse')!;
    const values = info.lines.map((l) => l.value).join(' ');
    expect(values).toContain('吞没火星轨道');
  });

  it('天狼星B 条目强调高密度（需求 3.1.5 白矮星）', () => {
    const info = getBodyInfoById('sirius')!;
    const values = info.lines.map((l) => l.value).join(' ');
    expect(values).toContain('高密度');
  });
});

describe('超新星事件条目（sn- 前缀动态生成）', () => {
  it('任意 sn- id 返回通用超新星条目', () => {
    const info = getBodyInfoById('sn-1');
    expect(info).toBeDefined();
    expect(info!.id).toBe('sn-1');
    expect(info!.nameZh).toBe('超新星爆炸');
    // 不同事件 id 均可用
    expect(getBodyInfoById('sn-42')!.id).toBe('sn-42');
  });

  it('条目含科学性说明（真实频率与模拟加速差异，需求 3.1.5）', () => {
    const info = getBodyInfoById('sn-1')!;
    const note = info.lines.find((l) => l.label === '科学性说明');
    expect(note).toBeDefined();
    expect(note!.value).toBe(SN_REAL_FREQUENCY_NOTE_ZH);
  });

  it('条目描述四阶段与遗迹类型规则', () => {
    const info = getBodyInfoById('sn-1')!;
    const values = info.lines.map((l) => l.value).join(' ');
    expect(values).toContain('冲击波');
    expect(values).toContain('中子星');
    expect(values).toContain('黑洞');
  });

  it('未知非 sn- id 仍返回 undefined', () => {
    expect(getBodyInfoById('nonexistent')).toBeUndefined();
  });
});
