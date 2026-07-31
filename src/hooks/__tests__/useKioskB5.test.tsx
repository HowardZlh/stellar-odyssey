/**
 * useKiosk 驱动 hook 单测（B5 §5.1-C）：?mode=kiosk 启动派发、激活态
 * 定时 tick、全局输入监听（pointerdown/wheel/keydown）、未激活零挂载、
 * 卸载全清理（防泄漏）。
 */

import { act, renderHook } from '@testing-library/react';

import { KIOSK_TICK_INTERVAL_MS, useKiosk } from '@/hooks/useKiosk';
import { KIOSK_INACTIVE } from '@/utils/kiosk';
import { DEFAULT_LAUNCH_PARAMS } from '@/utils/launchParams';
import { useSimulationStore } from '@/store';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  useSimulationStore.setState({
    launch: DEFAULT_LAUNCH_PARAMS,
    uiVisible: true,
    kiosk: KIOSK_INACTIVE,
    viewLevel: 'L2',
    continuousLevel: 2,
    cycleScope: 'solar',
    followBodyId: null,
    flyToBodyId: null,
    selectedBodyId: null,
    anchorBodyId: 'earth',
  });
});

describe('useKiosk（B5 §5.1-C 驱动接入）', () => {
  it('launch.mode=kiosk：挂载即派发 start（touring + 隐 UI，URL 启动不触达全屏）', () => {
    useSimulationStore.setState({ launch: { ...DEFAULT_LAUNCH_PARAMS, mode: 'kiosk' } });
    renderHook(() => useKiosk());
    const s = useSimulationStore.getState();
    expect(s.kiosk.phase).toBe('touring');
    expect(s.uiVisible).toBe(false);
    expect(s.followBodyId).toBe('earth');
  });

  it('launch.mode 为空：挂载零行为、不挂定时器与监听', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    renderHook(() => useKiosk());
    expect(useSimulationStore.getState().kiosk.phase).toBe('inactive');
    expect(jest.getTimerCount()).toBe(0);
    expect(addSpy.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(0);
    addSpy.mockRestore();
  });

  it('激活态定时派发 tick：dwell 到期自动推进下一站', () => {
    useSimulationStore.setState({ launch: { ...DEFAULT_LAUNCH_PARAMS, mode: 'kiosk', dwell: 5 } });
    renderHook(() => useKiosk());
    const firstFly = useSimulationStore.getState().flyToRequestId;
    act(() => {
      jest.advanceTimersByTime(5000 + KIOSK_TICK_INTERVAL_MS);
    });
    const s = useSimulationStore.getState();
    expect(s.flyToRequestId).toBe(firstFly + 1);
    expect(s.kiosk.phase).toBe('touring');
  });

  it('全局输入（pointerdown/wheel/keydown）派发 input：巡游暂停 + 显 UI', () => {
    useSimulationStore.setState({ launch: { ...DEFAULT_LAUNCH_PARAMS, mode: 'kiosk' } });
    renderHook(() => useKiosk());
    expect(useSimulationStore.getState().uiVisible).toBe(false);
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(useSimulationStore.getState().kiosk.phase).toBe('paused');
    expect(useSimulationStore.getState().uiVisible).toBe(true);
    // wheel/keydown 同样计入活跃信号（重置恢复计时）
    const at = useSimulationStore.getState().kiosk.nextAtSec;
    act(() => {
      jest.advanceTimersByTime(1000);
      window.dispatchEvent(new Event('wheel'));
    });
    expect(useSimulationStore.getState().kiosk.nextAtSec).toBeGreaterThanOrEqual(at);
    act(() => {
      window.dispatchEvent(new Event('keydown'));
    });
    expect(useSimulationStore.getState().kiosk.phase).toBe('paused');
  });

  it('exit 后（inactive）定时器与监听即时拆除', () => {
    useSimulationStore.setState({ launch: { ...DEFAULT_LAUNCH_PARAMS, mode: 'kiosk' } });
    renderHook(() => useKiosk());
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    act(() => {
      useSimulationStore.getState().kioskEvent('exit', performance.now() / 1000);
    });
    expect(jest.getTimerCount()).toBe(0);
    // 监听已移除：输入不再改变状态
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(useSimulationStore.getState().kiosk.phase).toBe('inactive');
  });

  it('卸载全清理（防泄漏）：removeEventListener 三类输入 + 定时器清零', () => {
    useSimulationStore.setState({ launch: { ...DEFAULT_LAUNCH_PARAMS, mode: 'kiosk' } });
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useKiosk());
    unmount();
    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toEqual(expect.arrayContaining(['pointerdown', 'wheel', 'keydown']));
    expect(jest.getTimerCount()).toBe(0);
    removeSpy.mockRestore();
  });
});
