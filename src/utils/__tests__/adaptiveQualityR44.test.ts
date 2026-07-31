/**
 * R4-4 帧率自适应质量档位单测（IMPROVEMENT_REQUIREMENTS_4 §R4-4）
 *
 * 覆盖：档位映射常量、升降档序、步数缩放、滑动窗 FPS（样本不足）、
 * 状态机核心判定（滞回边界：降档 52 / 升档 58 / 5s 连续达标 / 迟滞带）、
 * 逐帧推进（换档清窗、时间回退、窗口逐出）、平滑插值（≤0.5s 收敛）、
 * 强制档位滑杆映射、HUD 文案。
 *
 * ⚠ 判据修订（L4 频闪 P0 修复，2026-07；登记于 IMPROVEMENT_REQUIREMENTS_4
 * §R4-4 修订块）：降档阈值 55→52（拉大迟滞带）+ 新增 3s 换档驻留
 * （QUALITY_CHANGE_DWELL_MS）——消除帧耗时骑 55 阈值场景的 mid↔low 极限环
 * 振荡；本文件既有锚定值同步迁移，末段新增驻留时序 + 骑阈值不振荡回归例。
 */

import {
  VOLUME_QUALITY_SPECS,
  QUALITY_FPS_WINDOW_MS,
  QUALITY_CHANGE_DWELL_MS,
  QUALITY_DOWNGRADE_FPS,
  QUALITY_UPGRADE_FPS,
  QUALITY_UPGRADE_HOLD_MS,
  QUALITY_MIN_DECISION_SPAN_MS,
  QUALITY_MIN_DECISION_SAMPLES,
  QUALITY_TRANSITION_SECONDS,
  lowerTier,
  higherTier,
  stepsForTier,
  slidingWindowFps,
  decideTier,
  createAdaptiveQuality,
  recordQualityFrame,
  createQualityBlend,
  advanceQualityBlend,
  moveToward,
  forcedTierFromSlider,
  formatQualityLabel,
  type AdaptiveQualityState,
  type VolumeQualityTier,
} from '@/utils/adaptiveQuality';

/** 以固定 FPS 连续喂帧 durationMs（从 state 当前推进），返回结束时刻 */
function feedFrames(
  state: AdaptiveQualityState,
  startMs: number,
  fps: number,
  durationMs: number,
): number {
  const stepMs = 1000 / fps;
  let t = startMs;
  const end = startMs + durationMs;
  while (t + stepMs <= end) {
    t += stepMs;
    recordQualityFrame(state, t);
  }
  return t;
}

describe('档位映射常量（§R4-4：high 64 步/full → mid 48 步/half → low 32 步/half）', () => {
  it('三档 uQuality/步数/RT 比例逐项正确', () => {
    expect(VOLUME_QUALITY_SPECS.high).toEqual({ stepScale: 1, resolutionScale: 1, steps: 64 });
    expect(VOLUME_QUALITY_SPECS.mid).toEqual({ stepScale: 0.75, resolutionScale: 0.5, steps: 48 });
    expect(VOLUME_QUALITY_SPECS.low).toEqual({ stepScale: 0.5, resolutionScale: 0.5, steps: 32 });
  });

  it('滞回常量：降档 52 / 升档 58（6 FPS 迟滞带，频闪修复修订）/ 5s 连续达标 / 3s 窗 / 3s 驻留', () => {
    expect(QUALITY_DOWNGRADE_FPS).toBe(52);
    expect(QUALITY_UPGRADE_FPS).toBe(58);
    expect(QUALITY_UPGRADE_FPS).toBeGreaterThan(QUALITY_DOWNGRADE_FPS);
    expect(QUALITY_UPGRADE_HOLD_MS).toBe(5000);
    expect(QUALITY_FPS_WINDOW_MS).toBe(3000);
    expect(QUALITY_CHANGE_DWELL_MS).toBe(3000);
    // 驻留 < 升档达标时长：升档时序不被驻留拖长（文件头修订语义）
    expect(QUALITY_CHANGE_DWELL_MS).toBeLessThan(QUALITY_UPGRADE_HOLD_MS);
  });
});

describe('升降档序', () => {
  it('lowerTier：high→mid→low，low 封底', () => {
    expect(lowerTier('high')).toBe('mid');
    expect(lowerTier('mid')).toBe('low');
    expect(lowerTier('low')).toBe('low');
  });

  it('higherTier：low→mid→high，high 封顶', () => {
    expect(higherTier('low')).toBe('mid');
    expect(higherTier('mid')).toBe('high');
    expect(higherTier('high')).toBe('high');
  });
});

