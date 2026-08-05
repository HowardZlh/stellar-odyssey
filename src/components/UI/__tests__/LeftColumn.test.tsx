/**
 * 左侧列容器单测（左下角布局收口）：
 * - 桌面：列容器定位（left-4 / top-4 / bottom-4）与 pointer-events-none、
 *   列序（ControlPanel 首 → SunLayerCard → ContactBadge 尾）
 * - 常驻可见：事件通知/剖面卡触发时 ContactBadge 保持渲染（原避让
 *   隐藏逻辑已删除的集成回归）
 * - 紧凑视口：不套列容器，子组件维持各自移动形态
 */

import { act, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { LeftColumn } from '../LeftColumn';

const initialState = useSimulationStore.getState();

afterEach(() => {
  useSimulationStore.setState(initialState, true);
  window.localStorage.clear();
});

describe('LeftColumn 桌面列容器', () => {
  it('渲染定高列容器（left-4/top-4/bottom-4 + pointer-events-none + flex-col）', () => {
    const { container } = render(<LeftColumn />);
    const column = container.firstElementChild as HTMLElement;
    expect(column.className).toContain('pointer-events-none');
    expect(column.className).toContain('flex-col');
    expect(column.className).toContain('left-4');
    expect(column.className).toContain('top-4');
    expect(column.className).toContain('bottom-4');
  });

  it('列序：ControlPanel 在前、ContactBadge 在后（列 footer）', () => {
    render(<LeftColumn />);
    const handle = screen.getByRole('button', { name: '收起控制面板' });
    const badge = screen.getByRole('button', { name: /商业合作/ });
    expect(
      handle.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('剖面分层选中时 SunLayerCard 出现在列内、位于角标上方，角标仍可见', () => {
    useSimulationStore.setState({ sunCutawayMode: true, sunCutawayLayer: 'core' });
    render(<LeftColumn />);
    const range = screen.getByText('范围');
    const badge = screen.getByRole('button', { name: /商业合作/ });
    expect(badge).toBeInTheDocument();
    expect(
      range.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('事件通知标志触发时角标保持渲染（避让隐藏逻辑已删除）', () => {
    render(<LeftColumn />);
    act(() => {
      useSimulationStore.setState({
        supernovaNoticeVisible: true,
        cmeNoticeVisible: true,
        solarFlareNoticeVisible: true,
        cmeArrivalNoticeVisible: true,
      });
    });
    expect(screen.getByRole('button', { name: /商业合作/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开捐赠页（新标签页）' })).toBeInTheDocument();
  });
});

describe('LeftColumn 紧凑视口分流', () => {
  it('不套列容器：子组件维持各自移动形态（抽屉默认收起、角标不渲染）', () => {
    useSimulationStore.setState({ isCompact: true, isTouch: true });
    const { container } = render(<LeftColumn />);
    // 无桌面列容器
    expect(container.querySelector('.pointer-events-none.flex-col')).toBeNull();
    // 控制抽屉存在且默认收起（aria-hidden）
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // ContactBadge 紧凑视口默认不渲染（入口在底部标签栏）
    expect(screen.queryByRole('button', { name: /商业合作/ })).not.toBeInTheDocument();
  });
});
