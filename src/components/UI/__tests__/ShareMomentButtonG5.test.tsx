/**
 * 「分享此刻」按钮单测（G5，REQUIREMENTS_GROWTH §3 M2）：
 * - 桌面（isTouch=false）：直接 clipboard 复制 + 成功气泡；即使
 *   navigator.share 存在也不走系统分享面板
 * - 移动（isTouch=true）：优先 navigator.share；不可用降级复制 + 气泡；
 *   share 非取消失败降级复制；用户取消（AbortError）静默
 * - 复制失败：失败气泡（手动复制提示）
 * - URL 口径：仅 body/lang，恒不含 token（硬性约束）
 * - 宿主集成：BodyCycleSwitcher（桌面胶囊）与 BottomTabBar（移动
 *   第五 tab，不占 mobilePanel 互斥值）均渲染分享入口
 *
 * jsdom origin 为 http://localhost（jest.config 未定制 url）。
 * clipboard mock 范式沿用 unlock.test.tsx 先例（defineProperty configurable）。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { BodyCycleSwitcher } from '../BodyCycleSwitcher';
import { BottomTabBar } from '../BottomTabBar';
import { MainShareMomentButton, ShareMomentButton } from '../ShareMomentButton';

const initialState = useSimulationStore.getState();

function mockClipboard(impl?: () => Promise<void>): jest.Mock {
  const writeText = impl ? jest.fn(impl) : jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

function mockShare(impl: () => Promise<void>): jest.Mock {
  const share = jest.fn(impl);
  Object.defineProperty(window.navigator, 'share', {
    value: share,
    configurable: true,
  });
  return share;
}

afterEach(() => {
  useSimulationStore.setState(initialState, true);
  Reflect.deleteProperty(window.navigator, 'share');
  Reflect.deleteProperty(window.navigator, 'clipboard');
  window.localStorage.clear();
  jest.clearAllMocks();
});

describe('ShareMomentButton 桌面复制（isTouch=false）', () => {
  it('点击复制当前天体深链并显示成功气泡；share 存在也不调用', async () => {
    const writeText = mockClipboard();
    const share = mockShare(() => Promise.resolve());
    useSimulationStore.setState({ isTouch: false, followBodyId: 'sgr-a-star' });
    render(<MainShareMomentButton>分享此刻</MainShareMomentButton>);

    fireEvent.click(screen.getByRole('button', { name: /分享此刻/ }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost/?body=sgr-a-star'),
    );
    expect(share).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('链接已复制');
  });

  it('无跟随/无选中天体：复制站点根 URL（零参数）', async () => {
    const writeText = mockClipboard();
    useSimulationStore.setState({
      isTouch: false,
      followBodyId: null,
      selectedBodyId: null,
    });
    render(<MainShareMomentButton>分享此刻</MainShareMomentButton>);

    fireEvent.click(screen.getByRole('button', { name: /分享此刻/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost/'));
  });

  it('未跟随但信息面板有选中天体：取选中天体', async () => {
    const writeText = mockClipboard();
    useSimulationStore.setState({
      isTouch: false,
      followBodyId: null,
      selectedBodyId: 'orion-nebula',
    });
    render(<MainShareMomentButton>分享此刻</MainShareMomentButton>);

    fireEvent.click(screen.getByRole('button', { name: /分享此刻/ }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost/?body=orion-nebula'),
    );
  });

  it('en locale：URL 追加 lang=en；恒不含 token（权益在身也一样）', async () => {
    const writeText = mockClipboard();
    useSimulationStore.setState({
      isTouch: false,
      followBodyId: 'm31',
      locale: 'en',
      entitlement: { tier: 'year', expSec: Math.floor(Date.now() / 1000) + 999 },
    });
    render(<MainShareMomentButton>Share</MainShareMomentButton>);

    fireEvent.click(screen.getByRole('button', { name: /Share this moment/ }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost/?body=m31&lang=en'),
    );
    expect(String(writeText.mock.calls[0][0])).not.toMatch(/token/i);
  });

  it('复制失败：显示失败气泡（手动复制提示）', async () => {
    mockClipboard(() => Promise.reject(new Error('denied')));
    useSimulationStore.setState({ isTouch: false, followBodyId: 'earth' });
    render(<MainShareMomentButton>分享此刻</MainShareMomentButton>);

    fireEvent.click(screen.getByRole('button', { name: /分享此刻/ }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('复制失败'),
    );
  });
});

describe('ShareMomentButton 移动分享（isTouch=true）', () => {
  it('navigator.share 可用：走系统分享面板，不复制、无气泡', async () => {
    const writeText = mockClipboard();
    const share = mockShare(() => Promise.resolve());
    useSimulationStore.setState({ isTouch: true, followBodyId: 'sgr-a-star' });
    render(<MainShareMomentButton>分享此刻</MainShareMomentButton>);

    fireEvent.click(screen.getByRole('button', { name: /分享此刻/ }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({ url: 'http://localhost/?body=sgr-a-star' }),
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('share 不可用：降级 clipboard 复制 + 成功气泡', async () => {
    const writeText = mockClipboard();
    useSimulationStore.setState({ isTouch: true, followBodyId: 'sgr-a-star' });
    render(<MainShareMomentButton>分享此刻</MainShareMomentButton>);

    fireEvent.click(screen.getByRole('button', { name: /分享此刻/ }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost/?body=sgr-a-star'),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('链接已复制');
  });

  it('share 非取消失败：降级复制', async () => {
    const writeText = mockClipboard();
    mockShare(() => Promise.reject(new DOMException('nope', 'NotAllowedError')));
    useSimulationStore.setState({ isTouch: true, followBodyId: 'earth' });
    render(<MainShareMomentButton>分享此刻</MainShareMomentButton>);

    fireEvent.click(screen.getByRole('button', { name: /分享此刻/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  it('用户取消（AbortError）：静默返回，不复制、无气泡', async () => {
    const writeText = mockClipboard();
    const share = mockShare(() =>
      Promise.reject(new DOMException('cancel', 'AbortError')),
    );
    useSimulationStore.setState({ isTouch: true, followBodyId: 'earth' });
    render(<MainShareMomentButton>分享此刻</MainShareMomentButton>);

    fireEvent.click(screen.getByRole('button', { name: /分享此刻/ }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ShareMomentButton 观察站路径形态', () => {
  it('observatory 上下文：复制 /lab/observatory/<id> 路径链接', async () => {
    const writeText = mockClipboard();
    useSimulationStore.setState({ isTouch: false });
    render(
      <ShareMomentButton context={{ kind: 'observatory', bodyId: 'orion-nebula' }}>
        分享此刻
      </ShareMomentButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: /分享此刻/ }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'http://localhost/lab/observatory/orion-nebula',
      ),
    );
  });
});

describe('宿主集成（主场景两入口）', () => {
  it('桌面 BodyCycleSwitcher 胶囊内渲染分享钮', () => {
    useSimulationStore.setState({ isCompact: false });
    render(<BodyCycleSwitcher />);
    expect(screen.getByRole('button', { name: /分享此刻/ })).toBeInTheDocument();
  });

  it('移动 BottomTabBar 渲染分享 tab；点击不改 mobilePanel（互斥语义零改动）', async () => {
    mockClipboard();
    useSimulationStore.setState({ isCompact: true, isTouch: true, mobilePanel: null });
    render(<BottomTabBar />);
    const shareTab = screen.getByRole('button', { name: /分享此刻/ });
    fireEvent.click(shareTab);
    await waitFor(() =>
      expect(useSimulationStore.getState().mobilePanel).toBeNull(),
    );
  });
});
