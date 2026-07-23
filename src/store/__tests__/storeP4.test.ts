/**
 * Store P4 新增状态测试：行星视角天体切换与 L1 锚点行为变更（需求 §3.2.4）
 */

import { useSimulationStore } from '@/store';
import { DEFAULT_ANCHOR_BODY_ID } from '@/utils/bodyCycle';

function resetStore(): void {
  useSimulationStore.setState({
    viewLevel: 'L2',
    continuousLevel: 2,
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

  it('进入 L1 = 飞往并跟随锚定天体（不再飞向固定坐标）', () => {
    const before = useSimulationStore.getState();
    before.setViewLevel('L1');
    const s = useSimulationStore.getState();
    expect(s.viewLevel).toBe('L1');
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
    useSimulationStore.getState().cycleAnchorBody(1); // earth → moon
    useSimulationStore.getState().setViewLevel('L2');
    useSimulationStore.getState().setViewLevel('L1');
    const s = useSimulationStore.getState();
    expect(s.anchorBodyId).toBe('moon');
    expect(s.flyToBodyId).toBe('moon');
  });

  it('跟随远距天体时层级读数已为 L2，按 2 仍取消跟随回固定锚点（P4 修复）', () => {
    useSimulationStore.getState().requestFlyTo('halley');
    // 跟随哈雷彗星（~20 AU）时相机距原点较远，层级读数为 L2
    useSimulationStore.setState({ viewLevel: 'L2', continuousLevel: 2.2 });
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
    expect(s.viewTransitionId).toBe(before + 1);
  });
});

describe('cycleAnchorBody 循环切换（需求 3.2.4）', () => {
  beforeEach(resetStore);

  it('下一颗：地球 → 月球，并飞往跟随', () => {
    useSimulationStore.getState().cycleAnchorBody(1);
    const s = useSimulationStore.getState();
    expect(s.anchorBodyId).toBe('moon');
    expect(s.flyToBodyId).toBe('moon');
    expect(s.followBodyId).toBe('moon');
    expect(s.flyToRequestId).toBe(1);
  });

  it('上一颗：地球 → 金星', () => {
    useSimulationStore.getState().cycleAnchorBody(-1);
    expect(useSimulationStore.getState().anchorBodyId).toBe('venus');
  });

  it('循环边界：恩克彗星下一颗回到水星', () => {
    useSimulationStore.setState({ anchorBodyId: 'encke' });
    useSimulationStore.getState().cycleAnchorBody(1);
    expect(useSimulationStore.getState().anchorBodyId).toBe('mercury');
  });

  it('连续切换沿序列累进且每次递增飞往代次（P5：火星后为谷神星）', () => {
    useSimulationStore.getState().cycleAnchorBody(1); // moon
    useSimulationStore.getState().cycleAnchorBody(1); // mars
    useSimulationStore.getState().cycleAnchorBody(1); // ceres
    const s = useSimulationStore.getState();
    expect(s.anchorBodyId).toBe('ceres');
    expect(s.flyToRequestId).toBe(3);
  });
});

describe('requestFlyTo 记忆锚定天体（需求 3.2.4 会话内记忆）', () => {
  beforeEach(resetStore);

  it('飞往序列内天体时更新锚定天体', () => {
    useSimulationStore.getState().requestFlyTo('neptune');
    expect(useSimulationStore.getState().anchorBodyId).toBe('neptune');
  });

  it('飞往序列外天体（太阳/星系）不改变锚定天体', () => {
    useSimulationStore.getState().requestFlyTo('sun');
    expect(useSimulationStore.getState().anchorBodyId).toBe('earth');
    useSimulationStore.getState().requestFlyTo('m31');
    expect(useSimulationStore.getState().anchorBodyId).toBe('earth');
  });
});
