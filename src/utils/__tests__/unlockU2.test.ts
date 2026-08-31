/**
 * U2 权益纯逻辑补充单测（REQUIREMENTS_UNLOCK.md §U2-2/U2-3）：
 * - premiumDetailGateUpdate：useDetailLayer 注入判定矩阵（白名单天体
 *   无权益强制 inactive + lockedHit；有权益/免费天体原样透传——
 *   heliopause 恒不受影响）
 * - demoQuotaRemaining：只读剩余次数（不消耗、跨日满额、脏数据消毒）
 * - parseLaunchParams `?token=`：形态过滤（SO1. 前缀 + 长度上限）
 */

import {
  FREE_DEMO_DAILY_LIMIT,
  demoQuotaRemaining,
  localDateKey,
} from "@/utils/demoQuota";
import {
  parseLaunchParams,
  TOKEN_PARAM_MAX_LENGTH,
} from "@/utils/launchParams";
import { premiumDetailGateUpdate } from "@/utils/premiumGate";
import type { UnlockEntitlement } from "@/utils/premiumGate";

const NOW_SEC = 1_785_000_000;
const VALID: UnlockEntitlement = { tier: "month", expSec: NOW_SEC + 1000 };
const EXPIRED: UnlockEntitlement = { tier: "year", expSec: NOW_SEC - 1 };

describe("premiumDetailGateUpdate（useDetailLayer 注入判定）", () => {
  it("白名单天体 + 无权益：原判定激活 → 强制 inactive + lockedHit", () => {
    expect(premiumDetailGateUpdate(true, null, "m31", NOW_SEC)).toEqual({
      active: false,
      lockedHit: true,
    });
    expect(
      premiumDetailGateUpdate(true, EXPIRED, "betelgeuse", NOW_SEC),
    ).toEqual({
      active: false,
      lockedHit: true,
    });
  });

  it("白名单天体 + 无权益：原判定未激活 → 透传 inactive 且无 lockedHit（未推近不提示）", () => {
    expect(premiumDetailGateUpdate(false, null, "m31", NOW_SEC)).toEqual({
      active: false,
      lockedHit: false,
    });
  });

  it("白名单天体 + 有效权益：原判定原样透传（现状零差异）", () => {
    expect(premiumDetailGateUpdate(true, VALID, "m31", NOW_SEC)).toEqual({
      active: true,
      lockedHit: false,
    });
    expect(
      premiumDetailGateUpdate(false, VALID, "ring-nebula", NOW_SEC),
    ).toEqual({
      active: false,
      lockedHit: false,
    });
  });

  it("heliopause（免费近观）恒不受影响：任何权益态原样透传", () => {
    for (const entitlement of [null, VALID, EXPIRED]) {
      expect(
        premiumDetailGateUpdate(true, entitlement, "heliopause", NOW_SEC),
      ).toEqual({
        active: true,
        lockedHit: false,
      });
      expect(
        premiumDetailGateUpdate(false, entitlement, "heliopause", NOW_SEC),
      ).toEqual({
        active: false,
        lockedHit: false,
      });
    }
  });
});

describe("demoQuotaRemaining（只读，不消耗）", () => {
  const DAY_NOON = new Date(2026, 7, 10, 12, 0, 0).getTime();

  it("null 状态 / 跨日：满额", () => {
    expect(demoQuotaRemaining(null, DAY_NOON)).toBe(FREE_DEMO_DAILY_LIMIT);
    expect(
      demoQuotaRemaining({ dateKey: "2026-08-09", used: 5 }, DAY_NOON),
    ).toBe(FREE_DEMO_DAILY_LIMIT);
  });

  it("同日按已用扣减，超用/脏数据不出负数", () => {
    const key = localDateKey(DAY_NOON);
    expect(demoQuotaRemaining({ dateKey: key, used: 2 }, DAY_NOON)).toBe(3);
    expect(demoQuotaRemaining({ dateKey: key, used: 5 }, DAY_NOON)).toBe(0);
    expect(demoQuotaRemaining({ dateKey: key, used: 99 }, DAY_NOON)).toBe(0);
    expect(
      demoQuotaRemaining({ dateKey: key, used: Number.NaN }, DAY_NOON),
    ).toBe(FREE_DEMO_DAILY_LIMIT);
  });

  it("nowMs 非有限数：沿用现状态 dateKey（与 demoQuotaUpdate 同口径）", () => {
    expect(
      demoQuotaRemaining({ dateKey: "2026-08-10", used: 4 }, Number.NaN),
    ).toBe(1);
  });
});

describe("parseLaunchParams ?token=（U2-1 形态过滤）", () => {
  it("SO1. 前缀合法 token 透传（验签由 store 承担）", () => {
    expect(parseLaunchParams("?token=SO1.abc.def").token).toBe("SO1.abc.def");
  });

  it("缺前缀/空白/超长 → null（其余参数不受影响）", () => {
    expect(parseLaunchParams("?token=xyz").token).toBeNull();
    expect(parseLaunchParams("?token=").token).toBeNull();
    expect(parseLaunchParams("").token).toBeNull();
    const huge = `SO1.${"a".repeat(TOKEN_PARAM_MAX_LENGTH)}`;
    expect(parseLaunchParams(`?token=${huge}`).token).toBeNull();
    expect(parseLaunchParams("?token=xyz&lang=en").lang).toBe("en");
  });
});
