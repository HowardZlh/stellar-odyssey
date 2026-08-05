/**
 * 贡献者宇宙页移动端适配单测（C3，REQUIREMENTS_CONTRIBUTORS §C3）：
 * - isTouch 操作提示文案分流（触屏版/桌面版）+ isTouch 透传 Canvas
 * - 渲染档位透传：deviceTier → contributorCanvasQuality → Canvas quality
 * - isCompact 详情卡布局分流（底部卡片 50dvh+safe-b / 桌面右上悬浮卡）
 * - 画布容器 touch-none / UI 层 touch-manipulation（M1-2 口径）
 *
 * 判据经 jest.mock 注入（useViewportKind / store deviceTier），
 * 3D 组件以 stub 替换并捕获 props（附录 A：勿在 jsdom 跑真 WebGL）。
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import ContributorsPage from '@/app/contributors/page';
import { useSimulationStore } from '@/store';
import type { ContributorCanvasQuality } from '@/utils/contributorUniverse';

// mock 名单（详情卡分流测试需要至少一颗星）
jest.mock('@/data/donors', () => ({
  DONORS: [
    { name: '彗星', amountCny: 100, platform: 'afdian', date: '2026-07-01', message: '加油' },
  ],
}));

// M1 视口判据注入（页面消费 useViewportKind 返回值，禁止自建检测）
const mockViewport = {
  isTouch: false,
  isCompact: false,
  orientation: 'portrait' as const,
};

jest.mock('@/hooks/useViewportKind', () => ({
  __esModule: true,
  useViewportKind: (): typeof mockViewport => mockViewport,
  useDeviceTierInit: (): void => undefined,
}));

interface CanvasStubProps {
  onSelectStar: (index: number | null) => void;
  isTouch: boolean;
  quality: ContributorCanvasQuality;
}

let lastCanvasProps: CanvasStubProps | null = null;
const mockDetectWebglSupport = jest.fn<boolean, []>();

jest.mock('@/components/Scene/ContributorUniverse', () => ({
  __esModule: true,
  ContributorUniverseCanvas: (props: CanvasStubProps) => {
    lastCanvasProps = props;
    return (
      <div data-testid="contributor-canvas-stub">
        <button type="button" onClick={() => props.onSelectStar(0)}>
          stub-select-star
        </button>
      </div>
    );
  },
  detectWebglSupport: (): boolean => mockDetectWebglSupport(),
}));

beforeEach(() => {
  mockDetectWebglSupport.mockReturnValue(true);
  mockViewport.isTouch = false;
  mockViewport.isCompact = false;
  lastCanvasProps = null;
});

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh', deviceTier: 'high' });
  window.localStorage.clear();
  jest.clearAllMocks();
});

describe('C3-1 isTouch 交互分流', () => {
  it('桌面态：显示桌面操作提示，isTouch=false 透传 Canvas', () => {
    render(<ContributorsPage />);
    expect(
      screen.getByText('拖动环视 · 滚轮缩放 · 点击星星查看详情'),
    ).toBeInTheDocument();
    expect(lastCanvasProps?.isTouch).toBe(false);
  });

  it('触屏态：显示触屏操作提示（单指环视/双指缩放/点按聚焦），isTouch=true 透传', () => {
    mockViewport.isTouch = true;
    render(<ContributorsPage />);
    expect(
      screen.getByText('单指拖动环视 · 双指缩放 · 点按聚焦贡献者'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('拖动环视 · 滚轮缩放 · 点击星星查看详情'),
    ).not.toBeInTheDocument();
    expect(lastCanvasProps?.isTouch).toBe(true);
  });

  it('触屏态 EN：触屏提示切英文', () => {
    mockViewport.isTouch = true;
    render(<ContributorsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByText(/tap to focus on a contributor/)).toBeInTheDocument();
  });
});

describe('C3-2 渲染档位透传（deviceTier → quality props）', () => {
  it('high：dpr [1,2] / antialias true / 背景星场 3000 / 全密度边界球', () => {
    useSimulationStore.setState({ deviceTier: 'high' });
    render(<ContributorsPage />);
    expect(lastCanvasProps?.quality).toEqual({
      dpr: [1, 2],
      antialias: true,
      backgroundStarCount: 3000,
      boundarySphere: { radius: 110, latitudeLines: 11, longitudeLines: 12, arcSegments: 96 },
    });
  });

  it('medium：dpr [1,1.5] / antialias false / 背景星场 3000 / 全密度边界球', () => {
    useSimulationStore.setState({ deviceTier: 'medium' });
    render(<ContributorsPage />);
    expect(lastCanvasProps?.quality).toEqual({
      dpr: [1, 1.5],
      antialias: false,
      backgroundStarCount: 3000,
      boundarySphere: { radius: 110, latitudeLines: 11, longitudeLines: 12, arcSegments: 96 },
    });
  });

  it('low：dpr 1 / antialias false / 背景星场 1500 / 经纬密度减半边界球', () => {
    useSimulationStore.setState({ deviceTier: 'low' });
    render(<ContributorsPage />);
    expect(lastCanvasProps?.quality).toEqual({
      dpr: 1,
      antialias: false,
      backgroundStarCount: 1500,
      boundarySphere: { radius: 110, latitudeLines: 5, longitudeLines: 6, arcSegments: 48 },
    });
  });
});

describe('C3-3 isCompact 详情卡布局分流', () => {
  it('桌面态：详情卡为画布右上悬浮卡', () => {
    render(<ContributorsPage />);
    fireEvent.click(screen.getByText('stub-select-star'));
    const card = screen.getByRole('complementary');
    expect(card.className).toContain('right-4');
    expect(card.className).toContain('top-4');
    expect(card.className).not.toContain('bottom-0');
  });

  it('紧凑视口：详情卡为底部卡片（inset-x-0 bottom-0 + 50dvh 限高 + safe-b）', () => {
    mockViewport.isCompact = true;
    render(<ContributorsPage />);
    fireEvent.click(screen.getByText('stub-select-star'));
    const card = screen.getByRole('complementary');
    expect(card.className).toContain('fixed');
    expect(card.className).toContain('inset-x-0');
    expect(card.className).toContain('bottom-0');
    expect(card.className).toContain('max-h-[50dvh]');
    expect(card.className).toContain('safe-area-inset-bottom');
  });

  it('紧凑视口：关闭按钮 ≥44×44pt 可关闭详情卡', () => {
    mockViewport.isCompact = true;
    render(<ContributorsPage />);
    fireEvent.click(screen.getByText('stub-select-star'));
    const close = screen.getByRole('button', { name: '关闭详情卡' });
    expect(close.className).toContain('h-11');
    expect(close.className).toContain('w-11');
    fireEvent.click(close);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('点画布空白关闭：Canvas onSelectStar(null) 清除详情卡', () => {
    mockViewport.isCompact = true;
    render(<ContributorsPage />);
    fireEvent.click(screen.getByText('stub-select-star'));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    act(() => {
      lastCanvasProps?.onSelectStar(null);
    });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});

describe('C3 touch-action 原子类（M1-2 口径）', () => {
  it('画布容器 touch-none、UI 容器 touch-manipulation', () => {
    render(<ContributorsPage />);
    const canvasWrapper = screen.getByTestId('contributor-canvas-stub').parentElement;
    expect(canvasWrapper?.className).toContain('touch-none');
    expect(document.querySelector('.touch-manipulation')).not.toBeNull();
  });
});
