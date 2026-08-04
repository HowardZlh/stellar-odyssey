/**
 * 体积渲染帧率自适应质量档位（R4-4，IMPROVEMENT_REQUIREMENTS_4 §R4-4）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行，不 import React/three）：
 * - 滑动窗口 FPS 采样（3 秒窗）：`recordQualityFrame` 每帧记录时间戳，
 *   窗口均值 FPS 由 `slidingWindowFps` 计算（样本不足返回 null，不决策）；
 * - 质量档位状态机（high 64 步/full → mid 48 步/half → low 32 步/half）：
 *   核心判定 `decideTier` 为纯函数（滞回边界单测覆盖）——
 *   降档：窗口 FPS < 52 立即降一档（3 秒窗均值本身即防抖；
 *   **L4 频闪 P0 修复修订**：55→52 拉大迟滞带——帧耗时骑在 55 阈值上
 *   的场景（近观星系 + 尘埃盘 + 点云 + Bloom）曾致 mid↔low 极限环振荡，
 *   uSteps/RT 比例反复斜坡经 Bloom 放大为盘面明暗频闪；修订登记于
 *   IMPROVEMENT_REQUIREMENTS_4 §R4-4）；
 *   升档：窗口 FPS ≥ 58 **连续 5 秒**达标才升一档（滞回防抖，52–58 为
 *   迟滞带：既不降档也不累计升档；达标起点回溯到窗口起点——验收
 *   "恢复小占比后 5 秒内升档"不被窗口积累期拖长）；
 *   换档驻留（同修复第二重阻尼）：任何换档后 ≥3s 内不再换档
 *   （`QUALITY_CHANGE_DWELL_MS`；驻留期达标累计照常推进、届满即结算，
 *   5s 升档判据 > 3s 驻留故升档时序不受影响；创建时刻视作换档起点——
 *   挂载后 3s 观察期，防挂载风暴期误降档）；
 *   换档后清空采样窗（跨档样本不混算，重新积累 ≥1.5s 才有下一次决策）；
 * - 档位 → 渲染参数映射：`VOLUME_QUALITY_SPECS`（uQuality 标量 = 步数比例、
 *   步数、RT 渲染比例）；步数按基准步数缩放（`stepsForTier`，基准 64 时
 *   即 64/48/32 canonical 档）；
 * - 档位切换 ≤0.5s 平滑插值：`advanceQualityBlend` 就地推进混合状态
 *   （渲染循环零对象分配），uQuality/RT 比例线性趋近目标，最大全程差
 *   0.5 在 `QUALITY_TRANSITION_SECONDS`=0.5s 内走完；
 * - 预览页强制档位滑杆映射：`forcedTierFromSlider`（0 自动 / 1 低 / 2 中 / 3 高）。
 *
 * 状态容器 `AdaptiveQualityState` 采用就地更新（采样数组复用，渲染循环
 * 零逐帧对象分配，附录 A §2）；判定核心与全部映射均为纯函数可单测。
 */

/** 体积质量档位（高→低） */
export type VolumeQualityTier = 'high' | 'mid' | 'low';

/** 档位渲染参数（§R4-4：uQuality/步数/RT 比例三元映射） */
export interface VolumeQualitySpec {
  /** uQuality uniform 标量 = 步数缩放比例（1 / 0.75 / 0.5） */
  stepScale: number;
  /** 体积 RT 渲染比例（full=1 / half=0.5） */
  resolutionScale: number;
  /** canonical 步数（基准 64 步时：64 / 48 / 32） */
  steps: number;
}

/** 档位 → 渲染参数映射（§R4-4：high 64 步/full → mid 48 步/half → low 32 步/half） */
export const VOLUME_QUALITY_SPECS: Readonly<Record<VolumeQualityTier, VolumeQualitySpec>> = {
  high: { stepScale: 1, resolutionScale: 1, steps: 64 },
  mid: { stepScale: 0.75, resolutionScale: 0.5, steps: 48 },
  low: { stepScale: 0.5, resolutionScale: 0.5, steps: 32 },
};

/** FPS 采样滑动窗口时长（§R4-4：3 秒窗） */
export const QUALITY_FPS_WINDOW_MS = 3000;

