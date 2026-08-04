/**
 * store 沉浸模式与控制面板收起单测（UI 布局优化）：
 * - controlPanelCollapsed 默认展开 + set/toggle
 * - setImmersiveMode(true)：收起面板 + 暂存并清空选中天体
 * - setImmersiveMode(false)：展开面板 + 恢复进入前选中天体
 * - 沉浸期间用户另选天体：退出时不覆盖（点选功能不变）
 * - 幂等：同值调用零写入
 */

import { useSimulationStore } from '@/store';

function resetUiLayoutState(): void {
  useSimulationStore.setState({
    controlPanelCollapsed: false,
    immersiveMode: false,
    immersiveRestoreBodyId: null,
    selectedBodyId: null,
  });
}

beforeEach(() => {
  resetUiLayoutState();
});

describe('controlPanelCollapsed（左侧面板收起）', () => {
  it('默认展开', () => {
    expect(useSimulationStore.getState().controlPanelCollapsed).toBe(false);
  });

  it('setControlPanelCollapsed 写入 / toggleControlPanelCollapsed 翻转', () => {
    useSimulationStore.getState().setControlPanelCollapsed(true);
    expect(useSimulationStore.getState().controlPanelCollapsed).toBe(true);
    useSimulationStore.getState().toggleControlPanelCollapsed();
    expect(useSimulationStore.getState().controlPanelCollapsed).toBe(false);
    useSimulationStore.getState().toggleControlPanelCollapsed();
    expect(useSimulationStore.getState().controlPanelCollapsed).toBe(true);
  });
});

describe('setImmersiveMode（页面最大化联动）', () => {
  it('开启：收起控制面板、暂存并清空选中天体', () => {
    useSimulationStore.setState({ selectedBodyId: 'sun' });
    useSimulationStore.getState().setImmersiveMode(true);
    const s = useSimulationStore.getState();
    expect(s.immersiveMode).toBe(true);
    expect(s.controlPanelCollapsed).toBe(true);
    expect(s.selectedBodyId).toBeNull();
    expect(s.immersiveRestoreBodyId).toBe('sun');
  });

  it('关闭：展开控制面板并恢复进入前选中天体', () => {
    useSimulationStore.setState({ selectedBodyId: 'earth' });
    useSimulationStore.getState().setImmersiveMode(true);
    useSimulationStore.getState().setImmersiveMode(false);
    const s = useSimulationStore.getState();
    expect(s.immersiveMode).toBe(false);
    expect(s.controlPanelCollapsed).toBe(false);
    expect(s.selectedBodyId).toBe('earth');
    expect(s.immersiveRestoreBodyId).toBeNull();
  });

  it('沉浸期间点选新天体（selectBody 功能不变），退出时不覆盖用户选择', () => {
    useSimulationStore.setState({ selectedBodyId: 'earth' });
    useSimulationStore.getState().setImmersiveMode(true);
    // 沉浸模式下点击天体仍正常打开信息面板
    useSimulationStore.getState().selectBody('mars');
    expect(useSimulationStore.getState().selectedBodyId).toBe('mars');
    useSimulationStore.getState().setImmersiveMode(false);
    expect(useSimulationStore.getState().selectedBodyId).toBe('mars');
  });

  it('进入前未选中天体：退出后保持未选中', () => {
    useSimulationStore.getState().setImmersiveMode(true);
    useSimulationStore.getState().setImmersiveMode(false);
    expect(useSimulationStore.getState().selectedBodyId).toBeNull();
  });

  it('同值调用为幂等 no-op（不重复暂存/清空）', () => {
    useSimulationStore.setState({ selectedBodyId: 'sun' });
    useSimulationStore.getState().setImmersiveMode(true);
    // 二次开启：selectedBodyId 已为 null，不应覆盖已暂存的 'sun'
    useSimulationStore.getState().setImmersiveMode(true);
    expect(useSimulationStore.getState().immersiveRestoreBodyId).toBe('sun');
    useSimulationStore.getState().setImmersiveMode(false);
    expect(useSimulationStore.getState().selectedBodyId).toBe('sun');
    // 二次关闭：状态不变
    useSimulationStore.getState().setImmersiveMode(false);
    expect(useSimulationStore.getState().selectedBodyId).toBe('sun');
  });
});