describe('stepsForTier（基准步数按档位缩放）', () => {
  it('基准 64 → canonical 档 64/48/32', () => {
    expect(stepsForTier(64, 'high')).toBe(64);
    expect(stepsForTier(64, 'mid')).toBe(48);
    expect(stepsForTier(64, 'low')).toBe(32);
  });

  it('非 canonical 基准四舍五入且 ≥1', () => {
    expect(stepsForTier(100, 'mid')).toBe(75);
    expect(stepsForTier(1, 'low')).toBe(1); // round(0.5)=1，封底保 1
  });

  it('非正/非有限基准抛 RangeError', () => {
    expect(() => stepsForTier(0, 'high')).toThrow(RangeError);
    expect(() => stepsForTier(-8, 'mid')).toThrow(RangeError);
    expect(() => stepsForTier(Number.NaN, 'low')).toThrow(RangeError);
  });
});

describe('slidingWindowFps（窗口不足样本不决策，验收 §4.2）', () => {
  it('帧数不足最小样本数返回 null', () => {
    const samples = Array.from({ length: QUALITY_MIN_DECISION_SAMPLES - 1 }, (_, i) => i * 100);
    expect(slidingWindowFps(samples)).toBeNull();
    expect(slidingWindowFps([])).toBeNull();
  });

  it('时间跨度不足最小跨度返回 null（帧数已够）', () => {
    // 30 帧挤在 1000ms 内（< QUALITY_MIN_DECISION_SPAN_MS = 1500）
    const samples = Array.from({ length: 30 }, (_, i) => i * (1000 / 29));
    expect(slidingWindowFps(samples)).toBeNull();
  });

  it('样本充足按 (N−1)/跨度 计算均值 FPS', () => {
    // 121 帧、每 16.6667ms 一帧 → 2000ms 跨度 → 60 FPS
    const samples = Array.from({ length: 121 }, (_, i) => i * (2000 / 120));
    expect(slidingWindowFps(samples)).toBeCloseTo(60, 5);
  });

  it('边界：恰好达到最小样本数与最小跨度即可决策', () => {
    const n = QUALITY_MIN_DECISION_SAMPLES;
    const samples = Array.from(
      { length: n },
      (_, i) => (i * QUALITY_MIN_DECISION_SPAN_MS) / (n - 1),
    );
    expect(slidingWindowFps(samples)).not.toBeNull();
  });
});