/** 降档阈值：窗口均值 FPS 低于此值降一档（R4-4 原值 55；L4 频闪 P0
 * 修复修订为 52——拉大迟滞带，消除骑 55 阈值场景的 mid↔low 极限环振荡，
 * 登记于 IMPROVEMENT_REQUIREMENTS_4 §R4-4 修订块） */
export const QUALITY_DOWNGRADE_FPS = 52;

/** 升档阈值：窗口均值 FPS 达到此值才累计升档时长（与降档阈值间 6 FPS 迟滞带） */
export const QUALITY_UPGRADE_FPS = 58;

/** 升档需连续达标时长（§R4-4：连续 5 秒） */
export const QUALITY_UPGRADE_HOLD_MS = 5000;

/** 换档驻留时长（L4 频闪 P0 修复新增）：任何换档后此时长内不再换档
 * （第二重阻尼；驻留期升档达标累计照常推进、届满即结算） */
export const QUALITY_CHANGE_DWELL_MS = 3000;

/** 决策所需最小窗口时间跨度（样本不足不决策，防换档/启动初期误判） */
export const QUALITY_MIN_DECISION_SPAN_MS = 1500;

/** 决策所需最小样本帧数（防长时间挂起后稀疏样本误判） */
export const QUALITY_MIN_DECISION_SAMPLES = 24;

/** 档位切换平滑过渡时长（§R4-4：≤0.5s 插值） */
export const QUALITY_TRANSITION_SECONDS = 0.5;

/** 档位序（索引小 = 档位高） */
const TIER_ORDER: readonly VolumeQualityTier[] = ['high', 'mid', 'low'];

/**
 * 降一档（low 封底）
 */
export function lowerTier(tier: VolumeQualityTier): VolumeQualityTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, i + 1)];
}

/**
 * 升一档（high 封顶）
 */
export function higherTier(tier: VolumeQualityTier): VolumeQualityTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, i - 1)];
}

/**
 * 按档位缩放基准步数（基准 64 → 64/48/32 canonical 档；四舍五入取整）
 */
export function stepsForTier(baseSteps: number, tier: VolumeQualityTier): number {
  if (!(baseSteps > 0) || !Number.isFinite(baseSteps)) {
    throw new RangeError(`基准步数必须为正有限数，收到 ${baseSteps}`);
  }
  return Math.max(1, Math.round(baseSteps * VOLUME_QUALITY_SPECS[tier].stepScale));
}

/**
 * 滑动窗口均值 FPS（纯函数）
 *
 * 计算式：(样本数 − 1) / 时间跨度——样本为帧时间戳，N 帧覆盖 N−1 个帧间隔。
 *
 * @param samplesMs 窗口内帧时间戳（升序）
 * @returns 样本不足（帧数 < QUALITY_MIN_DECISION_SAMPLES 或时间跨度 <
 *   QUALITY_MIN_DECISION_SPAN_MS）时返回 null（表示不可决策）
 */
export function slidingWindowFps(samplesMs: readonly number[]): number | null {
  const n = samplesMs.length;
  if (n < QUALITY_MIN_DECISION_SAMPLES) return null;
  const spanMs = samplesMs[n - 1] - samplesMs[0];
  if (spanMs < QUALITY_MIN_DECISION_SPAN_MS) return null;
  return ((n - 1) * 1000) / spanMs;
}

/** 档位判定输入（纯函数接口，滞回边界单测据此覆盖） */
export interface TierDecisionInput {
  /** 当前档位 */
  tier: VolumeQualityTier;
  /** 窗口均值 FPS（null = 样本不足，不决策） */
  fps: number | null;
  /** 升档达标起始时刻（null = 未在达标累计中） */
  upgradeMetSinceMs: number | null;
  /**
   * 窗口最早样本时刻（null = 窗口空）：达标累计的回溯起点——窗口均值
   * 已 ≥ 升档阈值时，达标事实上自窗口起点成立（否则均值达不到），
   * 使"恢复小占比后 5 秒内升档"（验收 §4.2）不被窗口积累期额外拖长。
   */
  windowStartMs: number | null;
  /** 当前时刻（ms） */
  nowMs: number;
  /**
   * 最近一次换档时刻（L4 频闪修复新增；null/缺省 = 无驻留约束）：
   * nowMs − lastChangeMs < QUALITY_CHANGE_DWELL_MS 期间不换档。
   */
  lastChangeMs?: number | null;
}

