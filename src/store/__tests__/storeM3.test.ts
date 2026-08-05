/**
 * store 移动布局面板状态单测（M3）：mobilePanel 单值互斥位
 * （help/controls/contact）默认值、set、toggle 互斥语义。
 */

import { useSimulationStore } from '@/store';

const initialState = useSimulationStore.getState();

afterEach(() => {
  useSimulationStore.setState(initialState, true);
});

describe('mobilePanel（M3 底部标签栏互斥面板位）', () => {
  it('默认 null（全部面板关闭）', () => {
    expect(useSimulationStore.getState().mobilePanel).toBeNull();
  });

  it('setMobilePanel 直接写入与清空', () => {
    const s = useSimulationStore.getState();
    s.setMobilePanel('controls');
    expect(useSimulationStore.getState().mobilePanel).toBe('controls');
    s.setMobilePanel(null);
    expect(useSimulationStore.getState().mobilePanel).toBeNull();
  });

  it('toggleMobilePanel：同面板再切关闭', () => {
    const s = useSimulationStore.getState();
    s.toggleMobilePanel('help');
    expect(useSimulationStore.getState().mobilePanel).toBe('help');
    s.toggleMobilePanel('help');
    expect(useSimulationStore.getState().mobilePanel).toBeNull();
  });

  it('toggleMobilePanel：异面板互斥切换（同时至多一个打开）', () => {
    const s = useSimulationStore.getState();
    s.toggleMobilePanel('help');
    s.toggleMobilePanel('contact');
    expect(useSimulationStore.getState().mobilePanel).toBe('contact');
    s.toggleMobilePanel('controls');
    expect(useSimulationStore.getState().mobilePanel).toBe('controls');
  });
});