describe('decideTier 状态机核心（滞回边界全覆盖）', () => {
  const base = { upgradeMetSinceMs: null, windowStartMs: 0, nowMs: 10_000 };

  it('fps=null（样本不足）：保持现档、升档计时清零', () => {
    const d = decideTier({ tier: 'mid', fps: null, ...base, upgradeMetSinceMs: 8000 });
    expect(d).toEqual({ tier: 'mid', upgradeMetSinceMs: null, changed: false });
  });

  it('fps < 52：high→mid、mid→low 降一档；low 保持（changed=false）', () => {
    expect(decideTier({ tier: 'high', fps: 51.9, ...base })).toEqual({
      tier: 'mid',
      upgradeMetSinceMs: null,
      changed: true,
    });
    expect(decideTier({ tier: 'mid', fps: 30, ...base })).toEqual({
      tier: 'low',
      upgradeMetSinceMs: null,
      changed: true,
    });
    expect(decideTier({ tier: 'low', fps: 10, ...base })).toEqual({
      tier: 'low',
      upgradeMetSinceMs: null,
      changed: false,
    });
  });

  it('滞回边界：fps 恰为 52 不降档（< 严格比较）', () => {
    const d = decideTier({ tier: 'high', fps: 52, ...base });
    expect(d.tier).toBe('high');
    expect(d.changed).toBe(false);
  });

  it('原 55 阈值域（52 ≤ fps < 55）修订后落入迟滞带：不降档（骑 55 阈值场景）', () => {
    const d = decideTier({ tier: 'mid', fps: 54.5, ...base });
    expect(d).toEqual({ tier: 'mid', upgradeMetSinceMs: null, changed: false });
  });

  it('迟滞带 52 ≤ fps < 58：不降档、不累计升档（计时清零）', () => {
    const d = decideTier({ tier: 'low', fps: 56.5, ...base, upgradeMetSinceMs: 8000 });
    expect(d).toEqual({ tier: 'low', upgradeMetSinceMs: null, changed: false });
  });

  it('fps ≥ 58 非 high：首次达标以窗口起点回溯起算', () => {
    const d = decideTier({
      tier: 'mid',
      fps: 60,
      upgradeMetSinceMs: null,
      windowStartMs: 8000,
      nowMs: 10_000,
    });
    expect(d).toEqual({ tier: 'mid', upgradeMetSinceMs: 8000, changed: false });
  });

  it('fps ≥ 58 非 high 且窗口起点为 null：以当前时刻起算', () => {
    const d = decideTier({
      tier: 'low',
      fps: 60,
      upgradeMetSinceMs: null,
      windowStartMs: null,
      nowMs: 10_000,
    });
    expect(d).toEqual({ tier: 'low', upgradeMetSinceMs: 10_000, changed: false });
  });

  it('升档滞回边界：达标 4999ms 不升，恰 5000ms 升一档', () => {
    const notYet = decideTier({
      tier: 'low',
      fps: 60,
      upgradeMetSinceMs: 5001,
      windowStartMs: 7000,
      nowMs: 10_000,
    });
    expect(notYet).toEqual({ tier: 'low', upgradeMetSinceMs: 5001, changed: false });
    const exact = decideTier({
      tier: 'low',
      fps: 60,
      upgradeMetSinceMs: 5000,
      windowStartMs: 7000,
      nowMs: 10_000,
    });
    expect(exact).toEqual({ tier: 'mid', upgradeMetSinceMs: null, changed: true });
  });

  it('升档阈值边界：fps 恰为 58 计入达标（≥ 比较，回溯到窗口起点）', () => {
    const d = decideTier({ tier: 'mid', fps: 58, ...base, windowStartMs: 8000 });
    expect(d.upgradeMetSinceMs).toBe(8000);
    expect(d.changed).toBe(false);
  });

  it('回溯起点已满 5s（长窗口高帧率）：当帧即升档', () => {
    const d = decideTier({ tier: 'mid', fps: 60, ...base, windowStartMs: 0 });
    expect(d).toEqual({ tier: 'high', upgradeMetSinceMs: null, changed: true });
  });

  it('已是 high 档：fps ≥ 58 不再累计（计时保持清零）', () => {
    const d = decideTier({ tier: 'high', fps: 120, ...base, upgradeMetSinceMs: 8000 });
    expect(d).toEqual({ tier: 'high', upgradeMetSinceMs: null, changed: false });
  });
});

