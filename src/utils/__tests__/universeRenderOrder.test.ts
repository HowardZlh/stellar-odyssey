/**
 * L4 宇宙域透明层 renderOrder 注册表单测（P0 频闪修复）
 *
 * 锚定：注册表登记序严格递增（层间顺序与深度键脱钩的前提）、键穷举
 * 无遗漏、取值为非负整数、体积合成 = 10（VOLUME_RENDER_ORDER 语义零
 * 回退——消光方案 a"合成晚于星光粒子"）、既有登记行为的相对序不变式
 * （尘埃暗粒子晚于加性星光层、尘埃暗带晚于加性宇宙层、直绘体积早于
 * 体积合成）。
 */

import {
  UNIVERSE_RENDER_ORDER,
  UNIVERSE_RENDER_ORDER_SEQUENCE,
  type UniverseRenderOrderKey,
} from '@/utils/universeRenderOrder';

describe('UNIVERSE_RENDER_ORDER 注册表（单一事实来源）', () => {
  it('登记序列穷举全部键且无重复（新增层必须同步登记）', () => {
    const keys = Object.keys(UNIVERSE_RENDER_ORDER).sort();
    const seq = [...UNIVERSE_RENDER_ORDER_SEQUENCE].sort();
    expect(seq).toEqual(keys);
    expect(new Set(UNIVERSE_RENDER_ORDER_SEQUENCE).size).toBe(
      UNIVERSE_RENDER_ORDER_SEQUENCE.length,
    );
  });

  it('登记序列取值严格递增（层间绘制次序确定、无同值歧义）', () => {
    for (let i = 1; i < UNIVERSE_RENDER_ORDER_SEQUENCE.length; i += 1) {
      const prev = UNIVERSE_RENDER_ORDER[UNIVERSE_RENDER_ORDER_SEQUENCE[i - 1]];
      const curr = UNIVERSE_RENDER_ORDER[UNIVERSE_RENDER_ORDER_SEQUENCE[i]];
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it('取值均为整数；除星场（−1 最先绘制）外均非负', () => {
    for (const key of UNIVERSE_RENDER_ORDER_SEQUENCE) {
      const value = UNIVERSE_RENDER_ORDER[key];
      expect(Number.isInteger(value)).toBe(true);
      if (key !== 'starfield') expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('锚定值：星场 −1（透明队列最先，早于默认组 0 的加性粒子层）、体积合成 10（VOLUME_RENDER_ORDER 不变）', () => {
    expect(UNIVERSE_RENDER_ORDER.starfield).toBe(-1);
    // 默认组 0（未登记加性层：银盘/银晕粒子等）夹在星场与登记层之间
    expect(UNIVERSE_RENDER_ORDER.starfield).toBeLessThan(0);
    expect(UNIVERSE_RENDER_ORDER.galaxyCatalog).toBeGreaterThan(0);
    expect(UNIVERSE_RENDER_ORDER.volumeComposite).toBe(10);
  });

  it('既有登记行为相对序不变式', () => {
    const o = UNIVERSE_RENDER_ORDER;
    // R4-10：近观尘埃暗纹 normal 混合晚于加性星光层（"吸光"暗纹）
    expect(o.nearViewDust).toBeGreaterThan(o.nearViewParticles);
    // R2-9：银河系尘埃暗带晚于加性宇宙层（目录/宇宙网/流层/刻度）
    expect(o.galaxyDustLane).toBeGreaterThan(o.galaxyCatalog);
    expect(o.galaxyDustLane).toBeGreaterThan(o.cosmicWeb);
    expect(o.galaxyDustLane).toBeGreaterThan(o.additiveFlows);
    // 消光方案 a：体积合成晚于全部星光粒子层与直绘发射体积（渐晚绘制链）
    expect(o.volumeComposite).toBeGreaterThan(o.nearViewParticles);
    expect(o.volumeComposite).toBeGreaterThan(o.nearViewDust);
    expect(o.volumeComposite).toBeGreaterThan(o.emissiveVolumes);
    // 原 renderOrder=10 并列组错开（同值深度歧义消除）
    expect(o.emissiveVolumes).not.toBe(o.volumeComposite);
    // 运动线（尾迹/预测，顶点逐帧更新深度键漂移）与静态引导线分档
    expect(o.motionLines).not.toBe(o.guideLines);
    expect(o.motionLines).toBeLessThan(o.galaxyDustLane);
    // 任务登记的层序建议：星场 → 目录点云 → 星流 → 线 → 近观粒子层
    const suggested: UniverseRenderOrderKey[] = [
      'starfield',
      'galaxyCatalog',
      'additiveFlows',
      'guideLines',
      'nearViewParticles',
    ];
    for (let i = 1; i < suggested.length; i += 1) {
      expect(o[suggested[i]]).toBeGreaterThan(o[suggested[i - 1]]);
    }
  });
});
