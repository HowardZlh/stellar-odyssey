/**
 * 贡献者宇宙页动态名单合并单测（Z 迭代 M2，D-z4/§5.3）：
 * - 启动拉取 /api/contributors 与静态 DONORS 合并（金额降序插位）
 * - 空昵称显示「匿名用户」（i18n 键，EN 态切英文）
 * - alipay 渠道详情卡平台名走 i18n（注册表外平台）
 * - 拉取失败 / 形状异常静默降级为仅静态名单（不白屏无报错 UI）
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ContributorsPage from '@/app/contributors/page';
import { useSimulationStore } from '@/store';

jest.mock('@/data/donors', () => ({
  DONORS: [
    { id: 's1', name: '静态甲', amountCny: 50, platform: 'wechat', date: '2026-07-01' },
  ],
}));

interface CanvasStubProps {
  onSelectStar: (index: number | null) => void;
}

jest.mock('@/components/Scene/ContributorUniverse', () => ({
  __esModule: true,
  ContributorUniverseCanvas: ({ onSelectStar }: CanvasStubProps) => (
    <div data-testid="contributor-canvas-stub">
      <button type="button" onClick={() => onSelectStar(0)}>
        stub-select-top-star
      </button>
    </div>
  ),
  detectWebglSupport: (): boolean => true,
}));

/** 动态名单 fixture（Worker /api/contributors 契约体） */
const FEED_BODY = {
  ok: true,
  contributors: [
    {
      nickname: '支付宝甲',
      message: '扫码支持',
      channel: 'alipay',
      amountCny: 88,
      date: '2026-08-17',
    },
    {
      nickname: null,
      message: null,
      channel: 'alipay',
      amountCny: 6,
      date: '2026-08-16',
    },
  ],
};

let fetchImpl: () => Promise<unknown>;

beforeEach(() => {
  fetchImpl = async (): Promise<unknown> => ({ json: async () => FEED_BODY });
  global.fetch = jest.fn((url: unknown) => {
    expect(String(url)).toBe('https://stellar.guushu.com/api/contributors');
    return fetchImpl();
  }) as unknown as typeof fetch;
});

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
  jest.clearAllMocks();
  // @ts-expect-error 清理测试注入的全局 fetch
  delete global.fetch;
});

function rosterItems(): HTMLElement[] {
  return screen
    .getAllByRole('listitem')
    .filter((li) => li.textContent?.includes('#'));
}

describe('动态名单合并（D-z4）', () => {
  it('拉取成功：静态 + 动态合并按金额降序，匿名条目显示「匿名用户」', async () => {
    render(<ContributorsPage />);
    await waitFor(() => {
      expect(rosterItems()).toHaveLength(3);
    });
    const items = rosterItems();
    expect(items[0].textContent).toContain('支付宝甲'); // ¥88
    expect(items[1].textContent).toContain('静态甲'); // ¥50
    expect(items[2].textContent).toContain('匿名用户'); // ¥6
    expect(screen.getByText(/「扫码支持」/)).toBeInTheDocument();
  });

  it('alipay 渠道详情卡：平台名走 i18n（注册表外平台不显示原始 id）', async () => {
    render(<ContributorsPage />);
    await waitFor(() => {
      expect(rosterItems()).toHaveLength(3);
    });
    fireEvent.click(screen.getByText('stub-select-top-star'));
    const card = screen.getByRole('complementary');
    expect(card.textContent).toContain('支付宝甲');
    expect(card.textContent).toContain('支付宝');
    expect(card.textContent).not.toContain('alipay');
  });

  it('EN 态：匿名展示名切英文（Anonymous supporter / Alipay）', async () => {
    render(<ContributorsPage />);
    await waitFor(() => {
      expect(rosterItems()).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByText('Anonymous supporter')).toBeInTheDocument();
  });

  it('拉取失败：静默降级为仅静态名单（无报错 UI）', async () => {
    fetchImpl = async (): Promise<unknown> => {
      throw new Error('offline');
    };
    render(<ContributorsPage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    expect(rosterItems()).toHaveLength(1);
    expect(rosterItems()[0].textContent).toContain('静态甲');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('响应形状异常：同样静默降级', async () => {
    fetchImpl = async (): Promise<unknown> => ({
      json: async () => ({ ok: false }),
    });
    render(<ContributorsPage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    expect(rosterItems()).toHaveLength(1);
  });
});
