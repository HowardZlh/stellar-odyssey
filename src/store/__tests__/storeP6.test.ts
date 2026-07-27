/**
 * Store P6 新增状态测试：银河系视角参考系观察模式（需求 §3.1.1）
 */

import { useSimulationStore } from '@/store';

describe('galacticFrameMode（银河系视角参考系观察模式，P6）', () => {
  beforeEach(() => {
    useSimulationStore.setState({ galacticFrameMode: 'follow' });
  });

  it('默认参考系为跟随太阳系（follow，保持现状默认行为）', () => {
    expect(useSimulationStore.getState().galacticFrameMode).toBe('follow');
  });

  it('setGalacticFrameMode 直接设置模式', () => {
    useSimulationStore.getState().setGalacticFrameMode('galactic-center');
    expect(useSimulationStore.getState().galacticFrameMode).toBe('galactic-center');
    useSimulationStore.getState().setGalacticFrameMode('follow');
    expect(useSimulationStore.getState().galacticFrameMode).toBe('follow');
  });

  it('toggleGalacticFrameMode 在两模式间切换', () => {
    const s = useSimulationStore.getState();
    s.toggleGalacticFrameMode();
    expect(useSimulationStore.getState().galacticFrameMode).toBe('galactic-center');
    useSimulationStore.getState().toggleGalacticFrameMode();
    expect(useSimulationStore.getState().galacticFrameMode).toBe('follow');
  });
});
