/**
 * 贡献者宇宙页 mock 名单单测（C2，跨数量级 ¥5~¥10000）：
 * - 文字名单按金额降序、金额千分组、留言可见
 * - 点击星（stub Canvas 转发 onSelectStar）→ 详情卡字段齐全 → 关闭
 * - 详情卡平台名 zh/EN 双语切换
 * - WebGL 降级态名单仍可用
 */

import { fireEvent, render, screen } from '@testing-library/react';

import ContributorsPage from '@/app/contributors/page';
import { useSimulationStore } from '@/store';

// 跨数量级 mock 名单（含同额、有/无留言、多平台）
jest.mock('@/data/donors', () => ({
  DONORS: [
    { name: '小行星', amountCny: 5, platform: 'afdian', date: '2026-07-01' },
    { name: '彗星', amountCny: 10000, platform: 'wechat', date: '2026-07-02', message: '飞得更远' },
    { name: '流星', amountCny: 66, platform: 'kofi', date: '2026-07-03' },
    { name: '尘埃', amountCny: 88, platform: 'afdian', date: '2026-07-04' },
    { name: '微尘', amountCny: 88, platform: 'buymeacoffee', date: '2026-07-05', message: '加油' },
    { name: '卫星', amountCny: 520, platform: 'github-sponsors', date: '2026-07-06' },
    { name: '行星', amountCny: 1200, platform: 'afdian', date: '2026-07-07' },
    { name: '恒星', amountCny: 3000, platform: 'wechat', date: '2026-07-08' },
  ],
}));

interface CanvasStubProps {
  onSelectStar: (index: number | null) => void;
}

const mockDetectWebglSupport = jest.fn<boolean, []>();

jest.mock('@/components/Scene/ContributorUniverse', () => ({
  __esModule: true,
  // stub Canvas：暴露按钮转发 onSelectStar（0 = 金额最高者，名单已降序）
  ContributorUniverseCanvas: ({ onSelectStar }: CanvasStubProps) => (
    <div data-testid="contributor-canvas-stub">
      <button type="button" onClick={() => onSelectStar(0)}>
        stub-select-top-star
      </button>
    </div>
  ),
  detectWebglSupport: (): boolean => mockDetectWebglSupport(),
}));

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
  jest.clearAllMocks();
});

describe('ContributorsPage mock 名单（3D 态 stub）', () => {
  beforeEach(() => {
    mockDetectWebglSupport.mockReturnValue(true);
  });

  it('文字名单按金额降序、千分组金额、留言可见、无空名单占位', () => {
    render(<ContributorsPage />);
    const items = screen
      .getAllByRole('listitem')
      .filter((li) => li.textContent?.includes('#'));
    expect(items).toHaveLength(8);
    expect(items[0].textContent).toContain('彗星');
    expect(items[0].textContent).toContain('¥10,000');
    expect(items[1].textContent).toContain('恒星');
    expect(items[7].textContent).toContain('小行星');
    expect(screen.getByText(/飞得更远/)).toBeInTheDocument();
    expect(screen.queryByText(/虚位以待/)).not.toBeInTheDocument();
  });

  it('点击星打开详情卡：昵称/金额/日期/平台/留言齐全，可关闭', () => {
    render(<ContributorsPage />);
    fireEvent.click(screen.getByText('stub-select-top-star'));

    const card = screen.getByRole('complementary');
    expect(card.textContent).toContain('彗星');
    expect(card.textContent).toContain('¥10,000');
    expect(card.textContent).toContain('2026-07-02');
    expect(card.textContent).toContain('微信赞赏码');
    expect(card.textContent).toContain('「飞得更远」');

    fireEvent.click(screen.getByRole('button', { name: '关闭详情卡' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('EN 态详情卡字段标签与平台名切英文', () => {
    render(<ContributorsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    fireEvent.click(screen.getByText('stub-select-top-star'));

    const card = screen.getByRole('complementary');
    expect(card.textContent).toContain('WeChat Tip Code');
    expect(card.textContent).toContain('Amount');
    expect(card.textContent).toContain('Message');
    expect(screen.getByRole('button', { name: 'Close details' })).toBeInTheDocument();
  });
});

describe('ContributorsPage mock 名单（WebGL 降级态）', () => {
  beforeEach(() => {
    mockDetectWebglSupport.mockReturnValue(false);
  });

  it('降级提示 + 完整文字名单仍可用（不白屏）', () => {
    render(<ContributorsPage />);
    expect(screen.getByText(/已切换为文字名单/)).toBeInTheDocument();
    expect(screen.queryByTestId('contributor-canvas-stub')).not.toBeInTheDocument();
    const items = screen
      .getAllByRole('listitem')
      .filter((li) => li.textContent?.includes('#'));
    expect(items).toHaveLength(8);
  });
});
