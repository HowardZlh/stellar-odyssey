/**
 * store 启动参数字段单测（B4）：`launch` 默认值（无参数启动与现状
 * 行为等价的前提）+ setLaunchParams 写入。
 */

import type { LaunchParams } from '@/types';
import { useSimulationStore } from '@/store';
import { DEFAULT_LAUNCH_PARAMS } from '@/utils/launchParams';

afterEach(() => {
  useSimulationStore.setState({ launch: DEFAULT_LAUNCH_PARAMS });
});

describe('launch 状态（B4 启动 URL 参数）', () => {
  it('默认值与无参数解析结果一致（默认路径零回退登记）', () => {
    expect(useSimulationStore.getState().launch).toEqual({
      mode: null,
      tour: 'solar',
      dwell: 30,
      body: null,
      logo: null,
      lang: null,
      token: null,
    });
  });

  it('setLaunchParams 整体写入解析结果', () => {
    const params: LaunchParams = {
      mode: 'kiosk',
      tour: 'all',
      dwell: 60,
      body: 'jupiter',
      logo: 'https://example.com/logo.png',
      lang: 'en',
      token: null,
    };
    useSimulationStore.getState().setLaunchParams(params);
    expect(useSimulationStore.getState().launch).toEqual(params);
  });
});
