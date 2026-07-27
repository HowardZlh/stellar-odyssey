/**
 * 性能监控纯逻辑测试（可选需求 3.5.2 / 7 单元测试）
 */

import {
  FPS_WINDOW_MS,
  createFpsCounter,
  formatFpsLabel,
  formatMemoryMB,
  readUsedHeapBytes,
  recordFrame,
} from '@/utils/performance';

describe('createFpsCounter', () => {
  it('初始状态：窗口起点为传入时间、帧数 0、FPS 为 null（统计中）', () => {
    const state = createFpsCounter(1000);
    expect(state).toEqual({ windowStartMs: 1000, frameCount: 0, fps: null });
  });
});

describe('recordFrame（FPS 窗口结算）', () => {
  it('窗口未满时累计帧数、不结算 FPS', () => {
    let state = createFpsCounter(0);
    state = recordFrame(state, 100);
    state = recordFrame(state, 200);
    expect(state.frameCount).toBe(2);
    expect(state.fps).toBeNull();
    expect(state.windowStartMs).toBe(0);
  });

  it('窗口期满时结算平均 FPS 并开启新窗口', () => {
    let state = createFpsCounter(0);
    // 每 20ms 一帧（50 FPS），跑满 500ms 窗口
    for (let t = 20; t <= 500; t += 20) {
      state = recordFrame(state, t);
    }
    expect(state.fps).toBe(50);
    expect(state.windowStartMs).toBe(500);
    expect(state.frameCount).toBe(0);
  });

  it('60 FPS 场景结算 ≈ 60', () => {
    let state = createFpsCounter(0);
    let t = 0;
    while (state.fps === null) {
      t += 1000 / 60;
      state = recordFrame(state, t);
    }
    expect(state.fps).toBeGreaterThanOrEqual(59);
    expect(state.fps).toBeLessThanOrEqual(61);
  });

  it('时间倒退时重置窗口但保留上次 FPS 读数', () => {
    let state = createFpsCounter(0);
    for (let t = 20; t <= 500; t += 20) {
      state = recordFrame(state, t);
    }
    const lastFps = state.fps;
    state = recordFrame(state, 100); // 倒退到窗口起点之前
    expect(state.windowStartMs).toBe(100);
    expect(state.frameCount).toBe(1);
    expect(state.fps).toBe(lastFps);
  });

  it('自定义窗口时长生效', () => {
    let state = createFpsCounter(0);
    state = recordFrame(state, 50, 100);
    expect(state.fps).toBeNull();
    state = recordFrame(state, 100, 100);
    expect(state.fps).toBe(20); // 2 帧 / 100ms = 20 FPS
  });

  it('非正窗口时长抛出 RangeError', () => {
    const state = createFpsCounter(0);
    expect(() => recordFrame(state, 10, 0)).toThrow(RangeError);
    expect(() => recordFrame(state, 10, -500)).toThrow(RangeError);
  });

  it('默认窗口常量为 500ms', () => {
    expect(FPS_WINDOW_MS).toBe(500);
  });
});

describe('formatMemoryMB', () => {
  it('字节数格式化为整数 MB', () => {
    expect(formatMemoryMB(256 * 1024 * 1024)).toBe('256 MB');
    expect(formatMemoryMB(0)).toBe('0 MB');
  });

  it('不可用输入返回"不可用"（非 Chrome 浏览器降级）', () => {
    expect(formatMemoryMB(undefined)).toBe('不可用');
    expect(formatMemoryMB(Number.NaN)).toBe('不可用');
    expect(formatMemoryMB(-1)).toBe('不可用');
    expect(formatMemoryMB(Number.POSITIVE_INFINITY)).toBe('不可用');
  });
});

describe('formatFpsLabel（健康度指示）', () => {
  it('null 显示统计中', () => {
    expect(formatFpsLabel(null)).toBe('统计中…');
  });

  it('≥55 为达标、30-55 为一般、<30 为偏低', () => {
    expect(formatFpsLabel(60)).toBe('60 FPS');
    expect(formatFpsLabel(55)).toBe('55 FPS');
    expect(formatFpsLabel(45)).toBe('45 FPS（一般）');
    expect(formatFpsLabel(30)).toBe('30 FPS（一般）');
    expect(formatFpsLabel(20)).toBe('20 FPS（偏低）');
  });
});

describe('readUsedHeapBytes（Chrome 专有 API）', () => {
  it('读取 performance.memory.usedJSHeapSize', () => {
    expect(readUsedHeapBytes({ memory: { usedJSHeapSize: 12345 } })).toBe(12345);
  });

  it('API 不可用时返回 undefined', () => {
    expect(readUsedHeapBytes(undefined)).toBeUndefined();
    expect(readUsedHeapBytes({})).toBeUndefined();
    expect(readUsedHeapBytes({ memory: {} })).toBeUndefined();
  });
});
