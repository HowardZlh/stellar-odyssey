/**
 * 性能监控纯逻辑（可选需求 3.5.2：FPS / 内存监控，可开关）
 *
 * UI 组件（components/UI/PerformanceMonitor.tsx）负责 rAF 驱动与展示，
 * 本文件提供可测试的帧率统计与格式化函数。
 */

/** FPS 统计窗口（毫秒）：每窗口期输出一次平均帧率 */
export const FPS_WINDOW_MS = 500;

/** FPS 计数器状态（纯数据，便于测试） */
export interface FpsCounterState {
  /** 当前窗口起始时间（ms） */
  windowStartMs: number;
  /** 当前窗口累计帧数 */
  frameCount: number;
  /** 最近一次窗口期的平均 FPS（未满一个窗口期时为 null） */
  fps: number | null;
}

/**
 * 创建 FPS 计数器初始状态
 */
export function createFpsCounter(nowMs: number): FpsCounterState {
  return { windowStartMs: nowMs, frameCount: 0, fps: null };
}

/**
 * 记录一帧（纯函数，返回新状态）
 *
 * 窗口期满（≥ windowMs）时结算平均 FPS 并开启新窗口；
 * 时间倒退（nowMs < windowStartMs）时重置窗口。
 */
export function recordFrame(
  state: FpsCounterState,
  nowMs: number,
  windowMs = FPS_WINDOW_MS,
): FpsCounterState {
  if (windowMs <= 0) {
    throw new RangeError(`统计窗口必须为正数，收到 ${windowMs}`);
  }
  if (nowMs < state.windowStartMs) {
    return { windowStartMs: nowMs, frameCount: 1, fps: state.fps };
  }
  const frameCount = state.frameCount + 1;
  const elapsed = nowMs - state.windowStartMs;
  if (elapsed >= windowMs) {
    return {
      windowStartMs: nowMs,
      frameCount: 0,
      fps: Math.round((frameCount * 1000) / elapsed),
    };
  }
  return { ...state, frameCount };
}

/**
 * 内存字节数 → MB 整数值；不可用（非 Chrome / 非法值）时返回 null
 *
 * B3 抽出：UI 组件按 locale 渲染"不可用"文案（字典），本函数保持纯数值。
 */
export function usedMemoryMB(usedBytes: number | undefined): number | null {
  if (usedBytes === undefined || !Number.isFinite(usedBytes) || usedBytes < 0) {
    return null;
  }
  return Number((usedBytes / (1024 * 1024)).toFixed(0));
}

/**
 * 内存字节数 → "xxx MB" 文案；不可用（非 Chrome 等）时返回提示
 */
export function formatMemoryMB(usedBytes: number | undefined): string {
  const mb = usedMemoryMB(usedBytes);
  return mb === null ? '不可用' : `${mb} MB`;
}

/** FPS 健康度（B3 抽出：与 formatFpsLabel 同源阈值，UI 按 locale 渲染） */
export type FpsHealth = 'measuring' | 'good' | 'fair' | 'low';

/** FPS → 健康度档位（60 达标 / 30-60 一般 / <30 偏低） */
export function fpsHealth(fps: number | null): FpsHealth {
  if (fps === null) return 'measuring';
  if (fps >= 55) return 'good';
  if (fps >= 30) return 'fair';
  return 'low';
}

/**
 * FPS 显示文案（含健康度指示：60 达标 / 30-60 一般 / <30 偏低）
 */
export function formatFpsLabel(fps: number | null): string {
  switch (fpsHealth(fps)) {
    case 'measuring':
      return '统计中…';
    case 'good':
      return `${fps} FPS`;
    case 'fair':
      return `${fps} FPS（一般）`;
    default:
      return `${fps} FPS（偏低）`;
  }
}

/**
 * 读取 performance.memory（Chrome 专有 API，其他浏览器返回 undefined）
 */
export function readUsedHeapBytes(
  perf: { memory?: { usedJSHeapSize?: number } } | undefined,
): number | undefined {
  return perf?.memory?.usedJSHeapSize;
}
