/**
 * U1 权益纯逻辑层单测（REQUIREMENTS_UNLOCK.md §U1）：
 * - unlockPricing：三档定价常量 + resolveTierFromAmount 边界/多月/非法金额
 * - unlockToken：base64url/UTF-8/hex 编解码、签发→验签闭环、篡改/过期/
 *   格式错/版本不符各拒绝路径、时钟回拨弱门现状断言
 * - premiumGate：白名单收录/排除、与摘录来源一致性抽查、三态判定
 * - demoQuota：同日累计、跨自然日重置、时钟回拨防御（无负数/NaN）
 * - unlockStorage：localStorage 薄封装防御（JSON 脏数据/隐私模式异常）
 *
 * 密钥纪律：本文件内的 Ed25519 私钥为测试专用（固定字节，非生产密钥）。
 */
import * as ed from "@noble/ed25519";

import { UNLOCK_TIERS, resolveTierFromAmount } from "@/data/unlockPricing";
import { SPECIAL_BODIES } from "@/data/specialBodies";
import { ANTENNAE_BODY_ID } from "@/utils/antennaeNearView";
import { BLACK_HOLE_LENSED_CONFIGS } from "@/utils/blackHoleScene";
import {
  FREE_DEMO_DAILY_LIMIT,
  demoQuotaUpdate,
  localDateKey,
  type DemoQuotaState,
} from "@/utils/demoQuota";
import { GALAXY_NEAR_VIEW_CONFIGS } from "@/utils/galaxyNearView";
import { DUST_VOLUME_GALAXY_IDS } from "@/utils/galaxyDustVolume";
import { GRB_BODY_ID } from "@/utils/grbNearView";
import {
  PREMIUM_DETAIL_BODY_IDS,
  isPremiumDetailBody,
  premiumGateAllows,
  type UnlockEntitlement,
} from "@/utils/premiumGate";
import { QUASAR_BODY_ID } from "@/utils/quasarNearView";
import {
  UNLOCK_TOKEN_PREFIX,
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToHex,
  encodeTokenPayload,
  hexToBytes,
  parseToken,
  signToken,
  tokenRemainingDays,
  utf8Decode,
  utf8Encode,
  verifyToken,
  type UnlockTokenPayload,
} from "@/utils/unlockToken";
import {
  DEMO_QUOTA_STORAGE_KEY,
  UNLOCK_TOKEN_STORAGE_KEY,
  persistDemoQuota,
  persistUnlockToken,
  readStoredDemoQuota,
  readStoredUnlockToken,
} from "@/utils/unlockStorage";

// ---------------------------------------------------------------------------
// U1-1 定价档位
// ---------------------------------------------------------------------------

describe("UNLOCK_TIERS 定价单一事实源", () => {
  it("三档价格与时长与需求冻结值一致", () => {
    expect(UNLOCK_TIERS.week).toEqual({ priceCny: 6, priceUsd: 1, days: 7 });
    expect(UNLOCK_TIERS.month).toEqual({
      priceCny: 15,
      priceUsd: 2.5,
      days: 31,
    });
    expect(UNLOCK_TIERS.year).toEqual({
      priceCny: 88,
      priceUsd: 13,
      days: 366,
    });
  });
});

