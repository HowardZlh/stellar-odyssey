/**
 * 操作引导自动关闭单测（UI 布局优化）：
 * - 打开 5 秒后自动关闭，原位置留「?」重开按钮
 * - 鼠标悬停暂停倒计时，移出后重新计满 5 秒
 * - 手动 ✕ 提前关闭
 * - 经「?」重开后不再自动关闭
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { HELP_HINT_AUTO_CLOSE_MS, HelpHint } from '../HelpHint';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  window.localStorage.clear();
});

/** 引导面板可见性判定（以关闭按钮存在为准） */
function hintVisible(): boolean {
  return screen.queryByRole('button', { name: '关闭引导' }) !== null;
}

describe('HelpHint 自动关闭', () => {
  it('默认显示，5 秒后自动关闭并显示「?」重开按钮', () => {
    render(<HelpHint />);
    expect(hintVisible()).toBe(true);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS);
    });
    expect(hintVisible()).toBe(false);
    expect(screen.getByRole('button', { name: '重新打开操作引导' })).toBeInTheDocument();
  });

  it('未满 5 秒不关闭', () => {
    render(<HelpHint />);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS - 100);
    });
    expect(hintVisible()).toBe(true);
  });

  it('悬停暂停倒计时，移出后重新计满 5 秒', () => {
    render(<HelpHint />);
    const panel = screen.getByRole('button', { name: '关闭引导' }).closest('div')!
      .parentElement!;
    fireEvent.mouseEnter(panel);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS * 3);
    });
    expect(hintVisible()).toBe(true);
    fireEvent.mouseLeave(panel);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS - 100);
    });
    expect(hintVisible()).toBe(true);
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(hintVisible()).toBe(false);
  });

  it('手动 ✕ 提前关闭', () => {
    render(<HelpHint />);
    fireEvent.click(screen.getByRole('button', { name: '关闭引导' }));
    expect(hintVisible()).toBe(false);
    expect(screen.getByRole('button', { name: '重新打开操作引导' })).toBeInTheDocument();
  });

  it('经「?」重开后不再自动关闭（可手动关闭）', () => {
    render(<HelpHint />);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: '重新打开操作引导' }));
    expect(hintVisible()).toBe(true);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS * 3);
    });
    expect(hintVisible()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '关闭引导' }));
    expect(hintVisible()).toBe(false);
  });
});
