/**
 * Store P4 状态测试：行星视角天体切换与 L1 锚点行为（需求 §3.2.4；
 * R3 四域重构：L1 = 行星系统巡游域）
 */

import { useSimulationStore } from '@/store';
import { DEFAULT_ANCHOR_BODY_ID } from '@/utils/bodyCycle';

function resetStore(): void {
  useSimulationStore.setState({
    viewLevel: 'L2',
    continuousLevel: 2,
    cycleScope: 'solar',
    viewTransitionId: 0,
    followBodyId: null,
    flyToBodyId: null,
    flyToRequestId: 0,
    anchorBodyId: DEFAULT_ANCHOR_BODY_ID,
  });
}

describe('L1 锚点行为变更（需求 3.2.4）', () => {
  beforeEach(resetStore);

  it('默认锚定天体为地球', () => {
    expect(useSimulationStore.getState().anchorBodyId).toBe('earth');
  });

  it('进入 L1 = 飞往并跟随锚定天体（不再飞向固定坐标），巡游域切为行星系统', () => {
    const before = useSimulationStore.getState();
    before.setViewLevel('L1');
    const s = useSimulationStore.getState();
    expect(s.viewLevel).toBe('L1');
    expect(s.cycleScope).toBe('system');
    expect(s.flyToBodyId).toBe('earth');
    expect(s.followBodyId).toBe('earth');
    expect(s.flyToRequestId).toBe(before.flyToRequestId + 1);
    // 不触发固定锚点过渡（避免与飞往运镜竞争）
    expect(s.viewTransitionId).toBe(before.viewTransitionId);
  });

  it('已在 L1 时再次按 1 重新对准锚定天体', () => {
    useSimulationStore.getState().setViewLevel('L1');
    const mid = useSimulationStore.getState().flyToRequestId;
    useSimulationStore.getState().setViewLevel('L1');
    expect(useSimulationStore.getState().flyToRequestId).toBe(mid + 1);
  });

  it('会话内记忆：切换天体后再进 L1 飞往上次锚定天体', () => {
    useSimulationStore.getState().setViewLevel('L1');
    useSimulationStore.getState().cycleScopeBody(1); // earth → tiangong（地球系统序列）
    useSimulationStore.getState().setViewLevel('L2');
    useSimulationStore.getState().setViewLevel('L1');
    const s = useSimulationStore.getState();
    expect(s.anchorBodyId).toBe('tiangong');
    expect(s.flyToBodyId).toBe('tiangong');
  });

  it('跟随远距天体（层级已锁定）按 2 仍取消跟随回固定锚点（P4 修复）', () => {
    useSimulationStore.getState().requestFlyTo('halley');
    // R3：跟随行星域天体期间层级锁定（哈雷 ~20 AU 不再随距离漂移）
    expect(useSimulationStore.getState().viewLevel).toBe('L2');
    const before = useSimulationStore.getState().viewTransitionId;
    useSimulationStore.getState().setViewLevel('L2');
    const s = useSimulationStore.getState();
    expect(s.followBodyId).toBeNull();
    expect(s.flyToBodyId).toBeNull();
    expect(s.viewTransitionId).toBe(before + 1);
  });

  it('切到 L2-L4 锚点按现有逻辑取消跟随并触发锚点过渡', () => {
    useSimulationStore.getState().setViewLevel('L1');
    const before = useSimulationStore.getState().viewTransitionId;
    useSimulationStore.getState().setViewLevel('L3');
    const s = useSimulationStore.getState();
    expect(s.followBodyId).toBeNull();
    expect(s.flyToBodyId).toBeNull();
    expect(s.cycleScope).toBe('galaxy');
    expect(s.viewTransitionId).toBe(before + 1);
  });
});

describe('cycleScopeBody：L1 行星系统巡游（R3 需求 1）', () => {
  beforeEach(() => {
    resetStore();
    // 进入 L1（飞往并跟随地球）
    useSimulationStore.getState().setViewLevel('L1');
  });

  it('下一颗：地球 → 天宫（地球系统按绕行半长轴排序），并飞往跟随', () => {
    const before = useSimulationStore.getState().flyToRequestId;
    useSimulationStore.getState().cycleScopeBody(1);
    const s = useSimulationStore.getState();
    expect(s.anchorBodyId).toBe('tiangong');
    expect(s.flyToBodyId).toBe('tiangong');
    expect(s.followBodyId).toBe('tiangong');
    expect(s.flyToRequestId).toBe(before + 1);
    // R3 需求 2：巡游期间层级锁定 L1
    expect(s.viewLevel).toBe('L1');
  });

  it('上一颗：地球 → 月球（系统序列循环边界）', () => {
    useSimulationStore.getState().cycleScopeBody(-1);
    expect(useSimulationStore.getState().anchorBodyId).toBe('moon');
  });

  it('连续切换沿地球系统序列累进且不离开系统（R3 需求 1）', () => {
    const seq = ['tiangong', 'iss', 'hubble', 'geo-satellite', 'moon', 'earth'];
    for (const expected of seq) {
      useSimulationStore.getState().cycleScopeBody(1);
      expect(useSimulationStore.getState().followBodyId).toBe(expected);
    }
  });

  it('跟随木星时在木星系统内循环（不出现地球卫星/其他行星）', () => {
    useSimulationStore.getState().requestFlyTo('jupiter');
    const seq = ['io', 'europa', 'ganymede', 'callisto', 'jupiter'];
    for (const expected of seq) {
      useSimulationStore.getState().cycleScopeBody(1);
      expect(useSimulationStore.getState().followBodyId).toBe(expected);
    }
  });

  it('无卫星行星（水星）：切换原地不动（UI 已隐藏按钮）', () => {
    useSimulationStore.getState().requestFlyTo('mercury');
    useSimulationStore.setState({ cycleScope: 'system', viewLevel: 'L1' });
    const before = useSimulationStore.getState().flyToRequestId;
    useSimulationStore.getState().cycleScopeBody(1);
    const s = useSimulationStore.getState();
    expect(s.followBodyId).toBe('mercury');
    expect(s.flyToRequestId).toBe(before);
  });

  it('未跟随时点击：先飞往锚定天体（不跳步）', () => {
    useSimulationStore.setState({ followBodyId: null, flyToBodyId: null });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('earth');
  });
});

describe('requestFlyTo 记忆锚定天体（需求 3.2.4 会话内记忆）', () => {
  beforeEach(resetStore);

  it('飞往行星域天体（含卫星）时更新锚定天体', () => {
    useSimulationStore.getState().requestFlyTo('neptune');
    expect(useSimulationStore.getState().anchorBodyId).toBe('neptune');
    useSimulationStore.getState().requestFlyTo('moon');
    expect(useSimulationStore.getState().anchorBodyId).toBe('moon');
  });

  it('飞往行星域外天体（太阳/星系）不改变锚定天体', () => {
    useSimulationStore.getState().requestFlyTo('sun');
    expect(useSimulationStore.getState().anchorBodyId).toBe('earth');
    useSimulationStore.getState().requestFlyTo('m31');
    expect(useSimulationStore.getState().anchorBodyId).toBe('earth');
  });
});
