/**
 * 捐赠页 /donate 单测（空名单上线态）：
 * - 标题/说明（零回报承诺口径）渲染
 * - 平台卡片：爱发电/Ko-fi 可用链接（同源常量）+ 三个预留位
 * - 空名单占位文案
 * - zh/EN 语言切换
 */

import { fireEvent, render, screen } from '@testing-library/react';

import DonatePage from '@/app/donate/page';
import { SPONSOR_AFDIAN_URL } from '@/components/UI/ContactBadge';
import { SPONSOR_KOFI_URL } from '@/data/donationPlatforms';
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

  it('微信/GitHub Sponsors/Buy Me a Coffee 显示预留位', () => {
    render(<DonatePage />);
    expect(screen.getAllByText('预留位 · 即将开通')).toHaveLength(3);
    expect(screen.getByText(/微信赞赏码/)).toBeInTheDocument();
    expect(screen.getByText(/GitHub Sponsors/)).toBeInTheDocument();
    expect(screen.getByText(/Ko-fi/)).toBeInTheDocument();
    expect(screen.getByText(/Buy Me a Coffee/)).toBeInTheDocument();
  });

  it('空名单显示占位文案与降序排列说明', () => {
    render(<DonatePage />);
    expect(screen.getByText(/虚位以待/)).toBeInTheDocument();
    expect(screen.getByText(/按累计捐赠金额降序排列/)).toBeInTheDocument();
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
    expect(screen.getAllByText('Reserved · coming soon')).toHaveLength(3);
  });
});
