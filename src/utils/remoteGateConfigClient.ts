/**
 * 远程门控配置前端消费薄模块（A3，REQUIREMENTS_UNLOCK.md §A3-1 / §0.11）
 *
 * 落点登记（§A3-1 二选一）：拉取纯逻辑不并入 A1 的 remoteGateConfig.ts
 * ——A1 模块保持环境无关纯函数（管理台 Node 直 import / Worker 测试共享），
 * 本模块为前端专属消费层（URL 解析 / 响应解析 / 白名单 Set 身份 memo /
 * observatory 兜底），fetch 编排本体在 useUnlockInit（IO 壳层，
 * Worker index.ts 薄壳同口径）。
 *
 * 语义登记：
 * - 响应形状不符（`ok !== true` / `config` 非普通对象，含 not_configured
 *   降级）→ null（调用方静默保持现值——缓存或内置默认，弱门口径不变）；
 * - 形状合法后 config 内容一律交消毒单点 `sanitizeRemoteGateConfig` 裁决
 *   （§0.11 纪律）：KV 无记录的 `{}` 与 `v ≠ 1` 均消毒为 `{ v: 1 }` 并
 *   **采用**（= 配置清空回落代码默认，删配置即回滚的运营语义）。
 */

import {
  activeRemoteFreeWindow,
  sanitizeRemoteGateConfig,
  type RemoteGateConfigV1,
  type RemoteObservatoryGateConfig,
} from '@/utils/remoteGateConfig';
import { REDEEM_API_DEFAULT_BASE } from '@/utils/unlockRedeem';
import type { ObservatoryGateConfig } from '@/data/observatoryGate';
import {
  observatoryFreeWindowActive,
  resolveObservatoryGateConfig,
} from '@/utils/observatoryGate';

/** Worker 门控配置端点路径（§0.11 冻结契约） */
export const GATE_CONFIG_API_PATH = '/api/gate-config';

/**
 * 解析 gate-config API 完整 URL（`resolveRedeemApiUrl` 同范式、同基址）：
 * `base` 缺省/空白回退生产基址；尾部斜杠归一。
 *
 * @param baseOverride 构建期 `NEXT_PUBLIC_UNLOCK_API_BASE`（调用方传入）
 */
export function resolveGateConfigApiUrl(baseOverride?: string | null): string {
  const trimmed = baseOverride?.trim() ?? '';
  const base =
    trimmed === '' ? REDEEM_API_DEFAULT_BASE : trimmed.replace(/\/+$/, '');
  return `${base}${GATE_CONFIG_API_PATH}`;
}

/** 普通对象判定（排除 null / 数组 / 原始值） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `GET /api/gate-config` 响应体解析（unknown → 消毒后配置）：
 * - `{ ok: true, config: <普通对象> }` → `sanitizeRemoteGateConfig(config)`；
 * - 其余一切（`ok:false` 含 not_configured / config 非对象 / 非对象响应）
 *   → null（调用方保持现值）。
 */
export function parseGateConfigResponse(
  raw: unknown,
): RemoteGateConfigV1 | null {
  if (!isPlainObject(raw) || raw.ok !== true) return null;
  if (!isPlainObject(raw.config)) return null;
  return sanitizeRemoteGateConfig(raw.config);
}

/** Set memo 缓存（按数组身份，配置仅经 applyRemoteGateConfig 低频更换） */
let cachedPremiumBodyIds: readonly string[] | undefined;
let cachedPremiumBodyIdSet: ReadonlySet<string> | undefined;

/**
 * detail.premiumBodyIds → ReadonlySet（useDetailLayer 帧循环消费）：
 * 按数组**身份** memo——配置未更换时逐帧返回同一 Set 实例，渲染循环
 * 零分配纪律保持；undefined（未配置）→ undefined（premiumGate 回退
 * 代码默认 22 项名单）。
 */
export function remotePremiumBodyIdSet(
  ids: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (ids === undefined) return undefined;
  if (ids !== cachedPremiumBodyIds) {
    cachedPremiumBodyIds = ids;
    cachedPremiumBodyIdSet = new Set(ids);
  }
  return cachedPremiumBodyIdSet;
}

/**
 * 观察站门控配置解析兜底（§A3-2 登记）：远程 observatory 域已经 A1 消毒
 * 保证与默认合并后合法，`resolveObservatoryGateConfig` 的 validate 抛错
 * 路径理论上不可达——try/catch 仅作防御兜底，异常时回落无参默认配置
 * 并 console.warn（行为与无配置全等）。
 */
export function resolveRemoteObservatoryGateConfig(
  override?: Partial<ObservatoryGateConfig>,
): ObservatoryGateConfig {
  try {
    return resolveObservatoryGateConfig(override);
  } catch {
    console.warn('[unlock] 远程观察站门控配置非法，回落代码默认值');
    return resolveObservatoryGateConfig();
  }
}

/**
 * 观察站排期折算解析（自动运营第2步）：在判定时刻把 `freeWindows`
 * 排期数组折算为生效 freeWindow——
 * 1. 先剥离 freeWindows（它不是 ObservatoryGateConfig 字段，不参与
 *    Partial 合并校验）走既有 resolveRemoteObservatoryGateConfig；
 * 2. 合并结果的单窗口已生效 → 原样返回（单窗口优先，管理台显式下发
 *    的窗口不被排期覆盖）；
 * 3. 否则排期数组有命中 → 以命中窗口替换 freeWindow（enabled 置 true，
 *    下游 observatoryFreeWindowActive / observatoryAccessUpdate 零改动
 *    即正确豁免计次）；无命中 → 原引用返回（memo 友好）。
 *
 * 调用点须在 effect / 事件时刻传入 nowMs（渲染纯度纪律：不在渲染期读钟）。
 */
export function resolveScheduledObservatoryGateConfig(
  override: RemoteObservatoryGateConfig | undefined,
  nowMs: number,
): ObservatoryGateConfig {
  let fields: Partial<ObservatoryGateConfig> | undefined;
  if (override !== undefined) {
    const { freeWindows: _freeWindows, ...rest } = override;
    fields = rest;
  }
  const base = resolveRemoteObservatoryGateConfig(fields);
  if (observatoryFreeWindowActive(base, nowMs)) return base;
  const active = activeRemoteFreeWindow(
    { freeWindows: override?.freeWindows },
    nowMs,
  );
  if (active === undefined) return base;
  return {
    ...base,
    freeWindow: {
      enabled: true,
      startUtc: active.startUtc,
      endUtc: active.endUtc,
    },
  };
}
