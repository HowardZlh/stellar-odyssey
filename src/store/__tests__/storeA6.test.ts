/**
 * Store A6 测试：token 吊销核对（REQUIREMENTS_UNLOCK.md §A6-3 / §0.15）
 * 1) 三 action 命中矩阵：restoreUnlockState / entitlementTick /
 *    applyUnlockToken（命中 → 清除 + entitlementRevoked + lockedHint）
 * 2) 缓存软化 fail-closed 四分支（裁决 ④）：成功比对 / 失败有缓存放行 /
 *    失败无缓存降免费态 + 网络提示 / tick 只比对缓存零请求
 * 3) 过期 token 短路不查名单；applyRevocationList 挂起恢复补跑与
 *    即时比对；核验失败态粘贴拒绝（unverified）
 *
 * 验签公钥注入沿用 storeU2 范式（测试密钥对，jest.mock 字面量公钥）。
 */
jest.mock("@/data/unlockPublicKey", () => ({
  __esModule: true,
  UNLOCK_PUBLIC_KEY_HEX:
    "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664",
}));

import { useSimulationStore } from "@/store";
import { FREE_DEMO_DAILY_LIMIT } from "@/utils/demoQuota";
import {
  emptyRevocationList,
  unlockTokenHash,
  type RevocationListV1,
} from "@/utils/revocationList";
import { signToken } from "@/utils/unlockToken";
import type { UnlockTokenPayload } from "@/utils/unlockToken";
import {
  REVOCATIONS_STORAGE_KEY,
  UNLOCK_TOKEN_STORAGE_KEY,
} from "@/utils/unlockStorage";

/** 测试专用固定私钥（仅测试代码，与生产无关；storeU2 同源） */
const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

const NOW_SEC = 1_785_000_000;

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

function revListFor(token: string, exp = NOW_SEC + 31 * 86_400): RevocationListV1 {
  return {
    v: 1,
    entries: [{ h: unlockTokenHash(token), exp, at: "2026-08-14T00:00:00Z", reason: "manual" }],
  };
}

function seedCachedList(list: RevocationListV1): void {
  window.localStorage.setItem(REVOCATIONS_STORAGE_KEY, JSON.stringify(list));
}

