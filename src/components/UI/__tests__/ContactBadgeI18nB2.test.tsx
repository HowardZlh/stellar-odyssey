/**
 * ContactBadge i18n 打样单测（B2）：locale=en 时全部文案呈英文、
 * 切回 zh 恢复中文（既有 ContactBadge.test.tsx 的 zh 默认态断言
 * 零改动，另立本文件覆盖双语切换）。
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { ContactBadge } from '../ContactBadge';

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
  document.documentElement.lang = 'zh-CN';
});

describe('ContactBadge 双语打样（B2）', () => {
  it('locale=en 时角标与卡片全部文案呈英文', () => {
    useSimulationStore.setState({ locale: 'en' });
    render(<ContactBadge />);
    const button = screen.getByRole('button', { name: /Partnership/ });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(
      screen.getByRole('dialog', { name: 'Commercial partnership contact' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Commercial Partnership')).toBeInTheDocument();
    expect(screen.getByText(/exhibition integrators are welcome/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sponsor on Afdian/ })).toBeInTheDocument();
    // 中文文案不残留
    expect(screen.queryByText(/商业合作/)).not.toBeInTheDocument();
    expect(screen.queryByText(/爱发电赞助支持/)).not.toBeInTheDocument();
  });

  it('挂载后切换 locale 即时生效（en → zh 恢复中文）', () => {
    useSimulationStore.setState({ locale: 'en' });
    render(<ContactBadge />);
    expect(screen.getByRole('button', { name: /Partnership/ })).toBeInTheDocument();
    act(() => {
      useSimulationStore.getState().setLocale('zh');
    });
    expect(screen.getByRole('button', { name: /商业合作/ })).toBeInTheDocument();
    expect(screen.queryByText(/Partnership/)).not.toBeInTheDocument();
  });
});
