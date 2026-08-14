/**
 * R5-3 真实巡天目录二进制加载单测：validateGalaxyCatalog / loadGalaxyCatalog
 * 校验、降级与缓存路径 + public/data/galaxy-catalog.bin 实际产物集成断言
 * （含室女座团方向超密度复核——真实结构在产物中可验证）
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GALAXY_CATALOG_MAGIC,
  GALAXY_CATALOG_VERSION,
  loadGalaxyCatalog,
  resetBakedDataCache,
  validateGalaxyCatalog,
} from '../bakedData';
import {
  CATALOG_W_MAX,
  JK_TIER_UNKNOWN,
  VIRGO_CONE_RADIUS_DEG,
  VIRGO_DEC_DEG,
  VIRGO_OVERDENSITY_MIN_RATIO,
  VIRGO_RA_DEG,
  VIRGO_SHELL_MAX_MPC,
  VIRGO_SHELL_MIN_MPC,
  coneSolidAngleFraction,
  countInCone,
  countInShell,
  equatorialToSupergalacticUnit,
  packCatalogW,
  unpackCatalogW,
  type MorphTier,
} from '../galaxyCatalogCore';

/** 构造合法产物缓冲（bin V2，N=20000 最小域；确定性壳层分布） */
function buildValidBuffer(overrides?: {
  magic?: number;
  version?: number;
  count?: number;
  extraFloats?: number;
  mutate?: (data: Float32Array) => void;
}): ArrayBuffer {
  const n = overrides?.count ?? 20000;
  const data = new Float32Array(3 + n * 4 + (overrides?.extraFloats ?? 0));
  data[0] = overrides?.magic ?? GALAXY_CATALOG_MAGIC;
  data[1] = overrides?.version ?? GALAXY_CATALOG_VERSION;
  data[2] = n;
  for (let i = 0; i < n; i += 1) {
    const r = 5 + (i % 500);
    const a = (i / n) * Math.PI * 2;
    const b = ((i % 97) / 97 - 0.5) * Math.PI * 0.9;
    data[3 + i * 4] = Math.fround(r * Math.cos(b) * Math.cos(a));
    data[3 + i * 4 + 1] = Math.fround(r * Math.cos(b) * Math.sin(a));
    data[3 + i * 4 + 2] = Math.fround(r * Math.sin(b));
    // w V2 = 形态档×100000 + J−K 量化档×1000 + 亮度档
    data[3 + i * 4 + 3] = (i % 3) * 100000 + (i % 100) * 1000 + (i % 1000);
  }
  overrides?.mutate?.(data);
  return data.buffer;
}

function mockFetchBinary(buf: ArrayBuffer): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(buf),
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

afterEach(() => {
  resetBakedDataCache();
  jest.restoreAllMocks();
});

