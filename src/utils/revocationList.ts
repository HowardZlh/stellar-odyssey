/**
 * token 吊销名单纯逻辑（A6-1，REQUIREMENTS_UNLOCK.md §A6 / §0.15 冻结契约）
 *
 * 消毒/判定单点纪律（remoteGateConfig 同款）：本模块为吊销名单的**唯一**
 * 消毒与判定实现，前端（store 核对）/ 管理台（Node 直 import）/ Worker
 * 测试三端共享——Worker 本体对 KV `revoke:list` 原样透传不消毒，禁止在
 * 任何一端复制逻辑副本。
 *
 * 环境无关纪律（硬约束）：被 Worker（refundSync 自动吊销分支）经相对
 * 路径 import 复用，禁止 React/浏览器/Node 专属 API；sha256 取自
 * `@noble/hashes/sha2.js`（unlockToken 已引入同包 sha512，零新依赖）。
 *
 * 吊销标识 = sha256(完整 token 字符串) hex 64 位小写（裁决 ②）：
 * 已发 v1 token 全部可吊销、token 格式零变更；哈希不可逆，名单本身
 * 不泄露 token。
 */
import { sha256 } from "@noble/hashes/sha2.js";

// 相对路径 import（勿改为 `@/` 别名）：Worker 侧 wrangler 打包不识别
// tsconfig paths，共享模块链路必须保持相对路径可解析。
import { bytesToHex, utf8Encode } from "./unlockToken";

/** 吊销名单条目（§0.15 冻结 schema） */
export interface RevocationEntry {
  /** sha256(完整 token) hex 64 位小写——唯一去重键 */
  readonly h: string;
  /** 被吊销 token 的 expSec（自然到期后条目可清理，名单防膨胀） */
  readonly exp: number;
  /** 吊销时刻 ISO */
  readonly at: string;
  /** 'refund' | 'manual' | 自由文本 */
  readonly reason?: string;
}

/** 吊销名单（KV `revoke:list` 单键 JSON，§0.15 冻结 schema） */
export interface RevocationListV1 {
  readonly v: 1;
  readonly entries: readonly RevocationEntry[];
}

/** 空名单（消毒回退值；每次新建实例，防共享可变引用） */
export function emptyRevocationList(): RevocationListV1 {
  return { v: 1, entries: [] };
}

/** token 哈希形状（sha256 hex 64 位小写，条目级消毒依据） */
const HASH_RE = /^[0-9a-f]{64}$/;

/** 普通对象判定（排除 null / 数组 / 原始值） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 条目级消毒：字段非法 → null（丢弃该条）；reason 非字符串 → 略去该字段 */
function sanitizeEntry(raw: unknown): RevocationEntry | null {
  if (!isPlainObject(raw)) return null;
  const { h, exp, at, reason } = raw;
  if (typeof h !== "string" || !HASH_RE.test(h)) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (typeof at !== "string") return null;
  return {
    h,
    exp,
    at,
    ...(typeof reason === "string" ? { reason } : {}),
  };
}

/**
 * 名单消毒（unknown → 契约类型，永不抛异常）：
 * - 形状不符（非对象 / v ≠ 1 / entries 非数组）→ `{ v: 1, entries: [] }`；
 * - 条目级非法（缺字段/类型不符/哈希形状不符）→ 丢弃该条保留其余；
 * - 同哈希重复条目按首现去重（登记：h 为唯一去重键，§0.15）。
 */
export function sanitizeRevocationList(raw: unknown): RevocationListV1 {
  if (!isPlainObject(raw) || raw.v !== 1 || !Array.isArray(raw.entries)) {
    return emptyRevocationList();
  }
  const entries: RevocationEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw.entries) {
    const entry = sanitizeEntry(item);
    if (entry === null || seen.has(entry.h)) continue;
    seen.add(entry.h);
    entries.push(entry);
  }
  return { v: 1, entries };
}

/** 名单命中判定（前端三 action / 管理台共用；空名单恒 false） */
export function revocationHit(
  list: RevocationListV1,
  tokenHash: string,
): boolean {
  return list.entries.some((entry) => entry.h === tokenHash);
}

/**
 * 过期条目清理（名单防膨胀，管理台「清理过期条目」按钮消费）：
 * 边界口径登记：`exp <= nowSec` 即清理（**含端点**）——与 verifyToken
 * 的过期判定 `exp <= nowSec` 同口径（该时刻 token 本身已过期免费态，
 * 吊销条目失去意义）。
 */
export function prunedRevocationList(
  list: RevocationListV1,
  nowSec: number,
): RevocationListV1 {
  return { v: 1, entries: list.entries.filter((entry) => entry.exp > nowSec) };
}

/** token → 吊销标识哈希（sha256(完整 token 字符串) hex 64 位小写，裁决 ②） */
export function unlockTokenHash(token: string): string {
  return bytesToHex(sha256(utf8Encode(token)));
}
