/**
 * 捐赠页 /donate 单测（空名单上线态；Z 迭代 M3 改版，需求 E2(a)）：
 * - 标题/说明（"支持即解锁"口径）渲染
 * - 渠道顺序断言：支付宝（推荐引导面板）→ 微信（独立 panel）→ 爱发电 →
 *   Ko-fi → 预留位（对齐 stock test_pages_recommend_alipay_and_channel_order）
 * - 支付宝面板：引导口径 + 「前往解锁页扫码支付 →」跳 /unlock（modal 不进本页）
 * - 微信 panel：内嵌二维码图 + 可复制邮件模板 + 预填 mailto（与 /unlock 同源）
 * - 爱发电/Ko-fi 备选卡片链接（同源常量）+ 两个预留位
 * - 空名单占位文案 + 贡献者宇宙入口
 * - zh/EN 语言切换
 */

import { fireEvent, render, screen } from '@testing-library/react';

import DonatePage from '@/app/donate/page';
import {
  CONTACT_EMAIL,
  SPONSOR_AFDIAN_URL,
  UNLOCK_PAGE_PATH,
} from '@/components/UI/ContactBadge';
import { SPONSOR_KOFI_URL } from '@/data/donationPlatforms';
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

  it('M3 渠道顺序：支付宝 → 微信 → 爱发电 → Ko-fi → 预留位', () => {
    render(<DonatePage />);
    const reserved = screen.getAllByText('预留位 · 即将开通');
    expect(reserved).toHaveLength(2);
    expectDomOrder([
      screen.getByRole('heading', { name: /支付宝扫码支付/ }),
      screen.getByRole('heading', { name: /微信赞赏码/ }),
      screen.getByText('⚡ 爱发电'),
      screen.getByText('☕ Ko-fi'),
      reserved[0],
      reserved[1],
    ]);
  });

  it('支付宝引导面板：推荐口径 + 跳解锁页链接（付款 modal 不进本页）', () => {
    render(<DonatePage />);
    expect(screen.getByText(/支付成功后自动发放解锁 token 并即时解锁/)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /前往解锁页扫码支付/ });
    expect(cta).toHaveAttribute('href', UNLOCK_PAGE_PATH);
  });

  it('微信 panel 轻量化（M4 后续微调）：默认收起，展开后出二维码 + 人工核验口径', () => {
    render(<DonatePage />);
    // 默认态：二维码/邮件模板不可见，人工核验口径常显
    expect(screen.queryByRole('img', { name: '微信赞赏码' })).not.toBeInTheDocument();
    expect(screen.getByText(/需人工处理，解锁 token 只经 Email 发送/)).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /展开微信支付步骤/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    const qr = screen.getByRole('img', { name: '微信赞赏码' });
    expect(qr).toHaveAttribute('src', '/donate/wechat-tip-code.jpg');
    expect(screen.getByText(/微信内长按识别/)).toBeInTheDocument();
  });

  it('微信 panel：展开后邮件模板可复制 + mailto 预填主题与正文（同源邮箱）', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<DonatePage />);
    // 默认收起：模板不可见（轻量化断言）
    expect(
      screen.queryByText(new RegExp(`收件人: ${CONTACT_EMAIL}`)),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /展开微信支付步骤/ }));
    // 模板文本含收件人（同源邮箱）与主题行
    expect(
      screen.getByText(new RegExp(`收件人: ${CONTACT_EMAIL}`)),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /复制邮件模板/ }));
    expect(await screen.findByText(/已复制/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`收件人: ${CONTACT_EMAIL}`),
    );
    // mailto 预填：subject + body 双参数
    const mailto = screen.getByRole('link', { name: /打开邮件客户端/ });
    const href = mailto.getAttribute('href') ?? '';
    expect(href).toContain(`mailto:${CONTACT_EMAIL}`);
    expect(href).toContain('subject=');
    expect(href).toContain('body=');
  });

  it('爱发电/Ko-fi 备选卡片为可用链接（同源常量，新标签页）+ 备选口径说明', () => {
    render(<DonatePage />);
    const links = screen.getAllByRole('link', { name: '前往支持' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      SPONSOR_AFDIAN_URL,
      SPONSOR_KOFI_URL,
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
    }
    expect(screen.getByText(/凭订单号在解锁页自动兑换/)).toBeInTheDocument();
    expect(screen.getByText(/海外备选/)).toBeInTheDocument();
  });

  it('GitHub Sponsors/Buy Me a Coffee 显示预留位', () => {
    render(<DonatePage />);
    expect(screen.getAllByText('预留位 · 即将开通')).toHaveLength(2);
    expect(screen.getByText(/GitHub Sponsors/)).toBeInTheDocument();
    expect(screen.getByText(/Buy Me a Coffee/)).toBeInTheDocument();
  });

  it('空名单显示占位文案与降序排列说明', () => {
    render(<DonatePage />);
    expect(screen.getByText(/虚位以待/)).toBeInTheDocument();
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
    expect(
      screen.getByRole('link', { name: /Enter the Contributor Universe/ }),
    ).toHaveAttribute('href', CONTRIBUTORS_PAGE_PATH);
  });
});