describe('validateGalaxyCatalog', () => {
  it('接受合法缓冲并解构位置/形态档/J−K 档/亮度档（V2）', () => {
    const data = validateGalaxyCatalog(buildValidBuffer());
    expect(data).not.toBeNull();
    expect(data?.count).toBe(20000);
    expect(data?.positionsMpc).toHaveLength(20000 * 3);
    expect(data?.morphTiers).toHaveLength(20000);
    expect(data?.jkTiers).toHaveLength(20000);
    expect(data?.brightness01).toHaveLength(20000);
    // 第 1 条：w = 1×100000 + 1×1000 + 1 → tier 1、jk 1、b = 1/999
    expect(data?.morphTiers[1]).toBe(1);
    expect(data?.jkTiers[1]).toBe(1);
    expect(data?.brightness01[1]).toBeCloseTo(1 / 999, 10);
  });

  it('w 解码与烘焙侧 packCatalogW 编码同源（编解码往返，防两侧漂移）', () => {
    // 首 3 条 w 覆盖三档形态 × 不同 jk/亮度（含未知档 99）
    const samples: Array<[MorphTier, number, number]> = [
      [0, 0, 0],
      [1, JK_TIER_UNKNOWN, 0.5],
      [2, 98, 1],
    ];
    const buf = buildValidBuffer({
      mutate: (d) => {
        samples.forEach(([tier, jk, b], i) => {
          d[3 + i * 4 + 3] = packCatalogW(tier, jk, b);
        });
      },
    });
    const data = validateGalaxyCatalog(buf)!;
    samples.forEach(([tier, jk, b], i) => {
      const back = unpackCatalogW(packCatalogW(tier, jk, b));
      expect(data.morphTiers[i]).toBe(back.tier);
      expect(data.jkTiers[i]).toBe(back.jkTier);
      // Float32Array 存储精度（brightness01 为 float32）
      expect(data.brightness01[i]).toBeCloseTo(back.brightness01, 6);
      expect(data.brightness01[i]).toBeCloseTo(b, 2);
    });
  });

  it('拒绝非 ArrayBuffer / 过短 / 非 4 字节对齐', () => {
    expect(validateGalaxyCatalog(null)).toBeNull();
    expect(validateGalaxyCatalog(new ArrayBuffer(8))).toBeNull();
    expect(validateGalaxyCatalog(new ArrayBuffer(13))).toBeNull();
  });

  it('拒绝魔数/版本不符（只认 V2，V1 直接拒绝降级——SC3 决策）', () => {
    expect(validateGalaxyCatalog(buildValidBuffer({ magic: 1234 }))).toBeNull();
    expect(validateGalaxyCatalog(buildValidBuffer({ version: 1 }))).toBeNull();
    expect(validateGalaxyCatalog(buildValidBuffer({ version: 3 }))).toBeNull();
    expect(GALAXY_CATALOG_VERSION).toBe(2);
  });

  it('拒绝星系数越界（<20,000 / >60,000 / 非整数）', () => {
    expect(validateGalaxyCatalog(buildValidBuffer({ count: 19999 }))).toBeNull();
    expect(
      validateGalaxyCatalog(buildValidBuffer({ mutate: (d) => (d[2] = 20000.5) })),
    ).toBeNull();
    expect(
      validateGalaxyCatalog(buildValidBuffer({ mutate: (d) => (d[2] = 60001) })),
    ).toBeNull();
  });

  it('拒绝字节长度与头部不一致', () => {
    expect(validateGalaxyCatalog(buildValidBuffer({ extraFloats: 4 }))).toBeNull();
  });

  it('拒绝 NaN / 距离越界（0 或 > 800 Mpc）', () => {
    expect(
      validateGalaxyCatalog(buildValidBuffer({ mutate: (d) => (d[3] = Number.NaN) })),
    ).toBeNull();
    expect(
      validateGalaxyCatalog(
        buildValidBuffer({
          mutate: (d) => {
            d[3] = 900;
            d[4] = 0;
            d[5] = 0;
          },
        }),
      ),
    ).toBeNull();
    expect(
      validateGalaxyCatalog(
        buildValidBuffer({
          mutate: (d) => {
            d[3] = 0;
            d[4] = 0;
            d[5] = 0;
          },
        }),
      ),
    ).toBeNull();
  });

  it('拒绝 w 通道非法（非整数 / 越界——上界 299,999 即形态档 ≤ 2）', () => {
    expect(
      validateGalaxyCatalog(buildValidBuffer({ mutate: (d) => (d[6] = 12.5) })),
    ).toBeNull();
    expect(
      validateGalaxyCatalog(buildValidBuffer({ mutate: (d) => (d[6] = CATALOG_W_MAX + 1) })),
    ).toBeNull();
    expect(validateGalaxyCatalog(buildValidBuffer({ mutate: (d) => (d[6] = -1) }))).toBeNull();
    // 上界本身合法（tier 2 / jk 99 / b 999）
    expect(
      validateGalaxyCatalog(buildValidBuffer({ mutate: (d) => (d[6] = CATALOG_W_MAX) })),
    ).not.toBeNull();
  });
});

