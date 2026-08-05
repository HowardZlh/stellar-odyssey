/**
 * 捐赠页 /donate 单测（空名单上线态）：
 * - 标题/说明（零回报承诺口径）渲染
 * - 平台卡片：爱发电/Ko-fi 可用链接（同源常量）+ 微信赞赏码二维码展开/收起 + 两个预留位
 * - 空名单占位文案
 * - zh/EN 语言切换
 */

import { fireEvent, render, screen } from '@testing-library/react';

import DonatePage from '@/app/donate/page';
import { SPONSOR_AFDIAN_URL } from '@/components/UI/ContactBadge';
import { SPONSOR_KOFI_URL } from '@/data/donationPlatforms';
import { CONTRIBUTORS_PAGE_PATH } from '@/utils/contributorUniverse';
import { useSimulationStore } from '@/store';

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
});

describe('DonatePage 渲染（空名单）', () => {
  it('渲染标题、副标题与零回报口径说明', () => {
    render(<DonatePage />);
    expect(screen.getByRole('heading', { name: /投喂燃料/ })).toBeInTheDocument();
    expect(screen.getByText('为星海奥德赛添一把燃料')).toBeInTheDocument();
    expect(screen.getByText(/不构成任何回报或更新义务的承诺/)).toBeInTheDocument();
  });

  it('爱发电/Ko-fi 卡片为可用链接（同源常量，新标签页）', () => {
    render(<DonatePage />);
    const links = screen.getAllByRole('link', { name: '前往捐赠' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      SPONSOR_AFDIAN_URL,
      SPONSOR_KOFI_URL,
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
    }
  });

  it('GitHub Sponsors/Buy Me a Coffee 显示预留位', () => {
    render(<DonatePage />);
    expect(screen.getAllByText('预留位 · 即将开通')).toHaveLength(2);
    expect(screen.getByText(/微信赞赏码/)).toBeInTheDocument();
    expect(screen.getByText(/GitHub Sponsors/)).toBeInTheDocument();
    expect(screen.getByText(/Ko-fi/)).toBeInTheDocument();
    expect(screen.getByText(/Buy Me a Coffee/)).toBeInTheDocument();
  });

  it('微信赞赏码卡片：点按展开二维码与提示、再点收起', () => {
    render(<DonatePage />);
    // 初始：仅「查看赞赏码」按钮，无二维码图
    expect(screen.queryByRole('img', { name: '微信赞赏码' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '查看赞赏码' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // 展开：二维码图 + 双路径提示 + 按钮转「收起」
    fireEvent.click(toggle);
    const qr = screen.getByRole('img', { name: '微信赞赏码' });
    expect(qr).toHaveAttribute('src', '/donate/wechat-tip-code.jpg');
    expect(screen.getByText(/微信内长按识别/)).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // 收起（按钮再点）
    fireEvent.click(screen.getByRole('button', { name: '收起赞赏码' }));
    expect(screen.queryByRole('img', { name: '微信赞赏码' })).not.toBeInTheDocument();
  });

  it('微信赞赏码：点按二维码图本身也可收起', () => {
    render(<DonatePage />);
    fireEvent.click(screen.getByRole('button', { name: '查看赞赏码' }));
    fireEvent.click(screen.getByRole('img', { name: '微信赞赏码' }));
    expect(screen.queryByRole('img', { name: '微信赞赏码' })).not.toBeInTheDocument();
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

  it('EN 切换后标题与占位文案切英文', () => {
    render(<DonatePage />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('heading', { name: /Fuel the Voyage/ })).toBeInTheDocument();
    expect(screen.getAllByText('Reserved · coming soon')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Show tip code' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Enter the Contributor Universe/ }),
    ).toHaveAttribute('href', CONTRIBUTORS_PAGE_PATH);
  });
});
