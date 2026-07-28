/**
 * R4-2 统一细节层管理单元测试（IMPROVEMENT_REQUIREMENTS_4 §R4-2）
 *
 * 覆盖：泛化门控（滞回语义与 R2-7 逐项一致）、LRU 分池（particles/volume
 * 各容量 1）、GPU 显存估算（粒子 float32 布局 / 体积纹理分辨率×通道）、
 * 64 MB 总预算逐出决策、持有者注册表，以及与 nearView/galaxyNearView
 * 兼容包装的行为零回退断言（阈值同源/时长同源/LRU 语义同源）。
 */

import {
  DETAIL_GPU_BUDGET_BYTES,
  DETAIL_LAYER_TRANSITION_SECONDS,
  DETAIL_LRU_CAPACITY_BY_KIND,
  GPU_BYTES_PER_PARTICLE,
  VOLUME_TEXTURE_MAX_SIZE,
  claimDetailLayer,
  detailClaimUpdate,
  detailGateUpdate,
  detailGpuBytesTotal,
  detailLayerGpuBytesInUse,
  detailLayerHolderIds,
  detailLruUpdate,
  estimateGpuBytes,
  releaseDetailLayer,
  resetDetailLayerRegistry,
  volumeTextureGpuBytes,
  type DetailLayerHolder,
  type DetailLayerSpec,
} from '@/utils/detailLayer';
import {
  NEAR_VIEW_ENTER_RATIO,
  NEAR_VIEW_EXIT_RATIO,
  NEAR_VIEW_TRANSITION_SECONDS,
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
  nearViewGateUpdate,
} from '@/utils/nearView';
import {
  GALAXY_NEAR_VIEW_CONFIGS,
  GALAXY_NEAR_VIEW_LRU_CAPACITY,
  galaxyDetailLayerSpec,
  galaxyNearViewEnterDistanceUnits,
  nearViewLruUpdate,
} from '@/utils/galaxyNearView';

/** 便捷构造：测试用细节层规格 */
function specOf(
  bodyId: string,
  kind: DetailLayerSpec['kind'],
  gpuBytesEstimate: number,
): DetailLayerSpec {
  return {
    bodyId,
    kind,
    enterDistanceUnits: 100,
    exitDistanceUnits: 140,
    budget: { gpuBytesEstimate },
  };
}

describe('常量与同源断言（行为零回退）', () => {
  it('过渡时长 0.5s 且与 R2-7 NEAR_VIEW_TRANSITION_SECONDS 同源', () => {
    expect(DETAIL_LAYER_TRANSITION_SECONDS).toBe(0.5);
    expect(NEAR_VIEW_TRANSITION_SECONDS).toBe(DETAIL_LAYER_TRANSITION_SECONDS);
  });

  it('GPU 总预算 = 64 MB（附录 A 硬性约束）', () => {
    expect(DETAIL_GPU_BUDGET_BYTES).toBe(64 * 1024 * 1024);
  });

  it('LRU 分池容量：particles 沿用 R2-8 容量 1，volume/lensing/starCatalog 各 1', () => {
    expect(DETAIL_LRU_CAPACITY_BY_KIND.particles).toBe(GALAXY_NEAR_VIEW_LRU_CAPACITY);
    expect(DETAIL_LRU_CAPACITY_BY_KIND).toEqual({
      particles: 1,
      volume: 1,
      lensing: 1,
      starCatalog: 1,
    });
  });

  it('单粒子估算 = float32 属性布局 position(3)+color(3)+size(1) = 28 B', () => {
    expect(GPU_BYTES_PER_PARTICLE).toBe(7 * 4);
  });
});

