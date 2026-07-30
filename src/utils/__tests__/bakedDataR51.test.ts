/**
 * R5-1 星系影像权重图 meta 校验/加载单测 + public/data/galaxy-maps/
 * 实际烘焙产物完整性集成断言（产物随仓库提交，单星系 ≤600 KB）
 */
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  loadGalaxyMapMeta,
  resetBakedDataCache,
  validateGalaxyMapMeta,
  type GalaxyMapMeta,
} from '../bakedData';
import { IMAGE_DRIVEN_GALAXY_IDS } from '../galaxyNearView';

/** 合法 meta fixture（合成，随用例深拷贝修改） */
function metaFixture(): Record<string, unknown> {
  return {
    meta: {
      source: 'DSS2 彩色合成（测试）',
      retrievedAt: '2026-07-30T00:00:00Z',
      license: '测试授权登记',
      count: 4,
    },
    id: 'm31',
    nameZh: '仙女座星系',
    credit: 'STScI DSS / AAO / ROE / Caltech',
    sourceUrl: 'https://example.test/hips2fits?object=M31',
    mapSizePx: 256,
    spriteSizePx: 512,
    mapRadiusLy: 75277,
    pixelScaleLyPerPx: 588.1,
    inclinationDeg: 77,
    positionAngleDeg: 38,
    deprojection: { applied: true, method: '薄盘 1/cos i 拉伸', residualAxisRatio: 0.836 },
    distortionNote: '失真登记（测试）',
  };
}

afterEach(() => {
  resetBakedDataCache();
  jest.restoreAllMocks();
});

describe('validateGalaxyMapMeta（R5-1）', () => {
  it('接受合法 meta（含反投影登记）', () => {
    const data = validateGalaxyMapMeta(metaFixture());
    expect(data).not.toBeNull();
    expect(data?.id).toBe('m31');
    expect(data?.deprojection.applied).toBe(true);
    expect(data?.deprojection.residualAxisRatio).toBeCloseTo(0.836, 6);
  });

  it('接受未反投影 meta（residualAxisRatio = null）', () => {
    const raw = metaFixture();
    raw.deprojection = { applied: false, method: '未反投影（登记）', residualAxisRatio: null };
    const data = validateGalaxyMapMeta(raw);
    expect(data?.deprojection.residualAxisRatio).toBeNull();
  });

  it('拒绝非对象/缺 meta', () => {
    expect(validateGalaxyMapMeta(null)).toBeNull();
    expect(validateGalaxyMapMeta('x')).toBeNull();
    const raw = metaFixture();
    delete raw.meta;
    expect(validateGalaxyMapMeta(raw)).toBeNull();
  });

  it('拒绝字段缺失（id/credit/sourceUrl/distortionNote）', () => {
    for (const key of ['id', 'nameZh', 'credit', 'sourceUrl', 'distortionNote']) {
      const raw = metaFixture();
      delete raw[key];
      expect(validateGalaxyMapMeta(raw)).toBeNull();
    }
  });

  it('拒绝尺寸不符（mapSizePx≠256 / spriteSizePx≠512）', () => {
    const a = metaFixture();
    a.mapSizePx = 128;
    expect(validateGalaxyMapMeta(a)).toBeNull();
    const b = metaFixture();
    b.spriteSizePx = 256;
    expect(validateGalaxyMapMeta(b)).toBeNull();
  });

  it('拒绝非法数值域（半径/像素比例非正、倾角越界、方位角 NaN）', () => {
    const cases: Array<[string, unknown]> = [
      ['mapRadiusLy', 0],
      ['pixelScaleLyPerPx', -1],
      ['inclinationDeg', 91],
      ['inclinationDeg', -1],
      ['positionAngleDeg', Number.NaN],
    ];
    for (const [key, value] of cases) {
      const raw = metaFixture();
      raw[key] = value;
      expect(validateGalaxyMapMeta(raw)).toBeNull();
    }
  });

  it('拒绝反投影登记结构非法（缺 method/applied 非布尔/残差非数值非 null）', () => {
    const a = metaFixture();
    a.deprojection = { applied: true, residualAxisRatio: 1 };
    expect(validateGalaxyMapMeta(a)).toBeNull();
    const b = metaFixture();
    b.deprojection = { applied: 'yes', method: 'x', residualAxisRatio: null };
    expect(validateGalaxyMapMeta(b)).toBeNull();
    const c = metaFixture();
    c.deprojection = { applied: true, method: 'x', residualAxisRatio: 'big' };
    expect(validateGalaxyMapMeta(c)).toBeNull();
    const d = metaFixture();
    d.deprojection = null;
    expect(validateGalaxyMapMeta(d)).toBeNull();
  });
});

describe('loadGalaxyMapMeta（fetch + 缓存 + 降级）', () => {
  it('成功加载并按 URL 缓存（重复调用不重复 fetch）', async () => {
    const mock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(metaFixture()),
    });
    global.fetch = mock as unknown as typeof fetch;
    const a = await loadGalaxyMapMeta('m31');
    const b = await loadGalaxyMapMeta('m31');
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe('/data/galaxy-maps/m31-meta.json');
  });

  it('HTTP 失败/解析失败返回 null 且不缓存（可重试）', async () => {
    const mock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(metaFixture()) });
    global.fetch = mock as unknown as typeof fetch;
    expect(await loadGalaxyMapMeta('m31')).toBeNull();
    expect(await loadGalaxyMapMeta('m31')).not.toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('网络异常返回 null（消费方降级参数化）', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await loadGalaxyMapMeta('smc')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 实际烘焙产物完整性（集成断言：npm run bake:data 产物随仓库提交）
// ---------------------------------------------------------------------------

describe('public/data/galaxy-maps/ 实际产物完整性（§R5-1 A）', () => {
  const dir = join(process.cwd(), 'public', 'data', 'galaxy-maps');
  const PNG_SIGNATURE = [137, 80, 78, 71];

  it.each([...IMAGE_DRIVEN_GALAXY_IDS])('%s：meta 通过校验且登记齐全', (id) => {
    const raw = JSON.parse(readFileSync(join(dir, `${id}-meta.json`), 'utf8')) as unknown;
    const meta = validateGalaxyMapMeta(raw) as GalaxyMapMeta;
    expect(meta).not.toBeNull();
    expect(meta.id).toBe(id);
    expect(meta.meta.license.length).toBeGreaterThan(0);
    expect(meta.credit).toContain('STScI');
    expect(meta.sourceUrl).toContain('hips2fits');
    // M31 反投影登记（方法 + 残差）；其余未反投影
    if (id === 'm31') {
      expect(meta.deprojection.applied).toBe(true);
      expect(meta.deprojection.method).toContain('cos i');
      expect(meta.deprojection.residualAxisRatio).not.toBeNull();
    } else {
      expect(meta.deprojection.applied).toBe(false);
      expect(meta.deprojection.residualAxisRatio).toBeNull();
    }
  });

  it.each([...IMAGE_DRIVEN_GALAXY_IDS])(
    '%s：四件 PNG 存在（签名合法）且单星系合计 ≤600 KB',
    (id) => {
      let total = statSync(join(dir, `${id}-meta.json`)).size;
      for (const kind of ['density', 'color', 'dust', 'sprite']) {
        const path = join(dir, `${id}-${kind}.png`);
        const bytes = readFileSync(path);
        for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
          expect(bytes[i]).toBe(PNG_SIGNATURE[i]);
        }
        total += bytes.length;
      }
      expect(total).toBeLessThanOrEqual(600 * 1024);
    },
  );
});
