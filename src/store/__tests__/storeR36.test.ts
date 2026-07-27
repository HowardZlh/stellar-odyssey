/**
 * Store R3-6 新增状态测试：银河系视角天体垂直展开开关 + 增益滑块
 * （IMPROVEMENT_REQUIREMENTS_3 §6.1-B）
 */

import { useSimulationStore } from '@/store';
import { GALAXY_EXPAND_GAIN_DEFAULT } from '@/utils/galacticLatitude';

describe('galaxyVerticalExpand / galaxyExpandGain（R3-6）', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      galaxyVerticalExpand: false,
      galaxyExpandGain: GALAXY_EXPAND_GAIN_DEFAULT,
    });
  });

  it('默认：展开关闭、增益 ×3（默认观感由银纬修正数据承载）', () => {
    expect(useSimulationStore.getState().galaxyVerticalExpand).toBe(false);
    expect(useSimulationStore.getState().galaxyExpandGain).toBe(3);
  });

  it('setGalaxyVerticalExpand 直接设置；toggleGalaxyVerticalExpand（V 键）往返切换', () => {
    useSimulationStore.getState().setGalaxyVerticalExpand(true);
    expect(useSimulationStore.getState().galaxyVerticalExpand).toBe(true);
    useSimulationStore.getState().setGalaxyVerticalExpand(false);
    expect(useSimulationStore.getState().galaxyVerticalExpand).toBe(false);
    useSimulationStore.getState().toggleGalaxyVerticalExpand();
    expect(useSimulationStore.getState().galaxyVerticalExpand).toBe(true);
    useSimulationStore.getState().toggleGalaxyVerticalExpand();
    expect(useSimulationStore.getState().galaxyVerticalExpand).toBe(false);
  });

  it('setGalaxyExpandGain 钳制到 [1,6]（滑块范围）', () => {
    useSimulationStore.getState().setGalaxyExpandGain(4.5);
    expect(useSimulationStore.getState().galaxyExpandGain).toBe(4.5);
    useSimulationStore.getState().setGalaxyExpandGain(0);
    expect(useSimulationStore.getState().galaxyExpandGain).toBe(1);
    useSimulationStore.getState().setGalaxyExpandGain(99);
    expect(useSimulationStore.getState().galaxyExpandGain).toBe(6);
  });

  it('setGalaxyExpandGain 非有限输入抛 RangeError（状态不被污染）', () => {
    expect(() => useSimulationStore.getState().setGalaxyExpandGain(NaN)).toThrow(RangeError);
    expect(useSimulationStore.getState().galaxyExpandGain).toBe(3);
  });
});
