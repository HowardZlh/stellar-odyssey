/**
 * Store U2 测试：主应用门控接入（REQUIREMENTS_UNLOCK.md §U2）
 * 1) 权益写入/恢复/到期降级/清除（applyUnlockToken / restoreUnlockState /
 *    entitlementTick / clearEntitlement，localStorage persist 同步断言）
 * 2) 巡游 gate 分域矩阵（L1~L4 × 有/无权益）：L3/L4 无权益不切换 +
 *    巡游版锁定提示；L1/L2 恒不受影响
 * 3) 演示配额：无权益消耗（5 次 → 第 6 次拒绝 + 配额版提示）、有权益
 *    直通零消耗、跨自然日重置、persist
 * 4) lockedHint 节流：detail 同会话同天体一次；cycle/quota 不节流
 *
 * 验签公钥注入：jest.mock 换测试公钥（对应固定测试私钥 0x01..0x20，
 * 与 unlockU1.test.ts 同源；生产公钥不参与测试）。
 */

// 测试公钥 hex（对应私钥 Uint8Array 1..32；jest.mock 工厂 hoist，须用字面量）
jest.mock("@/data/unlockPublicKey", () => ({
  __esModule: true,
  UNLOCK_PUBLIC_KEY_HEX:
    "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664",
}));

import { useSimulationStore } from "@/store";
import { FREE_DEMO_DAILY_LIMIT, localDateKey } from "@/utils/demoQuota";
import { emptyRevocationList } from "@/utils/revocationList";
import { signToken } from "@/utils/unlockToken";
import type { UnlockTokenPayload } from "@/utils/unlockToken";
import {
  DEMO_QUOTA_STORAGE_KEY,
  REVOCATIONS_STORAGE_KEY,
  UNLOCK_TOKEN_STORAGE_KEY,
} from "@/utils/unlockStorage";

/** 测试专用固定私钥（仅测试代码，与生产无关） */
const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

const NOW_SEC = 1_785_000_000;
const NOW_MS = NOW_SEC * 1000;

function makeToken(overrides: Partial<UnlockTokenPayload> = {}): string {
  return signToken(
    {
      v: 1,
      tier: "month",
      exp: NOW_SEC + 31 * 86_400,
      iat: NOW_SEC,
      ch: "afdian",
      ...overrides,
    },
    TEST_PRIVATE_KEY,
  );
}

function resetStore(): void {
  useSimulationStore.setState({
    viewLevel: "L2",
    continuousLevel: 2,
    cycleScope: "solar",
    followBodyId: null,
    flyToBodyId: null,
    flyToRequestId: 0,
    anchorBodyId: "earth",
    galaxyAnchorBodyId: "sgr-a-star",
    universeAnchorBodyId: "m31",
    selectedBodyId: null,
    entitlement: null,
    demoQuota: null,
    lockedHint: null,
    lockedHintSeenBodyIds: [],
    demoRemainingToday: FREE_DEMO_DAILY_LIMIT,
    entitlementRemainingDays: null,
    entitlementTokenHash: null,
    entitlementRevoked: false,
    revocationCheckPending: false,
    revocationListReady: false,
    revocationCheckFailed: false,
    revocationList: emptyRevocationList(),
  });
  window.localStorage.clear();
  // A6：缓存空吊销名单——restore 走缓存软化同步比对路径（无缓存的
  // 挂起恢复分支由 storeA6.test 专测）
  window.localStorage.setItem(
    REVOCATIONS_STORAGE_KEY,
    JSON.stringify(emptyRevocationList()),
  );
}