function resetStore(): void {
  useSimulationStore.setState({
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
}

beforeEach(resetStore);

describe("A6-3 restoreUnlockState 吊销核对（缓存软化时序）", () => {
  it("有缓存名单未命中 → 同步比对零等待恢复权益", () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    seedCachedList(emptyRevocationList());
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    const state = useSimulationStore.getState();
    expect(state.entitlement).not.toBeNull();
    expect(state.entitlementTokenHash).toBe(unlockTokenHash(token));
    expect(state.revocationListReady).toBe(true);
    expect(state.revocationCheckPending).toBe(false);
  });

  it("有缓存名单命中 → 清除本地 token + 免费态 + 命中提示（裁决 ⑤ 落点）", () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    seedCachedList(revListFor(token));
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    const state = useSimulationStore.getState();
    expect(state.entitlement).toBeNull();
    expect(state.entitlementRevoked).toBe(true);
    expect(state.lockedHint).toEqual({ context: "revoked", bodyId: null });
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("无缓存名单 → 权益暂不恢复（挂起，fail-closed）", () => {
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, makeToken());
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    const state = useSimulationStore.getState();
    expect(state.entitlement).toBeNull();
    expect(state.revocationCheckPending).toBe(true);
    // token 存值保留（拉取成功后补恢复）
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).not.toBeNull();
  });

  it("过期 token 短路：清存值且不置挂起（无缓存名单也不挂起）", () => {
    window.localStorage.setItem(
      UNLOCK_TOKEN_STORAGE_KEY,
      makeToken({ exp: NOW_SEC - 1 }),
    );
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    expect(useSimulationStore.getState().revocationCheckPending).toBe(false);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("垃圾缓存名单：消毒为空名单照常恢复（行为与空名单全等）", () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    window.localStorage.setItem(
      REVOCATIONS_STORAGE_KEY,
      JSON.stringify({ v: 99, entries: "junk" }),
    );
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    expect(useSimulationStore.getState().entitlement).not.toBeNull();
    expect(useSimulationStore.getState().revocationList).toEqual(
      emptyRevocationList(),
    );
  });
});

describe("A6-3 applyRevocationList（拉取成功两路）", () => {
  it("挂起恢复补跑：未命中 → 权益补恢复", () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    expect(useSimulationStore.getState().revocationCheckPending).toBe(true);
    useSimulationStore
      .getState()
      .applyRevocationList(emptyRevocationList(), NOW_SEC);
    const state = useSimulationStore.getState();
    expect(state.entitlement).toEqual({
      tier: "month",
      expSec: NOW_SEC + 31 * 86_400,
    });
    expect(state.revocationCheckPending).toBe(false);
    expect(state.revocationCheckFailed).toBe(false);
  });

  it("挂起恢复补跑：命中 → 清除 token + 命中提示", () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    useSimulationStore.getState().applyRevocationList(revListFor(token), NOW_SEC);
    const state = useSimulationStore.getState();
    expect(state.entitlement).toBeNull();
    expect(state.entitlementRevoked).toBe(true);
    expect(state.lockedHint).toEqual({ context: "revoked", bodyId: null });
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("已激活权益即时比对：新名单命中当场吊销（不等 30s tick）", () => {
    const token = makeToken();
    useSimulationStore.getState().applyUnlockToken(token, NOW_SEC);
    expect(useSimulationStore.getState().entitlement).not.toBeNull();
    useSimulationStore.getState().applyRevocationList(revListFor(token), NOW_SEC);
    const state = useSimulationStore.getState();
    expect(state.entitlement).toBeNull();
    expect(state.entitlementRevoked).toBe(true);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("形状不符入参：消毒为空名单（挂起 token 照常补恢复）", () => {
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, makeToken());
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    useSimulationStore.getState().applyRevocationList("garbage", NOW_SEC);
    expect(useSimulationStore.getState().entitlement).not.toBeNull();
  });

  it("挂起补跑时存值已失效（被清/过期）→ 保持免费态", () => {
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, makeToken());
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    window.localStorage.removeItem(UNLOCK_TOKEN_STORAGE_KEY);
    useSimulationStore
      .getState()
      .applyRevocationList(emptyRevocationList(), NOW_SEC);
    expect(useSimulationStore.getState().entitlement).toBeNull();

    // 过期存值：补跑时验签失败 → 清存值
    resetStore();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, makeToken());
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    window.localStorage.setItem(
      UNLOCK_TOKEN_STORAGE_KEY,
      makeToken({ exp: NOW_SEC - 1 }),
    );
    useSimulationStore
      .getState()
      .applyRevocationList(emptyRevocationList(), NOW_SEC);
    expect(useSimulationStore.getState().entitlement).toBeNull();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe("A6-3 revocationFetchFailed（缓存软化 fail-closed 分支）", () => {
  it("失败 + 有缓存：已凭缓存放行的权益保持（静默，不误伤离线设备）", () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    seedCachedList(emptyRevocationList());
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    useSimulationStore.getState().revocationFetchFailed();
    const state = useSimulationStore.getState();
    expect(state.entitlement).not.toBeNull();
    expect(state.revocationCheckFailed).toBe(false);
  });

  it("失败 + 无缓存（挂起中）：降免费态 + 网络提示态", () => {
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, makeToken());
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    useSimulationStore.getState().revocationFetchFailed();
    const state = useSimulationStore.getState();
    expect(state.entitlement).toBeNull();
    expect(state.revocationCheckPending).toBe(false);
    expect(state.revocationCheckFailed).toBe(true);
    // 缓存软化：token 存值保留（联网后刷新可恢复）
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).not.toBeNull();
  });

  it("失败 + 无缓存 + 无 token（无痕首次）：置核验失败态（粘贴被拒依据）", () => {
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    useSimulationStore.getState().revocationFetchFailed();
    expect(useSimulationStore.getState().revocationCheckFailed).toBe(true);
  });
});

describe("A6-3 applyUnlockToken 吊销核对", () => {
  it("命中会话名单 → reason 'revoked'（不激活不 persist）", () => {
    const token = makeToken();
    useSimulationStore.setState({ revocationList: revListFor(token) });
    const result = useSimulationStore.getState().applyUnlockToken(token, NOW_SEC);
    expect(result).toEqual({ ok: false, reason: "revoked" });
    expect(useSimulationStore.getState().entitlement).toBeNull();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("核验失败态 → reason 'unverified'（fail-closed 拒绝激活）", () => {
    useSimulationStore.setState({ revocationCheckFailed: true });
    const result = useSimulationStore
      .getState()
      .applyUnlockToken(makeToken(), NOW_SEC);
    expect(result).toEqual({ ok: false, reason: "unverified" });
    expect(useSimulationStore.getState().entitlement).toBeNull();
  });

  it("过期 token 短路（expired 先于名单核对，含已吊销的过期 token）", () => {
    const expired = makeToken({ exp: NOW_SEC - 1 });
    useSimulationStore.setState({
      revocationList: revListFor(expired, NOW_SEC - 1),
    });
    expect(
      useSimulationStore.getState().applyUnlockToken(expired, NOW_SEC),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("重新成功激活其他 token → entitlementRevoked 复位", () => {
    useSimulationStore.setState({ entitlementRevoked: true });
    const result = useSimulationStore
      .getState()
      .applyUnlockToken(makeToken(), NOW_SEC);
    expect(result.ok).toBe(true);
    expect(useSimulationStore.getState().entitlementRevoked).toBe(false);
  });
});

describe("A6-3 entitlementTick 吊销比对（零请求）", () => {
  it("tick 命中已缓存名单 → 降免费态 + 清 persist + 命中提示（不发请求）", () => {
    const token = makeToken();
    useSimulationStore.getState().applyUnlockToken(token, NOW_SEC);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    // 模拟会话中拉取到的新名单（applyRevocationList 之外的直写路径：
    // 仅为隔离验证 tick 自身比对逻辑）
    useSimulationStore.setState({ revocationList: revListFor(token) });
    useSimulationStore.getState().entitlementTick(NOW_SEC + 30);
    const state = useSimulationStore.getState();
    expect(state.entitlement).toBeNull();
    expect(state.entitlementRemainingDays).toBeNull();
    expect(state.entitlementTokenHash).toBeNull();
    expect(state.entitlementRevoked).toBe(true);
    expect(state.lockedHint).toEqual({ context: "revoked", bodyId: null });
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tick 未命中：权益保持（既有到期逻辑零变化）", () => {
    useSimulationStore.getState().applyUnlockToken(makeToken(), NOW_SEC);
    useSimulationStore.setState({
      revocationList: revListFor(makeToken({ tier: "week" })),
    });
    useSimulationStore.getState().entitlementTick(NOW_SEC + 30);
    expect(useSimulationStore.getState().entitlement).not.toBeNull();
    expect(useSimulationStore.getState().entitlementRevoked).toBe(false);
  });
});

describe("A6-3 clearEntitlement 复位吊销态", () => {
  it("清除权益同时复位 revoked/hash/pending", () => {
    useSimulationStore.getState().applyUnlockToken(makeToken(), NOW_SEC);
    useSimulationStore.setState({ entitlementRevoked: true });
    useSimulationStore.getState().clearEntitlement();
    const state = useSimulationStore.getState();
    expect(state.entitlement).toBeNull();
    expect(state.entitlementTokenHash).toBeNull();
    expect(state.entitlementRevoked).toBe(false);
  });
});
