/**
 * R4-22 触须星系二进制烘焙产物加载单测：validateAntennae / loadAntennae
 * 校验、降级与缓存路径 + public/data/antennae.bin 实际产物集成断言
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ANTENNAE_MAGIC,
  ANTENNAE_VERSION,
  loadAntennae,
  resetBakedDataCache,
  validateAntennae,
} from '../bakedData';

/** 构造合法产物缓冲（S=8 快照 × N=20 粒，nA=10；坐标确定性小值） */
function buildValidBuffer(overrides?: {
  magic?: number;
  version?: number;
  snapshotCount?: number;
  particleCount?: number;
  diskACount?: number;
  extraFloats?: number;
  mutate?: (data: Float32Array) => void;
}): ArrayBuffer {
  const S = overrides?.snapshotCount ?? 8;
  const N = overrides?.particleCount ?? 20;
  const nA = overrides?.diskACount ?? 10;
  const floatsPerSnap = 6 + N * 3;
  const data = new Float32Array(5 + S * floatsPerSnap + (overrides?.extraFloats ?? 0));
  data[0] = Math.fround(overrides?.magic ?? ANTENNAE_MAGIC);
  data[1] = overrides?.version ?? ANTENNAE_VERSION;
  data[2] = S;
  data[3] = N;
  data[4] = nA;
  for (let s = 0; s < S; s += 1) {
    const base = 5 + s * floatsPerSnap;
    for (let i = 0; i < floatsPerSnap; i += 1) {
      // 确定性小坐标（|v| < 10），核与粒子同式即可
      data[base + i] = Math.fround(((s + 1) * (i + 1)) % 7 - 3 + s * 0.1);
    }
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

// ---------------------------------------------------------------------------
// validateAntennae
// ---------------------------------------------------------------------------

describe('validateAntennae', () => {
  it('接受合法缓冲并解构核/粒子数据', () => {
    const data = validateAntennae(buildValidBuffer());
    expect(data).not.toBeNull();
    expect(data?.snapshotCount).toBe(8);
    expect(data?.particleCount).toBe(20);
    expect(data?.diskACount).toBe(10);
    expect(data?.cores).toHaveLength(8 * 6);
    expect(data?.positions).toHaveLength(8 * 20 * 3);
    // 快照 0 的核 A x = 数据区第 0 个浮点
    const raw = new Float32Array(buildValidBuffer());
    expect(data?.cores[0]).toBe(raw[5]);
    // 快照 1 粒子 0 x = 头 5 + 1×(6+60) + 6
    expect(data?.positions[20 * 3]).toBe(raw[5 + 66 + 6]);
  });

  it('拒绝非 ArrayBuffer / 过短 / 非 4 字节对齐', () => {
    expect(validateAntennae(null)).toBeNull();
    expect(validateAntennae(new ArrayBuffer(8))).toBeNull();
    expect(validateAntennae(new ArrayBuffer(21))).toBeNull();
  });

  it('拒绝魔数/版本不符', () => {
    expect(validateAntennae(buildValidBuffer({ magic: 1234.5 }))).toBeNull();
    expect(validateAntennae(buildValidBuffer({ version: 2 }))).toBeNull();
  });

  it('拒绝快照数越界（<8 / >12 / 非整数）', () => {
    expect(validateAntennae(buildValidBuffer({ snapshotCount: 7 }))).toBeNull();
    expect(validateAntennae(buildValidBuffer({ snapshotCount: 13 }))).toBeNull();
    expect(
      validateAntennae(buildValidBuffer({ mutate: (d) => (d[2] = 8.5) })),
    ).toBeNull();
  });

  it('拒绝粒子数越界（<16 / >6000 / 非整数）', () => {
    expect(validateAntennae(buildValidBuffer({ particleCount: 15, diskACount: 7 }))).toBeNull();
    expect(
      validateAntennae(buildValidBuffer({ mutate: (d) => (d[3] = 20.5) })),
    ).toBeNull();
    // >6000：仅改头部计数 → 字节长度不匹配同样拒绝
    expect(
      validateAntennae(buildValidBuffer({ mutate: (d) => (d[3] = 6001) })),
    ).toBeNull();
  });

  it('拒绝盘 A 计数越界（<1 / ≥N）', () => {
    expect(validateAntennae(buildValidBuffer({ diskACount: 0 }))).toBeNull();
    expect(validateAntennae(buildValidBuffer({ diskACount: 20 }))).toBeNull();
  });

  it('拒绝字节长度与头部不一致', () => {
    expect(validateAntennae(buildValidBuffer({ extraFloats: 3 }))).toBeNull();
  });

  it('拒绝 NaN/Inf 与坐标越界（|r| > 64）', () => {
    expect(
      validateAntennae(buildValidBuffer({ mutate: (d) => (d[9] = Number.NaN) })),
    ).toBeNull();
    expect(
      validateAntennae(buildValidBuffer({ mutate: (d) => (d[30] = 65) })),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadAntennae（fetch + 缓存 + 降级）
// ---------------------------------------------------------------------------

describe('loadAntennae', () => {
  it('成功加载并按 URL 缓存（不重复 fetch）', async () => {
    const mock = mockFetchBinary(buildValidBuffer());
    const first = await loadAntennae();
    const second = await loadAntennae();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith('/data/antennae.bin');
  });

  it('HTTP 非 2xx 返回 null 且不缓存（允许重试）', async () => {
    const mock = jest.fn().mockResolvedValue({ ok: false });
    global.fetch = mock as unknown as typeof fetch;
    expect(await loadAntennae()).toBeNull();
    expect(await loadAntennae()).toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('网络异常返回 null', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await loadAntennae()).toBeNull();
  });

  it('校验失败返回 null（降级现状渲染路径）', async () => {
    mockFetchBinary(buildValidBuffer({ magic: 0 }));
    expect(await loadAntennae()).toBeNull();
  });

  it('支持自定义 baseUrl', async () => {
    const mock = mockFetchBinary(buildValidBuffer());
    await loadAntennae('/custom');
    expect(mock).toHaveBeenCalledWith('/custom/antennae.bin');
  });
});

// ---------------------------------------------------------------------------
// 实际产物集成断言（public/data/antennae.bin 随仓库提交）
// ---------------------------------------------------------------------------

describe('public/data/antennae.bin 产物完整性', () => {
  it('通过运行时校验且满足 §R4-22 预算约束', () => {
    const file = readFileSync(join(process.cwd(), 'public', 'data', 'antennae.bin'));
    const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const data = validateAntennae(buf);
    expect(data).not.toBeNull();
    // 快照数 8–12（需求 1）
    expect(data!.snapshotCount).toBeGreaterThanOrEqual(8);
    expect(data!.snapshotCount).toBeLessThanOrEqual(12);
    // 每盘 ≤3,000 测试粒子（需求 1）
    expect(data!.diskACount).toBeLessThanOrEqual(3000);
    expect(data!.particleCount - data!.diskACount).toBeLessThanOrEqual(3000);
    // 产物体积计入 ≤5 MB 预算（单文件远低于上限；总量由烘焙脚本断言）
    expect(file.byteLength).toBeLessThan(1024 * 1024);
    // 潮汐尾演化：末帧最大粒子半径显著大于首帧（尾已甩出）
    const n3 = data!.particleCount * 3;
    const maxR = (snap: number): number => {
      let m = 0;
      for (let i = 0; i < data!.particleCount; i += 1) {
        const o = snap * n3 + i * 3;
        const r = Math.hypot(
          data!.positions[o],
          data!.positions[o + 1],
          data!.positions[o + 2],
        );
        m = Math.max(m, r);
      }
      return m;
    };
    expect(maxR(data!.snapshotCount - 1)).toBeGreaterThan(maxR(0) * 2);
  });
});
