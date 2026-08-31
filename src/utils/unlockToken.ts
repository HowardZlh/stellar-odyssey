/**
 * 解锁 token 编解码与 Ed25519 验签（U1-2，REQUIREMENTS_UNLOCK.md §U1-2 / §0.5）
 *
 * token 格式（§0.5 冻结契约，版本前缀 `SO1`）：
 *   `SO1.<base64url(payload JSON)>.<base64url(Ed25519 签名)>`
 *   payload = `{ v: 1, tier, exp, iat, ch }`（exp/iat 为 epoch 秒）
 *   签名覆盖 `SO1.<payload段>` 的 UTF-8 字节串。
 *
 * Ed25519 选型登记（§U1-2 二选一）：采用 `@noble/ed25519` v3（纯 JS 零传递
 * 依赖，~4KB）+ `@noble/hashes` 注入同步 sha512——不依赖 WebCrypto，
 * 浏览器 / Cloudflare Worker / jest 三端行为一致，无特性检测负担。
 * （jest 侧经 next.config.mjs `transpilePackages` 放行两个纯 ESM 包。）
 *
 * 环境无关纪律（硬约束）：本模块被 Worker 经相对路径 import 复用，
 * 禁止 React/浏览器/Node 专属 API——base64url / UTF-8 / hex 均自实现
 * 纯函数（严禁 Buffer / TextEncoder 依赖）。
 *
 * 已知弱门登记（§0.3 安全底线）：exp 校验依赖调用方时钟（`nowSec`），
 * 用户把系统时钟回拨到 exp 之前即可让过期 token 复活——接受（付费物为
 * 功能非内容，密码学防绕过不适用，见 §0.6）。
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

// 相对路径 import（勿改为 `@/` 别名）：Worker 侧 wrangler 打包不识别
// tsconfig paths，共享模块链路必须保持相对路径可解析。
import type { UnlockTier } from "../data/unlockPricing";

// noble v3 同步 API（sign/verify/getPublicKey）需一次性注入 sha512 实现
ed.hashes.sha512 = sha512;

/** token 版本前缀（§0.5 冻结） */
export const UNLOCK_TOKEN_PREFIX = "SO1";

/** 支付渠道（payload `ch` 字段取值，§0.5 冻结；Z 迭代 M2 增 'alipay'，D-z3；
 * 面包多集成增 'mbd'——mbd.pub 商店订单号自动兑换渠道） */
export const UNLOCK_CHANNELS = [
  "afdian",
  "wechat",
  "kofi",
  "alipay",
  "mbd",
] as const;
export type UnlockChannel = (typeof UNLOCK_CHANNELS)[number];

/** token payload（§0.5 冻结契约） */
export interface UnlockTokenPayload {
  /** 契约版本（当前恒为 1） */
  readonly v: 1;
  readonly tier: UnlockTier;
  /** 过期时刻（epoch 秒） */
  readonly exp: number;
  /** 签发时刻（epoch 秒） */
  readonly iat: number;
  readonly ch: UnlockChannel;
}

/** verifyToken 判定结果（reason 供 U2 区分提示文案） */
export type VerifyTokenResult =
  | { readonly ok: true; readonly payload: UnlockTokenPayload }
  | { readonly ok: false; readonly reason: "format" | "signature" | "expired" };

// ---------------------------------------------------------------------------
// 编解码纯函数（自实现，环境无关）
// ---------------------------------------------------------------------------

/** base64url 字母表（RFC 4648 §5，无 padding） */
const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 字符串 → UTF-8 字节（自实现，替代 TextEncoder） */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i) as number;
    if (cp > 0xffff) i++; // 增补平面字符占两个 code unit（代理对）
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(
        0xe0 | (cp >> 12),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** UTF-8 字节 → 字符串（防御式：非法序列返回 null，不抛异常） */
export function utf8Decode(bytes: Uint8Array): string | null {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
      continue;
    }
    let extra: number;
    let cp: number;
    if ((b0 & 0xe0) === 0xc0) {
      extra = 1;
      cp = b0 & 0x1f;
    } else if ((b0 & 0xf0) === 0xe0) {
      extra = 2;
      cp = b0 & 0x0f;
    } else if ((b0 & 0xf8) === 0xf0) {
      extra = 3;
      cp = b0 & 0x07;
    } else {
      return null; // 孤立续字节或非法首字节
    }
    if (i + extra >= bytes.length) return null; // 截断的多字节序列
    for (let k = 1; k <= extra; k++) {
      const bk = bytes[i + k];
      if ((bk & 0xc0) !== 0x80) return null; // 非法续字节
      cp = (cp << 6) | (bk & 0x3f);
    }
    if (cp > 0x10ffff) return null;
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

/** 字节 → base64url（无 padding） */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 0x3f];
  }
  return out;
}

