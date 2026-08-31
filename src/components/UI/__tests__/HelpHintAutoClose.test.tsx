/**
 * 操作引导自动关闭与 G3 拆分单测（UI 布局优化 + REQUIREMENTS_GROWTH §3 M1）：
 * - 打开 12 秒后自动关闭（G3：自动关闭延时 ≥12s），原位置留「?」重开按钮
 * - 首屏自动展示态只留一行操作提示，不含科学性免责长文（G3 拆分）
 * - 鼠标悬停暂停倒计时，移出后重新计满
 * - 手动 ✕ 提前关闭
 * - 经「?」重开后不再自动关闭，且展示完整帮助（含科学性说明独立分节）
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

/** 科学性说明分节可见性判定（G3：仅完整帮助面板展示） */
function disclaimerVisible(): boolean {
  return screen.queryByText('✦ 科学性与艺术化说明') !== null;
}

describe('HelpHint 自动关闭与 G3 拆分', () => {
  it('自动关闭延时 ≥12 秒（G3 验收口径）', () => {
    expect(HELP_HINT_AUTO_CLOSE_MS).toBeGreaterThanOrEqual(12000);
  });

  it('默认显示，计满延时后自动关闭并显示「?」重开按钮', () => {
    render(<HelpHint />);
    expect(hintVisible()).toBe(true);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS);
    });
    expect(hintVisible()).toBe(false);
    expect(screen.getByRole('button', { name: '重新打开操作引导' })).toBeInTheDocument();
  });

  it('首屏自动展示态只留一行操作提示（不含免责长文与语言/kiosk 说明）', () => {
    render(<HelpHint />);
    expect(screen.getByText(/拖动旋转/)).toBeInTheDocument();
    expect(disclaimerVisible()).toBe(false);
    expect(screen.queryByText(/语言 Language/)).toBeNull();
  });

  it('未满延时不关闭', () => {
    render(<HelpHint />);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS - 100);
    });
    expect(hintVisible()).toBe(true);
  });

  it('悬停暂停倒计时，移出后重新计满', () => {
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

  it('经「?」重开后不再自动关闭，并展示完整帮助（含科学性说明分节）', () => {
    render(<HelpHint />);
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: '重新打开操作引导' }));
    expect(hintVisible()).toBe(true);
    // G3：完整帮助面板展示科学性说明独立分节与语言说明
    expect(disclaimerVisible()).toBe(true);
    expect(screen.getByText(/语言 Language/)).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(HELP_HINT_AUTO_CLOSE_MS * 3);
    });
    expect(hintVisible()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '关闭引导' }));
    expect(hintVisible()).toBe(false);
  });
});
