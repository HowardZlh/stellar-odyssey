/**
 * 开发预览工位注册表纯逻辑测试（R4-1，IMPROVEMENT_REQUIREMENTS_4 §R4-1 验收）
 */

import {
  MAX_PREVIEW_PARAMS,
  PREVIEW_REGISTRY,
  clampParamValue,
  defaultParamValues,
  previewEntryForBody,
  registeredPreviewIds,
  validatePreviewEntry,
  type PreviewEntry,
  type PreviewParam,
} from '@/utils/devPreview';

function makeEntry(overrides: Partial<PreviewEntry> = {}): PreviewEntry {
  return {
    bodyId: 'x',
    title: 'X',
    componentKey: 'k',
    cameraDistance: 3,
    params: [],
    ...overrides,
  };
}

const P = (o: Partial<PreviewParam> = {}): PreviewParam => ({
  key: 'a',
  label: 'A',
  min: 0,
  max: 1,
  default: 0.5,
  ...o,
});

describe('previewEntryForBody', () => {
  it('已注册 id 返回条目（betelgeuse 为首个样例）', () => {
    const entry = previewEntryForBody('betelgeuse');
    expect(entry).not.toBeNull();
    expect(entry!.bodyId).toBe('betelgeuse');
    expect(entry!.componentKey).toBe('stellar-surface');
  });

  it('未注册 id 返回 null（页面显示占位提示）', () => {
    expect(previewEntryForBody('not-a-body')).toBeNull();
  });

  it('null / undefined / 空串返回 null', () => {
    expect(previewEntryForBody(null)).toBeNull();
    expect(previewEntryForBody(undefined)).toBeNull();
    expect(previewEntryForBody('')).toBeNull();
  });
});

describe('参宿四条目内容', () => {
  const entry = previewEntryForBody('betelgeuse')!;

  it('参数数量不超过上限且键唯一', () => {
    expect(entry.params.length).toBeLessThanOrEqual(MAX_PREVIEW_PARAMS);
    const keys = entry.params.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('包含红巨星档 StellarSurface 参数（limbU/cellScale/convection/rednessStrength）', () => {
    const keys = entry.params.map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining(['limbU', 'cellScale', 'convection', 'rednessStrength']),
    );
  });

  it('默认值与 RedGiant 现状一致（管线验证样例）', () => {
    const byKey = Object.fromEntries(entry.params.map((p) => [p.key, p.default]));
    expect(byKey.limbU).toBe(0.75);
    expect(byKey.cellScale).toBe(2.2);
    expect(byKey.convection).toBe(0.7);
    expect(byKey.rednessStrength).toBe(0.6);
  });

  it('登记数据来源', () => {
    expect(entry.dataSource).toMatch(/Gaia|VLT|Montargès/);
  });
});

describe('defaultParamValues', () => {
  it('返回条目全部参数默认值映射', () => {
    const entry = makeEntry({ params: [P({ key: 'a', default: 0.3 }), P({ key: 'b', default: 2, max: 5 })] });
    expect(defaultParamValues(entry)).toEqual({ a: 0.3, b: 2 });
  });

  it('null / undefined 返回空对象', () => {
    expect(defaultParamValues(null)).toEqual({});
    expect(defaultParamValues(undefined)).toEqual({});
  });

  it('无参数条目返回空对象', () => {
    expect(defaultParamValues(makeEntry())).toEqual({});
  });
});

describe('clampParamValue', () => {
  const p = P({ min: 0, max: 1, default: 0.5 });

  it('区间内原样返回', () => {
    expect(clampParamValue(p, 0.4)).toBe(0.4);
  });

  it('超上界钳制到 max', () => {
    expect(clampParamValue(p, 2)).toBe(1);
  });

  it('超下界钳制到 min', () => {
    expect(clampParamValue(p, -3)).toBe(0);
  });

  it('非有限数回落默认值', () => {
    expect(clampParamValue(p, Number.NaN)).toBe(0.5);
    expect(clampParamValue(p, Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});

describe('validatePreviewEntry', () => {
  it('合法条目不抛错', () => {
    expect(() => validatePreviewEntry(makeEntry({ params: [P()] }))).not.toThrow();
  });

  it('参数数量超限抛 RangeError', () => {
    const params = Array.from({ length: MAX_PREVIEW_PARAMS + 1 }, (_, i) =>
      P({ key: `k${i}` }),
    );
    expect(() => validatePreviewEntry(makeEntry({ params }))).toThrow(RangeError);
  });

  it('相机距离非正抛 RangeError', () => {
    expect(() => validatePreviewEntry(makeEntry({ cameraDistance: 0 }))).toThrow(RangeError);
    expect(() => validatePreviewEntry(makeEntry({ cameraDistance: Number.NaN }))).toThrow(
      RangeError,
    );
  });

  it('参数键重复抛 RangeError', () => {
    expect(() =>
      validatePreviewEntry(makeEntry({ params: [P({ key: 'dup' }), P({ key: 'dup' })] })),
    ).toThrow(RangeError);
  });

  it('min>max 抛 RangeError', () => {
    expect(() =>
      validatePreviewEntry(makeEntry({ params: [P({ min: 2, max: 1, default: 1.5 })] })),
    ).toThrow(RangeError);
  });

  it('默认值越界抛 RangeError', () => {
    expect(() =>
      validatePreviewEntry(makeEntry({ params: [P({ min: 0, max: 1, default: 5 })] })),
    ).toThrow(RangeError);
    expect(() =>
      validatePreviewEntry(makeEntry({ params: [P({ min: 0, max: 1, default: -1 })] })),
    ).toThrow(RangeError);
  });

  it('步进非正抛 RangeError', () => {
    expect(() =>
      validatePreviewEntry(makeEntry({ params: [P({ step: 0 })] })),
    ).toThrow(RangeError);
  });

  it('合法步进不抛错', () => {
    expect(() =>
      validatePreviewEntry(makeEntry({ params: [P({ step: 0.01 })] })),
    ).not.toThrow();
  });
});

describe('registeredPreviewIds / PREVIEW_REGISTRY', () => {
  it('列出已注册 id 含 betelgeuse', () => {
    expect(registeredPreviewIds()).toContain('betelgeuse');
  });

  it('注册表所有条目均通过合法性自检', () => {
    for (const entry of PREVIEW_REGISTRY.values()) {
      expect(() => validatePreviewEntry(entry)).not.toThrow();
    }
  });
});
