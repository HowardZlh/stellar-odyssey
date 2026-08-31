/**
 * kiosk 巡游门控跳过回归单测（G2，REQUIREMENTS_GROWTH.md §3 M1）：
 * 免费用户（entitlement=null、无远程限免）以 kiosk 启动时——
 * - tour=all：连续推进 N 次不停滞在同一天体（旧缺陷：L3 首站被
 *   cycleScopeBody 门控拒绝 + kiosk 隐藏 UI → 静默永久停滞），
 *   且全程不进入 galaxy/universe 门控域、不触发巡游锁定提示；
 * - tour=galaxy/universe：启动即回落 solar 域轮转 + KioskBadge
 *   一次性说明（✕ 后同会话不重弹，退出 kiosk 复位）。
 */

import { useSimulationStore } from '@/store';
import { DEFAULT_LAUNCH_PARAMS } from '@/utils/launchParams';
import { KIOSK_INACTIVE } from '@/utils/kiosk';

/** 恢复本套件触达的字段（沿用 storeB5 复位惯例） */
afterEach(() => {
  useSimulationStore.setState({
    launch: DEFAULT_LAUNCH_PARAMS,
    uiVisible: true,
    kiosk: KIOSK_INACTIVE,
    kioskGateNotice: false,
    kioskGateNoticeShown: false,
    viewLevel: 'L2',
    continuousLevel: 2,
    cycleScope: 'solar',
    followBodyId: null,
    flyToBodyId: null,
    selectedBodyId: null,
    anchorBodyId: 'earth',
    galaxyAnchorBodyId: 'sgr-a-star',
    universeAnchorBodyId: 'm31',
    entitlement: null,
    remoteGateConfig: { v: 1 },
    lockedHint: null,
  });
});

/** 免费态注入（无权益 + 无远程限免 = 巡游 gate 生效判据） */
function setupFreeUser(tour: 'all' | 'galaxy' | 'universe'): void {
  useSimulationStore.setState({
    launch: { ...DEFAULT_LAUNCH_PARAMS, tour },
    entitlement: null,
    remoteGateConfig: { v: 1 },
  });
}

describe('kiosk + 无权益 + tour=all（G2 停滞回归）', () => {
  it('连续推进 40 次不停滞在同一天体，且不进入门控域、不触发锁定提示', () => {
    setupFreeUser('all');
    const dwell = DEFAULT_LAUNCH_PARAMS.dwell;
    useSimulationStore.getState().kioskEvent('start', 0);
    let prev = useSimulationStore.getState();
    for (let i = 1; i <= 40; i += 1) {
      useSimulationStore.getState().kioskEvent('tick', i * dwell);
      const s = useSimulationStore.getState();
      // 不停滞：每次推进后（跟随体, 层级）组合必有变化（next 换跟随体；
      // anchor 换层级/取消跟随；enter 从未跟随进入跟随）
      expect(
        s.followBodyId !== prev.followBodyId || s.viewLevel !== prev.viewLevel,
      ).toBe(true);
      // 门控域被跳过：全程只在 L1/L2 两域轮转
      expect(['system', 'solar']).toContain(s.cycleScope);
      expect(['L1', 'L2']).toContain(s.viewLevel);
      // 巡游 gate 未被撞上（cycleScopeBody 的锁定提示不触发）
      expect(s.lockedHint).toBeNull();
      prev = s;
    }
    // tour=all 静默退化：不弹回落说明（口径见 §3 M1 G2）
    expect(useSimulationStore.getState().kioskGateNotice).toBe(false);
  });

  it('有权益时四域轮转不受影响（锁定域为空，既有语义零变化）', () => {
    setupFreeUser('all');
    useSimulationStore.setState({
      entitlement: { tier: 'year', expSec: Number.MAX_SAFE_INTEGER },
    });
    const dwell = DEFAULT_LAUNCH_PARAMS.dwell;
    useSimulationStore.getState().kioskEvent('start', 0);
    const seenScopes = new Set<string>();
    // 足量推进以跨越 solar（15 站）与 galaxy（14 站）两域
    for (let i = 1; i <= 40; i += 1) {
      useSimulationStore.getState().kioskEvent('tick', i * dwell);
      seenScopes.add(useSimulationStore.getState().cycleScope);
    }
    expect(seenScopes.has('galaxy')).toBe(true);
  });
});

describe('kiosk + 无权益 + tour=galaxy/universe（G2 回落 + 一次性说明）', () => {
  it('tour=galaxy 启动即回落 solar 域并弹一次性说明；轮转正常', () => {
    setupFreeUser('galaxy');
    useSimulationStore.getState().kioskEvent('start', 0);
    let s = useSimulationStore.getState();
    // 默认已在 solar 域主层级 → 直接 enter 地球（不进 L3）
    expect(s.cycleScope).toBe('solar');
    expect(s.viewLevel).toBe('L2');
    expect(s.followBodyId).toBe('earth');
    expect(s.kioskGateNotice).toBe(true);
    expect(s.kioskGateNoticeShown).toBe(true);
    // 继续推进：solar 域内轮转不停滞
    const dwell = DEFAULT_LAUNCH_PARAMS.dwell;
    useSimulationStore.getState().kioskEvent('tick', dwell);
    s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('solar');
    expect(s.followBodyId).not.toBe('earth');
    expect(s.lockedHint).toBeNull();
  });

  it('说明 ✕ 关闭后同会话不重弹；退出 kiosk 复位（下次会话重新可见）', () => {
    setupFreeUser('universe');
    const dwell = DEFAULT_LAUNCH_PARAMS.dwell;
    useSimulationStore.getState().kioskEvent('start', 0);
    expect(useSimulationStore.getState().kioskGateNotice).toBe(true);
    useSimulationStore.getState().dismissKioskGateNotice();
    expect(useSimulationStore.getState().kioskGateNotice).toBe(false);
    // 后续推进不重弹（shown 标记生效）
    useSimulationStore.getState().kioskEvent('tick', dwell);
    useSimulationStore.getState().kioskEvent('tick', dwell * 2);
    expect(useSimulationStore.getState().kioskGateNotice).toBe(false);
    // 退出复位 → 新会话重新展示
    useSimulationStore.getState().kioskEvent('exit', dwell * 3);
    expect(useSimulationStore.getState().kioskGateNoticeShown).toBe(false);
    useSimulationStore.getState().kioskEvent('start', dwell * 4);
    expect(useSimulationStore.getState().kioskGateNotice).toBe(true);
  });
});
