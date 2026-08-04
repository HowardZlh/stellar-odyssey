/**
 * 控制面板收起/展开单测（UI 布局优化）：
 * - 右缘把手按钮切换收起态（store 联动）
 * - 收起时面板向左平移出屏（aria-hidden）、把手保留可展开
 */

import { fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { ControlPanel } from '../ControlPanel';

function resetState(): void {
  useSimulationStore.setState({
    controlPanelCollapsed: false,
    immersiveMode: false,
    locale: 'zh',
  });
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('ControlPanel 收起/展开', () => {
  it('默认展开：把手为「收起控制面板」，面板内容可见', () => {
    render(<ControlPanel />);
    const handle = screen.getByRole('button', { name: '收起控制面板' });
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('星海奥德赛')).toBeVisible();
  });

  it('点击把手收起：store 置位、把手切为「展开控制面板」、面板 aria-hidden', () => {
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole('button', { name: '收起控制面板' }));
    expect(useSimulationStore.getState().controlPanelCollapsed).toBe(true);
    const handle = screen.getByRole('button', { name: '展开控制面板' });
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    // 面板内容对辅助技术隐藏（视觉上向左平移出屏，组件不卸载）
    expect(screen.getByText('星海奥德赛').closest('[aria-hidden]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('再次点击把手展开', () => {
    useSimulationStore.setState({ controlPanelCollapsed: true });
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole('button', { name: '展开控制面板' }));
    expect(useSimulationStore.getState().controlPanelCollapsed).toBe(false);
    expect(screen.getByRole('button', { name: '收起控制面板' })).toBeInTheDocument();
  });

  it('沉浸模式联动：setImmersiveMode(true) 后面板收起', () => {
    render(<ControlPanel />);
    useSimulationStore.getState().setImmersiveMode(true);
    expect(useSimulationStore.getState().controlPanelCollapsed).toBe(true);
  });
});
