/**
 * 音频恢复失败提示单测（M5-1）：
 * - audioResumeFailed=false 不渲染（默认 = 现状零变化）
 * - true 时渲染 role=alert 提示文案（i18n zh 键）
 * - ✕ 关闭钮清除标记（提示消失）
 * - AudioController：resume 失败写标记 / 关闭音效清除标记
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { AudioResumeNotice } from '../AudioResumeNotice';
import { AudioController } from '@/components/Audio/AudioController';
import { getSharedAudioEngine } from '@/components/Audio/audioEngine';
import { useSimulationStore } from '@/store';
import { zh } from '@/i18n/zh';

jest.mock('@/components/Audio/audioEngine', () => ({
  getSharedAudioEngine: jest.fn(),
}));

const mockedGetEngine = getSharedAudioEngine as jest.Mock;

afterEach(() => {
  useSimulationStore.setState({ audioEnabled: false, audioResumeFailed: false });
  jest.clearAllMocks();
});

describe('AudioResumeNotice（M5-1）', () => {
  it('audioResumeFailed=false 不渲染（默认现状）', () => {
    const { container } = render(<AudioResumeNotice />);
    expect(container.firstChild).toBeNull();
  });

  it('audioResumeFailed=true 渲染 alert 提示；✕ 关闭清除标记', () => {
    act(() => {
      useSimulationStore.getState().setAudioResumeFailed(true);
    });
    render(<AudioResumeNotice />);
    expect(screen.getByRole('alert')).toHaveTextContent(zh.audioNotice.resumeFailed);

    fireEvent.click(screen.getByRole('button', { name: zh.audioNotice.dismissAria }));
    expect(useSimulationStore.getState().audioResumeFailed).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AudioController resume 失败接线（M5-1）', () => {
  /** 最小引擎 mock：resume 结果可注入；其余 AudioController 消费面打桩 */
  function mockEngine(resumed: boolean): void {
    mockedGetEngine.mockReturnValue({
      init: jest.fn(),
      resume: jest.fn().mockResolvedValue(resumed),
      dispose: jest.fn(),
      initialized: false,
      applyGains: jest.fn(),
      setPlanetAmbience: jest.fn(),
    });
  }

  it('音效开启且 resume 失败 → audioResumeFailed=true；关闭音效自动清除', async () => {
    mockEngine(false);
    render(<AudioController />);
    act(() => {
      useSimulationStore.getState().setAudioEnabled(true);
    });
    // resume Promise 回调结算
    await act(async () => {
      await Promise.resolve();
    });
    expect(useSimulationStore.getState().audioResumeFailed).toBe(true);

    act(() => {
      useSimulationStore.getState().setAudioEnabled(false);
    });
    expect(useSimulationStore.getState().audioResumeFailed).toBe(false);
  });

  it('resume 成功不写标记（现状零变化）', async () => {
    mockEngine(true);
    render(<AudioController />);
    act(() => {
      useSimulationStore.getState().setAudioEnabled(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(useSimulationStore.getState().audioResumeFailed).toBe(false);
  });
});
