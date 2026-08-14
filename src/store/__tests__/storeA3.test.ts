/**
 * Store A3 测试：远程门控配置接入（REQUIREMENTS_UNLOCK.md §A3-2）
 * 1) applyRemoteGateConfig：unknown 入参消毒单点写入 + 派生字段重算
 *    （demoRemainingToday 注入远程 dailyLimit / 两个限免窗口布尔）
 * 2) 演示矩阵：demo.freeWindow 开/关 × 有/无权益（期内放行不计次、
 *    期外回落既有 gate、权益态恒不受影响）+ dailyLimit 覆盖生效
 * 3) 巡游矩阵：tour.freeWindow 开/关 × 有/无权益 × L1~L4 域
 * 4) entitlementTick / restoreUnlockState 的远程 limit 注入与窗口跨界刷新
 *
 * 窗口常量登记：OPEN 取 2000–2100（同时覆盖测试注入时钟 NOW_MS 与
 * cycleScopeBody 的真实 Date.now()——该 action 无 now 参数，见 store 登记）。
 */

import { useSimulationStore } from '@/store';
import { FREE_DEMO_DAILY_LIMIT, localDateKey } from '@/utils/demoQuota';
import type { RemoteFreeWindow } from '@/utils/remoteGateConfig';
import { DEMO_QUOTA_STORAGE_KEY } from '@/utils/unlockStorage';

const NOW_SEC = 1_785_000_000;
const NOW_MS = NOW_SEC * 1000;

/** 生效窗口（覆盖 NOW_MS 与真实时钟） */
const WINDOW_OPEN: RemoteFreeWindow = {
  enabled: true,
  startUtc: '2000-01-01T00:00:00Z',
  endUtc: '2100-01-01T00:00:00Z',
};

/** 已过期窗口 */
const WINDOW_PAST: RemoteFreeWindow = {
  enabled: true,
  startUtc: '2000-01-01T00:00:00Z',
  endUtc: '2001-01-01T00:00:00Z',
};

/** 关闭开关的窗口（日期合法） */
const WINDOW_DISABLED: RemoteFreeWindow = { ...WINDOW_OPEN, enabled: false };

function resetStore(): void {
  useSimulationStore.setState({
    viewLevel: 'L2',
    continuousLevel: 2,
    cycleScope: 'solar',
    followBodyId: null,
    flyToBodyId: null,
    flyToRequestId: 0,
    anchorBodyId: 'earth',
    galaxyAnchorBodyId: 'sgr-a-star',
    universeAnchorBodyId: 'm31',
    selectedBodyId: null,
    entitlement: null,
    demoQuota: null,
    lockedHint: null,
    lockedHintSeenBodyIds: [],
    demoRemainingToday: FREE_DEMO_DAILY_LIMIT,
    entitlementRemainingDays: null,
    remoteGateConfig: { v: 1 },
    remoteTourFreeActive: false,
    remoteDemoFreeActive: false,
  });
  window.localStorage.clear();
}

const grantEntitlement = (): void => {
  useSimulationStore.setState({
    entitlement: { tier: 'month', expSec: NOW_SEC + 31 * 86_400 },
  });
};

