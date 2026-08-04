/**
 * 信息面板收起/滚动功能单测：
 * - 收起后隐藏中间信息列表与数据来源行，保留标题栏与操作按钮区（B 方案）
 * - 收起状态跨天体切换保持（建议方案）
 * - 展开态内容区带滚动样式（max-h 70vh + overflow-y-auto，推荐值）
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { HudInfo } from '../HudInfo';

const initialState = useSimulationStore.getState();

afterEach(() => {
  useSimulationStore.setState(initialState, true);
  window.localStorage.clear();
});

describe('HudInfo 信息面板收起/展开', () => {
  it('默认展开：显示信息列表、数据来源与收起按钮（aria-expanded=true）', () => {
    useSimulationStore.setState({ selectedBodyId: 'earth' });
    render(<HudInfo />);
    expect(screen.getByText('质量')).toBeInTheDocument();
    expect(screen.getByText(/^数据来源：/)).toBeInTheDocument();
    const collapseBtn = screen.getByRole('button', { name: '收起信息面板内容' });
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('点击收起：隐藏数据来源行，保留标题与飞往/跟随按钮，按钮切换为展开', () => {
    useSimulationStore.setState({ selectedBodyId: 'earth' });
    render(<HudInfo />);
    fireEvent.click(screen.getByRole('button', { name: '收起信息面板内容' }));
    // 数据来源行随信息列表隐藏
    expect(screen.queryByText(/^数据来源：/)).not.toBeInTheDocument();
    // 标题栏与底部操作按钮区保留
    expect(screen.getByText('地球（Earth）')).toBeInTheDocument();
    expect(screen.getByText(/飞往（F）/)).toBeInTheDocument();
    expect(screen.getByText(/🔒 跟随/)).toBeInTheDocument();
    const expandBtn = screen.getByRole('button', { name: '展开信息面板内容' });
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
    // 再次点击恢复展开
    fireEvent.click(expandBtn);
    expect(screen.getByText(/^数据来源：/)).toBeInTheDocument();
  });

  it('收起状态跨天体切换保持', () => {
    useSimulationStore.setState({ selectedBodyId: 'earth' });
    render(<HudInfo />);
    fireEvent.click(screen.getByRole('button', { name: '收起信息面板内容' }));
    act(() => {
      useSimulationStore.setState({ selectedBodyId: 'mars' });
    });
    // 切换天体后仍为收起态
    expect(screen.getByRole('button', { name: '展开信息面板内容' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText(/^数据来源：/)).not.toBeInTheDocument();
  });

  it('面板容器限高 70vh，展开态内容区可纵向滚动（hud-scroll）', () => {
    useSimulationStore.setState({ selectedBodyId: 'sun' });
    const { container } = render(<HudInfo />);
    const panel = container.querySelector('.max-h-\\[70vh\\]');
    expect(panel).not.toBeNull();
    const scrollArea = container.querySelector('.hud-scroll');
    expect(scrollArea).not.toBeNull();
    expect(scrollArea?.className).toContain('overflow-y-auto');
  });

  it('en 态收起/展开按钮 aria 标签为英文', () => {
    useSimulationStore.setState({ locale: 'en', selectedBodyId: 'earth' });
    render(<HudInfo />);
    const collapseBtn = screen.getByRole('button', { name: 'Collapse info panel content' });
    fireEvent.click(collapseBtn);
    expect(
      screen.getByRole('button', { name: 'Expand info panel content' }),
    ).toBeInTheDocument();
  });
});