describe('detailGateUpdate（泛化滞回门控，语义与 R2-7 逐项一致）', () => {
  it('未激活 → 激活：跟随且距离小于进入阈值', () => {
    expect(detailGateUpdate(false, true, 99, 100, 140)).toEqual({
      active: true,
      releaseNow: false,
    });
  });

  it('未跟随不激活（即使距离达标）', () => {
    expect(detailGateUpdate(false, false, 10, 100, 140)).toEqual({
      active: false,
      releaseNow: false,
    });
  });

  it('滞回带内保持激活（进入阈值 < 距离 < 退出阈值）', () => {
    expect(detailGateUpdate(true, true, 120, 100, 140)).toEqual({
      active: true,
      releaseNow: false,
    });
  });

  it('超出退出阈值：释放（releaseNow）', () => {
    expect(detailGateUpdate(true, true, 141, 100, 140)).toEqual({
      active: false,
      releaseNow: true,
    });
  });

  it('焦点离开：立即释放', () => {
    expect(detailGateUpdate(true, false, 50, 100, 140)).toEqual({
      active: false,
      releaseNow: true,
    });
  });

  it('入参校验：距离/进入阈值/退出阈值非法抛 RangeError', () => {
    expect(() => detailGateUpdate(false, true, -1, 100, 140)).toThrow(RangeError);
    expect(() => detailGateUpdate(false, true, Number.NaN, 100, 140)).toThrow(RangeError);
    expect(() => detailGateUpdate(false, true, 10, 0, 140)).toThrow(RangeError);
    expect(() => detailGateUpdate(false, true, 10, 100, 99)).toThrow(RangeError);
  });

  it('与 R2-7 nearViewGateUpdate 委托一致（退出 = 进入 × 1.4，逐状态对拍）', () => {
    const enter = nearViewEnterDistanceUnits('m13-cluster');
    const exit = nearViewExitDistanceUnits('m13-cluster');
    expect(exit).toBeCloseTo(enter * NEAR_VIEW_EXIT_RATIO, 10);
    for (const prev of [false, true]) {
      for (const focused of [false, true]) {
        for (const d of [0, enter * 0.99, enter * 1.2, exit * 1.01]) {
          expect(nearViewGateUpdate(prev, focused, d, enter)).toEqual(
            detailGateUpdate(prev, focused, d, enter, exit),
          );
        }
      }
    }
  });
});

describe('detailLruUpdate（泛化 LRU，语义与 R2-8 逐项一致）', () => {
  it('activeId 为 null 保持现状（淡出保留）', () => {
    expect(detailLruUpdate(['m31'], null, 1)).toEqual({
      holders: ['m31'],
      releasedIds: [],
    });
  });

  it('容量 1：新持有者挤出旧持有者', () => {
    expect(detailLruUpdate(['m31'], 'm33', 1)).toEqual({
      holders: ['m33'],
      releasedIds: ['m31'],
    });
  });

  it('重复声明同一持有者不产生释放', () => {
    expect(detailLruUpdate(['m31'], 'm31', 1)).toEqual({
      holders: ['m31'],
      releasedIds: [],
    });
  });

  it('容量 2：提升到最新位置，超容量释放最旧', () => {
    const s1 = detailLruUpdate([], 'a', 2);
    const s2 = detailLruUpdate(s1.holders, 'b', 2);
    expect(s2.holders).toEqual(['b', 'a']);
    const s3 = detailLruUpdate(s2.holders, 'c', 2);
    expect(s3).toEqual({ holders: ['c', 'b'], releasedIds: ['a'] });
  });

  it('容量非法抛 RangeError', () => {
    expect(() => detailLruUpdate([], 'a', 0)).toThrow(RangeError);
    expect(() => detailLruUpdate([], 'a', 1.5)).toThrow(RangeError);
  });

  it('galaxyNearView.nearViewLruUpdate 委托一致（对拍）', () => {
    expect(nearViewLruUpdate(['m31'], 'm33')).toEqual(detailLruUpdate(['m31'], 'm33', 1));
    expect(nearViewLruUpdate(['m31'], null)).toEqual(detailLruUpdate(['m31'], null, 1));
  });
});