describe('loadGalaxyCatalog（fetch + 缓存 + 降级）', () => {
  it('成功加载并按 URL 缓存（不重复 fetch）', async () => {
    const mock = mockFetchBinary(buildValidBuffer());
    const first = await loadGalaxyCatalog();
    const second = await loadGalaxyCatalog();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith('/data/galaxy-catalog.bin');
  });

  it('HTTP 非 2xx / 网络异常 / 校验失败均返回 null 且不缓存（降级现状宇宙网）', async () => {
    const mock = jest.fn().mockResolvedValue({ ok: false });
    global.fetch = mock as unknown as typeof fetch;
    expect(await loadGalaxyCatalog()).toBeNull();
    expect(await loadGalaxyCatalog()).toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);

    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await loadGalaxyCatalog()).toBeNull();

    mockFetchBinary(buildValidBuffer({ magic: 0 }));
    expect(await loadGalaxyCatalog()).toBeNull();
  });

  it('支持自定义 baseUrl', async () => {
    const mock = mockFetchBinary(buildValidBuffer());
    await loadGalaxyCatalog('/custom');
    expect(mock).toHaveBeenCalledWith('/custom/galaxy-catalog.bin');
  });
});

describe('public/data/galaxy-catalog.bin 产物完整性', () => {
  const file = readFileSync(join(process.cwd(), 'public', 'data', 'galaxy-catalog.bin'));
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

  it('通过运行时校验且满足 §R5-3 预算约束（≤1 MB）', () => {
    const data = validateGalaxyCatalog(buf);
    expect(data).not.toBeNull();
    expect(data!.count).toBeGreaterThanOrEqual(20000);
    expect(file.byteLength).toBeLessThanOrEqual(1024 * 1024);
  });

  it('室女座团方向超密度复核（5–30 Mpc 壳、6° 锥比 ≥ 3——真实结构可验证）', () => {
    const data = validateGalaxyCatalog(buf)!;
    const virgoDir = equatorialToSupergalacticUnit(VIRGO_RA_DEG, VIRGO_DEC_DEG);
    const inCone = countInCone(
      data.positionsMpc,
      virgoDir,
      VIRGO_CONE_RADIUS_DEG,
      VIRGO_SHELL_MIN_MPC,
      VIRGO_SHELL_MAX_MPC,
    );
    const inShell = countInShell(data.positionsMpc, VIRGO_SHELL_MIN_MPC, VIRGO_SHELL_MAX_MPC);
    const ratio = inCone / inShell / coneSolidAngleFraction(VIRGO_CONE_RADIUS_DEG);
    expect(inCone).toBeGreaterThanOrEqual(100);
    expect(ratio).toBeGreaterThanOrEqual(VIRGO_OVERDENSITY_MIN_RATIO);
  });

  it('实体星系去重生效：M87 方向 0.3° 内 10–25 Mpc 条目为零（无重影）', () => {
    const data = validateGalaxyCatalog(buf)!;
    const virgoDir = equatorialToSupergalacticUnit(VIRGO_RA_DEG, VIRGO_DEC_DEG);
    expect(countInCone(data.positionsMpc, virgoDir, 0.3, 10, 25)).toBe(0);
  });

  it('产物 J−K 量化档两端均有分布且未知档占比 < 5%（SC3 V2）', () => {
    const data = validateGalaxyCatalog(buf)!;
    let unknown = 0;
    let blueEnd = 0;
    let redEnd = 0;
    for (let i = 0; i < data.count; i += 1) {
      const jk = data.jkTiers[i];
      if (jk === JK_TIER_UNKNOWN) unknown += 1;
      else if (jk < 20) blueEnd += 1;
      else if (jk > 78) redEnd += 1;
    }
    expect(unknown / data.count).toBeLessThan(0.05);
    expect(blueEnd).toBeGreaterThan(100);
    expect(redEnd).toBeGreaterThan(100);
  });

  it('产物两级 LOD 拆分非空（近域 ≤80 Mpc 与远景均有条目）', () => {
    const data = validateGalaxyCatalog(buf)!;
    const near = countInShell(data.positionsMpc, 0, 80);
    expect(near).toBeGreaterThan(1000);
    expect(data.count - near).toBeGreaterThan(1000);
  });
});
