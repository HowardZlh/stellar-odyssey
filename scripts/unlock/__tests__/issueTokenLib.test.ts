/**
 * @jest-environment node
 *
 * U4-3 人工签发 CLI 纯逻辑测试（REQUIREMENTS_UNLOCK.md §U4 验收）：
 * --gen-key 产物验签互通（与前端 verifyToken 同模块闭环）；
 * --tier 三档 token 可被 U1 verifyToken 通过；参数解析全分支。
 * （文件 IO/argv 壳层 issue-token.mjs 不在覆盖范围，仅本地手动冒烟。）
 */
import * as ed from "@noble/ed25519";

import {
  bytesToHex,
  hexToBytes,
  verifyToken,
} from "../../../src/utils/unlockToken";
import {
  computeDurationDays,
  DEFAULT_KEY_RELATIVE_PATH,
  genKeyPair,
  issueToken,
  parseArgs,
  UNLOCK_URL_BASE,
} from "../issueTokenLib.mjs";

const TEST_PRIVATE_KEY_HEX = bytesToHex(
  Uint8Array.from({ length: 32 }, (_, i) => i + 1),
);
const TEST_PUBLIC_KEY_HEX = bytesToHex(
  ed.getPublicKey(hexToBytes(TEST_PRIVATE_KEY_HEX) as Uint8Array),
);
const NOW_SEC = 1_755_000_000;

describe("parseArgs", () => {
  it("--gen-key / --force", () => {
    expect(parseArgs(["--gen-key"])).toMatchObject({
      mode: "gen-key",
      force: false,
    });
    expect(parseArgs(["--gen-key", "--force"])).toMatchObject({
      mode: "gen-key",
      force: true,
    });
  });

  it("签发默认值：months 1、ch wechat、key 缺省", () => {
    expect(parseArgs(["--tier", "week"])).toEqual({
      mode: "issue",
      tier: "week",
      months: 1,
      startSec: null,
      ch: "wechat",
      keyPath: null,
      force: false,
    });
  });

  it("月卡多月 + 起始日 + 渠道 + 私钥路径", () => {
    const args = parseArgs([
      "--tier",
      "month",
      "--months",
      "2",
      "--start",
      "2026-08-12",
      "--ch",
      "kofi",
      "--key",
      "/tmp/k.key",
    ]);
    expect(args).toMatchObject({
      tier: "month",
      months: 2,
      startSec: Math.floor(Date.parse("2026-08-12") / 1000),
      ch: "kofi",
      keyPath: "/tmp/k.key",
    });
  });

  it.each([
    ["未知参数", ["--wat"]],
    ["非法档位", ["--tier", "vip"]],
    ["缺 --tier", []],
    ["months 为 0", ["--tier", "month", "--months", "0"]],
    ["months 非整数", ["--tier", "month", "--months", "1.5"]],
    ["months 用于非月卡", ["--tier", "week", "--months", "2"]],
    ["start 非法", ["--tier", "week", "--start", "not-a-date"]],
    ["ch 非法", ["--tier", "week", "--ch", "paypal"]],
  ])("非法输入（%s）抛中文错误", (_l, argv) => {
    expect(() => parseArgs(argv as string[])).toThrow();
  });
});

describe("computeDurationDays（单一事实源 UNLOCK_TIERS）", () => {
  it.each([
    ["week", 1, 7],
    ["month", 1, 31],
    ["month", 2, 62],
    ["year", 1, 366],
  ])("%s × %i 月 → %i 天", (tier, months, days) => {
    expect(computeDurationDays(tier, months)).toBe(days);
  });
});

describe("issueToken 三档签发 × U1 verifyToken 互通", () => {
  it.each([
    ["week", 1, 7],
    ["month", 2, 62],
    ["year", 1, 366],
  ])("--tier %s（months=%i）→ %i 天，前端验签通过", (tier, months, days) => {
    const startSec = NOW_SEC - 3600;
    const { token, payload, url, publicKeyHex } = issueToken({
      tier,
      months,
      startSec,
      nowSec: NOW_SEC,
      privateKeyHex: TEST_PRIVATE_KEY_HEX,
    });
    expect(publicKeyHex).toBe(TEST_PUBLIC_KEY_HEX);
    expect(payload).toEqual({
      v: 1,
      tier,
      exp: startSec + days * 86_400,
      iat: NOW_SEC,
      ch: "wechat",
    });
    expect(url).toBe(`${UNLOCK_URL_BASE}?token=${token}`);
    expect(verifyToken(token, TEST_PUBLIC_KEY_HEX, NOW_SEC)).toEqual({
      ok: true,
      payload,
    });
  });

  it("--start 缺省时以 nowSec 起算；--ch 透传 payload", () => {
    const { payload } = issueToken({
      tier: "week",
      nowSec: NOW_SEC,
      startSec: null,
      privateKeyHex: TEST_PRIVATE_KEY_HEX,
      ch: "kofi",
    });
    expect(payload.exp).toBe(NOW_SEC + 7 * 86_400);
    expect(payload.ch).toBe("kofi");
  });

  it("私钥 hex 非法（非 hex / 长度不符）抛错", () => {
    expect(() =>
      issueToken({
        tier: "week",
        nowSec: NOW_SEC,
        startSec: null,
        privateKeyHex: "zz",
      }),
    ).toThrow();
    expect(() =>
      issueToken({
        tier: "week",
        nowSec: NOW_SEC,
        startSec: null,
        privateKeyHex: "abcd",
      }),
    ).toThrow();
  });
});

describe("genKeyPair（--gen-key 产物互通）", () => {
  it("生成的密钥对签发 token 可被 verifyToken 验签，且两次生成不同", () => {
    const kp1 = genKeyPair();
    const kp2 = genKeyPair();
    expect(kp1.privateKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(kp1.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(kp1.privateKeyHex).not.toBe(kp2.privateKeyHex);

    const { token, payload } = issueToken({
      tier: "month",
      months: 1,
      startSec: NOW_SEC,
      nowSec: NOW_SEC,
      privateKeyHex: kp1.privateKeyHex,
    });
    expect(verifyToken(token, kp1.publicKeyHex, NOW_SEC)).toEqual({
      ok: true,
      payload,
    });
    // 换一把公钥必须验签失败（密钥轮换预案的行为基础）
    expect(verifyToken(token, kp2.publicKeyHex, NOW_SEC)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("默认私钥路径位于 gitignore 的 secrets/ 下（与 U3 生产密钥登记一致）", () => {
    expect(DEFAULT_KEY_RELATIVE_PATH).toBe(
      "../../secrets/unlock-ed25519-private.hex",
    );
  });
});