describe('estimateGpuBytes / volumeTextureGpuBytes（显存估算纯函数）', () => {
  it('粒子按 float32 属性布局：n × 28 B', () => {
    expect(estimateGpuBytes({ particles: 8000 })).toBe(8000 * GPU_BYTES_PER_PARTICLE);
    expect(estimateGpuBytes({})).toBe(0);
  });

  it('体积纹理字节数直接累加', () => {
    expect(estimateGpuBytes({ particles: 100, volumeTexBytes: 1024 })).toBe(
      100 * GPU_BYTES_PER_PARTICLE + 1024,
    );
  });

  it('体积纹理估算 = 分辨率³ × 通道 × 每通道字节（R8 单通道默认 1 B）', () => {
    expect(volumeTextureGpuBytes(128, 1)).toBe(128 ** 3);
    expect(volumeTextureGpuBytes(64, 2, 2)).toBe(64 ** 3 * 4);
  });

  it('体积纹理约束：分辨率 ≤128（附录 A）、通道 1–4、字节 1–4', () => {
    expect(VOLUME_TEXTURE_MAX_SIZE).toBe(128);
    expect(() => volumeTextureGpuBytes(129, 1)).toThrow(RangeError);
    expect(() => volumeTextureGpuBytes(0, 1)).toThrow(RangeError);
    expect(() => volumeTextureGpuBytes(64, 0)).toThrow(RangeError);
    expect(() => volumeTextureGpuBytes(64, 5)).toThrow(RangeError);
    expect(() => volumeTextureGpuBytes(64, 1, 0)).toThrow(RangeError);
    expect(() => volumeTextureGpuBytes(64, 1, 8)).toThrow(RangeError);
  });

  it('入参校验：粒子数/体积字节数非法抛 RangeError', () => {
    expect(() => estimateGpuBytes({ particles: -1 })).toThrow(RangeError);
    expect(() => estimateGpuBytes({ particles: 1.5 })).toThrow(RangeError);
    expect(() => estimateGpuBytes({ volumeTexBytes: -8 })).toThrow(RangeError);
    expect(() => estimateGpuBytes({ volumeTexBytes: 0.5 })).toThrow(RangeError);
  });
});