/** base64url → 字节（防御式：非法字符/非法长度/尾部脏位返回 null） */
export function base64UrlToBytes(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null; // base64 不存在 4n+1 长度
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const chr of text) {
    const v = B64URL.indexOf(chr);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  if ((buffer & ((1 << bits) - 1)) !== 0) return null; // 规范编码尾部残余位必须为 0
  return Uint8Array.from(out);
}

/** hex 字符串 → 字节（防御式：奇数长度/非法字符返回 null） */
export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 字节 → hex 字符串（公钥常量内嵌/测试闭环用） */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

// ---------------------------------------------------------------------------
// token 编解码与验签
// ---------------------------------------------------------------------------

/**
 * payload → 签名输入段 `SO1.<base64url(payload JSON)>`（签名恰覆盖此串的
 * UTF-8 字节，§0.5）；字段序列化顺序固定（v/tier/exp/iat/ch），确保确定性。
 */
export function encodeTokenPayload(payload: UnlockTokenPayload): string {
  const json = JSON.stringify({
    v: payload.v,
    tier: payload.tier,
    exp: payload.exp,
    iat: payload.iat,
    ch: payload.ch,
  });
  return `${UNLOCK_TOKEN_PREFIX}.${bytesToBase64Url(utf8Encode(json))}`;
}

/**
 * 签发完整 token（U4 Worker/CLI 签发侧共享入口；私钥由调用方持有，
 * 本模块不存储任何密钥材料）。
 */
export function signToken(
  payload: UnlockTokenPayload,
  privateKey: Uint8Array,
): string {
  const signingInput = encodeTokenPayload(payload);
  const sig = ed.sign(utf8Encode(signingInput), privateKey);
  return `${signingInput}.${bytesToBase64Url(sig)}`;
}

/** payload 字段校验（unknown → 契约类型；任何偏差返回 null） */
function validatePayload(raw: unknown): UnlockTokenPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.v !== 1) return null;
  const tier = rec.tier;
  if (tier !== "week" && tier !== "month" && tier !== "year") return null;
  const { exp, iat } = rec;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
  const ch = rec.ch;
  if (!UNLOCK_CHANNELS.includes(ch as UnlockChannel)) return null;
  return { v: 1, tier, exp, iat, ch: ch as UnlockChannel };
}

/**
 * token 字符串 → payload（仅格式/字段校验，不验签名不验过期）；
 * 任何格式错误返回 null，保证不抛未捕获异常。
 */
export function parseToken(token: string): UnlockTokenPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== UNLOCK_TOKEN_PREFIX) return null;
  if (parts[1] === "" || parts[2] === "") return null;
  const payloadBytes = base64UrlToBytes(parts[1]);
  if (payloadBytes === null) return null;
  const json = utf8Decode(payloadBytes);
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return validatePayload(raw);
}

/**
 * 完整验证（签名 + exp 双验，§U1-2）：
 * - 格式/字段错 → `{ ok: false, reason: 'format' }`
 * - 签名不匹配（含篡改/公钥不符/非法公钥） → `reason: 'signature'`
 * - 签名有效但 `exp ≤ nowSec` → `reason: 'expired'`
 *
 * 时钟回拨绕过接受（弱门，见文件头登记）：nowSec 由调用方时钟提供，
 * 回拨即可让过期 token 重新通过——不做服务端校时。
 */
export function verifyToken(
  token: string,
  publicKeyHex: string,
  nowSec: number,
): VerifyTokenResult {
  const payload = parseToken(token);
  if (payload === null) return { ok: false, reason: "format" };
  const parts = token.split(".");
  const sig = base64UrlToBytes(parts[2]);
  if (sig === null) return { ok: false, reason: "format" };
  const pub = hexToBytes(publicKeyHex);
  if (pub === null) return { ok: false, reason: "signature" };
  const message = utf8Encode(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try {
    valid = ed.verify(sig, message, pub);
  } catch {
    valid = false; // noble 对非法长度签名/公钥可能抛错：一律判签名无效
  }
  if (!valid) return { ok: false, reason: "signature" };
  if (payload.exp <= nowSec) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

/**
 * 权益剩余天数（UI 展示用）：向上取整（剩 1 秒也显示 1 天）；
 * 已过期或非法输入返回 0（不产生负数/NaN）。
 */
export function tokenRemainingDays(exp: number, nowSec: number): number {
  if (!Number.isFinite(exp) || !Number.isFinite(nowSec)) return 0;
  const remainingSec = exp - nowSec;
  if (remainingSec <= 0) return 0;
  return Math.ceil(remainingSec / 86_400);
}
