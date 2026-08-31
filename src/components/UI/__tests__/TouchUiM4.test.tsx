/**
 * M4 触屏交互 UI 单测（REQUIREMENTS_MOBILE §M4-3/M4-4/M4-5）：
 * - HideUiButton / UiRestoreButton：H 键触屏等价入口（仅 isTouch 渲染；
 *   隐藏后恢复按钮不受 uiVisible 容器裹挟；kiosk 激活态不渲染）
 * - HelpHint 触屏分流：触屏引导文案替换 + 快捷键段落隐藏 + 触摸暂停倒计时
 * - ImmersiveToggle：isTouch 下 title 转可见文本（M4-4 裁决）
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';
import { HELP_HINT_AUTO_CLOSE_MS, HelpHint } from '../HelpHint';
import { ImmersiveToggle } from '../ImmersiveToggle';
import { HideUiButton, UiRestoreButton } from '../UiVisibilityToggle';

const initialState = useSimulationStore.getState();

afterEach(() => {
  useSimulationStore.setState(initialState, true);
  window.localStorage.clear();
});

describe('HideUiButton（M4-3 H 键触屏等价入口）', () => {
  it('桌面（isTouch=false）不渲染（布局零变化）', () => {
    render(<HideUiButton />);
    expect(screen.queryByRole('button', { name: /隐藏界面/ })).toBeNull();
  });

  it('触屏渲染，点按隐藏 UI', () => {
    useSimulationStore.setState({ isTouch: true });
    render(<HideUiButton />);
    fireEvent.click(screen.getByRole('button', { name: /隐藏界面/ }));
    expect(useSimulationStore.getState().uiVisible).toBe(false);
  });
});

describe('UiRestoreButton（M4-3 隐藏后恢复角标）', () => {
  it('uiVisible=true 或桌面不渲染', () => {
    useSimulationStore.setState({ isTouch: true, uiVisible: true });
    const { rerender } = render(<UiRestoreButton />);
    expect(screen.queryByRole('button', { name: /显示界面/ })).toBeNull();
    useSimulationStore.setState({ isTouch: false, uiVisible: false });
    rerender(<UiRestoreButton />);
    expect(screen.queryByRole('button', { name: /显示界面/ })).toBeNull();
  });

  it('触屏隐藏 UI 后渲染，点按恢复（不可永久失去 UI）', () => {
    useSimulationStore.setState({ isTouch: true, uiVisible: false });
    render(<UiRestoreButton />);
    fireEvent.click(screen.getByRole('button', { name: /显示界面/ }));
    expect(useSimulationStore.getState().uiVisible).toBe(true);
  });

  it('kiosk 激活态不渲染（影院式全隐藏观感，任意输入唤醒承担恢复）', () => {
    useSimulationStore.setState({
      isTouch: true,
      uiVisible: false,
      kiosk: { ...initialState.kiosk, phase: 'touring' },
    });
    render(<UiRestoreButton />);
    expect(screen.queryByRole('button', { name: /显示界面/ })).toBeNull();
  });
});

describe('HelpHint 触屏分流（M4-5 引导文案 + M4-4 触摸暂停）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('触屏：首段为触屏口径，键鼠快捷键段落（kioskNote）隐藏', () => {
    useSimulationStore.setState({ isTouch: true });
    render(<HelpHint />);
    expect(screen.getByText(/单指拖动旋转 · 双指缩放\/平移 · 点按选中天体/)).toBeInTheDocument();
    expect(screen.queryByText(/H 隐藏\/显示界面/)).toBeNull();
  });

  it('桌面：键鼠口径原样；快捷键段落在「?」重开的完整帮助内（G3 拆分）', () => {
    render(<HelpHint />);
    expect(screen.getByText(/拖动旋转 · 滚轮缩放 · 右键平移/)).toBeInTheDocument();
    // G3：首屏只留操作提示行，kiosk/H 键说明移入完整帮助面板
    expect(screen.queryByText(/H 隐藏\/显示界面/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭引导' }));
    fireEvent.click(screen.getByRole('button', { name: '重新打开操作引导' }));
    expect(screen.getByText(/H 隐藏\/显示界面/)).toBeInTheDocument();
  });

  it('触屏：触摸提示卡任意处解除自动关闭（倒计时暂停）', () => {
    useSimulationStore.setState({ isTouch: true });
    render(<HelpHint />);
    const panel = screen
      .getByRole('button', { name: '关闭引导' })
      .closest('div')!.parentElement!;
    fireEvent.pointerDown(panel);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS * 3);
    });
    expect(screen.getByRole('button', { name: '关闭引导' })).toBeInTheDocument();
  });
});

describe('ImmersiveToggle title 裁决（M4-4：isTouch 转可见文本）', () => {
  it('触屏渲染可见标签文本；桌面仅图标（title 保留）', () => {
    useSimulationStore.setState({ isTouch: true });
    const { rerender } = render(<ImmersiveToggle />);
    // jsdom 无 Fullscreen API → 降级文案（M3-5"收起面板"口径）
    expect(screen.getByRole('button')).toHaveTextContent(/收起面板/);
    useSimulationStore.setState({ isTouch: false });
    rerender(<ImmersiveToggle />);
    expect(screen.getByRole('button')).not.toHaveTextContent(/收起面板/);
    expect(screen.getByRole('button')).toHaveAttribute('title');
  });
});
