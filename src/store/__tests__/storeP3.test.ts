/**
 * Store P3 新增状态测试：Bloom 泛光开关（需求 §4.6）
 */

import { useSimulationStore } from '@/store';

function resetStore(): void {
  useSimulationStore.setState({ bloomEnabled: true });
}

describe('Bloom 泛光开关（需求 4.6）', () => {
  beforeEach(resetStore);

  it('默认开启', () => {
    expect(useSimulationStore.getState().bloomEnabled).toBe(true);
  });

  it('setBloomEnabled 设置开关', () => {
    useSimulationStore.getState().setBloomEnabled(false);
    expect(useSimulationStore.getState().bloomEnabled).toBe(false);
    useSimulationStore.getState().setBloomEnabled(true);
    expect(useSimulationStore.getState().bloomEnabled).toBe(true);
  });

  it('toggleBloom 翻转开关', () => {
    useSimulationStore.getState().toggleBloom();
    expect(useSimulationStore.getState().bloomEnabled).toBe(false);
    useSimulationStore.getState().toggleBloom();
    expect(useSimulationStore.getState().bloomEnabled).toBe(true);
  });
});
