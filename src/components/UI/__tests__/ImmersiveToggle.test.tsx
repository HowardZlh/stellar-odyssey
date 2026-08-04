/**
 * 沉浸模式（页面最大化）按钮单测（UI 布局优化）：
 * - 点击进入：store 联动（面板收起 + 清空选中）+ 请求浏览器全屏
 * - 再次点击退出：还原面板 + 退出全屏
 * - fullscreenchange（Esc/系统手势退出全屏）同步退出沉浸模式
 * - 全屏 API 不可用时静默降级（面板照常联动）
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { ImmersiveToggle } from '../ImmersiveToggle';

function resetState(): void {
  useSimulationStore.setState({
    controlPanelCollapsed: false,
    immersiveMode: false,
    immersiveRestoreBodyId: null,
    selectedBodyId: null,
  });
}

/** 全屏 API mock（jsdom 无实现） */
let requestFullscreenMock: jest.Mock;
let exitFullscreenMock: jest.Mock;

beforeEach(() => {
  resetState();
  requestFullscreenMock = jest.fn().mockResolvedValue(undefined);
  exitFullscreenMock = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    value: requestFullscreenMock,
    configurable: true,
  });
  Object.defineProperty(document, 'exitFullscreen', {
    value: exitFullscreenMock,
    configurable: true,
  });
  Object.defineProperty(document, 'fullscreenElement', {
    value: null,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('ImmersiveToggle', () => {
  it('点击进入沉浸模式：面板收起、选中清空、请求全屏', () => {
    useSimulationStore.setState({ selectedBodyId: 'sun' });
    render(<ImmersiveToggle />);
    fireEvent.click(screen.getByRole('button', { name: '最大化（收起面板）' }));
    const s = useSimulationStore.getState();
    expect(s.immersiveMode).toBe(true);
    expect(s.controlPanelCollapsed).toBe(true);
    expect(s.selectedBodyId).toBeNull();
    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
  });

  it('再次点击退出：面板展开、恢复选中、退出全屏', () => {
    useSimulationStore.setState({ selectedBodyId: 'sun' });
    render(<ImmersiveToggle />);
    fireEvent.click(screen.getByRole('button', { name: '最大化（收起面板）' }));
    // 模拟全屏已生效
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });
    fireEvent.click(screen.getByRole('button', { name: '退出最大化' }));
    const s = useSimulationStore.getState();
    expect(s.immersiveMode).toBe(false);
    expect(s.controlPanelCollapsed).toBe(false);
    expect(s.selectedBodyId).toBe('sun');
    expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
  });

  it('按钮 aria-pressed 与沉浸状态同步', () => {
    render(<ImmersiveToggle />);
    const button = screen.getByRole('button', { name: '最大化（收起面板）' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: '退出最大化' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Esc/系统手势退出全屏（fullscreenchange）同步退出沉浸模式', () => {
    render(<ImmersiveToggle />);
    fireEvent.click(screen.getByRole('button', { name: '最大化（收起面板）' }));
    expect(useSimulationStore.getState().immersiveMode).toBe(true);
    // fullscreenElement 保持 null（beforeEach 默认）= 全屏已退出
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(useSimulationStore.getState().immersiveMode).toBe(false);
    expect(useSimulationStore.getState().controlPanelCollapsed).toBe(false);
  });

  it('非沉浸态的 fullscreenchange 不产生写入', () => {
    render(<ImmersiveToggle />);
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(useSimulationStore.getState().immersiveMode).toBe(false);
  });

  it('全屏 API 不可用时静默降级：面板联动照常', () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: undefined,
      configurable: true,
    });
    render(<ImmersiveToggle />);
    fireEvent.click(screen.getByRole('button', { name: '最大化（收起面板）' }));
    expect(useSimulationStore.getState().immersiveMode).toBe(true);
    expect(useSimulationStore.getState().controlPanelCollapsed).toBe(true);
  });

  it('卸载时清理 fullscreenchange 监听', () => {
    const addSpy = jest.spyOn(document, 'addEventListener');
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    const { unmount } = render(<ImmersiveToggle />);
    const countAdded = addSpy.mock.calls.filter(([type]) => type === 'fullscreenchange').length;
    expect(countAdded).toBe(1);
    unmount();
    const countRemoved = removeSpy.mock.calls.filter(
      ([type]) => type === 'fullscreenchange',
    ).length;
    expect(countRemoved).toBe(1);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
