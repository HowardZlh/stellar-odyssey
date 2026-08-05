/**
 * store 设备能力状态单测（M1-1）：deviceTier / isTouch / isCompact
 * 默认值（SSR 安全 = 桌面现状）与写入 action。
 */

import { useSimulationStore } from '@/store';

/** 恢复本套件触达的字段 */
afterEach(() => {
  useSimulationStore.setState({
    deviceTier: 'high',
    isTouch: false,
    isCompact: false,
  });
});

describe('设备能力状态默认值（M1：SSR 安全 = 桌面现状）', () => {
  it('deviceTier 默认 high / isTouch 默认 false / isCompact 默认 false', () => {
    const s = useSimulationStore.getState();
    expect(s.deviceTier).toBe('high');
    expect(s.isTouch).toBe(false);
    expect(s.isCompact).toBe(false);
  });
});

describe('设备能力写入 action', () => {
  it('setDeviceTier 写入三档', () => {
    useSimulationStore.getState().setDeviceTier('low');
    expect(useSimulationStore.getState().deviceTier).toBe('low');
    useSimulationStore.getState().setDeviceTier('medium');
    expect(useSimulationStore.getState().deviceTier).toBe('medium');
    useSimulationStore.getState().setDeviceTier('high');
    expect(useSimulationStore.getState().deviceTier).toBe('high');
  });

  it('setIsTouch / setIsCompact 写入布尔', () => {
    useSimulationStore.getState().setIsTouch(true);
    useSimulationStore.getState().setIsCompact(true);
    expect(useSimulationStore.getState().isTouch).toBe(true);
    expect(useSimulationStore.getState().isCompact).toBe(true);
    useSimulationStore.getState().setIsTouch(false);
    useSimulationStore.getState().setIsCompact(false);
    expect(useSimulationStore.getState().isTouch).toBe(false);
    expect(useSimulationStore.getState().isCompact).toBe(false);
  });
});
