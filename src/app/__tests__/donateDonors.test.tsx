/**
 * 捐赠页名单渲染单测（mock 名单）：按金额降序展示、金额千分组、留言可见；
 * 动态名单合并（与 /contributors 同源，修复数据源分裂——远程贡献者本页可见）
 */

import { render, screen, waitFor } from '@testing-library/react';

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
  jest.clearAllMocks();
  // @ts-expect-error 清理测试注入的全局 fetch
  delete global.fetch;
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

describe('DonatePage 动态名单合并（修复数据源分裂：远程贡献者本页可见）', () => {
  const FEED_BODY = {
    ok: true,
    contributors: [
      {
        nickname: '支付宝甲',
        message: '扫码支持',
        channel: 'alipay',
        amountCny: 2000,
        date: '2026-08-17',
      },
      {
        nickname: null,
        message: null,
        channel: 'alipay',
        amountCny: 30,
        date: '2026-08-16',
      },
    ],
  };

  it('拉取成功：静态 + 远程合并按金额降序，匿名条目显示「匿名用户」', async () => {
    global.fetch = jest.fn(
      async () => ({ json: async () => FEED_BODY }) as unknown as Response,
    ) as unknown as typeof fetch;
    render(<DonatePage />);
    // 远程条目上榜后名单稳定——等远程头名(¥2000 支付宝甲)出现即证明合并生效
    await screen.findByText('支付宝甲');
    // 核心断言：远程条目已合并进本页名单（修复前 /donate 只读静态 DONORS，
    // 远程贡献者不可见，与 /contributors 数据源分裂）。静态条目仍在，
    // 匿名远程条目走「匿名用户」展示名、留言可见。
    expect(screen.getByText('支付宝甲')).toBeInTheDocument(); // 远程头名(¥2000)
    expect(screen.getByText('匿名用户')).toBeInTheDocument(); // 远程匿名(¥30)
    expect(screen.getByText(/扫码支持/)).toBeInTheDocument(); // 远程留言
    expect(screen.getByText('小行星')).toBeInTheDocument(); // 静态仍在
    expect(screen.getByText('¥2,000')).toBeInTheDocument(); // 远程金额千分组
    // 降序排列本身由本文件首个用例与 contributorsFeed 合并用例覆盖，此处不重复
  });

  it('拉取失败：静默降级为仅静态名单（无报错 UI）', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    render(<DonatePage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    const rosterItems = screen
      .getAllByRole('listitem')
      .filter((li) => li.textContent?.includes('#'));
    expect(rosterItems).toHaveLength(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