describe("resolveTierFromAmount 档位判定（§0.6 平移顺序）", () => {
  it("¥5.99 → null（不足周卡）", () => {
    expect(resolveTierFromAmount(5.99)).toBeNull();
  });

  it("¥6 → week 7 天（下界含）", () => {
    expect(resolveTierFromAmount(6)).toEqual({ tier: "week", days: 7 });
  });

  it("¥14.99 → week（未达月卡）", () => {
    expect(resolveTierFromAmount(14.99)).toEqual({ tier: "week", days: 7 });
  });

  it("¥15 → month 31 天（下界含）", () => {
    expect(resolveTierFromAmount(15)).toEqual({ tier: "month", days: 31 });
  });

  it("¥30 + months=2 → month 62 天（多月折算）", () => {
    expect(resolveTierFromAmount(30, 2)).toEqual({ tier: "month", days: 62 });
  });

  it("¥29.99 + months=2 → 未达两月月卡，落回 week", () => {
    expect(resolveTierFromAmount(29.99, 2)).toEqual({ tier: "week", days: 7 });
  });

  it("¥87.99 → month（未达年卡，月数 1）", () => {
    expect(resolveTierFromAmount(87.99)).toEqual({ tier: "month", days: 31 });
  });

  it("¥88 → year 366 天（下界含；即使 months 很大也先判年卡）", () => {
    expect(resolveTierFromAmount(88)).toEqual({ tier: "year", days: 366 });
    expect(resolveTierFromAmount(88, 12)).toEqual({ tier: "year", days: 366 });
  });

  it("负数 → null", () => {
    expect(resolveTierFromAmount(-1)).toBeNull();
  });

  it("NaN / Infinity 金额 → null（非有限数一律非法）", () => {
    expect(resolveTierFromAmount(Number.NaN)).toBeNull();
    expect(resolveTierFromAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("非法 months（NaN/0/负数/小数）防御回退", () => {
    expect(resolveTierFromAmount(15, Number.NaN)).toEqual({
      tier: "month",
      days: 31,
    });
    expect(resolveTierFromAmount(15, 0)).toEqual({ tier: "month", days: 31 });
    expect(resolveTierFromAmount(15, -3)).toEqual({ tier: "month", days: 31 });
    // 小数月取整：2.9 → 2 个月
    expect(resolveTierFromAmount(30, 2.9)).toEqual({ tier: "month", days: 62 });
  });
});

// ---------------------------------------------------------------------------
// U1-2 编解码纯函数
// ---------------------------------------------------------------------------

describe("base64url / UTF-8 / hex 编解码（自实现纯函数）", () => {
  it("base64url 各余数长度往返一致", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 32, 64]) {
      const bytes = Uint8Array.from(
        { length: len },
        (_, i) => (i * 37 + len) % 256,
      );
      const encoded = bytesToBase64Url(bytes);
      expect(encoded).not.toMatch(/[+/=]/); // URL 安全无 padding
      expect(base64UrlToBytes(encoded)).toEqual(bytes);
    }
  });

  it("base64url 解码拒绝非法输入（不抛异常）", () => {
    expect(base64UrlToBytes("a")).toBeNull(); // 4n+1 长度不存在
    expect(base64UrlToBytes("ab+c")).toBeNull(); // 标准 base64 '+' 非法
    expect(base64UrlToBytes("ab=c")).toBeNull(); // padding 非法
    expect(base64UrlToBytes("中文")).toBeNull();
    expect(base64UrlToBytes("AA")).toEqual(Uint8Array.from([0])); // 规范 4n+2
    expect(base64UrlToBytes("_w")).toEqual(Uint8Array.from([0xff])); // '_' 属字母表
    expect(base64UrlToBytes("a9")).toBeNull(); // 尾部残余位非 0（非规范编码）
    expect(base64UrlToBytes("ab")).toBeNull(); // 同上
  });

  it("UTF-8 往返：ASCII / 中文 / emoji（增补平面代理对）", () => {
    for (const text of [
      "",
      "hello SO1",
      "星系运动",
      "🌌🚀",
      "mixé\u00df\u6f22🛰",
    ]) {
      const bytes = utf8Encode(text);
      expect(utf8Decode(bytes)).toBe(text);
    }
  });

  it("UTF-8 解码拒绝非法序列（返回 null 不抛）", () => {
    expect(utf8Decode(Uint8Array.from([0x80]))).toBeNull(); // 孤立续字节
    expect(utf8Decode(Uint8Array.from([0xff, 0xff]))).toBeNull(); // 非法首字节
    expect(utf8Decode(Uint8Array.from([0xe4, 0xb8]))).toBeNull(); // 截断三字节序列
    expect(utf8Decode(Uint8Array.from([0xc3, 0x28]))).toBeNull(); // 续字节非法
  });

  it("hex 往返与非法输入", () => {
    const bytes = Uint8Array.from([0, 1, 0x7f, 0x80, 0xff]);
    const hex = bytesToHex(bytes);
    expect(hex).toBe("00017f80ff");
    expect(hexToBytes(hex)).toEqual(bytes);
    expect(hexToBytes(hex.toUpperCase())).toEqual(bytes);
    expect(hexToBytes("abc")).toBeNull(); // 奇数长度
    expect(hexToBytes("zz")).toBeNull(); // 非法字符
    expect(hexToBytes("")).toEqual(new Uint8Array(0));
  });
});

