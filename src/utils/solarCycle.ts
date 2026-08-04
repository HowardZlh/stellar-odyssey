/**
 * 太阳 11 年活动周期纯逻辑（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.4）
 *
 * 以模拟时间轴驱动的理想化周期模型，输出：周期序号、相位名、黑子相对数
 * 包络（0–1）、耀斑/CME 频率调制因子、日冕形态各向异性因子、蝴蝶图黑子
 * 生成纬度（随相位从高纬向赤道迁移）。所有活动系统（黑子/耀斑/CME/日冕）
 * 据此联动，快进时可观察完整周期演变（相位与 simDays 共享、暂停冻结）。
 *
 * 科学背景与数据来源：
 * - 太阳活动以约 11 年为周期消长（Schwabe 1844 发现；磁场每约 22 年反转
 *   一次即 Hale 周期）。黑子数、耀斑/CME 频率、日冕形态均随周期变化：
 *   极小期黑子稀少、日冕冕流集中于赤道；极大期黑子繁多（可达 200+）、
 *   耀斑/CME 频发、日冕辉光向全纬度铺开。
 * - 蝴蝶图（Maunder 1904）：每个新周期黑子先出现在 ±30° 高纬，随周期推进
 *   逐渐向赤道（±5°）迁移，绘成时间-纬度图形似蝴蝶翅膀（Spörer 定律）。
 * - 相位锚定真实第 25 太阳活动周期（SILSO / NOAA SWPC）：
 *   周期极小 2019-12（≈J2000+7275 天）、周期极大 2024-10（≈J2000+9040 天）。
 *   以极小为周期起点、极大位于周期约 40% 处（真实上升期短于下降期，
 *   本模型以偏置正弦近似），当前日期打开应用即处于正确相位。
 *
 * ── 艺术化/近似登记（需求 §3、§4.4、AGENTS.md 数据准确性）──────────────
 * - 真实太阳周期长度在 9–14 年间波动、峰值强度不可精确预测（如第 24 周期
 *   偏弱、第 25 周期偏强），本模型采用固定 11 年（SOLAR_CYCLE_LENGTH_DAYS）
 *   理想化正弦包络，仅作科普示意，不代表任何具体预测。
 * - 上升期/下降期不对称（真实上升 ~4 年、下降 ~7 年）以相位偏置近似
 *   （RISE_PHASE_FRACTION），并非严格 Waldmeier 关系拟合。
 * - 黑子相对数包络归一化到 0–1（0=极小、1=极大），非真实黑子数 SSN。
 * 数据来源：SILSO（比利时皇家天文台黑子数）；NOAA SWPC 第 25 周期预测；
 * Hathaway (2015) The Solar Cycle（Living Rev. Solar Phys.）。
 */

/** 理想化周期长度（模拟天，11 年，登记见文件头） */
export const SOLAR_CYCLE_LENGTH_DAYS = 11 * 365.25;

/**
 * 相位锚点：第 25 周期极小时刻（J2000 历元起天数）。
 * 2019-12-01 ≈ J2000（2000-01-01）后 7274 天。以此为周期相位 0。
 * 来源：SILSO 平滑黑子数最小值定于 2019 年 12 月。
 */
export const SOLAR_CYCLE_25_MIN_SIMDAYS = 7274;

/** 第 25 周期序号（相位锚点对应的 Schwabe 周期编号） */
export const SOLAR_CYCLE_25_NUMBER = 25;

/**
 * 上升期占周期比例（真实上升 ~4 年 / 11 年 ≈ 0.36，登记见文件头）：
 * 极大出现在相位 RISE_PHASE_FRACTION 处，其后为较长的下降期。
 */
export const RISE_PHASE_FRACTION = 0.4;

/** 频率调制因子范围（极小/极大耀斑·CME 频率相对倍数，登记见文件头） */
export const CYCLE_FREQ_FACTOR_MIN = 0.25;
export const CYCLE_FREQ_FACTOR_MAX = 2.5;

/** 蝴蝶图黑子生成纬度范围（度）：周期初高纬 → 周期末赤道（Spörer 定律） */
export const BUTTERFLY_LAT_HIGH_DEG = 30;
export const BUTTERFLY_LAT_LOW_DEG = 5;

/** 太阳活动周期相位名 */
export type SolarCyclePhaseName = 'rising' | 'maximum' | 'declining' | 'minimum';