describe('detailClaimUpdate（分池 LRU + 64 MB 预算逐出决策）', () => {
  const MB = 1024 * 1024;

  it('同池容量 1：新声明挤出旧持有者', () => {
    const a: DetailLayerHolder = { bodyId: 'a', kind: 'particles', gpuBytesEstimate: MB };
    const b: DetailLayerHolder = { bodyId: 'b', kind: 'particles', gpuBytesEstimate: MB };
    const r = detailClaimUpdate([a], b);
    expect(r.holders).toEqual([b]);
    expect(r.released).toEqual([a]);
  });

  it('重复声明同一持有者：幂等无释放', () => {
    const a: DetailLayerHolder = { bodyId: 'a', kind: 'particles', gpuBytesEstimate: MB };
    const r = detailClaimUpdate([a], { ...a });
    expect(r.holders).toEqual([{ ...a }]);
    expect(r.released).toEqual([]);
  });

  it('不同池互不挤出（particles 与 volume 各容量 1 可并存）', () => {
    const p: DetailLayerHolder = { bodyId: 'orion', kind: 'particles', gpuBytesEstimate: MB };
    const v: DetailLayerHolder = { bodyId: 'orion', kind: 'volume', gpuBytesEstimate: 2 * MB };
    const r = detailClaimUpdate([p], v);
    expect(r.released).toEqual([]);
    expect(r.holders).toEqual([v, p]);
    expect(detailGpuBytesTotal(r.holders)).toBe(3 * MB);
  });

  it('总预算超限：跨池按最旧优先逐出，新声明层豁免', () => {
    const p: DetailLayerHolder = { bodyId: 'a', kind: 'particles', gpuBytesEstimate: 30 * MB };
    const v: DetailLayerHolder = { bodyId: 'b', kind: 'volume', gpuBytesEstimate: 30 * MB };
    // 先 p 后 v（v 最新在前）：再声明 20 MB 透镜层 → 80 MB 超限，
    // 逐出最旧的 p（→50 MB 达标），v 保留
    const l: DetailLayerHolder = { bodyId: 'c', kind: 'lensing', gpuBytesEstimate: 20 * MB };
    const r = detailClaimUpdate([v, p], l);
    expect(r.released).toEqual([p]);
    expect(r.holders).toEqual([l, v]);
    expect(detailGpuBytesTotal(r.holders)).toBeLessThanOrEqual(DETAIL_GPU_BUDGET_BYTES);
  });

  it('预算逐出可连续多层直至达标', () => {
    const olds: DetailLayerHolder[] = [
      { bodyId: 'v1', kind: 'volume', gpuBytesEstimate: 25 * MB },
      { bodyId: 'p1', kind: 'particles', gpuBytesEstimate: 25 * MB },
    ];
    const big: DetailLayerHolder = { bodyId: 'l1', kind: 'lensing', gpuBytesEstimate: 60 * MB };
    const r = detailClaimUpdate(olds, big);
    expect(r.released).toEqual([olds[1], olds[0]]);
    expect(r.holders).toEqual([big]);
  });

  it('单层估算超总预算：注册期防错抛 RangeError', () => {
    expect(() =>
      detailClaimUpdate([], { bodyId: 'x', kind: 'volume', gpuBytesEstimate: 65 * MB }),
    ).toThrow(RangeError);
  });

  it('入参校验：预算/估算非法抛 RangeError', () => {
    const a: DetailLayerHolder = { bodyId: 'a', kind: 'particles', gpuBytesEstimate: MB };
    expect(() => detailClaimUpdate([], a, 0)).toThrow(RangeError);
    expect(() => detailClaimUpdate([], a, Number.NaN)).toThrow(RangeError);
    expect(() =>
      detailClaimUpdate([], { bodyId: 'a', kind: 'particles', gpuBytesEstimate: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      detailClaimUpdate([], { bodyId: 'a', kind: 'particles', gpuBytesEstimate: 1.5 }),
    ).toThrow(RangeError);
  });
});

describe('持有者注册表（渲染端单例，claim/release/reset）', () => {
  beforeEach(() => resetDetailLayerRegistry());
  afterAll(() => resetDetailLayerRegistry());

  it('claim 声明持有权并返回被逐出者；holderIds 按池查询', () => {
    expect(detailLayerHolderIds('particles')).toEqual([]);
    expect(claimDetailLayer(specOf('m31', 'particles', 1024))).toEqual([]);
    expect(detailLayerHolderIds('particles')).toEqual(['m31']);
    const released = claimDetailLayer(specOf('smc', 'particles', 2048));
    expect(released.map((h) => h.bodyId)).toEqual(['m31']);
    expect(detailLayerHolderIds('particles')).toEqual(['smc']);
    expect(detailLayerGpuBytesInUse()).toBe(2048);
  });

  it('不同池并存；release 幂等释放；GPU 在用量同步出账', () => {
    claimDetailLayer(specOf('orion', 'particles', 1000));
    claimDetailLayer(specOf('orion', 'volume', 3000));
    expect(detailLayerHolderIds('particles')).toEqual(['orion']);
    expect(detailLayerHolderIds('volume')).toEqual(['orion']);
    expect(detailLayerGpuBytesInUse()).toBe(4000);
    releaseDetailLayer('orion', 'volume');
    expect(detailLayerHolderIds('volume')).toEqual([]);
    expect(detailLayerHolderIds('particles')).toEqual(['orion']);
    releaseDetailLayer('orion', 'volume');
    expect(detailLayerGpuBytesInUse()).toBe(1000);
  });

  it('reset 清空注册表', () => {
    claimDetailLayer(specOf('m31', 'particles', 1024));
    resetDetailLayerRegistry();
    expect(detailLayerHolderIds('particles')).toEqual([]);
    expect(detailLayerGpuBytesInUse()).toBe(0);
  });
});

describe('galaxyDetailLayerSpec（R2-8 星系近观规格，阈值同源零回退）', () => {
  it.each(Object.keys(GALAXY_NEAR_VIEW_CONFIGS))(
    '%s：进入阈值 = 飞往观察距离 × 1.5，退出 = 进入 × 1.4，估算按粒子布局',
    (galaxyId) => {
      const spec = galaxyDetailLayerSpec(galaxyId);
      expect(spec.kind).toBe('particles');
      expect(spec.enterDistanceUnits).toBeCloseTo(
        galaxyNearViewEnterDistanceUnits(galaxyId),
        10,
      );
      expect(spec.exitDistanceUnits).toBeCloseTo(
        spec.enterDistanceUnits * NEAR_VIEW_EXIT_RATIO,
        10,
      );
      const particles = GALAXY_NEAR_VIEW_CONFIGS[galaxyId].particleCount;
      expect(spec.budget.particles).toBe(particles);
      expect(spec.budget.gpuBytesEstimate).toBe(particles * GPU_BYTES_PER_PARTICLE);
      // 附录 A：任一星系近观层估算远低于 64 MB 总预算
      expect(spec.budget.gpuBytesEstimate).toBeLessThan(DETAIL_GPU_BUDGET_BYTES);
    },
  );

  it('未配置星系 id 抛 RangeError', () => {
    expect(() => galaxyDetailLayerSpec('not-a-galaxy')).toThrow(RangeError);
  });

  it('进入系数与 R2-7 同源（×1.5）', () => {
    expect(NEAR_VIEW_ENTER_RATIO).toBe(1.5);
  });
});