/** 档位判定结果 */
export interface TierDecision {
  /** 判定后档位 */
  tier: VolumeQualityTier;
  /** 升档达标起始时刻（换档/失格后清零） */
  upgradeMetSinceMs: number | null;
  /** 本次是否发生换档（发生则调用方应清空采样窗） */
  changed: boolean;
}

/**
 * 档位状态机核心判定（纯函数）
 *
 * 滞回语义（L4 频闪 P0 修复修订：降档 55→52 + 3s 换档驻留，见文件头）：
 * - fps === null（样本不足）：保持现档，升档计时清零（无法证明持续达标）；
 * - 驻留期（距上次换档 < 3s）：不换档——低于降档阈值仅清升档计时，
 *   达标累计照常推进（届满 5s 且出驻留即升档）；
 * - fps < 52：降一档（已是 low 则保持），升档计时清零；
 * - fps ≥ 58 且非 high：开始/继续累计达标时长（起点回溯到窗口起点），
 *   连续 ≥5s 升一档；
 * - 52 ≤ fps < 58（迟滞带）或已是 high：保持现档，升档计时清零。
 */
export function decideTier(input: TierDecisionInput): TierDecision {
  const { tier, fps, upgradeMetSinceMs, windowStartMs, nowMs } = input;
  if (fps === null) {
    return { tier, upgradeMetSinceMs: null, changed: false };
  }
  const lastChangeMs = input.lastChangeMs ?? null;
  const inDwell =
    lastChangeMs !== null && nowMs - lastChangeMs < QUALITY_CHANGE_DWELL_MS;
  if (fps < QUALITY_DOWNGRADE_FPS) {
    if (inDwell) {
      return { tier, upgradeMetSinceMs: null, changed: false };
    }
    const next = lowerTier(tier);
    return { tier: next, upgradeMetSinceMs: null, changed: next !== tier };
  }
  if (tier !== 'high' && fps >= QUALITY_UPGRADE_FPS) {
    const since = upgradeMetSinceMs ?? windowStartMs ?? nowMs;
    if (!inDwell && nowMs - since >= QUALITY_UPGRADE_HOLD_MS) {
      return { tier: higherTier(tier), upgradeMetSinceMs: null, changed: true };
    }
    return { tier, upgradeMetSinceMs: since, changed: false };
  }
  return { tier, upgradeMetSinceMs: null, changed: false };
}

/** 自适应质量状态容器（就地更新，渲染循环零逐帧对象分配） */
export interface AdaptiveQualityState {
  /** 当前档位 */
  tier: VolumeQualityTier;
  /** 窗口内帧时间戳（升序；内部复用，勿外部改写） */
  samplesMs: number[];
  /** 升档达标起始时刻（null = 未累计） */
  upgradeMetSinceMs: number | null;
  /** 最近一次换档时刻（初始 = 创建时刻） */
  lastChangeMs: number;
}

/**
 * 创建自适应质量状态（初始档默认 high）
 */
export function createAdaptiveQuality(
  nowMs: number,
  tier: VolumeQualityTier = 'high',
): AdaptiveQualityState {
  return { tier, samplesMs: [], upgradeMetSinceMs: null, lastChangeMs: nowMs };
}

/**
 * 记录一帧并推进状态机（就地更新，返回同一状态对象）
 *
 * 时间回退（nowMs 小于最近样本，如秒表重置）时清空采样窗重新积累。
 * 换档时清空采样窗（跨档样本不混算）并记录换档时刻。
 */