describe('recordQualityFrame 逐帧推进（集成时序）', () => {
  it('创建状态：默认 high 档、空窗、无累计', () => {
    const s = createAdaptiveQuality(100);
    expect(s).toEqual({ tier: 'high', samplesMs: [], upgradeMetSinceMs: null, lastChangeMs: 100 });
    const s2 = createAdaptiveQuality(0, 'low');
    expect(s2.tier).toBe('low');
  });

  it('稳定 60 FPS：保持 high 档不变', () => {
    const s = createAdaptiveQuality(0);
    feedFrames(s, 0, 60, 10_000);
    expect(s.tier).toBe('high');
  });

  it('持续 30 FPS：驻留期满后降至 mid，再一轮驻留后降至 low 并封底', () => {
    const s = createAdaptiveQuality(0);
    // 创建时刻视作换档起点（3s 观察期，频闪修复驻留语义）：
    // 窗口 1.5s 即可决策但驻留期内不降档
    let t = feedFrames(s, 0, 30, 2000);
    expect(s.tier).toBe('high');
    t = feedFrames(s, t, 30, 1500); // 越过 3s 驻留即降档
    expect(s.tier).toBe('mid');
    // 换档清窗（跨档样本不混算）：窗内样本均晚于换档时刻
    expect(s.samplesMs.every((m) => m > s.lastChangeMs)).toBe(true);
    t = feedFrames(s, t, 30, 3500); // 第二轮驻留 3s + 决策
    expect(s.tier).toBe('low');
    feedFrames(s, t, 30, 10_000);
    expect(s.tier).toBe('low'); // 封底不再变
  });

  it('降档后帧率恢复 60：升档需连续 5 秒达标（恢复后 ~5s 内完成一次升档）', () => {
    const s = createAdaptiveQuality(0, 'low');
    s.lastChangeMs = 0;
    // 恢复期开始（t=0 起 60 FPS），逐帧找出升档时刻
    const stepMs = 1000 / 60;
    let t = 0;
    let upgradeAt: number | null = null;
    while (t < 8000) {
      t += stepMs;
      recordQualityFrame(s, t);
      if (s.tier !== 'low') {
        upgradeAt = t;
        break;
      }
    }
    expect(s.tier).toBe('mid');
    // 达标起点回溯窗口起点：升档在 5s 达标线附近、不被窗口积累期拖长
    expect(upgradeAt).not.toBeNull();
    expect(upgradeAt as number).toBeGreaterThanOrEqual(QUALITY_UPGRADE_HOLD_MS);
    expect(upgradeAt as number).toBeLessThanOrEqual(QUALITY_UPGRADE_HOLD_MS + 200);
  });

  it('升档累计中帧率跌回迟滞带：计时清零重新累计', () => {
    const s = createAdaptiveQuality(0, 'low');
    let t = feedFrames(s, 0, 60, 3000);
    expect(s.upgradeMetSinceMs).not.toBeNull();
    t = feedFrames(s, t, 56, 3200); // 迟滞带（55–58）：不降档但计时清零
    expect(s.tier).toBe('low');
    expect(s.upgradeMetSinceMs).toBeNull();
  });

  it('连续升档回到 high：low→mid→high 各需一轮 5s 达标', () => {
    const s = createAdaptiveQuality(0, 'low');
    let t = feedFrames(s, 0, 60, 5500);
    expect(s.tier).toBe('mid');
    t = feedFrames(s, t, 60, 6000);
    expect(s.tier).toBe('high');
    feedFrames(s, t, 60, 6000);
    expect(s.tier).toBe('high'); // 封顶
  });

  it('窗口逐出：样本始终在 3s 窗内', () => {
    const s = createAdaptiveQuality(0);
    const t = feedFrames(s, 0, 60, 10_000);
    expect(s.samplesMs[0]).toBeGreaterThan(t - QUALITY_FPS_WINDOW_MS);
    expect(s.samplesMs[s.samplesMs.length - 1]).toBeLessThanOrEqual(t);
  });

  it('时间回退（秒表重置）：清窗重新积累，不误判', () => {
    const s = createAdaptiveQuality(0);
    feedFrames(s, 0, 60, 3000);
    expect(s.samplesMs.length).toBeGreaterThan(0);
    recordQualityFrame(s, 10); // 回退到 10ms
    expect(s.samplesMs).toEqual([10]);
    expect(s.tier).toBe('high');
    expect(s.upgradeMetSinceMs).toBeNull();
  });

  it('换档登记 lastChangeMs', () => {
    const s = createAdaptiveQuality(0);
    feedFrames(s, 0, 30, 3500); // 越过创建驻留期（3s）后首次降档
    expect(s.tier).toBe('mid');
    expect(s.lastChangeMs).toBeGreaterThan(0);
  });

  it('就地更新：返回同一状态对象（渲染循环零分配）', () => {
    const s = createAdaptiveQuality(0);
    expect(recordQualityFrame(s, 16)).toBe(s);
  });
});

describe('moveToward（限速趋近）', () => {
  it('差值在限内直接到达目标', () => {
    expect(moveToward(0.5, 0.6, 0.2)).toBe(0.6);
    expect(moveToward(0.5, 0.5, 0)).toBe(0.5);
  });

  it('超限按最大步长逼近（双向）', () => {
    expect(moveToward(0, 1, 0.3)).toBeCloseTo(0.3, 10);
    expect(moveToward(1, 0, 0.3)).toBeCloseTo(0.7, 10);
  });

  it('负 maxDelta 抛 RangeError', () => {
    expect(() => moveToward(0, 1, -0.1)).toThrow(RangeError);
  });
});

