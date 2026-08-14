/**
 * SC5 控制面板「星系色彩增强」开关单测（REQUIREMENTS_STAR_COLORS §SC5-3）：
 * - 显示区渲染开关且默认勾选（store 默认 true）
 * - 点击切换 store（关闭 → 回真实物理色的状态位）
 * - 描述行文案恒显（增强/关闭两态口径说明）
 * - 移动端 isCompact 走 PanelToggle 抽屉范式（MobileLayoutM3 先例直写 store）
 */

import { fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { ControlPanel } from '../ControlPanel';

function resetState(): void {
  useSimulationStore.setState({
    colorBoostEnabled: true,
    controlPanelCollapsed: false,
    immersiveMode: false,
    isCompact: false,
    mobilePanel: null,
    locale: 'zh',
  });
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('ControlPanel 星系色彩增强开关（SC5）', () => {
  it('显示区渲染开关且默认勾选', () => {
    render(<ControlPanel />);
    const toggle = screen.getByRole('checkbox', { name: /星系色彩增强/ });
    expect(toggle).toBeChecked();
  });

  it('描述行恒显（增强口径 + 关闭回真实观测色调说明）', () => {
    render(<ControlPanel />);
    expect(
      screen.getByText(
        '增强红黄/蓝白色彩对比便于分辨恒星与星系类型；关闭后为真实观测色调（对比较弱，偏黄白）',
      ),
    ).toBeInTheDocument();
  });

  it('点击切换 store：取消勾选 → colorBoostEnabled=false，再点回 true', () => {
    render(<ControlPanel />);
    const toggle = screen.getByRole('checkbox', { name: /星系色彩增强/ });
    fireEvent.click(toggle);
    expect(useSimulationStore.getState().colorBoostEnabled).toBe(false);
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(useSimulationStore.getState().colorBoostEnabled).toBe(true);
  });

  it('英文 locale 下开关文案为 Enhanced galaxy colors', () => {
    useSimulationStore.setState({ locale: 'en' });
    render(<ControlPanel />);
    expect(screen.getByRole('checkbox', { name: /Enhanced galaxy colors/ })).toBeChecked();
  });

  it('移动端（isCompact）抽屉展开后开关可达且可切换', () => {
    useSimulationStore.setState({ isCompact: true, mobilePanel: 'controls' });
    render(<ControlPanel />);
    const toggle = screen.getByRole('checkbox', { name: /星系色彩增强/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(useSimulationStore.getState().colorBoostEnabled).toBe(false);
  });
});
