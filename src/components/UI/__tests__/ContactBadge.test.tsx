/**
 * 商业合作角标单测（B1，左下角布局收口修订）：渲染 / 展开收起（按钮
 * 切换、点击外部收起、卡片内点击不收起）/ 常驻可见（事件通知与剖面
 * 分层卡触发时不再避让隐藏——原「临时隐藏」方案已由 LeftColumn 列
 * 布局取代）/ 卸载清理外部点击监听。
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import {
  CONTACT_EMAIL,
  CONTACT_GITHUB_ISSUES_URL,
  ContactBadge,
  DONATE_PAGE_PATH,
  SPONSOR_AFDIAN_URL,
  UNLOCK_PAGE_PATH,
} from '../ContactBadge';

/** 事件/剖面相关标志复位（其余 store 字段不动，沿用既有 store 测试口径） */
function resetEventFlags(): void {
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
  resetEventFlags();
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

  it('商业合作左侧渲染「投喂燃料」捐赠入口（新标签页打开 /donate）', () => {
    render(<ContactBadge />);
    const donate = screen.getByRole('link', { name: '打开捐赠页（新标签页）' });
    expect(donate).toHaveTextContent('投喂燃料');
    expect(donate).toHaveAttribute('href', DONATE_PAGE_PATH);
    expect(donate).toHaveAttribute('target', '_blank');
    // 捐赠入口位于商业合作按钮左侧（DOM 先序）
    const badge = screen.getByRole('button', { name: /商业合作/ });
    expect(
      donate.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('展开后卡片包含邮箱 mailto 链接、GitHub Issues 链接与爱发电赞助链接', () => {
    render(<ContactBadge />);
    expandBadge();
    expect(screen.getByRole('dialog', { name: '商业合作联系方式' })).toBeInTheDocument();
    const mail = screen.getByRole('link', { name: new RegExp(CONTACT_EMAIL) });
    expect(mail).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`);
    const issues = screen.getByRole('link', { name: /GitHub Issues/ });
    expect(issues).toHaveAttribute('href', CONTACT_GITHUB_ISSUES_URL);
    const sponsor = screen.getByRole('link', { name: /爱发电赞助支持/ });
    expect(sponsor).toHaveAttribute('href', SPONSOR_AFDIAN_URL);
    expect(sponsor).toHaveAttribute('target', '_blank');
  });

  it('展开卡包含支持者解锁入口（M3 统一"支持即解锁"口径，新标签页 /unlock）', () => {
    render(<ContactBadge />);
    expandBadge();
    const unlock = screen.getByRole('link', { name: '打开解锁页（新标签页）' });
    expect(unlock).toHaveTextContent('支持者解锁');
    expect(unlock).toHaveAttribute('href', UNLOCK_PAGE_PATH);
    expect(unlock).toHaveAttribute('target', '_blank');
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

describe('ContactBadge 常驻可见（左下角布局收口：避让隐藏逻辑已删除）', () => {
  it.each([
    ['solarFlareNoticeVisible', { solarFlareNoticeVisible: true }],
    ['cmeNoticeVisible', { cmeNoticeVisible: true }],
    ['cmeArrivalNoticeVisible', { cmeArrivalNoticeVisible: true }],
    ['supernovaNoticeVisible', { supernovaNoticeVisible: true }],
    [
      'sunCutawayMode + sunCutawayLayer',
      { sunCutawayMode: true, sunCutawayLayer: 'core' as const },
    ],
  ])('%s 为真时角标与捐赠入口保持可见', (_label, patch) => {
    render(<ContactBadge />);
    act(() => {
      useSimulationStore.setState(patch);
    });
    expect(screen.getByRole('button', { name: /商业合作/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开捐赠页（新标签页）' })).toBeInTheDocument();
  });

  it('事件通知期间展开态保持（不再强制收起）', () => {
    render(<ContactBadge />);
    expandBadge();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      useSimulationStore.setState({ supernovaNoticeVisible: true });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
