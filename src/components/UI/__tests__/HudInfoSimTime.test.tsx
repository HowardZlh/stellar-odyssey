/**
 * HUD 模拟时间两段式显示单测（UI 布局优化）：
 * - 正常日期范围：单行 UTC 日期，无历元副行
 * - 大时间尺度：主行"距今约 …"通俗表示 + 专业历元副行（J2000 ± Myr）
 * - 右上角面板含沉浸模式（页面最大化）按钮
 */

import { render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { HudInfo } from '../HudInfo';

const initialState = useSimulationStore.getState();

afterEach(() => {
  useSimulationStore.setState(initialState, true);
  window.localStorage.clear();
});

describe('HudInfo 模拟时间显示', () => {
  it('正常范围：显示 UTC 日期，无历元副行', () => {
    useSimulationStore.setState({ simDays: 0 });
    render(<HudInfo />);
    expect(screen.getByText('模拟时间：2000-01-01 12:00 UTC')).toBeInTheDocument();
    expect(screen.queryByText(/天文历元/)).not.toBeInTheDocument();
  });

  it('大时间尺度：主行通俗表示 + 历元副行', () => {
    useSimulationStore.setState({ simDays: 42.73e6 * 365.25 });
    render(<HudInfo />);
    expect(screen.getByText('模拟时间：距今约 4,273 万年后')).toBeInTheDocument();
    expect(screen.getByText('（天文历元 J2000 + 42.73 Myr）')).toBeInTheDocument();
  });

  it('右上角面板含沉浸模式按钮', () => {
    render(<HudInfo />);
    expect(screen.getByRole('button', { name: '最大化（收起面板）' })).toBeInTheDocument();
  });
});