describe('A3-2 applyRemoteGateConfig（消毒单点写入 + 派生重算）', () => {
  beforeEach(resetStore);

  it.each([['junk'], [null], [42], [{ v: 2, demo: { dailyLimit: 3 } }]])(
    '垃圾输入 %p → 空配置 { v: 1 }（行为与无配置全等）',
    (raw) => {
      useSimulationStore.getState().applyRemoteGateConfig(raw, NOW_MS);
      const state = useSimulationStore.getState();
      expect(state.remoteGateConfig).toEqual({ v: 1 });
      expect(state.remoteTourFreeActive).toBe(false);
      expect(state.remoteDemoFreeActive).toBe(false);
      expect(state.demoRemainingToday).toBe(FREE_DEMO_DAILY_LIMIT);
    },
  );

  it('远程 dailyLimit 覆盖 → demoRemainingToday 按已用次数重算；清配置回落默认', () => {
    useSimulationStore.setState({
      demoQuota: { dateKey: localDateKey(NOW_MS), used: 3 },
      demoRemainingToday: FREE_DEMO_DAILY_LIMIT - 3,
    });
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, demo: { dailyLimit: 10 } }, NOW_MS);
    expect(useSimulationStore.getState().demoRemainingToday).toBe(7);
    // 删配置（KV 清空 → 空配置）→ 回落代码默认 5-3=2
    useSimulationStore.getState().applyRemoteGateConfig({ v: 1 }, NOW_MS);
    expect(useSimulationStore.getState().demoRemainingToday).toBe(2);
  });

  it('域内非法字段细粒度丢弃（dailyLimit=-1 → 域省略，remaining 用默认）', () => {
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, demo: { dailyLimit: -1 } }, NOW_MS);
    const state = useSimulationStore.getState();
    expect(state.remoteGateConfig).toEqual({ v: 1 });
    expect(state.demoRemainingToday).toBe(FREE_DEMO_DAILY_LIMIT);
  });

  it('派生布尔：OPEN 窗口 → true；PAST/DISABLED → false', () => {
    useSimulationStore.getState().applyRemoteGateConfig(
      {
        v: 1,
        tour: { freeWindow: WINDOW_OPEN },
        demo: { freeWindow: WINDOW_OPEN },
      },
      NOW_MS,
    );
    expect(useSimulationStore.getState().remoteTourFreeActive).toBe(true);
    expect(useSimulationStore.getState().remoteDemoFreeActive).toBe(true);
    useSimulationStore.getState().applyRemoteGateConfig(
      {
        v: 1,
        tour: { freeWindow: WINDOW_PAST },
        demo: { freeWindow: WINDOW_DISABLED },
      },
      NOW_MS,
    );
    expect(useSimulationStore.getState().remoteTourFreeActive).toBe(false);
    expect(useSimulationStore.getState().remoteDemoFreeActive).toBe(false);
  });
});

describe('A3-2 演示矩阵（requestDemoEvent × demo 域配置）', () => {
  beforeEach(resetStore);

  it('限免期内免费态：放行不计次（配额/persist/剩余次数零触碰），配额尽仍放行', () => {
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, demo: { freeWindow: WINDOW_OPEN } }, NOW_MS);
    expect(useSimulationStore.getState().requestDemoEvent(NOW_MS)).toBe(true);
    expect(useSimulationStore.getState().demoQuota).toBeNull();
    expect(window.localStorage.getItem(DEMO_QUOTA_STORAGE_KEY)).toBeNull();
    expect(useSimulationStore.getState().demoRemainingToday).toBe(
      FREE_DEMO_DAILY_LIMIT,
    );
    // 配额已尽也放行（不计次口径 = 观察站免费期）
    useSimulationStore.setState({
      demoQuota: { dateKey: localDateKey(NOW_MS), used: FREE_DEMO_DAILY_LIMIT },
      demoRemainingToday: 0,
    });
    expect(useSimulationStore.getState().requestDemoEvent(NOW_MS)).toBe(true);
    expect(useSimulationStore.getState().lockedHint).toBeNull();
  });

  it('限免期外（PAST/DISABLED）：回落既有计次 gate', () => {
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, demo: { freeWindow: WINDOW_PAST } }, NOW_MS);
    expect(useSimulationStore.getState().requestDemoEvent(NOW_MS)).toBe(true);
    expect(useSimulationStore.getState().demoQuota?.used).toBe(1);
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, demo: { freeWindow: WINDOW_DISABLED } }, NOW_MS);
    expect(useSimulationStore.getState().requestDemoEvent(NOW_MS)).toBe(true);
    expect(useSimulationStore.getState().demoQuota?.used).toBe(2);
  });

  it('远程 dailyLimit=2：第 3 次拒绝 + 配额版提示 + 剩余归零', () => {
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, demo: { dailyLimit: 2 } }, NOW_MS);
    expect(useSimulationStore.getState().requestDemoEvent(NOW_MS)).toBe(true);
    expect(useSimulationStore.getState().demoRemainingToday).toBe(1);
    expect(useSimulationStore.getState().requestDemoEvent(NOW_MS + 1000)).toBe(true);
    expect(useSimulationStore.getState().requestDemoEvent(NOW_MS + 2000)).toBe(false);
    const state = useSimulationStore.getState();
    expect(state.demoRemainingToday).toBe(0);
    expect(state.lockedHint).toEqual({ context: 'quota', bodyId: null });
  });

  it('权益态：任意配置下恒放行零消耗（不受配置影响）', () => {
    grantEntitlement();
    useSimulationStore.getState().applyRemoteGateConfig(
      { v: 1, demo: { dailyLimit: 1, freeWindow: WINDOW_PAST } },
      NOW_MS,
    );
    for (let i = 0; i < 5; i++) {
      expect(useSimulationStore.getState().requestDemoEvent(NOW_MS)).toBe(true);
    }
    expect(useSimulationStore.getState().demoQuota).toBeNull();
  });
});

