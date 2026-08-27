/**
 * 启动 URL 参数解析（B4，方案 K4）
 *
 * 纯逻辑模块（不依赖 DOM/three.js，可全分支单测）：客户端挂载后读
 * `window.location.search` 传入（静态导出兼容；**勿用 `useSearchParams`**——
 * 避免 Suspense 边界要求，登记）。消费侧见 hooks/useLaunchParams.ts。
 *
 * 解析口径：
 * - 全部参数非法值**静默回退默认**（不抛错，控制台零错误）；
 * - `mode`/`tour`/`lang` 大小写不敏感（与 B2 `parseLangParam` 口径一致）；
 * - `lang` 统一迁移收口（B2 独立轻量解析 `parseLangParam` 已删除，
 *   `resolveInitialLocale` 优先级链 `?lang` > localStorage > zh 语义不变）；
 * - `logo` 安全约束登记：仅 https、长度 ≤2048；`<img>` onerror 即隐藏
 *   （演示用途风险已知可接受，§0.5#9）。
 */

import type { LaunchParams, LaunchTour, Locale } from '@/types';
import { DEFAULT_RECORDING_TUNING, parseRecordingTuning } from '@/utils/recordingTuning';

/** dwell 合法下限（秒） */
export const DWELL_MIN_SEC = 5;

/** dwell 合法上限（秒） */
export const DWELL_MAX_SEC = 600;

/** dwell 默认值（秒，§0.5#6：含 2.5s 运镜） */
export const DWELL_DEFAULT_SEC = 30;

/** tour 默认巡游域（§0.5#8：solar 单域循环） */
export const TOUR_DEFAULT: LaunchTour = 'solar';

/** logo URL 长度上限（§4.1-A 安全约束） */
export const LOGO_URL_MAX_LENGTH = 2048;

/** tour 合法值集合 */
const TOUR_VALUES: ReadonlySet<string> = new Set<LaunchTour>([
  'solar',
  'galaxy',
  'universe',
  'all',
]);

/** token 参数长度上限（U2-1 防御口径同 logo） */
export const TOKEN_PARAM_MAX_LENGTH = 2048;

/** 无参数启动的默认解析结果（store `launch` 字段初始值） */
export const DEFAULT_LAUNCH_PARAMS: Readonly<LaunchParams> = Object.freeze({
  mode: null,
  tour: TOUR_DEFAULT,
  dwell: DWELL_DEFAULT_SEC,
  body: null,
  logo: null,
  lang: null,
  token: null,
  rec: DEFAULT_RECORDING_TUNING,
});

/** `?mode=kiosk`（大小写不敏感）；其余值回退 null */
function parseMode(value: string | null): 'kiosk' | null {
  return value?.toLowerCase() === 'kiosk' ? 'kiosk' : null;
}

/** `?tour=solar|galaxy|universe|all`（大小写不敏感）；非法回退 solar */
function parseTour(value: string | null): LaunchTour {
  const normalized = value?.toLowerCase() ?? '';
  return TOUR_VALUES.has(normalized) ? (normalized as LaunchTour) : TOUR_DEFAULT;
}

/** `?dwell=<整数 5–600>`；非整数/越界回退默认 30（不做钳制——非法即默认） */
function parseDwell(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return DWELL_DEFAULT_SEC;
  const parsed = Number(value);
  return parsed >= DWELL_MIN_SEC && parsed <= DWELL_MAX_SEC ? parsed : DWELL_DEFAULT_SEC;
}

/** `?body=<天体 id>`；空白回退 null（非法 id 由 store `requestFlyTo` 自含校验） */
function parseBody(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** `?logo=<https URL>`；仅 https 且长度 ≤2048，其余静默回退 null */
function parseLogo(value: string | null): string | null {
  if (value === null || value.length === 0 || value.length > LOGO_URL_MAX_LENGTH) {
    return null;
  }
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    // 非合法 URL：静默回退（控制台零错误）
    return null;
  }
}

/**
 * `?lang=zh|en`（大小写不敏感）；非法返回 null（不影响后续优先级链）
 *
 * B2 语义等价迁移（登记）：原 `src/i18n/index.ts` `parseLangParam` 并入
 * 本统一入口，`resolveInitialLocale` 改由此处取值，优先级链不变。
 */
function parseLang(value: string | null): Locale | null {
  const normalized = value?.toLowerCase();
  return normalized === 'zh' || normalized === 'en' ? normalized : null;
}

/**
 * `?token=SO1.…`（U2-1 解锁 token 注入）：仅做形态过滤（`SO1.` 前缀 +
 * 长度 ≤2048），验签/过期判定由 store `applyUnlockToken` 承担；
 * 非法形态静默回退 null（控制台零错误口径）。
 */
function parseToken(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '' || trimmed.length > TOKEN_PARAM_MAX_LENGTH) return null;
  return trimmed.startsWith('SO1.') ? trimmed : null;
}

/**
 * 解析启动 URL 参数（纯函数）
 *
 * @param search `window.location.search`（含 `?` 前缀或裸查询串均可，空串安全）
 */
export function parseLaunchParams(search: string): LaunchParams {
  const params = new URLSearchParams(search);
  return {
    mode: parseMode(params.get('mode')),
    tour: parseTour(params.get('tour')),
    dwell: parseDwell(params.get('dwell')),
    body: parseBody(params.get('body')),
    logo: parseLogo(params.get('logo')),
    lang: parseLang(params.get('lang')),
    token: parseToken(params.get('token')),
    // dev 专用录制调参（recordingTuning.ts：生产构建恒默认值，零行为差异）
    rec: parseRecordingTuning(params),
  };
}
