/**
 * Store R2-6 测试：G 键银心固定模式一次性引导提示
 * （IMPROVEMENT_REQUIREMENTS_2 §R2-6 §6.1：首次切入 L3 一次性 toast，
 *   会话内仅出现一次；用户已切换过模式即视为已发现，不再打扰）
 */

import { useSimulationStore } from '@/store';

describe('galacticFrameTip（G 键银心固定模式一次性引导，R2-6）', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      galacticFrameMode: 'follow',
      galacticFrameTipVisible: false,
      galacticFrameTipSeen: false,
    });
  });

  it('默认不可见且未看过', () => {
    const s = useSimulationStore.getState();
    expect(s.galacticFrameTipVisible).toBe(false);
    expect(s.galacticFrameTipSeen).toBe(false);
  });

  it('showGalacticFrameTipOnce 首次调用展示提示并标记已看过', () => {
    useSimulationStore.getState().showGalacticFrameTipOnce();
    const s = useSimulationStore.getState();
    expect(s.galacticFrameTipVisible).toBe(true);
    expect(s.galacticFrameTipSeen).toBe(true);
  });

  it('会话内仅一次：关闭后再次触发不再展示', () => {
    useSimulationStore.getState().showGalacticFrameTipOnce();
    useSimulationStore.getState().dismissGalacticFrameTip();
    useSimulationStore.getState().showGalacticFrameTipOnce();
    expect(useSimulationStore.getState().galacticFrameTipVisible).toBe(false);
  });

  it('已处于银心固定模式时不展示（用户已会用）', () => {
    useSimulationStore.setState({ galacticFrameMode: 'galactic-center' });
    useSimulationStore.getState().showGalacticFrameTipOnce();
    expect(useSimulationStore.getState().galacticFrameTipVisible).toBe(false);
  });

  it('dismissGalacticFrameTip 收起提示且保持已看过', () => {
    useSimulationStore.getState().showGalacticFrameTipOnce();
    useSimulationStore.getState().dismissGalacticFrameTip();
    const s = useSimulationStore.getState();
    expect(s.galacticFrameTipVisible).toBe(false);
    expect(s.galacticFrameTipSeen).toBe(true);
  });

  it('toggleGalacticFrameMode（G 键）收起提示并标记已看过', () => {
    useSimulationStore.getState().showGalacticFrameTipOnce();
    useSimulationStore.getState().toggleGalacticFrameMode();
    const s = useSimulationStore.getState();
    expect(s.galacticFrameTipVisible).toBe(false);
    expect(s.galacticFrameTipSeen).toBe(true);
    expect(s.galacticFrameMode).toBe('galactic-center');
  });

  it('setGalacticFrameMode 同样标记已看过（HUD 按钮切换路径）', () => {
    useSimulationStore.getState().setGalacticFrameMode('galactic-center');
    const s = useSimulationStore.getState();
    expect(s.galacticFrameTipSeen).toBe(true);
    expect(s.galacticFrameTipVisible).toBe(false);
    // 之后进入 L3 不再展示
    useSimulationStore.getState().setGalacticFrameMode('follow');
    useSimulationStore.getState().showGalacticFrameTipOnce();
    expect(useSimulationStore.getState().galacticFrameTipVisible).toBe(false);
  });
});
