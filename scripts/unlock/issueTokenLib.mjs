/**
 * 人工签发 CLI 纯逻辑（REQUIREMENTS_UNLOCK.md §U4-3）：参数解析 / 时长
 * 计算 / 密钥对生成 / token 签发，全部无副作用，jest 直测（验签互通
 * 断言经 U1 verifyToken 同模块闭环）。
 *
 * 文件 IO / argv / console 等副作用全在入口 `issue-token.mjs`。
 *
 * 单一事实源纪律：定价/天数 import 自 `src/data/unlockPricing.ts`，
 * 签发经 `src/utils/unlockToken.ts` 的 signToken——与 Worker/前端同一
 * 编码路径，禁止复制逻辑副本。显式 `.ts` 扩展名是 Node 类型剥离运行
 * （≥22.18 默认开启）的解析要求，勿省略。
 */
import * as ed from "@noble/ed25519";

import { UNLOCK_TIERS } from "../../src/data/unlockPricing.ts";
import {
  bytesToHex,
  hexToBytes,
  signToken,
  UNLOCK_CHANNELS,
} from "../../src/utils/unlockToken.ts";

/** 解锁页直达链接前缀（U3-3 `?token=` URL 注入激活） */
export const UNLOCK_URL_BASE = "https://stellar.guushu.com/unlock";

/**
 * 私钥文件默认相对路径（相对 scripts/unlock/ → 仓库根 secrets/，
 * 目录已 gitignore；与 U3 生产密钥对生成登记的路径一致，
 * 见 src/data/unlockPublicKey.ts 文件头）
 */
export const DEFAULT_KEY_RELATIVE_PATH = "../../secrets/unlock-ed25519-private.hex";

const TIERS = Object.keys(UNLOCK_TIERS);

/**
 * argv → 结构化参数（非法输入抛 Error，消息为中文可读提示）。
 * 支持：--gen-key [--force] | --tier week|month|year [--months N]
 * [--start ISO] [--ch wechat|kofi|afdian] [--key <path>]
 */
export function parseArgs(argv) {
  const args = {
    mode: "issue",
    tier: null,
    months: 1,
    startSec: null,
    ch: "wechat",
    keyPath: null,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--gen-key":
        args.mode = "gen-key";
        break;
      case "--force":
        args.force = true;
        break;
      case "--tier": {
        const tier = argv[++i];
        if (!TIERS.includes(tier)) {
          throw new Error(`--tier 必须为 ${TIERS.join("|")}，收到：${tier}`);
        }
        args.tier = tier;
        break;
      }
      case "--months": {
        const months = Number(argv[++i]);
        if (!Number.isInteger(months) || months < 1) {
          throw new Error(`--months 必须为 ≥1 的整数，收到：${argv[i]}`);
        }
        args.months = months;
        break;
      }
      case "--start": {
        const ms = Date.parse(argv[++i]);
        if (Number.isNaN(ms)) {
          throw new Error(`--start 无法解析为日期（ISO 格式）：${argv[i]}`);
        }
        args.startSec = Math.floor(ms / 1000);
        break;
      }
      case "--ch": {
        const ch = argv[++i];
        if (!UNLOCK_CHANNELS.includes(ch)) {
          throw new Error(
            `--ch 必须为 ${UNLOCK_CHANNELS.join("|")}，收到：${ch}`,
          );
        }
        args.ch = ch;
        break;
      }
      case "--key":
        args.keyPath = argv[++i];
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }
  if (args.mode === "issue") {
    if (args.tier === null) {
      throw new Error("缺少 --tier（或使用 --gen-key 生成密钥对）。");
    }
    if (args.months !== 1 && args.tier !== "month") {
      throw new Error("--months 仅对 --tier month 有效。");
    }
  }
  return args;
}

/** 档位 → 权益天数（月卡按 31 × 月数，单一事实源取自 UNLOCK_TIERS） */
export function computeDurationDays(tier, months = 1) {
  if (tier === "month") return UNLOCK_TIERS.month.days * months;
  return UNLOCK_TIERS[tier].days;
}

/** 生成 Ed25519 密钥对（hex；私钥由入口落盘，本函数无副作用） */
export function genKeyPair() {
  const { secretKey, publicKey } = ed.keygen();
  return {
    privateKeyHex: bytesToHex(secretKey),
    publicKeyHex: bytesToHex(publicKey),
  };
}

/**
 * 签发 token（U1 signToken 同一编码路径）：
 * exp = startSec + 档位天数 × 86400；返回 token/payload/直达链接/公钥。
 */
export function issueToken({
  tier,
  months = 1,
  startSec,
  nowSec,
  privateKeyHex,
  ch = "wechat",
}) {
  const privateKey = hexToBytes(privateKeyHex.trim());
  if (privateKey === null || privateKey.length !== 32) {
    throw new Error("私钥文件内容不是 32 字节 hex，请检查（或 --gen-key 重新生成）。");
  }
  const start = startSec ?? nowSec;
  const exp = start + computeDurationDays(tier, months) * 86_400;
  const payload = { v: 1, tier, exp, iat: nowSec, ch };
  const token = signToken(payload, privateKey);
  return {
    token,
    payload,
    url: `${UNLOCK_URL_BASE}?token=${token}`,
    publicKeyHex: bytesToHex(ed.getPublicKey(privateKey)),
  };
}
