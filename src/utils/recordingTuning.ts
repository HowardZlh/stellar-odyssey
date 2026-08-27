/**
 * dev 专用录制调参参数（解析 + 消毒纯函数）
 *
 * 视频录制时无需 hack（拦截补丁/快进硬撞），经 URL 参数放大/定向太阳事件链
 * 演示效果。解析入口挂 `utils/launchParams.ts` 的 parseLaunchParams（同源
 * 风格：非法/越界值**静默消毒回默认**，控制台零错误），store 挂只读会话级
 * 快照字段（`launch.rec`）。
 *
 * **仅开发构建生效**（`NODE_ENV !== 'production'`）：生产构建下解析恒返回
 * DEFAULT_RECORDING_TUNING（active=false），全部消费点走默认分支——
 * 生产零行为差异。
 *
 * 参数表：
 * - `recCmeEarth=1`   CME 方向直接取日→地方向（earthDirectionAt），
 *                     earthDirected 恒真（视觉因果天然正确，非放宽判定角）
 * - `recCmeSpeed`     250–3000（km/s）固定 CME 速度；越界不覆盖
 * - `recFlareClass`   C|M|X 演示耀斑定级（X → 90% 联动 CME，走既有概率）
 * - `recFlareMag`     1–9.9 演示耀斑量级；越界不覆盖
 * - `recAuroraDays`   0.1–30 极光增强时长（模拟天），默认 1.5
 * - `recAuroraBoost`  0.5–3 极光层峰值 opacity 乘数（消费侧封顶 1.0），默认 1
 * - `recLog=1`        单独开诊断日志（devRecLog.ts）
 */

import type { RecordingTuning, SolarFlareClass, Vec3 } from '@/types';
import {
  AURORA_ENHANCEMENT_DAYS,
  CME_SPEED_KM_S_MAX,
  CME_SPEED_KM_S_MIN,
} from '@/utils/solarActivity';

/** recFlareMag 合法范围（级内量级 1.0–9.9） */
export const REC_FLARE_MAG_MIN = 1;
export const REC_FLARE_MAG_MAX = 9.9;

/** recAuroraDays 合法范围（模拟天）与默认值（= AURORA_ENHANCEMENT_DAYS） */
export const REC_AURORA_DAYS_MIN = 0.1;
export const REC_AURORA_DAYS_MAX = 30;
export const REC_AURORA_DAYS_DEFAULT = AURORA_ENHANCEMENT_DAYS;

/** recAuroraBoost 合法范围与默认值（1 = 现状峰值 opacity 0.5） */
export const REC_AURORA_BOOST_MIN = 0.5;
export const REC_AURORA_BOOST_MAX = 3;
export const REC_AURORA_BOOST_DEFAULT = 1;

/** 全部 rec* 参数键（任一出现 → active=true，诊断日志门控依据） */
export const REC_PARAM_KEYS: readonly string[] = [
  'recCmeEarth',
  'recCmeSpeed',
  'recFlareClass',
  'recFlareMag',
  'recAuroraDays',
  'recAuroraBoost',
  'recLog',
];

/** 无参数/生产构建的默认解析结果（消费点走该值 = 现状零行为差异） */
export const DEFAULT_RECORDING_TUNING: Readonly<RecordingTuning> = Object.freeze({
  cmeEarth: false,
  cmeSpeedKmS: null,
  flareClass: null,
  flareMag: null,
  auroraDays: REC_AURORA_DAYS_DEFAULT,
  auroraBoost: REC_AURORA_BOOST_DEFAULT,
  log: false,
  active: false,
});

/** 数值参数消毒：非有限数/越界 → null（越界不钳制——非法即回默认） */
function parseNumberInRange(value: string | null, min: number, max: number): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed >= min && parsed <= max ? parsed : null;
}

/** `recFlareClass=C|M|X`（大小写不敏感）；非法回退 null（不覆盖） */
function parseFlareClass(value: string | null): SolarFlareClass | null {
  const normalized = value?.toUpperCase();
  return normalized === 'C' || normalized === 'M' || normalized === 'X' ? normalized : null;
}

/**
 * 解析录制调参参数（纯函数，parseLaunchParams 内部调用）
 *
 * @param params 已构造的 URLSearchParams（与 launchParams 共享一次解析）
 * @param isProduction 生产构建标记（默认取 NODE_ENV；生产恒返回默认值）
 */
