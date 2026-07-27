/**
 * 自定义 404 页单测（src/app/not-found.tsx）
 *
 * 覆盖：页面渲染（星野/文案/按钮/倒计时初值）、倒计时逐秒推进、
 * 归零自动跳转（location.replace 语义经 utils/notFound.redirectHome）、
 * 「立即返回星图」按钮点击立即跳转、卸载清理定时器。
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { redirectHome } from '@/utils/notFound';

import NotFound from '../not-found';

// 跳转经 utils/notFound.redirectHome 注入点 mock（jsdom 的
// window.location 不可重定义，直接 mock 模块导出）
jest.mock('@/utils/notFound', () => ({
  ...jest.requireActual('@/utils/notFound'),
  redirectHome: jest.fn(),
}));

const redirectHomeMock = redirectHome as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  redirectHomeMock.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('NotFound 渲染', () => {
  it('渲染 404 标识、科幻文案与返回按钮', () => {
    render(<NotFound />);
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('你已漂流到已知宇宙之外')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即返回星图' })).toBeInTheDocument();
  });

  it('倒计时初值为 10 秒', () => {
    render(<NotFound />);
    expect(screen.getByRole('status')).toHaveTextContent('10 秒后自动返回星图');
  });

  it('渲染深空星野背景（装饰性 SVG 星场，aria-hidden）', () => {
    const { container } = render(<NotFound />);
    const svg = container.querySelector('svg[aria-hidden="true"]');
    expect(svg).not.toBeNull();
    // 星场星点数量为设计值 140
    expect(svg?.querySelectorAll('circle')).toHaveLength(140);
  });
});

describe('NotFound 倒计时', () => {
  it('每真实秒递减 1', () => {
    render(<NotFound />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('9 秒后自动返回星图');
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('6 秒后自动返回星图');
  });

  it('归零后保持 0 不再递减为负', () => {
    render(<NotFound />);
    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('0 秒后自动返回星图');
  });
});

describe('NotFound 跳转', () => {
  it('倒计时未归零前不跳转', () => {
    render(<NotFound />);
    act(() => {
      jest.advanceTimersByTime(9000);
    });
    expect(redirectHomeMock).not.toHaveBeenCalled();
  });

  it('倒计时归零自动返回首页', () => {
    render(<NotFound />);
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(redirectHomeMock).toHaveBeenCalledTimes(1);
  });

  it('点击「立即返回星图」按钮立即跳转', () => {
    render(<NotFound />);
    fireEvent.click(screen.getByRole('button', { name: '立即返回星图' }));
    expect(redirectHomeMock).toHaveBeenCalledTimes(1);
  });

  it('卸载后定时器被清理，不再触发跳转', () => {
    const { unmount } = render(<NotFound />);
    unmount();
    act(() => {
      jest.advanceTimersByTime(20_000);
    });
    expect(redirectHomeMock).not.toHaveBeenCalled();
  });
});
