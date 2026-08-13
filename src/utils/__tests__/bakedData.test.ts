/**
 * R4-5 bakedData 加载器单测：fixture 驱动的加载/校验/降级路径
 * 另含对 public/data/ 实际烘焙产物的完整性集成断言（产物随仓库提交）
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadPleiades,
  loadStarParams,
  loadM13Profile,
  loadYaleBrightStars,
  resetBakedDataCache,
  validatePleiades,
  validateStarParams,
  validateM13Profile,
  validateYaleBrightStars,
  STAR_PARAM_KEYS,
} from '../bakedData';
import pleiadesFixture from './fixtures/pleiades.fixture.json';
import starParamsFixture from './fixtures/star-params.fixture.json';
import m13Fixture from './fixtures/m13-profile.fixture.json';

/** 深拷贝 fixture，避免用例间污染 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mockFetchOk(payload: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

afterEach(() => {
  resetBakedDataCache();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// validatePleiades
// ---------------------------------------------------------------------------

describe('validatePleiades', () => {
  it('接受合法 fixture', () => {
    const data = validatePleiades(clone(pleiadesFixture));
    expect(data).not.toBeNull();
    expect(data?.stars).toHaveLength(3);
    expect(data?.meta.count).toBe(3);
    expect(data?.meta.source).toContain('Gaia DR3');
  });

  it('拒绝非对象/缺 stars/缺 meta', () => {
    expect(validatePleiades(null)).toBeNull();
    expect(validatePleiades('x')).toBeNull();
    expect(validatePleiades({ meta: clone(pleiadesFixture).meta })).toBeNull();
    expect(validatePleiades({ stars: [] })).toBeNull();
  });

  it('拒绝 meta 字段缺失或 count 非法', () => {
    const bad = clone(pleiadesFixture) as { meta: Record<string, unknown> };
    delete bad.meta.license;
    expect(validatePleiades(bad)).toBeNull();
    const badCount = clone(pleiadesFixture) as { meta: { count: unknown } };
    badCount.meta.count = Number.NaN;
    expect(validatePleiades(badCount)).toBeNull();
  });

  it('拒绝星数与 meta.count 不符、空表、超 600', () => {
    const mismatch = clone(pleiadesFixture) as { meta: { count: number } };
    mismatch.meta.count = 5;
    expect(validatePleiades(mismatch)).toBeNull();
    const empty = clone(pleiadesFixture) as { meta: { count: number }; stars: unknown[] };
    empty.stars = [];
    empty.meta.count = 0;
    expect(validatePleiades(empty)).toBeNull();
    const star = clone(pleiadesFixture).stars[0];
    const oversized = {
      meta: { ...clone(pleiadesFixture).meta, count: 601 },
      stars: Array.from({ length: 601 }, (_, i) => ({ ...star, id: String(i) })),
    };
    expect(validatePleiades(oversized)).toBeNull();
  });

  it('拒绝坐标 NaN / 模长超 30 pc / B−V、V 越界 / id 缺失', () => {
    const withStar = (patch: Record<string, unknown>): unknown => {
      const data = clone(pleiadesFixture) as { stars: Record<string, unknown>[] };
      data.stars[1] = { ...data.stars[1], ...patch };
      return data;
    };
    expect(validatePleiades(withStar({ x: Number.NaN }))).toBeNull();
    expect(validatePleiades(withStar({ y: '1' }))).toBeNull();
    expect(validatePleiades(withStar({ z: 40 }))).toBeNull();
    expect(validatePleiades(withStar({ bv: 3.9 }))).toBeNull();
    expect(validatePleiades(withStar({ bv: -1 }))).toBeNull();
    expect(validatePleiades(withStar({ v: 25 }))).toBeNull();
    expect(validatePleiades(withStar({ v: -3 }))).toBeNull();
    expect(validatePleiades(withStar({ id: '' }))).toBeNull();
    const notObj = clone(pleiadesFixture) as { stars: unknown[] };
    notObj.stars[0] = 7;
    expect(validatePleiades(notObj)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateStarParams
// ---------------------------------------------------------------------------

describe('validateStarParams', () => {
  it('接受合法 fixture 且 6 颗恒星齐全', () => {
    const data = validateStarParams(clone(starParamsFixture));
    expect(data).not.toBeNull();
    for (const key of STAR_PARAM_KEYS) {
      expect(data?.stars[key].teffK).toBeGreaterThan(1000);
      expect(data?.stars[key].ref.length).toBeGreaterThan(0);
    }
    expect(data?.stars.betelgeuse.spectralType).toContain('M1-M2');
    expect(data?.stars.wr124.spectralType).toBe('WN8h');
  });

  it('拒绝非对象/缺 stars/meta.count 不为 6', () => {
    expect(validateStarParams(null)).toBeNull();
    expect(validateStarParams({ meta: clone(starParamsFixture).meta })).toBeNull();
    const badCount = clone(starParamsFixture) as { meta: { count: number } };
    badCount.meta.count = 5;
    expect(validateStarParams(badCount)).toBeNull();
  });

  it('拒绝缺星/字段缺失/数值域越界', () => {
    const withoutStar = clone(starParamsFixture) as { stars: Record<string, unknown> };
    delete withoutStar.stars.siriusB;
    expect(validateStarParams(withoutStar)).toBeNull();

    const withPatch = (key: string, patch: Record<string, unknown>): unknown => {
      const data = clone(starParamsFixture) as { stars: Record<string, Record<string, unknown>> };
      data.stars[key] = { ...data.stars[key], ...patch };
      return data;
    };
    expect(validateStarParams(withPatch('rigel', { spectralType: '' }))).toBeNull();
    expect(validateStarParams(withPatch('rigel', { ref: '' }))).toBeNull();
    expect(validateStarParams(withPatch('siriusA', { teffK: 500 }))).toBeNull();
    expect(validateStarParams(withPatch('siriusA', { teffK: 300000 }))).toBeNull();
    expect(validateStarParams(withPatch('deltaCephei', { radiusRsun: 0 }))).toBeNull();
    expect(validateStarParams(withPatch('wr124', { luminosityLsun: -1 }))).toBeNull();
    expect(validateStarParams(withPatch('betelgeuse', { teffK: 'hot' }))).toBeNull();
    expect(validateStarParams(withPatch('betelgeuse', { nameZh: '' }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateM13Profile
// ---------------------------------------------------------------------------

describe('validateM13Profile', () => {
  it('接受合法 fixture（Harris 目录值）', () => {
    const data = validateM13Profile(clone(m13Fixture));
    expect(data).not.toBeNull();
    expect(data?.profile.concentration).toBe(1.53);
    expect(data?.profile.coreRadiusArcmin).toBe(0.62);
    expect(data?.profile.tidalRadiusArcmin).toBeGreaterThan(data?.profile.coreRadiusArcmin ?? 0);
  });

  it('拒绝非对象/缺 profile/meta.count 不为 1', () => {
    expect(validateM13Profile(null)).toBeNull();
    expect(validateM13Profile({ meta: clone(m13Fixture).meta })).toBeNull();
    const badCount = clone(m13Fixture) as { meta: { count: number } };
    badCount.meta.count = 2;
    expect(validateM13Profile(badCount)).toBeNull();
  });

  it('拒绝数值缺失/物理关系不自洽', () => {
    const withPatch = (patch: Record<string, unknown>): unknown => {
      const data = clone(m13Fixture) as { profile: Record<string, unknown> };
      data.profile = { ...data.profile, ...patch };
      return data;
    };
    expect(validateM13Profile(withPatch({ id: '' }))).toBeNull();
    expect(validateM13Profile(withPatch({ concentration: Number.NaN }))).toBeNull();
    expect(validateM13Profile(withPatch({ coreRadiusArcmin: 0 }))).toBeNull();
    expect(validateM13Profile(withPatch({ tidalRadiusArcmin: 0.5 }))).toBeNull();
    expect(validateM13Profile(withPatch({ concentration: 4 }))).toBeNull();
    expect(validateM13Profile(withPatch({ concentration: 0.3 }))).toBeNull();
    expect(validateM13Profile(withPatch({ distanceKpc: -1 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateYaleBrightStars（M2，契约 C3）
// ---------------------------------------------------------------------------

/** 合成合法亮星数组（条数域下限 8300，字段全在数值域内） */
function makeYaleStars(count = 8300): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    ra: (i * 0.042) % 360,
    dec: -89 + (i % 179),
    mag: -1.4 + (i % 79) * 0.1,
    bv: -0.3 + (i % 40) * 0.1,
  }));
}