// ---------------------------------------------------------------------------
// U1-2 token 签发→验签闭环与拒绝路径
// ---------------------------------------------------------------------------

/** 测试专用固定私钥（仅存在于测试代码，与生产无关） */
const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const TEST_PUBLIC_KEY_HEX = bytesToHex(ed.getPublicKey(TEST_PRIVATE_KEY));

const NOW_SEC = 1_785_000_000; // 2026-07 附近的 epoch 秒基准

function makePayload(
  overrides: Partial<UnlockTokenPayload> = {},
): UnlockTokenPayload {
  return {
    v: 1,
    tier: "month",
    exp: NOW_SEC + 31 * 86_400,
    iat: NOW_SEC,
    ch: "afdian",
    ...overrides,
  };
}

/** 用任意 JSON 对象构造签名合法但字段非法的 token（走真实签名路径） */
function signRawPayload(raw: unknown): string {
  const payloadPart = bytesToBase64Url(utf8Encode(JSON.stringify(raw)));
  const signingInput = `${UNLOCK_TOKEN_PREFIX}.${payloadPart}`;
  const sig = ed.sign(utf8Encode(signingInput), TEST_PRIVATE_KEY);
  return `${signingInput}.${bytesToBase64Url(sig)}`;
}

describe("encodeTokenPayload / parseToken", () => {
  it("编码产物为 SO1.<base64url> 且可解析还原", () => {
    const payload = makePayload();
    const encoded = encodeTokenPayload(payload);
    expect(encoded.startsWith("SO1.")).toBe(true);
    const token = signToken(payload, TEST_PRIVATE_KEY);
    expect(parseToken(token)).toEqual(payload);
  });

  it("parseToken 拒绝各类格式错误（一律 null 不抛）", () => {
    expect(parseToken("")).toBeNull();
    expect(parseToken("SO1")).toBeNull(); // 段数不足
    expect(parseToken("SO1.abcd")).toBeNull();
    expect(parseToken("SO1.a.b.c")).toBeNull(); // 段数过多
    expect(parseToken("SO2.abcd.abcd")).toBeNull(); // 版本前缀不符
    expect(parseToken("SO1..abcd")).toBeNull(); // 空 payload 段
    expect(parseToken("SO1.abcd.")).toBeNull(); // 空签名段
    expect(parseToken("SO1.!!!!.abcd")).toBeNull(); // payload 非 base64url
    // payload 是合法 base64url 但不是 JSON
    expect(
      parseToken(`SO1.${bytesToBase64Url(utf8Encode("not json"))}.abcd`),
    ).toBeNull();
    // payload 是 JSON 但非对象
    expect(
      parseToken(`SO1.${bytesToBase64Url(utf8Encode("42"))}.abcd`),
    ).toBeNull();
    expect(
      parseToken(`SO1.${bytesToBase64Url(utf8Encode("null"))}.abcd`),
    ).toBeNull();
  });

  it("parseToken 拒绝字段缺失/取值非法（v/tier/exp/iat/ch 逐项）", () => {
    const base = makePayload() as unknown as Record<string, unknown>;
    const omit = (key: string): Record<string, unknown> => {
      const copy = { ...base };
      delete copy[key];
      return copy;
    };
    const cases: unknown[] = [
      { ...base, v: 2 }, // 版本非 1
      omit("v"), // 缺 v
      { ...base, tier: "day" }, // 非法档位
      { ...base, tier: 7 },
      { ...base, exp: "tomorrow" }, // exp 非数字
      { ...base, exp: Number.NaN }, // JSON 序列化为 null
      omit("exp"), // 缺 exp
      { ...base, iat: null },
      { ...base, ch: "paypal" }, // 非法渠道
      omit("ch"), // 缺 ch
    ];
    for (const raw of cases) {
      expect(parseToken(signRawPayload(raw))).toBeNull();
    }
  });
});