export function parseRecordingTuning(
  params: URLSearchParams,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): RecordingTuning {
  if (isProduction || !REC_PARAM_KEYS.some((key) => params.has(key))) {
    return DEFAULT_RECORDING_TUNING;
  }
  return {
    cmeEarth: params.get('recCmeEarth') === '1',
    cmeSpeedKmS: parseNumberInRange(
      params.get('recCmeSpeed'),
      CME_SPEED_KM_S_MIN,
      CME_SPEED_KM_S_MAX,
    ),
    flareClass: parseFlareClass(params.get('recFlareClass')),
    flareMag: parseNumberInRange(params.get('recFlareMag'), REC_FLARE_MAG_MIN, REC_FLARE_MAG_MAX),
    auroraDays:
      parseNumberInRange(params.get('recAuroraDays'), REC_AURORA_DAYS_MIN, REC_AURORA_DAYS_MAX) ??
      REC_AURORA_DAYS_DEFAULT,
    auroraBoost:
      parseNumberInRange(
        params.get('recAuroraBoost'),
        REC_AURORA_BOOST_MIN,
        REC_AURORA_BOOST_MAX,
      ) ?? REC_AURORA_BOOST_DEFAULT,
    log: params.get('recLog') === '1',
    active: true,
  };
}

// ---------------------------------------------------------------------------
// 事件参数覆盖（SunActivity roll 调用处消费的纯函数）
// ---------------------------------------------------------------------------

/** CME 事件参数形状（rollCmeParams / 耀斑联动 CME 共用） */
export interface CmeRollParams {
  direction: Vec3;
  speedKmS: number;
  startedAtSimDays: number;
  earthDirected: boolean;
}

/**
 * CME 事件参数覆盖：recCmeEarth=1 时方向**直接取日→地方向**且 earthDirected
 * 恒真（视觉因果天然正确——勿只放宽判定角）；recCmeSpeed 固定速度。
 * 未激活调参时原样透传（生产零行为差异）。
 */
export function overrideCmeRoll(
  params: CmeRollParams,
  rec: RecordingTuning,
  earthDir: Vec3,
): CmeRollParams {
  if (!rec.active) return params;
  return {
    ...params,
    direction: rec.cmeEarth ? { x: earthDir.x, y: earthDir.y, z: earthDir.z } : params.direction,
    speedKmS: rec.cmeSpeedKmS ?? params.speedKmS,
    earthDirected: rec.cmeEarth ? true : params.earthDirected,
  };
}

/**
 * 耀斑级别/量级覆盖（rollFlareParams 消费）：覆盖后的级别参与后续
 * CME 联动概率判定（X → 90%，走既有 cmeLinkProbability 概率）。
 */
export function overrideFlareRoll(
  rolled: { flareClass: SolarFlareClass; magnitude: number },
  rec: RecordingTuning,
): { flareClass: SolarFlareClass; magnitude: number } {
  if (!rec.active) return rolled;
  return {
    flareClass: rec.flareClass ?? rolled.flareClass,
    magnitude: rec.flareMag ?? rolled.magnitude,
  };
}

// ---------------------------------------------------------------------------
// 诊断日志换算辅助（devRecLog 埋点 payload 用，纯函数）
// ---------------------------------------------------------------------------

/** 单位方向矢量 → 黄纬/黄经（度，场景坐标 y 为北极方向） */
export function dirToLatLonDeg(dir: Vec3): { latDeg: number; lonDeg: number } {
  const y = Math.min(1, Math.max(-1, dir.y));
  return {
    latDeg: (Math.asin(y) * 180) / Math.PI,
    lonDeg: (Math.atan2(dir.z, dir.x) * 180) / Math.PI,
  };
}

/** 两单位矢量夹角（度，点积反余弦，钳制防浮点越界） */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * 模拟天跨度 → 真实秒（按当前压缩比与倍速）：暂停/零倍速时无有限换算，
 * 返回 null（日志侧如实记录）。
 *
 * @param simDaysSpan 模拟天跨度
 * @param compression 当前时间压缩比（模拟秒/真实秒，timeCompressionForContinuousLevel）
 * @param speedMultiplier 当前全局倍速
 */
export function simDaysToRealSeconds(
  simDaysSpan: number,
  compression: number,
  speedMultiplier: number,
): number | null {
  const rate = compression * speedMultiplier;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return (simDaysSpan * 86400) / rate;
}

/** 数值按小数位取整（日志单行 JSON 紧凑化） */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
