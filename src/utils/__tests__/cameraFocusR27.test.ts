/**
 * R2-7 §7.1-A：旅行者标记可点选/可飞往（解析 + 科普卡片）单测
 */

import {
  VOYAGER_VIEW_DISTANCE_UNITS,
  resolveFocusTarget,
} from '@/utils/cameraFocus';
import { VOYAGER_MARKERS, voyagerMarkerPositionUnits } from '@/utils/heliopause';
import { getBodyInfoById } from '@/data/catalog';

describe('旅行者标记飞往解析（resolveFocusTarget）', () => {
  it.each(VOYAGER_MARKERS.map((m) => m.id))('%s 可解析（点选卡片可飞往）', (id) => {
    const target = resolveFocusTarget(id, 0);
    expect(target).not.toBeNull();
    expect(target!.position).toEqual(voyagerMarkerPositionUnits(id));
    expect(target!.viewDistanceUnits).toBe(VOYAGER_VIEW_DISTANCE_UNITS);
  });

  it('解析位置与模拟时间无关（标记随日球层顶壳固定于太阳系原点系）', () => {
    const a = resolveFocusTarget('voyager-1', 0)!;
    const b = resolveFocusTarget('voyager-1', 12345.6)!;
    expect(a.position).toEqual(b.position);
  });
});

describe('旅行者科普卡片（catalog 条目扩展，NASA/JPL 来源）', () => {
  it.each(VOYAGER_MARKERS.map((m) => m.id))('%s 卡片存在且标注数据来源', (id) => {
    const info = getBodyInfoById(id)!;
    expect(info).toBeDefined();
    expect(info.dataSource).toContain('NASA/JPL Voyager Interstellar Mission');
    expect(info.lines.some((l) => l.label === '穿越日球层顶')).toBe(true);
  });

  it('日球层顶卡片登记三层结构与不对称形态说明（R2-7）', () => {
    const info = getBodyInfoById('heliopause')!;
    const structure = info.lines.find((l) => l.label === '结构分层');
    expect(structure?.value).toContain('终端激波');
    expect(structure?.value).toContain('日鞘');
    const shape = info.lines.find((l) => l.label === '形态');
    expect(shape?.value).toContain('彗尾状不对称');
  });
});
