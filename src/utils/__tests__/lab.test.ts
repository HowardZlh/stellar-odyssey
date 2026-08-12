/**
 * M2-1 实验室注册表单测（契约 C4）：注册期校验 + 查找 + 路由路径
 */
import {
  LAB_PAGE_PATH,
  LAB_REGISTRY,
  labEntryForId,
  labScenePath,
  registeredLabEntries,
  validateLabEntry,
  type LabEntry,
} from '../lab';

/** 合法条目模板（用例按需覆写字段） */
const VALID_ENTRY: LabEntry = {
  labId: 'meteor-shower',
  titleKey: 'lab.meteorShowerTitle',
  descriptionKey: 'lab.meteorShowerDescription',
  componentKey: 'meteor-shower-lab',
  dataSource: 'Yale Bright Star Catalog (Hoffleit & Warren 1991)',
};

describe('LAB_REGISTRY（契约 C4）', () => {
  it('本期仅 meteor-shower 一项且字段齐全', () => {
    expect(LAB_REGISTRY.size).toBe(1);
    const entry = LAB_REGISTRY.get('meteor-shower');
    expect(entry).toBeDefined();
    expect(entry?.titleKey).toBe('lab.meteorShowerTitle');
    expect(entry?.descriptionKey).toBe('lab.meteorShowerDescription');
    expect(entry?.componentKey).toBe('meteor-shower-lab');
    expect(entry?.dataSource).toContain('Yale Bright Star Catalog');
    expect(entry?.dataSource).toContain('IAU Meteor Data Center');
  });

  it('注册表全部条目通过注册期校验（模块加载即自检，此处显式复跑）', () => {
    for (const entry of LAB_REGISTRY.values()) {
      expect(() => validateLabEntry(entry)).not.toThrow();
    }
  });
});

describe('validateLabEntry（注册期校验）', () => {
  it('接受合法条目', () => {
    expect(() => validateLabEntry(VALID_ENTRY)).not.toThrow();
  });

  it('拒绝路由段非法的 labId（大写/下划线/空串/首尾连字符）', () => {
    for (const labId of ['', 'Meteor', 'meteor_shower', '-meteor', 'meteor-', '流星']) {
      expect(() => validateLabEntry({ ...VALID_ENTRY, labId })).toThrow(RangeError);
    }
  });

  it('拒绝空 componentKey 与空 dataSource（来源登记强制）', () => {
    expect(() => validateLabEntry({ ...VALID_ENTRY, componentKey: '' })).toThrow(RangeError);
    expect(() => validateLabEntry({ ...VALID_ENTRY, dataSource: '' })).toThrow(RangeError);
  });
});

describe('查找与路径', () => {
  it('labEntryForId：命中返回条目，null/undefined/未注册返回 null', () => {
    expect(labEntryForId('meteor-shower')).toBe(LAB_REGISTRY.get('meteor-shower'));
    expect(labEntryForId(null)).toBeNull();
    expect(labEntryForId(undefined)).toBeNull();
    expect(labEntryForId('solar-eclipse')).toBeNull();
  });

  it('registeredLabEntries 按注册序返回全部条目', () => {
    const entries = registeredLabEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].labId).toBe('meteor-shower');
  });

  it('labScenePath 与 LAB_PAGE_PATH 路由同源', () => {
    expect(LAB_PAGE_PATH).toBe('/lab');
    expect(labScenePath(VALID_ENTRY)).toBe('/lab/meteor-shower');
  });
});
