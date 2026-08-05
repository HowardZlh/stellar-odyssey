/**
 * store 音频恢复失败标记单测（M5-1）：audioResumeFailed 默认值与
 * setAudioResumeFailed action（AudioController resume 结果写入 /
 * AudioResumeNotice 关闭钮清除）。
 */

import { useSimulationStore } from '@/store';

describe('store M5-1：audioResumeFailed', () => {
  afterEach(() => {
    useSimulationStore.setState({ audioResumeFailed: false });
  });

  it('默认 false（无提示 = 现状）', () => {
    expect(useSimulationStore.getState().audioResumeFailed).toBe(false);
  });

  it('setAudioResumeFailed 写入与清除', () => {
    useSimulationStore.getState().setAudioResumeFailed(true);
    expect(useSimulationStore.getState().audioResumeFailed).toBe(true);
    useSimulationStore.getState().setAudioResumeFailed(false);
    expect(useSimulationStore.getState().audioResumeFailed).toBe(false);
  });
});