describe('advanceQualityBlend（档位切换 ≤0.5s 平滑插值，§R4-4）', () => {
  it('createQualityBlend 初始即落在档位参数上', () => {
    expect(createQualityBlend('high')).toEqual({ stepScale: 1, resolutionScale: 1 });
    expect(createQualityBlend('low')).toEqual({ stepScale: 0.5, resolutionScale: 0.5 });
  });

  it('high→low 全程差 0.5：0.5s 内收敛到目标', () => {
    const blend = createQualityBlend('high');
    const dt = 1 / 60;
    let elapsed = 0;
    while (elapsed < QUALITY_TRANSITION_SECONDS + dt) {
      advanceQualityBlend(blend, 'low', dt);
      elapsed += dt;
    }
    expect(blend.stepScale).toBeCloseTo(0.5, 10);
    expect(blend.resolutionScale).toBeCloseTo(0.5, 10);
  });

  it('相邻档（mid→high）差 0.25/0.5：≤0.5s 收敛且中途单调', () => {
    const blend = createQualityBlend('mid');
    advanceQualityBlend(blend, 'high', 0.1);
    expect(blend.stepScale).toBeCloseTo(0.85, 10); // 0.75 + 0.1×1.0
    expect(blend.resolutionScale).toBeCloseTo(0.6, 10);
    advanceQualityBlend(blend, 'high', 1); // 大步长一次落到目标
    expect(blend).toEqual({ stepScale: 1, resolutionScale: 1 });
  });

  it('delta=0 不变；返回同一对象（就地推进）', () => {
    const blend = createQualityBlend('mid');
    const out = advanceQualityBlend(blend, 'low', 0);
    expect(out).toBe(blend);
    expect(blend.stepScale).toBe(0.75);
  });

  it('负/非有限 delta 抛 RangeError', () => {
    const blend = createQualityBlend('high');
    expect(() => advanceQualityBlend(blend, 'low', -0.1)).toThrow(RangeError);
    expect(() => advanceQualityBlend(blend, 'low', Number.NaN)).toThrow(RangeError);
  });
});

describe('forcedTierFromSlider（预览页强制档位滑杆）', () => {
  it('0=自动（null）、1=low、2=mid、3=high', () => {
    expect(forcedTierFromSlider(0)).toBeNull();
    expect(forcedTierFromSlider(1)).toBe('low');
    expect(forcedTierFromSlider(2)).toBe('mid');
    expect(forcedTierFromSlider(3)).toBe('high');
  });

  it('四舍五入取档；越界/非有限返回 null（自动）', () => {
    expect(forcedTierFromSlider(0.6)).toBe('low');
    expect(forcedTierFromSlider(2.4)).toBe('mid');
    expect(forcedTierFromSlider(4)).toBeNull();
    expect(forcedTierFromSlider(-1)).toBeNull();
    expect(forcedTierFromSlider(Number.NaN)).toBeNull();
  });
});

describe('formatQualityLabel（HUD 档位文案）', () => {
  it('自动档 + 窗口 FPS', () => {
    expect(formatQualityLabel('mid', false, 59.6, 48, 0.5)).toBe(
      'mid（自动）· 48 步 · RT 50% · 窗口 60 FPS',
    );
  });

  it('强制档 + 采样中', () => {
    expect(formatQualityLabel('low', true, null, 32, 0.5)).toBe(
      'low（强制）· 32 步 · RT 50% · 窗口 采样中',
    );
  });
});