/** 相位名中文标签（HUD/面板展示） */
export const SOLAR_CYCLE_PHASE_LABELS_ZH: Record<SolarCyclePhaseName, string> = {
  rising: '上升期',
  maximum: '极大期',
  declining: '下降期',
  minimum: '极小期',
};

/** 相位名英文标签（i18n 全站覆盖；与 ZH 键集合一致） */
export const SOLAR_CYCLE_PHASE_LABELS_EN: Record<SolarCyclePhaseName, string> = {
  rising: 'rising phase',
  maximum: 'solar maximum',
  declining: 'declining phase',
  minimum: 'solar minimum',
};

/** 周期状态（供渲染/事件/UI 消费） */
export interface SolarCycleState {
  /** Schwabe 周期序号（第 N 周期） */
  cycleNumber: number;
  /** 周期内相位（0 极小 → RISE 极大 → 1 下次极小） */
  phase01: number;
  /** 相位名（上升期/极大期/下降期/极小期） */
  phaseName: SolarCyclePhaseName;
  /** 黑子相对数包络（0 极小 → 1 极大） */
  sunspotEnvelope01: number;
  /** 耀斑/CME 频率调制因子（泊松均值按此缩放：因子越大越频繁） */
  frequencyFactor: number;
  /**
   * 日冕形态各向异性因子（0 极小期赤道集中 → 1 极大期全纬度铺开）。
   * 供 sunSurface 冕流因子插值：低值时强赤道加权、高值时趋近各向同性。
   */
  coronaIsotropy01: number;
}

/**
 * 周期内相位（0-1）：以第 25 周期极小为锚，模拟时间按周期长度取模。
 *
 * @param simDays 模拟时间（天）
 * @returns 相位 ∈ [0,1)
 */
export function solarCyclePhase01(simDays: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  const elapsed = simDays - SOLAR_CYCLE_25_MIN_SIMDAYS;
  const raw = (elapsed / SOLAR_CYCLE_LENGTH_DAYS) % 1;
  return raw < 0 ? raw + 1 : raw;
}

/**
 * 周期序号：第 25 周期极小之后每满一个周期长度序号 +1（之前 -1）。
 *
 * @param simDays 模拟时间（天）
 */
export function solarCycleNumber(simDays: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  const elapsed = simDays - SOLAR_CYCLE_25_MIN_SIMDAYS;
  return SOLAR_CYCLE_25_NUMBER + Math.floor(elapsed / SOLAR_CYCLE_LENGTH_DAYS);
}

/** 平滑插值（GLSL smoothstep 镜像） */
function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 黑子相对数包络（0-1）：不对称"上升快、下降慢"曲线——
 * 相位 0 为极小（0）、相位 RISE_PHASE_FRACTION 为极大（1）、
 * 相位 1 回到极小（0）。上升段与下降段各以余弦半波塑形（C¹ 连续，
 * 极小/极大处斜率为 0，无尖角）。
 *
 * @param phase01 周期相位 ∈ [0,1]（超出按周期回卷由调用方处理）
 */
export function cycleSunspotEnvelope(phase01: number): number {
  if (!Number.isFinite(phase01)) {
    throw new RangeError(`相位必须为有限数，收到 ${phase01}`);
  }
  const p = phase01 - Math.floor(phase01);
  if (p <= RISE_PHASE_FRACTION) {
    // 上升段：cos 半波 0 → 1
    const t = p / RISE_PHASE_FRACTION;
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }
  // 下降段：cos 半波 1 → 0
  const t = (p - RISE_PHASE_FRACTION) / (1 - RISE_PHASE_FRACTION);
  return 0.5 + 0.5 * Math.cos(Math.PI * t);
}

/**
 * 相位名判定（上升期/极大期/下降期/极小期）：
 * 以包络阈值划分——极小/极大为峰谷附近平台，其余按上升/下降段归类。
 *
 * @param phase01 周期相位 ∈ [0,1)
 * @param envelope01 黑子包络（cycleSunspotEnvelope 结果）
 */
export function cyclePhaseName(phase01: number, envelope01: number): SolarCyclePhaseName {
  const p = phase01 - Math.floor(phase01);
  if (envelope01 >= 0.85) return 'maximum';
  if (envelope01 <= 0.15) return 'minimum';
  return p <= RISE_PHASE_FRACTION ? 'rising' : 'declining';
}