describe("verifyToken 签名 + exp 双验", () => {
  it("合法 token 通过并返回 payload", () => {
    const payload = makePayload();
    const token = signToken(payload, TEST_PRIVATE_KEY);
    expect(verifyToken(token, TEST_PUBLIC_KEY_HEX, NOW_SEC)).toEqual({
      ok: true,
      payload,
    });
  });

  it("三档 tier 与五渠道 ch 全组合均可闭环（M2 增 alipay，面包多集成增 mbd）", () => {
    for (const tier of ["week", "month", "year"] as const) {
      for (const ch of ["afdian", "wechat", "kofi", "alipay", "mbd"] as const) {
        const token = signToken(makePayload({ tier, ch }), TEST_PRIVATE_KEY);
        expect(verifyToken(token, TEST_PUBLIC_KEY_HEX, NOW_SEC).ok).toBe(true);
      }
    }
  });

  it("篡改 payload（换档位重编码）→ signature 拒绝", () => {
    const token = signToken(makePayload({ tier: "week" }), TEST_PRIVATE_KEY);
    const parts = token.split(".");
    const forgedPayload = bytesToBase64Url(
      utf8Encode(JSON.stringify(makePayload({ tier: "year" }))),
    );
    const forged = `${parts[0]}.${forgedPayload}.${parts[2]}`;
    expect(verifyToken(forged, TEST_PUBLIC_KEY_HEX, NOW_SEC)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("篡改签名段 → signature 拒绝（含长度非法签名不抛异常）", () => {
    const token = signToken(makePayload(), TEST_PRIVATE_KEY);
    const parts = token.split(".");
    // 翻转签名首字符
    const flipped = parts[2].startsWith("A")
      ? `B${parts[2].slice(1)}`
      : `A${parts[2].slice(1)}`;
    expect(
      verifyToken(
        `${parts[0]}.${parts[1]}.${flipped}`,
        TEST_PUBLIC_KEY_HEX,
        NOW_SEC,
      ),
    ).toEqual({ ok: false, reason: "signature" });
    // 签名长度非法（noble 抛错路径被捕获）
    expect(
      verifyToken(`${parts[0]}.${parts[1]}.abcd`, TEST_PUBLIC_KEY_HEX, NOW_SEC),
    ).toEqual({
      ok: false,
      reason: "signature",
    });
    // 签名段非 base64url → format
    expect(
      verifyToken(`${parts[0]}.${parts[1]}.!!!!`, TEST_PUBLIC_KEY_HEX, NOW_SEC),
    ).toEqual({
      ok: false,
      reason: "format",
    });
  });

  it("错误公钥 / 非法公钥 hex → signature 拒绝", () => {
    const token = signToken(makePayload(), TEST_PRIVATE_KEY);
    const otherPub = bytesToHex(
      ed.getPublicKey(Uint8Array.from({ length: 32 }, () => 9)),
    );
    expect(verifyToken(token, otherPub, NOW_SEC)).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(verifyToken(token, "zz-not-hex", NOW_SEC)).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(verifyToken(token, "abcd", NOW_SEC)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("过期 token → expired（exp === nowSec 视为已过期）", () => {
    const payload = makePayload({ exp: NOW_SEC - 1 });
    const token = signToken(payload, TEST_PRIVATE_KEY);
    expect(verifyToken(token, TEST_PUBLIC_KEY_HEX, NOW_SEC)).toEqual({
      ok: false,
      reason: "expired",
    });
    const edge = signToken(makePayload({ exp: NOW_SEC }), TEST_PRIVATE_KEY);
    expect(verifyToken(edge, TEST_PUBLIC_KEY_HEX, NOW_SEC)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("格式错 token → format（复用 parseToken 拒绝路径）", () => {
    expect(verifyToken("garbage", TEST_PUBLIC_KEY_HEX, NOW_SEC)).toEqual({
      ok: false,
      reason: "format",
    });
    expect(verifyToken("SO2.abcd.abcd", TEST_PUBLIC_KEY_HEX, NOW_SEC)).toEqual({
      ok: false,
      reason: "format",
    });
  });

  it("【已知弱门登记】时钟回拨绕过成立：过期 token 在回拨后的 nowSec 下重新通过", () => {
    // 断言现状（§U1-2 弱门定位）：exp 校验完全信任调用方时钟，
    // 系统时钟回拨到 exp 之前即可让过期 token 复活——接受，不做防御。
    const payload = makePayload({ exp: NOW_SEC - 86_400 }); // 一天前已过期
    const token = signToken(payload, TEST_PRIVATE_KEY);
    expect(verifyToken(token, TEST_PUBLIC_KEY_HEX, NOW_SEC).ok).toBe(false);
    const rolledBackNow = NOW_SEC - 2 * 86_400; // 时钟回拨两天
    expect(verifyToken(token, TEST_PUBLIC_KEY_HEX, rolledBackNow).ok).toBe(
      true,
    );
  });
});

describe("tokenRemainingDays", () => {
  it("剩余天数向上取整；已过期/非法输入返回 0", () => {
    expect(tokenRemainingDays(NOW_SEC + 86_400, NOW_SEC)).toBe(1);
    expect(tokenRemainingDays(NOW_SEC + 86_401, NOW_SEC)).toBe(2);
    expect(tokenRemainingDays(NOW_SEC + 1, NOW_SEC)).toBe(1);
    expect(tokenRemainingDays(NOW_SEC, NOW_SEC)).toBe(0);
    expect(tokenRemainingDays(NOW_SEC - 5, NOW_SEC)).toBe(0);
    expect(tokenRemainingDays(Number.NaN, NOW_SEC)).toBe(0);
    expect(tokenRemainingDays(NOW_SEC, Number.NaN)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// U1-3 付费天体白名单
// ---------------------------------------------------------------------------

describe("PREMIUM_DETAIL_BODY_IDS 白名单", () => {
  it("heliopause（免费近观）不在名单；L1/L2 常规天体不在名单", () => {
    expect(PREMIUM_DETAIL_BODY_IDS.has("heliopause")).toBe(false);
    for (const freeId of ["earth", "moon", "sun", "jupiter", "iss", "halley"]) {
      expect(isPremiumDetailBody(freeId)).toBe(false);
    }
  });

  it("无 useDetailLayer 消费方的 cluster-lensing 不在名单", () => {
    expect(PREMIUM_DETAIL_BODY_IDS.has("cluster-lensing")).toBe(false);
  });

  it("名单共 24 项（盘点登记数）", () => {
    expect(PREMIUM_DETAIL_BODY_IDS.size).toBe(24);
  });

  it("与摘录来源一致性抽查：河外近观常量 / 黑洞透镜配置键", () => {
    expect(isPremiumDetailBody(QUASAR_BODY_ID)).toBe(true);
    expect(isPremiumDetailBody(ANTENNAE_BODY_ID)).toBe(true);
    expect(isPremiumDetailBody(GRB_BODY_ID)).toBe(true);
    for (const id of Object.keys(BLACK_HOLE_LENSED_CONFIGS)) {
      expect(isPremiumDetailBody(id)).toBe(true);
    }
  });

  it("与摘录来源一致性抽查：星系近观配置全 8 项 + 尘埃体积层子集", () => {
    const galaxyIds = Object.keys(GALAXY_NEAR_VIEW_CONFIGS);
    expect(galaxyIds).toHaveLength(8);
    for (const id of galaxyIds) {
      expect(isPremiumDetailBody(id)).toBe(true);
    }
    for (const id of DUST_VOLUME_GALAXY_IDS) {
      expect(isPremiumDetailBody(id)).toBe(true);
    }
  });

  it("与摘录来源一致性抽查：挂近观细节层的特殊天体 id 全在名单", () => {
    const nearViewSpecialIds = [
      "betelgeuse",
      "rigel",
      "sirius",
      "delta-cephei",
      "wr-124",
      "crab-pulsar",
      "orion-nebula",
      "ring-nebula",
      "horsehead-nebula",
      "m13-cluster",
      "sgr-a-star",
      "cygnus-x1",
      "pleiades",
    ];
    const allSpecialIds = new Set(SPECIAL_BODIES.map((b) => b.id));
    for (const id of nearViewSpecialIds) {
      expect(allSpecialIds.has(id)).toBe(true); // 摘录 id 确实存在于数据源
      expect(isPremiumDetailBody(id)).toBe(true);
    }
  });
});

describe("premiumGateAllows 三态判定", () => {
  const valid: UnlockEntitlement = { tier: "month", expSec: NOW_SEC + 1000 };
  const expired: UnlockEntitlement = { tier: "year", expSec: NOW_SEC - 1 };

  it("有效权益：付费天体放行", () => {
    expect(premiumGateAllows(valid, "m31", NOW_SEC)).toBe(true);
    expect(premiumGateAllows(valid, "sgr-a-star", NOW_SEC)).toBe(true);
  });

  it("过期/无权益：付费天体拒绝（expSec === nowSec 视为过期）", () => {
    expect(premiumGateAllows(expired, "m31", NOW_SEC)).toBe(false);
    expect(premiumGateAllows(null, "m31", NOW_SEC)).toBe(false);
    expect(
      premiumGateAllows({ tier: "week", expSec: NOW_SEC }, "m31", NOW_SEC),
    ).toBe(false);
    expect(
      premiumGateAllows({ tier: "week", expSec: Number.NaN }, "m31", NOW_SEC),
    ).toBe(false);
  });

  it("免费天体：无论权益状态一律放行", () => {
    expect(premiumGateAllows(null, "heliopause", NOW_SEC)).toBe(true);
    expect(premiumGateAllows(expired, "earth", NOW_SEC)).toBe(true);
    expect(premiumGateAllows(valid, "heliopause", NOW_SEC)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// U1-4 每日限次
// ---------------------------------------------------------------------------

describe("demoQuotaUpdate 每日限次", () => {
  // 用本地时区正午构造时间戳，避免时区边界干扰
  const DAY1_NOON = new Date(2026, 7, 10, 12, 0, 0).getTime();
  const DAY2_NOON = new Date(2026, 7, 11, 12, 0, 0).getTime();

  it("常量登记：每日限次为 5", () => {
    expect(FREE_DEMO_DAILY_LIMIT).toBe(5);
  });

  it("localDateKey 输出本地自然日 YYYY-MM-DD", () => {
    expect(localDateKey(DAY1_NOON)).toBe("2026-08-10");
  });

  it("同日累计：前 5 次放行，第 6 次拒绝且计数不再增长", () => {
    let state: DemoQuotaState | null = null;
    for (let i = 1; i <= FREE_DEMO_DAILY_LIMIT; i++) {
      const result = demoQuotaUpdate(state, DAY1_NOON + i * 60_000);
      expect(result.allowed).toBe(true);
      expect(result.state.used).toBe(i);
      expect(result.remaining).toBe(FREE_DEMO_DAILY_LIMIT - i);
      state = result.state;
    }
    const denied = demoQuotaUpdate(state, DAY1_NOON + 3_600_000);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.state.used).toBe(FREE_DEMO_DAILY_LIMIT);
    // 继续尝试也不增长
    expect(
      demoQuotaUpdate(denied.state, DAY1_NOON + 3_700_000).state.used,
    ).toBe(FREE_DEMO_DAILY_LIMIT);
  });

  it("跨自然日重置：次日首个请求重新放行且计数归 1", () => {
    const exhausted: DemoQuotaState = {
      dateKey: localDateKey(DAY1_NOON),
      used: 5,
    };
    const result = demoQuotaUpdate(exhausted, DAY2_NOON);
    expect(result.allowed).toBe(true);
    expect(result.state).toEqual({ dateKey: "2026-08-11", used: 1 });
    expect(result.remaining).toBe(FREE_DEMO_DAILY_LIMIT - 1);
  });

  it("时钟回拨到前一日：dateKey 不匹配触发重置（弱门接受），输出无负数/NaN", () => {
    const day2State: DemoQuotaState = {
      dateKey: localDateKey(DAY2_NOON),
      used: 5,
    };
    const rolledBack = demoQuotaUpdate(day2State, DAY1_NOON);
    expect(rolledBack.allowed).toBe(true);
    expect(rolledBack.state.used).toBe(1);
    expect(rolledBack.remaining).toBeGreaterThanOrEqual(0);
  });

  it("脏数据防御：used 为负数/NaN/小数时消毒，不产生负 remaining", () => {
    for (const dirty of [-3, Number.NaN, 2.7]) {
      const result = demoQuotaUpdate(
        { dateKey: localDateKey(DAY1_NOON), used: dirty },
        DAY1_NOON,
      );
      expect(Number.isFinite(result.state.used)).toBe(true);
      expect(result.state.used).toBeGreaterThanOrEqual(1);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    }
  });

  it("nowMs 非有限数（异常时钟）：沿用现状态 dateKey，不产生 NaN 日键", () => {
    const state: DemoQuotaState = { dateKey: "2026-08-10", used: 2 };
    const result = demoQuotaUpdate(state, Number.NaN);
    expect(result.state.dateKey).toBe("2026-08-10");
    expect(result.state.used).toBe(3);
    // 无状态 + 异常时钟：回退 epoch 0 日键（仍为合法 YYYY-MM-DD 形态）
    const fresh = demoQuotaUpdate(null, Number.NaN);
    expect(fresh.state.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fresh.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// U1-4 localStorage 持久层
// ---------------------------------------------------------------------------

describe("unlockStorage localStorage 薄封装", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("键名沿用 stellar-odyssey: 前缀先例", () => {
    expect(UNLOCK_TOKEN_STORAGE_KEY).toBe("stellar-odyssey:unlockToken");
    expect(DEMO_QUOTA_STORAGE_KEY).toBe("stellar-odyssey:demoQuota");
  });

  it("token 写入→读回→null 清除", () => {
    expect(readStoredUnlockToken()).toBeNull();
    persistUnlockToken("SO1.abc.def");
    expect(readStoredUnlockToken()).toBe("SO1.abc.def");
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBe(
      "SO1.abc.def",
    );
    persistUnlockToken(null);
    expect(readStoredUnlockToken()).toBeNull();
  });

  it("demoQuota 写入→读回（JSON 往返）", () => {
    expect(readStoredDemoQuota()).toBeNull();
    persistDemoQuota({ dateKey: "2026-08-12", used: 3 });
    expect(readStoredDemoQuota()).toEqual({ dateKey: "2026-08-12", used: 3 });
  });

  it("demoQuota 脏数据防御：非 JSON/非对象/形状不符一律 null", () => {
    const cases = [
      "not json",
      "42",
      "null",
      "[]",
      '{"dateKey":7,"used":1}',
      '{"dateKey":"2026-08-12"}',
      '{"dateKey":"2026-08-12","used":"three"}',
      '{"dateKey":"2026-08-12","used":null}',
    ];
    for (const raw of cases) {
      window.localStorage.setItem(DEMO_QUOTA_STORAGE_KEY, raw);
      expect(readStoredDemoQuota()).toBeNull();
    }
    // NaN 经 JSON.stringify 变 null 已被上例覆盖；Infinity 同理
  });

  it("隐私模式异常防御：getItem/setItem 抛错时读 null、写静默", () => {
    const getSpy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    const setSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const removeSpy = jest
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    try {
      expect(readStoredUnlockToken()).toBeNull();
      expect(readStoredDemoQuota()).toBeNull();
      expect(() => persistUnlockToken("SO1.a.b")).not.toThrow();
      expect(() => persistUnlockToken(null)).not.toThrow();
      expect(() =>
        persistDemoQuota({ dateKey: "2026-08-12", used: 1 }),
      ).not.toThrow();
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
