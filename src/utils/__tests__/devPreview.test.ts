/**
 * 开发预览工位注册表纯逻辑测试（R4-1，IMPROVEMENT_REQUIREMENTS_4 §R4-1 验收）
 */

import {
  MAX_PREVIEW_PARAMS,
  PREVIEW_REGISTRY,
  VOLUME_PREVIEW_COMPONENT_KEYS,
  clampParamValue,
  defaultParamValues,
  previewEntryForBody,
  registeredPreviewIds,
  stellarPreviewConfigForBody,
  validatePreviewEntry,
  type PreviewEntry,
  type PreviewParam,
} from '@/utils/devPreview';
import { FALLBACK_STAR_PARAMS, granulationCellScale } from '@/utils/starPhysics';
import { STAR_PARAM_KEYS } from '@/utils/bakedData';

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

describe('恒星预览条目组（R4-6：6 类恒星）', () => {
  const STELLAR_IDS = [
    'betelgeuse',
    'rigel',
    'sirius',
    'sirius-b',
    'delta-cephei',
    'wr-124',
  ];

  it('6 类恒星全部注册且 componentKey 为 stellar-surface', () => {
    for (const id of STELLAR_IDS) {
      const entry = previewEntryForBody(id);
      expect(entry).not.toBeNull();
      expect(entry!.componentKey).toBe('stellar-surface');
    }
  });

  it('每条目滑杆为 §R4-6 指定三件：Teff 覆写/噪声频率/时间流速（参宿四另加 R4-18 两件）', () => {
    for (const id of STELLAR_IDS) {
      const keys = previewEntryForBody(id)!.params.map((p) => p.key);
      if (id === 'betelgeuse') {
        // R4-18：参宿四专属滑杆——球谐幅度/演化速度
        expect(keys).toEqual(['teffK', 'cellScale', 'timeScale', 'shAmplitude', 'shSpeed']);
      } else {
        expect(keys).toEqual(['teffK', 'cellScale', 'timeScale']);
      }
    }
  });

  it('R4-18：仅参宿四 shAmplitude 配置非零（其余恒星均匀颗粒观感区分）', () => {
    for (const id of STELLAR_IDS) {
      const config = stellarPreviewConfigForBody(id)!;
      if (id === 'betelgeuse') {
        expect(config.shAmplitude).toBeGreaterThan(0);
        expect(config.shAmplitude).toBeLessThanOrEqual(1);
        // 滑杆默认值与配置同源
        const amp = previewEntryForBody(id)!.params.find((p) => p.key === 'shAmplitude')!;
        expect(amp.default).toBe(config.shAmplitude);
      } else {
        expect(config.shAmplitude).toBe(0);
      }
    }
  });

  it('每条目均有恒星配置（stellarPreviewConfigForBody）且 starKey 属烘焙产物键集', () => {
    for (const id of STELLAR_IDS) {
      const config = stellarPreviewConfigForBody(id);
      expect(config).not.toBeNull();
      expect(STAR_PARAM_KEYS).toContain(config!.starKey);
    }
    expect(stellarPreviewConfigForBody('volume-test')).toBeNull();
    expect(stellarPreviewConfigForBody(null)).toBeNull();
  });

  it('Teff 滑杆默认值与降级参数表一致（参宿四 3,600 K / 天狼星 B 25,200 K）', () => {
    const teffOf = (id: string): number =>
      previewEntryForBody(id)!.params.find((p) => p.key === 'teffK')!.default;
    expect(teffOf('betelgeuse')).toBe(FALLBACK_STAR_PARAMS.betelgeuse.teffK);
    expect(teffOf('sirius-b')).toBe(FALLBACK_STAR_PARAMS.siriusB.teffK);
    expect(teffOf('wr-124')).toBe(FALLBACK_STAR_PARAMS.wr124.teffK);
  });

  it('噪声频率滑杆默认值 = granulationCellScale(半径)（参宿四 ≈2.2 巨对流胞）', () => {
    const cellOf = (id: string): number =>
      previewEntryForBody(id)!.params.find((p) => p.key === 'cellScale')!.default;
    expect(cellOf('betelgeuse')).toBeCloseTo(
      granulationCellScale(FALLBACK_STAR_PARAMS.betelgeuse.radiusRsun),
      10,
    );
    expect(cellOf('betelgeuse')).toBeCloseTo(2.2, 1);
    expect(cellOf('sirius-b')).toBe(12);
  });

  it('参数数量不超过上限且键唯一', () => {
    for (const id of STELLAR_IDS) {
      const entry = previewEntryForBody(id)!;
      expect(entry.params.length).toBeLessThanOrEqual(MAX_PREVIEW_PARAMS);
      const keys = entry.params.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('逐条目登记数据来源（含 Claret 2000 临边昏暗近似档）', () => {
    for (const id of STELLAR_IDS) {
      expect(previewEntryForBody(id)!.dataSource).toMatch(/Claret \(2000\)/);
    }
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

describe('猎户座星云 M42 体积条目（R4-7）', () => {
  it('orion-nebula 已注册且 componentKey 为 orion-nebula-volume', () => {
    const entry = previewEntryForBody('orion-nebula');
    expect(entry).not.toBeNull();
    expect(entry!.componentKey).toBe('orion-nebula-volume');
  });

  it('滑杆含 §R4-7 指定三件（密度倍率/双色权重/步数）且总数 ≤ 上限', () => {
    const entry = previewEntryForBody('orion-nebula')!;
    const keys = entry.params.map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining(['density', 'weightBias', 'steps']),
    );
    expect(entry.params.length).toBeLessThanOrEqual(MAX_PREVIEW_PARAMS);
  });

  it('双色权重滑杆默认 0、区间 [-1,1]；步数默认 64、区间 [16,128]', () => {
    const entry = previewEntryForBody('orion-nebula')!;
    const weight = entry.params.find((p) => p.key === 'weightBias')!;
    expect(weight.default).toBe(0);
    expect(weight.min).toBe(-1);
    expect(weight.max).toBe(1);
    const steps = entry.params.find((p) => p.key === 'steps')!;
    expect(steps.default).toBe(64);
    expect(steps.min).toBe(16);
    expect(steps.max).toBe(128);
  });

  it('dataSource 登记 Hubble 公版图像形态参考（附录 A §4）', () => {
    expect(previewEntryForBody('orion-nebula')!.dataSource).toMatch(/Hubble 公版图像/);
  });

  it('VOLUME_PREVIEW_COMPONENT_KEYS 覆盖两个体积条目（HUD 质量档行显隐依据）', () => {
    expect(VOLUME_PREVIEW_COMPONENT_KEYS.has('volume-raymarch-test')).toBe(true);
    expect(VOLUME_PREVIEW_COMPONENT_KEYS.has('orion-nebula-volume')).toBe(true);
    expect(VOLUME_PREVIEW_COMPONENT_KEYS.has('stellar-surface')).toBe(false);
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
