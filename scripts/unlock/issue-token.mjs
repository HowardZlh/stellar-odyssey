#!/usr/bin/env node
/**
 * 人工签发 CLI 入口（REQUIREMENTS_UNLOCK.md §U4-3，微信/Ko-fi 人工兑换
 * SOP 用，见 docs/internal/UNLOCK_OPS.md）。纯逻辑在 issueTokenLib.mjs
 * （jest 直测），本文件只做 argv / 文件 IO / 打印。
 *
 * 运行要求：Node ≥ 22.18（默认 TypeScript 类型剥离；更旧的 22.6+ 需加
 * `--experimental-strip-types`）——共享模块为 .ts 单一事实源。
 *
 * 用法：
 *   node scripts/unlock/issue-token.mjs --gen-key [--force]
 *   node scripts/unlock/issue-token.mjs --tier week|month|year \
 *     [--months N] [--start 2026-08-12] [--ch wechat|kofi|afdian] [--key <路径>]
 *
 * 密钥安全（最高优先级）：私钥默认读写 secrets/unlock-ed25519-private.hex
 * （目录已 gitignore，与 src/data/unlockPublicKey.ts 登记的生产密钥对
 * 同路径），严禁移入任何会入库的路径。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_KEY_RELATIVE_PATH,
  genKeyPair,
  issueToken,
  parseArgs,
} from "./issueTokenLib.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_KEY_PATH = join(SCRIPT_DIR, DEFAULT_KEY_RELATIVE_PATH);

const USAGE = `用法：
  生成密钥对   node scripts/unlock/issue-token.mjs --gen-key [--force]
  签发 token   node scripts/unlock/issue-token.mjs --tier week|month|year \\
                 [--months N] [--start 2026-08-12] [--ch wechat|kofi|afdian] [--key <路径>]`;

function runGenKey(args) {
  const keyPath = args.keyPath ?? DEFAULT_KEY_PATH;
  if (existsSync(keyPath) && !args.force) {
    console.error(`私钥文件已存在：${keyPath}\n确认要覆盖请加 --force（旧私钥签发的 token 将无法用新公钥验签）。`);
    process.exit(1);
  }
  const { privateKeyHex, publicKeyHex } = genKeyPair();
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, `${privateKeyHex}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  console.log(`私钥已写入（严禁入库/外传）：${keyPath}`);
  console.log(`公钥 hex（两处消费）：${publicKeyHex}`);
  console.log("  1. 替换 src/data/unlockPublicKey.ts 的 UNLOCK_PUBLIC_KEY_HEX；");
  console.log("  2. Worker secret：npx wrangler secret put ED25519_PRIVATE_KEY");
  console.log("     （在 workers/unlock/ 目录执行，输入私钥 hex）。");
}

function runIssue(args) {
  const keyPath = args.keyPath ?? DEFAULT_KEY_PATH;
  if (!existsSync(keyPath)) {
    console.error(`私钥文件不存在：${keyPath}\n先执行 --gen-key 生成，或用 --key 指定路径。`);
    process.exit(1);
  }
  const privateKeyHex = readFileSync(keyPath, "utf8").trim();
  const nowSec = Math.floor(Date.now() / 1000);
  const { token, payload, url } = issueToken({
    tier: args.tier,
    months: args.months,
    startSec: args.startSec,
    nowSec,
    privateKeyHex,
    ch: args.ch,
  });
  console.log(`档位：${payload.tier}${payload.tier === "month" ? ` × ${args.months} 月` : ""}（渠道 ${payload.ch}）`);
  console.log(`到期：${new Date(payload.exp * 1000).toISOString()}`);
  console.log(`token：\n${token}`);
  console.log(`直达链接：\n${url}`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "gen-key") {
    runGenKey(args);
  } else {
    runIssue(args);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error(USAGE);
  process.exit(1);
}
