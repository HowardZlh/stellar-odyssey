/**
 * SC5 store 单测：星系色彩增强开关（默认开、会话级、setter 往返）
 */

import { useSimulationStore } from '@/store';

const initial = {
  colorBoostEnabled: true,
};

afterEach(() => {
  useSimulationStore.setState(initial);
});

describe('colorBoostEnabled（SC5 星系色彩增强开关）', () => {
  it('默认开启（用户裁决：默认艺术化增强，关闭回真实物理色）', () => {
    expect(useSimulationStore.getState().colorBoostEnabled).toBe(true);
  });

  it('setColorBoostEnabled 往返切换', () => {
    useSimulationStore.getState().setColorBoostEnabled(false);
    expect(useSimulationStore.getState().colorBoostEnabled).toBe(false);
    useSimulationStore.getState().setColorBoostEnabled(true);
    expect(useSimulationStore.getState().colorBoostEnabled).toBe(true);
  });
});