describe("U2-1 权益写入/恢复/到期降级/清除", () => {
  beforeEach(resetStore);

  it("applyUnlockToken：合法 token → 权益写入 + persist", () => {
    const token = makeToken({ tier: "year", exp: NOW_SEC + 366 * 86_400 });
    const result = useSimulationStore
      .getState()
      .applyUnlockToken(token, NOW_SEC);
    expect(result.ok).toBe(true);
    expect(useSimulationStore.getState().entitlement).toEqual({
      tier: "year",
      expSec: NOW_SEC + 366 * 86_400,
    });
    // 派生字段（渲染纯度纪律：组件读此字段，不读时钟）
    expect(useSimulationStore.getState().entitlementRemainingDays).toBe(366);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBe(token);
  });

  it("applyUnlockToken：篡改/过期 token → 拒绝且不写入不 persist", () => {
    const forged = `${makeToken().slice(0, -4)}AAAA`;
    const forgedResult = useSimulationStore
      .getState()
      .applyUnlockToken(forged, NOW_SEC);
    expect(forgedResult.ok).toBe(false);
    const expired = makeToken({ exp: NOW_SEC - 1 });
    const expiredResult = useSimulationStore
      .getState()
      .applyUnlockToken(expired, NOW_SEC);
    expect(expiredResult).toEqual({ ok: false, reason: "expired" });
    expect(useSimulationStore.getState().entitlement).toBeNull();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("restoreUnlockState：存值合法 → 恢复权益与演示配额", () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    window.localStorage.setItem(
      DEMO_QUOTA_STORAGE_KEY,
      JSON.stringify({ dateKey: localDateKey(NOW_MS), used: 3 }),
    );
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    expect(useSimulationStore.getState().entitlement).toEqual({
      tier: "month",
      expSec: NOW_SEC + 31 * 86_400,
    });
    expect(useSimulationStore.getState().demoQuota).toEqual({
      dateKey: localDateKey(NOW_MS),
      used: 3,
    });
  });

  it("restoreUnlockState：过期/非法存值 → 保持免费态并清除存值", () => {
    window.localStorage.setItem(
      UNLOCK_TOKEN_STORAGE_KEY,
      makeToken({ exp: NOW_SEC - 1 }),
    );
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    expect(useSimulationStore.getState().entitlement).toBeNull();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();

    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, "garbage-token");
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    expect(useSimulationStore.getState().entitlement).toBeNull();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("entitlementTick：未到期保持，到期降级免费态 + 清 persist", () => {
    const token = makeToken();
    useSimulationStore.getState().applyUnlockToken(token, NOW_SEC);
    useSimulationStore.getState().entitlementTick(NOW_SEC + 86_400);
    expect(useSimulationStore.getState().entitlement).not.toBeNull();
    useSimulationStore.getState().entitlementTick(NOW_SEC + 32 * 86_400);
    expect(useSimulationStore.getState().entitlement).toBeNull();
    expect(useSimulationStore.getState().entitlementRemainingDays).toBeNull();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("entitlementTick：派生字段低频刷新（剩余天数递减 / 跨自然日配额恢复）", () => {
    useSimulationStore.getState().applyUnlockToken(makeToken(), NOW_SEC);
    expect(useSimulationStore.getState().entitlementRemainingDays).toBe(31);
    useSimulationStore.getState().entitlementTick(NOW_SEC + 86_400 + 1);
    expect(useSimulationStore.getState().entitlementRemainingDays).toBe(30);
    // 配额耗尽后跨自然日：tick 兜底刷新剩余次数（按钮解禁不等用户点击）
    useSimulationStore.setState({
      demoQuota: { dateKey: localDateKey(NOW_MS), used: FREE_DEMO_DAILY_LIMIT },
      demoRemainingToday: 0,
    });
    useSimulationStore.getState().entitlementTick(NOW_SEC + 2 * 86_400);
    expect(useSimulationStore.getState().demoRemainingToday).toBe(
      FREE_DEMO_DAILY_LIMIT,
    );
  });

  it("clearEntitlement：置空 + 清 persist", () => {
    useSimulationStore.getState().applyUnlockToken(makeToken(), NOW_SEC);
    useSimulationStore.getState().clearEntitlement();
    expect(useSimulationStore.getState().entitlement).toBeNull();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe("U2-3 巡游 gate 分域矩阵（L1~L4 × 有/无权益）", () => {
  beforeEach(resetStore);

  const grantEntitlement = (): void => {
    useSimulationStore.setState({
      entitlement: { tier: "month", expSec: NOW_SEC + 31 * 86_400 },
    });
  };

  it("L1 行星域：无权益照常切换（零变化）", () => {
    useSimulationStore.setState({
      cycleScope: "system",
      viewLevel: "L1",
      followBodyId: "earth",
      anchorBodyId: "earth",
    });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).not.toBe("earth");
    expect(useSimulationStore.getState().lockedHint).toBeNull();
  });

  it("L2 太阳系域：无权益照常切换（零变化）", () => {
    useSimulationStore.setState({
      followBodyId: "earth",
      anchorBodyId: "earth",
    });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().selectedBodyId).toBe("mars");
    expect(useSimulationStore.getState().lockedHint).toBeNull();
  });

  it.each([
    ["galaxy", "L3", "sgr-a-star"],
    ["universe", "L4", "m31"],
  ] as const)(
    "%s 域无权益：不切换 + 巡游版锁定提示（kiosk 复用同 action 同受限）",
    (scope, viewLevel, followId) => {
      useSimulationStore.setState({
        cycleScope: scope,
        viewLevel,
        followBodyId: followId,
        flyToRequestId: 0,
      });
      useSimulationStore.getState().cycleScopeBody(1);
      const state = useSimulationStore.getState();
      expect(state.followBodyId).toBe(followId); // 不切换
      expect(state.flyToRequestId).toBe(0); // 无运镜请求
      expect(state.lockedHint).toEqual({ context: "cycle", bodyId: null });
    },
  );

  it.each([
    ["galaxy", "L3", "sgr-a-star", "betelgeuse"],
    ["universe", "L4", "m31", "m33"],
  ] as const)(
    "%s 域有权益：照常切换（与现状一致）",
    (scope, viewLevel, followId, nextId) => {
      grantEntitlement();
      useSimulationStore.setState({
        cycleScope: scope,
        viewLevel,
        followBodyId: followId,
      });
      useSimulationStore.getState().cycleScopeBody(1);
      const state = useSimulationStore.getState();
      expect(state.followBodyId).toBe(nextId);
      expect(state.lockedHint).toBeNull();
    },
  );

  it("L3 未跟随（起始锚定路径）同样被 gate", () => {
    useSimulationStore.setState({ cycleScope: "galaxy", viewLevel: "L3" });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBeNull();
    expect(useSimulationStore.getState().lockedHint).toEqual({
      context: "cycle",
      bodyId: null,
    });
  });
});

describe("U2-3 演示配额（requestDemoEvent）", () => {
  beforeEach(resetStore);

  it("无权益：前 5 次放行并 persist，第 6 次拒绝 + 配额版提示", () => {
    const store = useSimulationStore.getState();
    for (let i = 1; i <= FREE_DEMO_DAILY_LIMIT; i++) {
      expect(store.requestDemoEvent(NOW_MS + i * 1000)).toBe(true);
      expect(useSimulationStore.getState().demoQuota?.used).toBe(i);
      expect(useSimulationStore.getState().demoRemainingToday).toBe(
        FREE_DEMO_DAILY_LIMIT - i,
      );
    }
    expect(store.requestDemoEvent(NOW_MS + 60_000)).toBe(false);
    expect(useSimulationStore.getState().lockedHint).toEqual({
      context: "quota",
      bodyId: null,
    });
    // persist 断言（薄封装写入）
    expect(
      JSON.parse(window.localStorage.getItem(DEMO_QUOTA_STORAGE_KEY) ?? "null"),
    ).toEqual({ dateKey: localDateKey(NOW_MS), used: FREE_DEMO_DAILY_LIMIT });
  });

  it("跨自然日重置：次日恢复放行", () => {
    useSimulationStore.setState({
      demoQuota: { dateKey: localDateKey(NOW_MS), used: FREE_DEMO_DAILY_LIMIT },
    });
    const nextDayMs = NOW_MS + 2 * 86_400_000;
    expect(useSimulationStore.getState().requestDemoEvent(nextDayMs)).toBe(
      true,
    );
    expect(useSimulationStore.getState().demoQuota).toEqual({
      dateKey: localDateKey(nextDayMs),
      used: 1,
    });
  });

  it("有权益：不限次且零消耗", () => {
    useSimulationStore.setState({
      entitlement: { tier: "week", expSec: NOW_SEC + 7 * 86_400 },
    });
    for (let i = 0; i < FREE_DEMO_DAILY_LIMIT + 3; i++) {
      expect(useSimulationStore.getState().requestDemoEvent(NOW_MS)).toBe(true);
    }
    expect(useSimulationStore.getState().demoQuota).toBeNull();
    expect(window.localStorage.getItem(DEMO_QUOTA_STORAGE_KEY)).toBeNull();
  });
});

describe("U2-2/U2-4 lockedHint 上报与节流", () => {
  beforeEach(resetStore);

  it("detail 场景：同会话同天体节流一次（关闭后不再重弹）", () => {
    const store = useSimulationStore.getState();
    store.reportLockedHint("detail", "m31");
    expect(useSimulationStore.getState().lockedHint).toEqual({
      context: "detail",
      bodyId: "m31",
    });
    useSimulationStore.getState().dismissLockedHint();
    store.reportLockedHint("detail", "m31"); // 同天体再报 → 节流
    expect(useSimulationStore.getState().lockedHint).toBeNull();
    store.reportLockedHint("detail", "betelgeuse"); // 新天体照常
    expect(useSimulationStore.getState().lockedHint).toEqual({
      context: "detail",
      bodyId: "betelgeuse",
    });
  });

  it("detail 场景 bodyId 为 null：不上报（防御）", () => {
    useSimulationStore.getState().reportLockedHint("detail", null);
    expect(useSimulationStore.getState().lockedHint).toBeNull();
  });

  it("cycle/quota 场景：不节流（显式操作反馈每次都弹）", () => {
    const store = useSimulationStore.getState();
    store.reportLockedHint("cycle", null);
    useSimulationStore.getState().dismissLockedHint();
    store.reportLockedHint("cycle", null);
    expect(useSimulationStore.getState().lockedHint).toEqual({
      context: "cycle",
      bodyId: null,
    });
    useSimulationStore.getState().dismissLockedHint();
    store.reportLockedHint("quota", null);
    expect(useSimulationStore.getState().lockedHint).toEqual({
      context: "quota",
      bodyId: null,
    });
  });
});
