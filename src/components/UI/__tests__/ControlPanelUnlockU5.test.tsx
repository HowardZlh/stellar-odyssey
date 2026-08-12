/**
 * 演示配额尽的解锁引导形态（U5 用户反馈优化，REQUIREMENTS_UNLOCK §U2-3 形态修订）：
 * - 配额尽后按钮保持可点击（锁态样式 🔒 + tooltip，非静默 disabled）
 * - 点击经 requestDemoEvent gate 弹配额版锁定提示（含「前往解锁」），事件不触发
 * - 配额行改为「已用完 + 查看解锁方案」链接直达 /unlock
 * - 配额未尽 / 有权益态回归：剩余次数行 / 无配额行，按钮正常触发
 */

import { fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';
import { FREE_DEMO_DAILY_LIMIT, localDateKey } from '@/utils/demoQuota';
import { UNLOCK_PAGE_PATH } from '@/utils/unlockPage';

import { ControlPanel } from '../ControlPanel';

const FLARE_BUTTON = /触发太阳耀斑演示/;

function resetState(): void {
  useSimulationStore.setState({
    locale: 'zh',
    viewLevel: 'L2',
    controlPanelCollapsed: false,
    immersiveMode: false,
    entitlement: null,
    entitlementRemainingDays: null,
    demoQuota: null,
    demoRemainingToday: FREE_DEMO_DAILY_LIMIT,
    lockedHint: null,
    activeSolarFlare: null,
    activeCme: null,
  });
}

function exhaustQuota(): void {
  useSimulationStore.setState({
    demoQuota: { dateKey: localDateKey(Date.now()), used: FREE_DEMO_DAILY_LIMIT },
    demoRemainingToday: 0,
  });
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('演示配额尽的解锁引导（ControlPanel）', () => {
  it('配额尽：按钮保持可点击（非 disabled）、🔒 锁态前缀 + tooltip', () => {
    exhaustQuota();
    render(<ControlPanel />);
    const flareBtn = screen.getByRole('button', { name: FLARE_BUTTON });
    expect(flareBtn).toBeEnabled();
    expect(flareBtn).toHaveTextContent(/^🔒/);
    expect(flareBtn).toHaveAttribute(
      'title',
      '今日免费演示次数已用完，解锁后不限次，或明天再来。',
    );
  });

  it('配额尽点击：事件不触发，弹配额版锁定提示（quota lockedHint）', () => {
    exhaustQuota();
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole('button', { name: FLARE_BUTTON }));
    const state = useSimulationStore.getState();
    expect(state.activeSolarFlare).toBeNull();
    expect(state.lockedHint).toEqual({ context: 'quota', bodyId: null });
  });

  it('配额尽：配额行改为「已用完」文案 + 查看解锁方案链接（/unlock 新标签页）', () => {
    exhaustQuota();
    render(<ControlPanel />);
    const line = screen.getByText(/今日免费演示次数已用完，解锁后不限次/);
    const link = line.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', UNLOCK_PAGE_PATH);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('查看解锁方案');
  });

  it('配额未尽回归：剩余次数行、无锁前缀，点击正常触发并消耗配额', () => {
    render(<ControlPanel />);
    expect(
      screen.getByText(`今日免费演示剩余 ${FREE_DEMO_DAILY_LIMIT} 次`),
    ).toBeInTheDocument();
    const flareBtn = screen.getByRole('button', { name: FLARE_BUTTON });
    expect(flareBtn).toHaveTextContent(/^☀️/);
    expect(flareBtn).not.toHaveAttribute('title');
    fireEvent.click(flareBtn);
    const state = useSimulationStore.getState();
    expect(state.activeSolarFlare).not.toBeNull();
    expect(state.demoQuota?.used).toBe(1);
    expect(state.lockedHint).toBeNull();
  });

  it('有权益态回归：不显示配额行，按钮正常且不消耗配额', () => {
    useSimulationStore.setState({
      entitlement: { tier: 'week', expSec: Math.floor(Date.now() / 1000) + 86400 },
      entitlementRemainingDays: 1,
    });
    render(<ControlPanel />);
    expect(screen.queryByText(/今日免费演示/)).toBeNull();
    const flareBtn = screen.getByRole('button', { name: FLARE_BUTTON });
    expect(flareBtn).toHaveTextContent(/^☀️/);
    fireEvent.click(flareBtn);
    const state = useSimulationStore.getState();
    expect(state.activeSolarFlare).not.toBeNull();
    expect(state.demoQuota).toBeNull();
  });
});
