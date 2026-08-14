/**
 * M2-1 实验室注册表单测（契约 C4）：注册期校验 + 查找 + 路由路径
 * O1 更新：注册表扩至流星雨 + 天体观察站两项，LabEntry 增加 emoji 字段
 */
import {
  LAB_PAGE_PATH,
  LAB_REGISTRY,
  labEntryForId,
  labScenePath,
  OBSERVATORY_PAGE_PATH,
  observatoryBodyPath,
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
  emoji: '☄️',
};

describe('LAB_REGISTRY（契约 C4）', () => {
  it('本期为 meteor-shower + observatory 两项且字段齐全', () => {
    expect(LAB_REGISTRY.size).toBe(2);
    const entry = LAB_REGISTRY.get('meteor-shower');
    expect(entry).toBeDefined();
    expect(entry?.titleKey).toBe('lab.meteorShowerTitle');
    expect(entry?.descriptionKey).toBe('lab.meteorShowerDescription');
    expect(entry?.componentKey).toBe('meteor-shower-lab');
    expect(entry?.dataSource).toContain('Yale Bright Star Catalog');
    expect(entry?.dataSource).toContain('IAU Meteor Data Center');
    expect(entry?.emoji).toBe('☄️');
  });

  it('O1：天体观察站条目字段齐全', () => {
    const entry = LAB_REGISTRY.get('observatory');
    expect(entry).toBeDefined();
    expect(entry?.titleKey).toBe('lab.observatoryTitle');
    expect(entry?.descriptionKey).toBe('lab.observatoryDescription');
    expect(entry?.componentKey).toBe('observatory-lab');
    expect(entry?.dataSource).toContain('devPreview');
    expect(entry?.emoji).toBe('🔭');
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

  it('拒绝空 componentKey / 空 dataSource / 空 emoji', () => {
    expect(() => validateLabEntry({ ...VALID_ENTRY, componentKey: '' })).toThrow(RangeError);
    expect(() => validateLabEntry({ ...VALID_ENTRY, dataSource: '' })).toThrow(RangeError);
    expect(() => validateLabEntry({ ...VALID_ENTRY, emoji: '' })).toThrow(RangeError);
  });
});

describe('查找与路径', () => {
  it('labEntryForId：命中返回条目，null/undefined/未注册返回 null', () => {
    expect(labEntryForId('meteor-shower')).toBe(LAB_REGISTRY.get('meteor-shower'));
    expect(labEntryForId('observatory')).toBe(LAB_REGISTRY.get('observatory'));
    expect(labEntryForId(null)).toBeNull();
    expect(labEntryForId(undefined)).toBeNull();
    expect(labEntryForId('solar-eclipse')).toBeNull();
  });

  it('registeredLabEntries 按注册序返回全部条目', () => {
    const entries = registeredLabEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].labId).toBe('meteor-shower');
    expect(entries[1].labId).toBe('observatory');
  });

  it('labScenePath 与 LAB_PAGE_PATH 路由同源', () => {
    expect(LAB_PAGE_PATH).toBe('/lab');
    expect(labScenePath(VALID_ENTRY)).toBe('/lab/meteor-shower');
    expect(labScenePath(LAB_REGISTRY.get('observatory')!)).toBe('/lab/observatory');
  });

  it('OBSERVATORY_PAGE_PATH 与画廊场景路径同源', () => {
    expect(OBSERVATORY_PAGE_PATH).toBe('/lab/observatory');
    expect(OBSERVATORY_PAGE_PATH).toBe(labScenePath(LAB_REGISTRY.get('observatory')!));
  });

  it('observatoryBodyPath 生成路径形态 /lab/observatory/<id>', () => {
    expect(observatoryBodyPath('betelgeuse')).toBe('/lab/observatory/betelgeuse');
    expect(observatoryBodyPath('blackhole-test')).toBe('/lab/observatory/blackhole-test');
  });

  it('observatoryBodyPath 对异常字符做 URL 编码（防御性）', () => {
    expect(observatoryBodyPath('a b/c')).toBe('/lab/observatory/a%20b%2Fc');
  });
});
