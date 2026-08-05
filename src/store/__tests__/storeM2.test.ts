/**
 * store 自适应 bloom 门单测（M2-2）：默认 true（桌面现状）+ 写入 action。
 */

import { useSimulationStore } from '@/store';

afterEach(() => {
  useSimulationStore.setState({ adaptiveBloomGate: true });
});

describe('adaptiveBloomGate（M2-2）', () => {
  it('默认 true（桌面无驱动 = 现状，生效 bloom 完全由用户开关决定）', () => {
    expect(useSimulationStore.getState().adaptiveBloomGate).toBe(true);
  });

  it('setAdaptiveBloomGate 写入（驱动换档联动）', () => {
    useSimulationStore.getState().setAdaptiveBloomGate(false);
    expect(useSimulationStore.getState().adaptiveBloomGate).toBe(false);
    useSimulationStore.getState().setAdaptiveBloomGate(true);
    expect(useSimulationStore.getState().adaptiveBloomGate).toBe(true);
  });
});
