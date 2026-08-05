/**
 * 贡献者宇宙页 /contributors 单测（空名单上线态，C2）：
 * - 标题/副标题/说明（陈述口径）渲染
 * - WebGL 降级态：提示文案 + 文字名单区可用（不白屏）
 * - 3D 态（stub Canvas）：空名单占位 + 前往捐赠入口 + 桌面操作提示
 * - zh/EN 语言切换
 *
 * 3D 组件经 jest.mock 以 stub 替换（附录 A：勿在 jsdom 跑真 WebGL）。
 */

import { fireEvent, render, screen } from '@testing-library/react';

import ContributorsPage from '@/app/contributors/page';
import { useSimulationStore } from '@/store';

const mockDetectWebglSupport = jest.fn<boolean, []>();

jest.mock('@/components/Scene/ContributorUniverse', () => ({
  __esModule: true,
  ContributorUniverseCanvas: () => <div data-testid="contributor-canvas-stub" />,
  detectWebglSupport: (): boolean => mockDetectWebglSupport(),
}));

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
  jest.clearAllMocks();
});

describe('ContributorsPage（空名单，WebGL 降级态）', () => {
  beforeEach(() => {
    mockDetectWebglSupport.mockReturnValue(false);
  });

  it('渲染标题、副标题与陈述口径说明', () => {
    render(<ContributorsPage />);
    expect(screen.getByRole('heading', { name: /贡献者宇宙/ })).toBeInTheDocument();
    expect(screen.getByText(/这里陈列了每一位支持者/)).toBeInTheDocument();
    expect(screen.getByText(/对数映射呈现/)).toBeInTheDocument();
  });

  it('WebGL 不可用时显示降级提示且不渲染 Canvas（不白屏）', () => {
    render(<ContributorsPage />);
    expect(screen.getByText(/已切换为文字名单/)).toBeInTheDocument();
    expect(screen.queryByTestId('contributor-canvas-stub')).not.toBeInTheDocument();
  });

  it('文字名单区显示空名单占位与排序注记', () => {
    render(<ContributorsPage />);
    expect(screen.getByText(/虚位以待/)).toBeInTheDocument();
    expect(screen.getByText(/按累计捐赠金额降序排列/)).toBeInTheDocument();
  });

  it('返回主站与前往捐赠链接可达', () => {
    render(<ContributorsPage />);
    const back = screen.getAllByRole('link', { name: /返回星图/ });
    expect(back.length).toBeGreaterThan(0);
    expect(back[0]).toHaveAttribute('href', '/');
    const donate = screen.getByRole('link', { name: /前往捐赠页/ });
    expect(donate).toHaveAttribute('href', '/donate');
  });

  it('EN 切换后标题与降级提示切英文', () => {
    render(<ContributorsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(
      screen.getByRole('heading', { name: /Contributor Universe/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/showing the text roster instead/)).toBeInTheDocument();
    expect(screen.getByText(/This spot is waiting/)).toBeInTheDocument();
  });
});

describe('ContributorsPage（空名单，3D 态 stub）', () => {
  beforeEach(() => {
    mockDetectWebglSupport.mockReturnValue(true);
  });

  it('渲染 Canvas 区并叠加空名单占位与捐赠入口', () => {
    render(<ContributorsPage />);
    expect(screen.getByTestId('contributor-canvas-stub')).toBeInTheDocument();
    // 空名单占位：3D 区中央叠加 + 文字名单区各一处
    expect(screen.getAllByText(/虚位以待/)).toHaveLength(2);
    const goDonate = screen.getAllByRole('link', { name: /前往捐赠页/ });
    expect(goDonate.length).toBeGreaterThanOrEqual(2);
    expect(goDonate[0]).toHaveAttribute('href', '/donate');
  });

  it('显示桌面操作提示（拖动环视/滚轮缩放/点击）', () => {
    render(<ContributorsPage />);
    expect(screen.getByText(/拖动环视 · 滚轮缩放 · 点击星星查看详情/)).toBeInTheDocument();
  });
});