describe('A3-2 巡游矩阵（cycleScopeBody × tour 域配置）', () => {
  beforeEach(resetStore);

  it.each([
    ['galaxy', 'L3', 'sgr-a-star', 'betelgeuse'],
    ['universe', 'L4', 'm31', 'm33'],
  ] as const)(
    '%s 域免费态 + tour 限免期内：照常切换无锁定提示',
    (scope, viewLevel, followId, nextId) => {
      useSimulationStore
        .getState()
        .applyRemoteGateConfig({ v: 1, tour: { freeWindow: WINDOW_OPEN } });
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

  it.each([[WINDOW_PAST], [WINDOW_DISABLED]])(
    '限免期外（%p）：免费态回落锁定（不切换 + 巡游版提示）',
    (freeWindow) => {
      useSimulationStore
        .getState()
        .applyRemoteGateConfig({ v: 1, tour: { freeWindow } });
      useSimulationStore.setState({
        cycleScope: 'galaxy',
        viewLevel: 'L3',
        followBodyId: 'sgr-a-star',
        flyToRequestId: 0,
      });
      useSimulationStore.getState().cycleScopeBody(1);
      const state = useSimulationStore.getState();
      expect(state.followBodyId).toBe('sgr-a-star');
      expect(state.flyToRequestId).toBe(0);
      expect(state.lockedHint).toEqual({ context: 'cycle', bodyId: null });
    },
  );

  it('权益态：配置期外照常切换（权益恒不受配置影响）', () => {
    grantEntitlement();
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, tour: { freeWindow: WINDOW_PAST } });
    useSimulationStore.setState({
      cycleScope: 'universe',
      viewLevel: 'L4',
      followBodyId: 'm31',
    });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('m33');
    expect(useSimulationStore.getState().lockedHint).toBeNull();
  });

  it('L1/L2 域：任意配置恒不受影响（回归）', () => {
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, tour: { freeWindow: WINDOW_PAST } });
    useSimulationStore.setState({ followBodyId: 'earth', anchorBodyId: 'earth' });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().selectedBodyId).toBe('mars');
    expect(useSimulationStore.getState().lockedHint).toBeNull();
  });
});

describe('A3-2 派生字段维护（entitlementTick / restoreUnlockState）', () => {
  beforeEach(resetStore);

  it('entitlementTick：限免窗口跨界刷新派生布尔（≤30s 宽限口径）', () => {
    // 以 NOW 为窗口起点：apply 于窗口前 → false，tick 进窗 → true，tick 出窗 → false
    const window: RemoteFreeWindow = {
      enabled: true,
      startUtc: new Date(NOW_MS).toISOString(),
      endUtc: new Date(NOW_MS + 86_400_000).toISOString(),
    };
    useSimulationStore.getState().applyRemoteGateConfig(
      { v: 1, tour: { freeWindow: window }, demo: { freeWindow: window } },
      NOW_MS - 1000,
    );
    expect(useSimulationStore.getState().remoteTourFreeActive).toBe(false);
    useSimulationStore.getState().entitlementTick(NOW_SEC + 60);
    expect(useSimulationStore.getState().remoteTourFreeActive).toBe(true);
    expect(useSimulationStore.getState().remoteDemoFreeActive).toBe(true);
    useSimulationStore.getState().entitlementTick(NOW_SEC + 2 * 86_400);
    expect(useSimulationStore.getState().remoteTourFreeActive).toBe(false);
    expect(useSimulationStore.getState().remoteDemoFreeActive).toBe(false);
  });

  it('entitlementTick：跨自然日配额恢复按远程 dailyLimit 重算', () => {
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, demo: { dailyLimit: 10 } }, NOW_MS);
    useSimulationStore.setState({
      demoQuota: { dateKey: localDateKey(NOW_MS), used: 10 },
      demoRemainingToday: 0,
    });
    useSimulationStore.getState().entitlementTick(NOW_SEC + 2 * 86_400);
    expect(useSimulationStore.getState().demoRemainingToday).toBe(10);
  });

  it('restoreUnlockState：恢复配额时注入远程 dailyLimit', () => {
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, demo: { dailyLimit: 10 } }, NOW_MS);
    window.localStorage.setItem(
      DEMO_QUOTA_STORAGE_KEY,
      JSON.stringify({ dateKey: localDateKey(NOW_MS), used: 3 }),
    );
    useSimulationStore.getState().restoreUnlockState(NOW_SEC);
    expect(useSimulationStore.getState().demoRemainingToday).toBe(7);
  });
});