describe('换档驻留 + 骑阈值不振荡（L4 频闪 P0 修复回归）', () => {
  it('decideTier 驻留期内 fps < 52 不降档，届满后降档', () => {
    const inDwell = decideTier({
      tier: 'mid',
      fps: 40,
      upgradeMetSinceMs: 3000,
      windowStartMs: 8000,
      nowMs: 10_000,
      lastChangeMs: 8000, // 距上次换档 2s < 3s 驻留
    });
    expect(inDwell).toEqual({ tier: 'mid', upgradeMetSinceMs: null, changed: false });
    const after = decideTier({
      tier: 'mid',
      fps: 40,
      upgradeMetSinceMs: null,
      windowStartMs: 8000,
      nowMs: 11_000, // 恰满 3s 驻留（≥ 边界即出驻留）
      lastChangeMs: 8000,
    });
    expect(after).toEqual({ tier: 'low', upgradeMetSinceMs: null, changed: true });
  });

  it('decideTier 驻留期内升档达标累计照常推进、届满即结算升档', () => {
    // 距上次换档 2.5s（驻留中），达标已累计 6s（> 5s 判据）：不升、保留累计
    const held = decideTier({
      tier: 'mid',
      fps: 60,
      upgradeMetSinceMs: 4000,
      windowStartMs: 8000,
      nowMs: 10_000,
      lastChangeMs: 7500,
    });
    expect(held).toEqual({ tier: 'mid', upgradeMetSinceMs: 4000, changed: false });
    // 驻留届满：累计已满即刻升档
    const settled = decideTier({
      tier: 'mid',
      fps: 60,
      upgradeMetSinceMs: 4000,
      windowStartMs: 8000,
      nowMs: 10_600,
      lastChangeMs: 7500,
    });
    expect(settled).toEqual({ tier: 'high', upgradeMetSinceMs: null, changed: true });
  });

  it('decideTier 未传 lastChangeMs（旧调用签名）：无驻留约束零回退', () => {
    const d = decideTier({
      tier: 'high',
      fps: 40,
      upgradeMetSinceMs: null,
      windowStartMs: 0,
      nowMs: 100, // 若按创建驻留会被拦；缺省 = 无约束
    });
    expect(d).toEqual({ tier: 'mid', upgradeMetSinceMs: null, changed: true });
  });

  it('骑阈值回归（根因场景）：mid 档 FPS 在 54–56 间摆动 60s 恒不换档', () => {
    // 修复前：<55 即降 low、恢复 ≥58 5s 后升回 mid → 极限环振荡；
    // 修订后 54–56 全程落在 52–58 迟滞带 → 稳定 mid
    const s = createAdaptiveQuality(0, 'mid');
    let t = 0;
    let phase = 0;
    while (t < 60_000) {
      // 0.5s 一段在 54/56 间交替（帧耗时骑阈值的锯齿近似）
      const fps = phase % 2 === 0 ? 54 : 56;
      t = feedFrames(s, t, fps, 500);
      phase += 1;
      expect(s.tier).toBe('mid');
    }
    expect(s.lastChangeMs).toBe(0); // 全程零换档
  });

  it('骑降档线回归：FPS 在 51/60 间交替（窗口均值落带内）不振荡', () => {
    // 3s 窗均值 ≈ (51+60)/2 ≈ 55.4 ∈ [52, 58) 迟滞带 → 不降不升
    const s = createAdaptiveQuality(0, 'mid');
    let t = 0;
    for (let i = 0; i < 40; i += 1) {
      t = feedFrames(s, t, i % 2 === 0 ? 51 : 60, 500);
    }
    expect(s.tier).toBe('mid');
    expect(s.lastChangeMs).toBe(0);
  });

  it('recordQualityFrame 集成：深跌后两次降档间隔 ≥ 3s 驻留', () => {
    const s = createAdaptiveQuality(0);
    const stepMs = 1000 / 20; // 持续 20 FPS 深跌
    const changes: number[] = [];
    let prevTier = s.tier;
    let t = 0;
    while (t < 12_000) {
      t += stepMs;
      recordQualityFrame(s, t);
      if (s.tier !== prevTier) {
        changes.push(t);
        prevTier = s.tier;
      }
    }
    expect(s.tier).toBe('low');
    expect(changes).toHaveLength(2); // high→mid→low 各一次
    expect(changes[0]).toBeGreaterThanOrEqual(QUALITY_CHANGE_DWELL_MS); // 创建观察期
    expect(changes[1] - changes[0]).toBeGreaterThanOrEqual(QUALITY_CHANGE_DWELL_MS);
  });

  it('升档时序零回退：驻留（3s）< 升档判据（5s），恢复后仍 ~5s 升档', () => {
    const s = createAdaptiveQuality(0, 'low');
    const stepMs = 1000 / 60;
    let t = 0;
    let upgradeAt: number | null = null;
    while (t < 8000) {
      t += stepMs;
      recordQualityFrame(s, t);
      if (s.tier !== 'low') {
        upgradeAt = t;
        break;
      }
    }
    expect(s.tier).toBe('mid');
    expect(upgradeAt as number).toBeGreaterThanOrEqual(QUALITY_UPGRADE_HOLD_MS);
    expect(upgradeAt as number).toBeLessThanOrEqual(QUALITY_UPGRADE_HOLD_MS + 200);
  });
});

describe('类型完备性（档位穷举）', () => {
  it('三档规格均可经 stepsForTier 消费', () => {
    const tiers: VolumeQualityTier[] = ['high', 'mid', 'low'];
    for (const tier of tiers) {
      expect(stepsForTier(VOLUME_QUALITY_SPECS[tier].steps / VOLUME_QUALITY_SPECS[tier].stepScale, tier)).toBe(
        VOLUME_QUALITY_SPECS[tier].steps,
      );
    }
  });
});
