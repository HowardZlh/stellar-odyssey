/**
 * 吊销名单前端消费薄模块（A6-3，REQUIREMENTS_UNLOCK.md §A6-3 / §0.15）
 *
 * remoteGateConfigClient 完全同构：URL 解析复用 `REDEEM_API_DEFAULT_BASE`
 * 同基址 + 响应解析纯函数；fetch 编排本体在 useUnlockInit（IO 壳层）。
 *
 * 语义登记（缓存软化 fail-closed 与 gate-config 的差异，裁决 ④）：
 * - 响应形状不符（`ok !== true` / `list` 非普通对象，**含 not_configured**）
 *   → null——调用方按「拉取失败」处理（revocationFetchFailed），而非
 *   gate-config 的静默保持现值：not_configured 意味着无法核验凭证状态；
 * - 形状合法后 list 内容交消毒单点 `sanitizeRevocationList` 裁决
 *   （§0.15 纪律）：KV 无记录的 `{}` 消毒为空名单并**采用**（= 成功
 *   核验且无吊销记录）。
 */
import {
  sanitizeRevocationList,
  type RevocationListV1,
} from '@/utils/revocationList';
import { REDEEM_API_DEFAULT_BASE } from '@/utils/unlockRedeem';

/** Worker 吊销名单端点路径（§0.15 冻结契约） */
export const REVOCATIONS_API_PATH = '/api/revocations';

/**
 * 解析 revocations API 完整 URL（`resolveGateConfigApiUrl` 同范式、同基址）：
 * `base` 缺省/空白回退生产基址；尾部斜杠归一。
 */
export function resolveRevocationsApiUrl(baseOverride?: string | null): string {
  const trimmed = baseOverride?.trim() ?? '';
  const base =
    trimmed === '' ? REDEEM_API_DEFAULT_BASE : trimmed.replace(/\/+$/, '');
  return `${base}${REVOCATIONS_API_PATH}`;
}

/** 普通对象判定（排除 null / 数组 / 原始值） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `GET /api/revocations` 响应体解析（unknown → 消毒后名单）：
 * - `{ ok: true, list: <普通对象> }` → `sanitizeRevocationList(list)`
 *   （KV 无记录的 `{}` → 空名单 = 核验通过零吊销）；
 * - 其余一切（`ok:false` 含 not_configured / list 非对象 / 非对象响应）
 *   → null（调用方按拉取失败处理——fail-closed 口径）。
 */
export function parseRevocationsResponse(
  raw: unknown,
): RevocationListV1 | null {
  if (!isPlainObject(raw) || raw.ok !== true) return null;
  if (!isPlainObject(raw.list)) return null;
  return sanitizeRevocationList(raw.list);
}
