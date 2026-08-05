/**
 * 捐赠页名单渲染单测（mock 名单）：按金额降序展示、金额千分组、留言可见
 */

import { render, screen } from '@testing-library/react';

import DonatePage from '@/app/donate/page';
import { useSimulationStore } from '@/store';

jest.mock('@/data/donors', () => ({
  DONORS: [
    { name: '小行星', amountCny: 20, platform: 'afdian', date: '2026-07-01' },
    { name: '彗星', amountCny: 1200, platform: 'wechat', date: '2026-07-02', message: '加油' },
    { name: '流星', amountCny: 66, platform: 'kofi', date: '2026-07-03' },
  ],
}));

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
});

describe('DonatePage 捐赠名单', () => {
  it('按金额降序排列（数据文件顺序无关）', () => {
    render(<DonatePage />);
    const items = screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('#'));
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('彗星');
    expect(items[1].textContent).toContain('流星');
    expect(items[2].textContent).toContain('小行星');
  });

  it('金额千分组显示、留言可见、无空名单占位', () => {
    render(<DonatePage />);
    expect(screen.getByText('¥1,200')).toBeInTheDocument();
    expect(screen.getByText(/加油/)).toBeInTheDocument();
    expect(screen.queryByText(/虚位以待/)).not.toBeInTheDocument();
  });

  it('非空名单同样显示贡献者宇宙入口（C4-1，指向 /contributors）', () => {
    render(<DonatePage />);
    const entry = screen.getByRole('link', { name: /进入贡献者宇宙/ });
    expect(entry).toHaveAttribute('href', '/contributors');
  });
});