/**
 * 频率调制因子：黑子包络在 [MIN, MAX] 间线性映射（极小期低频、极大期高频）。
 * 供耀斑/CME 泊松均值缩放（均值 = 基础均值 / 因子）。
 *
 * @param envelope01 黑子包络 ∈ [0,1]
 */
export function cycleFrequencyFactor(envelope01: number): number {
  const e = Math.min(1, Math.max(0, envelope01));
  return CYCLE_FREQ_FACTOR_MIN + (CYCLE_FREQ_FACTOR_MAX - CYCLE_FREQ_FACTOR_MIN) * e;
}

/**
 * 蝴蝶图黑子生成纬度（度，绝对值）：周期初高纬（BUTTERFLY_LAT_HIGH_DEG）、
 * 周期末赤道（BUTTERFLY_LAT_LOW_DEG），随相位平滑迁移（Spörer 定律）。
 * 迁移以相位（非包络）驱动——即便极大期后包络下降，纬度仍持续向赤道推进。
 *
 * @param phase01 周期相位 ∈ [0,1)
 */
export function butterflyLatitudeDeg(phase01: number): number {
  if (!Number.isFinite(phase01)) {
    throw new RangeError(`相位必须为有限数，收到 ${phase01}`);
  }
  const p = phase01 - Math.floor(phase01);
  const migrate = smooth01(p);
  return BUTTERFLY_LAT_HIGH_DEG + (BUTTERFLY_LAT_LOW_DEG - BUTTERFLY_LAT_HIGH_DEG) * migrate;
}

/**
 * 黑子相对数示意条（HUD/面板文本进度条，§4.4）：按包络填充方块。
 *
 * @param envelope01 黑子包络 ∈ [0,1]
 * @param segments 方块总数（默认 10）
 */
export function sunspotRelativeBar(envelope01: number, segments: number = 10): string {
  if (!Number.isInteger(segments) || segments <= 0) {
    throw new RangeError(`分段数必须为正整数，收到 ${segments}`);
  }
  const e = Math.min(1, Math.max(0, envelope01));
  const filled = Math.round(e * segments);
  return '█'.repeat(filled) + '░'.repeat(segments - filled);
}

/** 与 data/catalog.BodyInfoLine 同构（避免 utils → data 反向依赖） */
export interface CycleInfoLine {
  label: string;
  value: string;
}

/**
 * 周期状态信息行（§4.4：HUD 状态行 / 太阳信息面板）：
 * "第 N 周期 · 相位名 + 黑子相对数示意"。
 *
 * i18n：label 保持中文键（UI 层经 catalogText 直映射），value 按
 * locale 生成（默认 zh——既有测试断言零改动）。
 *
 * @param state 周期状态（solarCycleState 结果）
 */
export function solarCycleStatusLine(
  state: SolarCycleState,
  locale: 'zh' | 'en' = 'zh',
): CycleInfoLine {
  const bar = sunspotRelativeBar(state.sunspotEnvelope01);
  const pct = Math.round(state.sunspotEnvelope01 * 100);
  return {
    label: '活动周期',
    value:
      locale === 'en'
        ? `Cycle ${state.cycleNumber} · ${SOLAR_CYCLE_PHASE_LABELS_EN[state.phaseName]} · sunspot number ${bar} ${pct}%`
        : `第 ${state.cycleNumber} 周期 · ${SOLAR_CYCLE_PHASE_LABELS_ZH[state.phaseName]} · 黑子相对数 ${bar} ${pct}%`,
  };
}

/**
 * 综合周期状态（一次计算，供渲染/事件/UI 复用；无分配返回新对象——
 * 调用方按需在渲染循环外或低频调用）。
 *
 * @param simDays 模拟时间（天）
 */
export function solarCycleState(simDays: number): SolarCycleState {
  const phase01 = solarCyclePhase01(simDays);
  const envelope = cycleSunspotEnvelope(phase01);
  return {
    cycleNumber: solarCycleNumber(simDays),
    phase01,
    phaseName: cyclePhaseName(phase01, envelope),
    sunspotEnvelope01: envelope,
    frequencyFactor: cycleFrequencyFactor(envelope),
    // 日冕形态：包络越高越趋近各向同性（极大期全纬度）
    coronaIsotropy01: envelope,
  };
}