export function recordQualityFrame(
  state: AdaptiveQualityState,
  nowMs: number,
): AdaptiveQualityState {
  const samples = state.samplesMs;
  if (samples.length > 0 && nowMs < samples[samples.length - 1]) {
    samples.length = 0;
    state.upgradeMetSinceMs = null;
  }
  samples.push(nowMs);
  // 窗口逐出：保留 (nowMs − 3000, nowMs] 内样本
  const cutoff = nowMs - QUALITY_FPS_WINDOW_MS;
  let drop = 0;
  while (drop < samples.length && samples[drop] <= cutoff) drop += 1;
  if (drop > 0) samples.splice(0, drop);

  const decision = decideTier({
    tier: state.tier,
    fps: slidingWindowFps(samples),
    upgradeMetSinceMs: state.upgradeMetSinceMs,
    windowStartMs: samples[0], // 刚 push 的样本必存活（cutoff < nowMs），窗口非空
    nowMs,
    lastChangeMs: state.lastChangeMs, // 换档驻留（创建时刻视作换档起点）
  });
  state.upgradeMetSinceMs = decision.upgradeMetSinceMs;
  if (decision.changed) {
    state.tier = decision.tier;
    state.lastChangeMs = nowMs;
    samples.length = 0;
  }
  return state;
}

/** 档位渲染参数混合状态（平滑过渡载体，就地推进零分配） */
export interface VolumeQualityBlend {
  /** 当前 uQuality 标量（= 步数缩放比例，向目标档趋近） */
  stepScale: number;
  /** 当前 RT 渲染比例（向目标档趋近；动态视口支持连续取值） */
  resolutionScale: number;
}

/**
 * 创建混合状态（初始即落在指定档位参数上）
 */
export function createQualityBlend(tier: VolumeQualityTier): VolumeQualityBlend {
  const spec = VOLUME_QUALITY_SPECS[tier];
  return { stepScale: spec.stepScale, resolutionScale: spec.resolutionScale };
}

/**
 * 标量限速趋近（每次调用最多移动 maxDelta，纯函数）
 */
export function moveToward(current: number, target: number, maxDelta: number): number {
  if (!(maxDelta >= 0)) {
    throw new RangeError(`maxDelta 必须为非负数，收到 ${maxDelta}`);
  }
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/**
 * 就地推进混合状态向目标档位插值（档位切换 ≤0.5s 平滑过渡，§R4-4）
 *
 * 速率标定：uQuality 与 RT 比例的最大全程差均为 0.5（high↔low），按
 * `QUALITY_TRANSITION_SECONDS`=0.5s 走完 → 速率 1.0/s；相邻档差更小，
 * 过渡时间 ≤0.25s。
 */
export function advanceQualityBlend(
  blend: VolumeQualityBlend,
  targetTier: VolumeQualityTier,
  deltaSeconds: number,
): VolumeQualityBlend {
  if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds)) {
    throw new RangeError(`deltaSeconds 必须为非负有限数，收到 ${deltaSeconds}`);
  }
  const spec = VOLUME_QUALITY_SPECS[targetTier];
  const maxDelta = (deltaSeconds * 0.5) / QUALITY_TRANSITION_SECONDS;
  blend.stepScale = moveToward(blend.stepScale, spec.stepScale, maxDelta);
  blend.resolutionScale = moveToward(blend.resolutionScale, spec.resolutionScale, maxDelta);
  return blend;
}

/**
 * 预览页强制档位滑杆值 → 档位（0 自动 / 1 低 / 2 中 / 3 高；四舍五入）
 *
 * @returns 强制档位；0 或越界/非有限值返回 null（= 自动自适应）
 */
export function forcedTierFromSlider(value: number): VolumeQualityTier | null {
  if (!Number.isFinite(value)) return null;
  const v = Math.round(value);
  if (v === 1) return 'low';
  if (v === 2) return 'mid';
  if (v === 3) return 'high';
  return null;
}

/**
 * HUD 质量档位文案（预览页左上角性能区显示，实现定夺登记：予以显示）
 *
 * @param tier 当前生效档位
 * @param forced 是否为强制档（滑杆覆写）
 * @param fps 窗口均值 FPS（null 显示采样中）
 * @param steps 当前实际步数
 * @param resolutionScale 当前 RT 比例
 */
export function formatQualityLabel(
  tier: VolumeQualityTier,
  forced: boolean,
  fps: number | null,
  steps: number,
  resolutionScale: number,
): string {
  const fpsText = fps === null ? '采样中' : `${fps.toFixed(0)} FPS`;
  const mode = forced ? '强制' : '自动';
  return `${tier}（${mode}）· ${steps} 步 · RT ${Math.round(resolutionScale * 100)}% · 窗口 ${fpsText}`;
}