describe('validateYaleBrightStars', () => {
  it('接受合法裸数组并逐条通过', () => {
    const data = validateYaleBrightStars(makeYaleStars());
    expect(data).not.toBeNull();
    expect(data).toHaveLength(8300);
    expect(data?.[0]).toEqual({ ra: 0, dec: -89, mag: -1.4, bv: -0.3 });
  });

  it('拒绝非数组与条数越域（<8300 或 >9200）', () => {
    expect(validateYaleBrightStars(null)).toBeNull();
    expect(validateYaleBrightStars({ stars: makeYaleStars() })).toBeNull();
    expect(validateYaleBrightStars(makeYaleStars(8299))).toBeNull();
    expect(validateYaleBrightStars(makeYaleStars(9201))).toBeNull();
  });

  it('拒绝字段越域/NaN/非对象条目（契约 C3 域断言）', () => {
    const withPatch = (patch: Record<string, unknown>): unknown => {
      const stars = makeYaleStars();
      stars[42] = { ...stars[42], ...patch };
      return stars;
    };
    expect(validateYaleBrightStars(withPatch({ ra: -0.1 }))).toBeNull();
    expect(validateYaleBrightStars(withPatch({ ra: 360 }))).toBeNull();
    expect(validateYaleBrightStars(withPatch({ dec: 90.5 }))).toBeNull();
    expect(validateYaleBrightStars(withPatch({ dec: -91 }))).toBeNull();
    expect(validateYaleBrightStars(withPatch({ mag: 6.51 }))).toBeNull();
    expect(validateYaleBrightStars(withPatch({ mag: -3 }))).toBeNull();
    expect(validateYaleBrightStars(withPatch({ bv: 6.1 }))).toBeNull();
    expect(validateYaleBrightStars(withPatch({ bv: -2 }))).toBeNull();
    expect(validateYaleBrightStars(withPatch({ mag: Number.NaN }))).toBeNull();
    expect(validateYaleBrightStars(withPatch({ bv: '0.5' }))).toBeNull();
    const stars = makeYaleStars() as unknown[];
    stars[0] = 7;
    expect(validateYaleBrightStars(stars)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 加载器：fetch + 缓存 + 降级
// ---------------------------------------------------------------------------

describe('loadPleiades / loadStarParams / loadM13Profile', () => {
  it('成功加载并缓存（重复调用不重复 fetch）', async () => {
    const mock = mockFetchOk(clone(pleiadesFixture));
    const first = await loadPleiades();
    const second = await loadPleiades();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith('/data/pleiades.json');
  });

  it('支持自定义 baseUrl 且各 URL 独立缓存', async () => {
    const mock = mockFetchOk(clone(m13Fixture));
    await loadM13Profile('/custom');
    await loadM13Profile();
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock).toHaveBeenNthCalledWith(1, '/custom/m13-profile.json');
    expect(mock).toHaveBeenNthCalledWith(2, '/data/m13-profile.json');
  });

  it('网络异常返回 null 且不缓存失败（可重试成功）', async () => {
    const mock = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(clone(starParamsFixture)) });
    global.fetch = mock as unknown as typeof fetch;
    expect(await loadStarParams()).toBeNull();
    expect(await loadStarParams()).not.toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('HTTP 非 2xx 返回 null', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
    expect(await loadPleiades()).toBeNull();
  });

  it('JSON 解析失败返回 null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('bad json')),
    }) as unknown as typeof fetch;
    expect(await loadM13Profile()).toBeNull();
  });

  it('载荷未过校验返回 null', async () => {
    mockFetchOk({ meta: clone(pleiadesFixture).meta, stars: [{ id: 'a', x: Number.NaN }] });
    expect(await loadPleiades()).toBeNull();
  });

  it('loadYaleBrightStars 成功加载并缓存（M2）', async () => {
    const mock = mockFetchOk(makeYaleStars());
    const first = await loadYaleBrightStars();
    const second = await loadYaleBrightStars();
    expect(first).toHaveLength(8300);
    expect(second).toBe(first);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith('/data/yale_bright_stars.json');
  });

  it('resetBakedDataCache 后重新 fetch', async () => {
    const mock = mockFetchOk(clone(starParamsFixture));
    await loadStarParams();
    resetBakedDataCache();
    await loadStarParams();
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 实际烘焙产物集成断言（public/data/ 随仓库提交，运行时零外部网络请求）
// ---------------------------------------------------------------------------

describe('public/data/ 烘焙产物完整性', () => {
  const readProduct = (name: string): unknown =>
    JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', name), 'utf8')) as unknown;

  it('pleiades.json 通过校验：600 颗成员星、坐标模长与光度域合法', () => {
    const data = validatePleiades(readProduct('pleiades.json'));
    expect(data).not.toBeNull();
    expect(data?.stars.length).toBeLessThanOrEqual(600);
    expect(data?.stars.length).toBe(data?.meta.count);
    // 簇质心系：全体成员星坐标均值应接近原点
    const n = data?.stars.length ?? 1;
    const mean = (data?.stars ?? []).reduce(
      (acc, s) => ({ x: acc.x + s.x / n, y: acc.y + s.y / n, z: acc.z + s.z / n }),
      { x: 0, y: 0, z: 0 }
    );
    expect(Math.abs(mean.x)).toBeLessThan(0.01);
    expect(Math.abs(mean.y)).toBeLessThan(0.01);
    expect(Math.abs(mean.z)).toBeLessThan(0.01);
  });

  it('yale_bright_stars.json 通过校验：mag ≤ 6.5 完备样本 8404 条（§M1-1 差异登记口径）', () => {
    const data = validateYaleBrightStars(readProduct('yale_bright_stars.json'));
    expect(data).not.toBeNull();
    expect(data).toHaveLength(8404);
  });

  it('star-params.json 通过校验且含 6 颗 R4 恒星', () => {
    const data = validateStarParams(readProduct('star-params.json'));
    expect(data).not.toBeNull();
    expect(Object.keys(data?.stars ?? {})).toHaveLength(6);
  });

  it('m13-profile.json 通过校验且潮汐半径符合 r_t = r_c·10^c', () => {
    const data = validateM13Profile(readProduct('m13-profile.json'));
    expect(data).not.toBeNull();
    const p = data?.profile;
    expect(p?.tidalRadiusArcmin).toBeCloseTo((p?.coreRadiusArcmin ?? 0) * 10 ** (p?.concentration ?? 0), 1);
  });
});
