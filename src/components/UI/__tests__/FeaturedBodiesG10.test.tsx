/**
 * 精选天体直达入口单测（G10 增补，REQUIREMENTS_GROWTH §3 M2 追加裁决）：
 * - 控制面板渲染「精选天体直达」区与 2 个入口（sgr-a-star / orion-nebula）
 * - 点击即飞往并跟随（复用深链 ?body= 等价的 requestFlyTo）：
 *   followBodyId / flyToBodyId / viewLevel(L3) / cycleScope(galaxy) 正确切换
 * - 免费用户（entitlement=null）直达不触发巡游锁定提示（直达 ≠ 巡游，
 *   lockedHint 保持 null——门控与配额零改动的行为面证明）
 * - 移动端（isCompact + mobilePanel='controls'）：点击后关闭控制抽屉
 *   露出场景（mobilePanel 置 null，单值互斥语义不变）
 * - zh/EN 双语文案
 */

import { fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { ControlPanel } from '../ControlPanel';

const initialState = useSimulationStore.getState();

function resetState(): void {
  useSimulationStore.setState(initialState, true);
  useSimulationStore.setState({
    controlPanelCollapsed: false,
    immersiveMode: false,
    isCompact: false,
    mobilePanel: null,
    locale: 'zh',
    entitlement: null,
  });
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  useSimulationStore.setState(initialState, true);
  window.localStorage.clear();
});

describe('ControlPanel 精选天体直达（G10 增补）', () => {
  it('渲染分区标题与两个直达入口（至少含 sgr-a-star / orion-nebula）', () => {
    render(<ControlPanel />);
    expect(screen.getByText('精选天体直达')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /飞往人马座 A\*（黑洞光子环）/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /飞往猎户座星云（体积星云）/ }),
    ).toBeInTheDocument();
  });

  it('点击人马座 A*：飞往并跟随 + 切 L3/galaxy 域（requestFlyTo 路径）', () => {
    render(<ControlPanel />);
    fireEvent.click(
      screen.getByRole('button', { name: /飞往人马座 A\*（黑洞光子环）/ }),
    );
    const s = useSimulationStore.getState();
    expect(s.flyToBodyId).toBe('sgr-a-star');
    expect(s.followBodyId).toBe('sgr-a-star');
    expect(s.selectedBodyId).toBe('sgr-a-star');
    expect(s.viewLevel).toBe('L3');
    expect(s.cycleScope).toBe('galaxy');
  });

  it('点击猎户座星云：飞往并跟随 + 切 L3/galaxy 域', () => {
    render(<ControlPanel />);
    fireEvent.click(
      screen.getByRole('button', { name: /飞往猎户座星云（体积星云）/ }),
    );
    const s = useSimulationStore.getState();
    expect(s.flyToBodyId).toBe('orion-nebula');
    expect(s.followBodyId).toBe('orion-nebula');
    expect(s.viewLevel).toBe('L3');
  });

  it('免费用户直达不触发巡游锁定提示（直达 ≠ 巡游，门控零改动）', () => {
    render(<ControlPanel />);
    fireEvent.click(
      screen.getByRole('button', { name: /飞往人马座 A\*（黑洞光子环）/ }),
    );
    expect(useSimulationStore.getState().entitlement).toBeNull();
    expect(useSimulationStore.getState().lockedHint).toBeNull();
  });

  it('移动端：抽屉内点击直达后关闭控制抽屉（mobilePanel 置 null）', () => {
    useSimulationStore.setState({ isCompact: true, mobilePanel: 'controls' });
    render(<ControlPanel />);
    fireEvent.click(
      screen.getByRole('button', { name: /飞往猎户座星云（体积星云）/ }),
    );
    const s = useSimulationStore.getState();
    expect(s.mobilePanel).toBeNull();
    expect(s.followBodyId).toBe('orion-nebula');
  });

  it('EN locale：分区与入口文案切英文', () => {
    useSimulationStore.setState({ locale: 'en' });
    render(<ControlPanel />);
    expect(screen.getByText('Featured bodies')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Fly to Sgr A\* \(black-hole photon ring\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Fly to Orion Nebula \(volumetric nebula\)/ }),
    ).toBeInTheDocument();
  });
});
