/**
 * 商业合作角标单测（B1）：渲染 / 展开收起（按钮切换、点击外部收起、
 * 卡片内点击不收起）/ 避让分支（四类事件通知 + 剖面分层卡片逐一触发
 * 隐藏与恢复、隐藏期间展开态重置）/ 卸载清理外部点击监听。
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import {
  CONTACT_EMAIL,
  CONTACT_GITHUB_ISSUES_URL,
  ContactBadge,
} from '../ContactBadge';

/** 避让相关标志复位（其余 store 字段不动，沿用既有 store 测试口径） */
function resetAvoidanceFlags(): void {
  useSimulationStore.setState({
    solarFlareNoticeVisible: false,
    cmeNoticeVisible: false,
    cmeArrivalNoticeVisible: false,
    supernovaNoticeVisible: false,
    sunCutawayMode: false,
    sunCutawayLayer: null,
  });
}

beforeEach(() => {
  resetAvoidanceFlags();
});

/** 展开卡片的公共操作 */
function expandBadge(): void {
  fireEvent.click(screen.getByRole('button', { name: /商业合作/ }));
}

describe('ContactBadge 渲染', () => {
  it('默认渲染左下角角标按钮，卡片不显示', () => {
    render(<ContactBadge />);
    const button = screen.getByRole('button', { name: /商业合作/ });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('展开后卡片包含邮箱 mailto 链接与 GitHub Issues 链接', () => {
    render(<ContactBadge />);
    expandBadge();
    expect(screen.getByRole('dialog', { name: '商业合作联系方式' })).toBeInTheDocument();
    const mail = screen.getByRole('link', { name: new RegExp(CONTACT_EMAIL) });
    expect(mail).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`);
    const issues = screen.getByRole('link', { name: /GitHub Issues/ });
    expect(issues).toHaveAttribute('href', CONTACT_GITHUB_ISSUES_URL);
  });
});

describe('ContactBadge 展开/收起', () => {
  it('点击按钮展开、再次点击收起', () => {
    render(<ContactBadge />);
    expandBadge();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expandBadge();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('展开后点击卡片外部收起', () => {
    render(<ContactBadge />);
    expandBadge();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('展开后点击卡片内部不收起', () => {
    render(<ContactBadge />);
    expandBadge();
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('未展开时不注册外部点击监听、卸载时清理监听', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<ContactBadge />);
    const countAdded = (): number =>
      addSpy.mock.calls.filter(([type]) => type === 'pointerdown').length;
    const countRemoved = (): number =>
      removeSpy.mock.calls.filter(([type]) => type === 'pointerdown').length;
    expect(countAdded()).toBe(0);
    expandBadge();
    expect(countAdded()).toBe(1);
    unmount();
    expect(countRemoved()).toBe(1);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe('ContactBadge 事件避让（隐藏方案）', () => {
  it.each([
    ['solarFlareNoticeVisible', { solarFlareNoticeVisible: true }],
    ['cmeNoticeVisible', { cmeNoticeVisible: true }],
    ['cmeArrivalNoticeVisible', { cmeArrivalNoticeVisible: true }],
    ['supernovaNoticeVisible', { supernovaNoticeVisible: true }],
    [
      'sunCutawayMode + sunCutawayLayer',
      { sunCutawayMode: true, sunCutawayLayer: 'core' as const },
    ],
  ])('%s 为真时角标隐藏，复位后恢复', (_label, patch) => {
    render(<ContactBadge />);
    act(() => {
      useSimulationStore.setState(patch);
    });
    expect(screen.queryByRole('button', { name: /商业合作/ })).not.toBeInTheDocument();
    act(() => {
      resetAvoidanceFlags();
    });
    expect(screen.getByRole('button', { name: /商业合作/ })).toBeInTheDocument();
  });

  it('剖面模式开启但未选分层时不避让', () => {
    render(<ContactBadge />);
    act(() => {
      useSimulationStore.setState({ sunCutawayMode: true, sunCutawayLayer: null });
    });
    expect(screen.getByRole('button', { name: /商业合作/ })).toBeInTheDocument();
  });

  it('展开状态下触发避让，解除后回到收起初始态', () => {
    render(<ContactBadge />);
    expandBadge();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      useSimulationStore.setState({ supernovaNoticeVisible: true });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      resetAvoidanceFlags();
    });
    expect(screen.getByRole('button', { name: /商业合作/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
