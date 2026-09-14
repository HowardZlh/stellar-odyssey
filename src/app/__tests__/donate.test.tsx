/**
 * 捐赠页 /donate 单测（空名单上线态；Z 迭代 M3 改版，需求 E2(a)）：
 * - 标题/说明（"支持即解锁"口径）渲染
 * - 渠道顺序断言：爱发电（推荐独立面板）→ 支付宝（引导面板）→ 面包多 →
 *   Ko-fi → 预留位；微信赞赏码已下线不再渲染
 * - 爱发电面板：推荐口径 + 站外购买链接（同源常量）+ 回解锁页兑换链接
 * - 支付宝面板：引导口径 + 「前往解锁页扫码支付 →」跳 /unlock（modal 不进本页）
 * - 面包多/Ko-fi 备选卡片链接（同源常量）+ 两个预留位
 * - 空名单占位文案 + 贡献者宇宙入口
 * - zh/EN 语言切换
 */

import { fireEvent, render, screen } from '@testing-library/react';

import DonatePage from '@/app/(zh)/donate/page';
import {
  SPONSOR_AFDIAN_URL,
  UNLOCK_PAGE_PATH,
} from '@/components/UI/ContactBadge';
import { SPONSOR_KOFI_URL, SPONSOR_MBD_URL } from '@/data/donationPlatforms';
import { CONTRIBUTORS_PAGE_PATH } from '@/utils/contributorUniverse';
import { useSimulationStore } from '@/store';

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
});

/** 断言一组节点在 DOM 中按给定先后顺序出现 */
function expectDomOrder(nodes: readonly Element[]): void {
  for (let i = 0; i < nodes.length - 1; i += 1) {
    expect(
      nodes[i].compareDocumentPosition(nodes[i + 1]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
}

describe('DonatePage 渲染（空名单）', () => {
  it('渲染标题、副标题与"支持即解锁"口径说明', () => {
    render(<DonatePage />);
    expect(screen.getByRole('heading', { name: /投喂燃料/ })).toBeInTheDocument();
    expect(screen.getByText('支持项目，即刻解锁高级内容')).toBeInTheDocument();
    expect(screen.getByText(/支持项目即可解锁高级内容/)).toBeInTheDocument();
    expect(screen.getByText(/记入贡献者名单与贡献者宇宙/)).toBeInTheDocument();
  });

  it('渠道顺序：爱发电 → 支付宝 → 面包多 → Ko-fi → 预留位（微信赞赏码已下线）', () => {
    render(<DonatePage />);
    const reserved = screen.getAllByText('预留位 · 即将开通');
    expect(reserved).toHaveLength(2);
    expectDomOrder([
      screen.getByRole('heading', { name: /爱发电/ }),
      screen.getByRole('heading', { name: /支付宝扫码支付/ }),
      screen.getByText('🍞 面包多'),
      screen.getByText('☕ Ko-fi'),
      reserved[0],
      reserved[1],
    ]);
    expect(screen.queryByText(/微信赞赏码/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '微信赞赏码' })).not.toBeInTheDocument();
  });

  it('爱发电推荐面板：推荐口径 + 站外购买链接（同源常量、新标签页）+ 回解锁页兑换链接', () => {
    render(<DonatePage />);
    expect(screen.getByText(/推荐渠道：前往爱发电按档位金额购买/)).toBeInTheDocument();
    const buy = screen.getByRole('link', { name: /前往爱发电支持/ });
    expect(buy).toHaveAttribute('href', SPONSOR_AFDIAN_URL);
    expect(buy).toHaveAttribute('target', '_blank');
    const redeem = screen.getByRole('link', { name: /去解锁页兑换订单号/ });
    expect(redeem).toHaveAttribute('href', UNLOCK_PAGE_PATH);
  });

  it('支付宝引导面板：不再标"推荐"，保留自动发码口径 + 跳解锁页链接（付款 modal 不进本页）', () => {
    render(<DonatePage />);
    const guide = screen.getByText(/支付成功后自动发放解锁 token 并即时解锁/);
    expect(guide.textContent).not.toMatch(/推荐/);
    const cta = screen.getByRole('link', { name: /前往解锁页扫码支付/ });
    expect(cta).toHaveAttribute('href', UNLOCK_PAGE_PATH);
  });

  it('面包多/Ko-fi 备选卡片为可用链接（同源常量，新标签页）+ 备选口径说明', () => {
    render(<DonatePage />);
    const links = screen.getAllByRole('link', { name: '前往支持' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      SPONSOR_MBD_URL,
      SPONSOR_KOFI_URL,
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
    }
    expect(screen.getByText(/备选 · 扫码即付无需注册，支付后凭订单号在解锁页自动兑换/)).toBeInTheDocument();
    expect(screen.getByText(/海外备选/)).toBeInTheDocument();
  });

  it('GitHub Sponsors/Buy Me a Coffee 显示预留位', () => {
    render(<DonatePage />);
    expect(screen.getAllByText('预留位 · 即将开通')).toHaveLength(2);
    expect(screen.getByText(/GitHub Sponsors/)).toBeInTheDocument();
    expect(screen.getByText(/Buy Me a Coffee/)).toBeInTheDocument();
  });

  it('空名单显示正向占位文案与降序排列说明（G9 口径，与贡献者宇宙一致）', () => {
    render(<DonatePage />);
    // 空态改为正向表述（"将点亮第一颗星"），不再用"虚位以待"反向社会证明
    expect(screen.getByText(/这里将点亮第一颗星/)).toBeInTheDocument();
    expect(screen.queryByText(/虚位以待/)).not.toBeInTheDocument();
    expect(screen.getByText(/按累计捐赠金额降序排列/)).toBeInTheDocument();
  });

  it('空名单态同样显示贡献者宇宙入口（C4-1，指向 /contributors）', () => {
    render(<DonatePage />);
    const entry = screen.getByRole('link', { name: /进入贡献者宇宙/ });
    expect(entry).toHaveAttribute('href', CONTRIBUTORS_PAGE_PATH);
  });

  it('返回主站链接指向 /', () => {
    render(<DonatePage />);
    const back = screen.getAllByRole('link', { name: /返回星图/ });
    expect(back.length).toBeGreaterThan(0);
    expect(back[0]).toHaveAttribute('href', '/');
  });

  it('EN 切换后标题、渠道与占位文案切英文', () => {
    render(<DonatePage />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('heading', { name: /Fuel the Voyage/ })).toBeInTheDocument();
    expect(screen.getAllByText('Reserved · coming soon')).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: /Pay with Alipay on the unlock page/ }),
    ).toHaveAttribute('href', UNLOCK_PAGE_PATH);
    expect(screen.getByRole('heading', { name: /Alipay QR Pay/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Support on Afdian/ })).toHaveAttribute(
      'href',
      SPONSOR_AFDIAN_URL,
    );
    expect(
      screen.getByRole('link', { name: /Enter the Contributor Universe/ }),
    ).toHaveAttribute('href', CONTRIBUTORS_PAGE_PATH);
  });
});
