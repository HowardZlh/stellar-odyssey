/**
 * 燃料补给名单共享小节单测（/donate 与 /unlock 统一展示）：
 * - 标题总计数（真实合并名单的事实陈述）
 * - Top-N 截断：>maxItems 时只显前 N 条 + 幽灵行「还有 N 位支持者——进入
 *   贡献者宇宙查看全部」（整行链接 → /contributors），普通入口不重复出现
 * - ≤maxItems / 未传 maxItems：全量展示 + 普通「进入贡献者宇宙」入口，
 *   无"更多"信号（人少时不产生反向社会证明）
 * - zh/EN 切换
 *
 * 名单数据经 jest.mock(@/data/donors) 注入 7 条；无 global.fetch 环境下
 * 远程拉取静默降级（hook 既有口径），名单即静态 7 条。
 */

import { render, screen } from '@testing-library/react';

import { ContributorsRosterSection } from '@/components/UI/ContributorsRosterSection';
import { useSimulationStore } from '@/store';

jest.mock('@/data/donors', () => ({
  DONORS: Array.from({ length: 7 }, (_, i) => ({
    id: `d${i + 1}`,
    name: `星友${i + 1}`,
    amountCny: 700 - i * 100, // 700, 600, …, 100（降序）
    platform: 'afdian',
    date: '2026-08-01',
  })),
}));

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
});

/** 名单条目（#排名前缀行） */
function rosterItems(): HTMLElement[] {
  return screen
    .getAllByRole('listitem')
    .filter((li) => /#\d/.test(li.textContent ?? ''));
}

describe('ContributorsRosterSection 截断与计数', () => {
  it('未传 maxItems：全量 7 条 + 标题总计数 + 普通入口，无幽灵行', () => {
    render(<ContributorsRosterSection />);
    expect(screen.getByText('燃料补给名单')).toBeInTheDocument();
    expect(screen.getByText('共 7 位')).toBeInTheDocument();
    expect(rosterItems()).toHaveLength(7);
    const entry = screen.getByRole('link', { name: /进入贡献者宇宙/ });
    expect(entry).toHaveAttribute('href', '/contributors');
    expect(screen.queryByText(/还有 \d+ 位支持者/)).not.toBeInTheDocument();
  });

  it('maxItems=5 且 7 位：只显 Top 5 + 幽灵行「还有 2 位支持者」链接，普通入口不重复', () => {
    render(<ContributorsRosterSection maxItems={5} />);
    expect(screen.getByText('共 7 位')).toBeInTheDocument();
    const items = rosterItems();
    expect(items).toHaveLength(5);
    // Top 5 按金额降序：¥700 在首、¥300 在尾，¥200/¥100 被截断
    expect(items[0].textContent).toContain('星友1');
    expect(items[4].textContent).toContain('星友5');
    expect(screen.queryByText('星友6')).not.toBeInTheDocument();
    // 幽灵行：真实剩余计数 + 整行链接 → /contributors
    const more = screen.getByRole('link', {
      name: /还有 2 位支持者——进入贡献者宇宙查看全部/,
    });
    expect(more).toHaveAttribute('href', '/contributors');
    // 普通入口不与幽灵行同时出现（避免重复链接）
    expect(
      screen.queryByRole('link', { name: /^✨ 进入贡献者宇宙$/ }),
    ).not.toBeInTheDocument();
  });

  it('maxItems ≥ 名单长度：全量展示 + 普通入口（无截断信号）', () => {
    render(<ContributorsRosterSection maxItems={10} />);
    expect(rosterItems()).toHaveLength(7);
    expect(screen.queryByText(/还有 \d+ 位支持者/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /进入贡献者宇宙/ }),
    ).toHaveAttribute('href', '/contributors');
  });

  it('EN 态：标题计数与幽灵行切英文', () => {
    useSimulationStore.setState({ locale: 'en' });
    render(<ContributorsRosterSection maxItems={5} />);
    expect(screen.getByText('Fuel supply roster')).toBeInTheDocument();
    expect(screen.getByText('7 supporters')).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: /2 more supporters — enter the Contributor Universe to see them all/,
      }),
    ).toHaveAttribute('href', '/contributors');
  });
});
