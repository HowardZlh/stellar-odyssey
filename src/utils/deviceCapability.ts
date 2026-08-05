/**
 * 设备能力检测纯函数（M1-1，REQUIREMENTS_MOBILE §M1）
 *
 * 全部判据走 CSS media query / WebGL 能力探测，**禁止 userAgent 嗅探**
 * （需求红线：UA 可伪造且 iPadOS 桌面 UA 失真）。
 * SSR / jsdom（无 matchMedia / 无 WebGL）下全部安全降级：
 * isTouchPrimary/isCompactViewport → false，getDeviceTier → 'high'
 * （与 store 默认值一致，桌面端行为零变化）。
 */

/** 渲染档位：M2 渲染降档的唯一档位枚举 */
export type DeviceTier = 'high' | 'medium' | 'low';

/** 触屏为主设备判据（主指点设备精度粗糙 = 手指） */
export const POINTER_COARSE_QUERY = '(pointer: coarse)';
/** 紧凑视口判据（≤767px = Tailwind md 断点下限 - 1，手机竖屏区间） */
export const COMPACT_VIEWPORT_QUERY = '(max-width: 767px)';
/** 竖屏判据（useViewportKind 的 orientation 输出用） */
export const PORTRAIT_QUERY = '(orientation: portrait)';

/** matchMedia 安全求值：SSR / jsdom 无实现或查询异常时返回 false */
function safeMatchMedia(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** 触屏为主设备（pointer: coarse）；SSR 安全降级 false */
export function isTouchPrimary(): boolean {
  return safeMatchMedia(POINTER_COARSE_QUERY);
}

/** 紧凑视口（max-width: 767px）；SSR 安全降级 false */
export function isCompactViewport(): boolean {
  return safeMatchMedia(COMPACT_VIEWPORT_QUERY);
}

/** getDeviceTier 判定信号集（classifyDeviceTier 纯分类器输入，单测穷举用） */
export interface DeviceTierSignals {
  /** 主指点设备是否为粗糙精度（触屏） */
  coarsePointer: boolean;
  /** window.devicePixelRatio（缺失 = SSR / 探测失败） */
  devicePixelRatio: number | undefined;
  /** navigator.hardwareConcurrency（缺失 = 旧 Safari 等不暴露） */
  hardwareConcurrency: number | undefined;
  /** WebGL MAX_TEXTURE_SIZE（缺失 = 无 gl 上下文） */
  maxTextureSize: number | undefined;
  /** WebGL renderer 字符串（WEBGL_debug_renderer_info 优先，缺失 = 扩展不可用） */
  renderer: string | undefined;
  /**
   * 用户省流开关（M5-1：Network Information API `navigator.connection.saveData`，
   * Chrome 系可用；缺省 = 能力不可用（Safari/Firefox 未实现）跳过本判据，登记）。
   * 可选字段——既有调用方/测试用例不受影响。
   */
  saveData?: boolean | undefined;
}

/**
 * 低端 GPU renderer 关键字（命中任一即判 low）：
 * - Mali-4xx：老旧 Utgard 架构（Mali-400/450）
 * - Adreno 1xx–5xx：骁龙 6 系及更早的中低端 GPU
 * - PowerVR：老旧 iPhone（≤A10）/ 低端 MTK 平台
 * - SwiftShader / llvmpipe：软件渲染回退（无硬件加速）
 */
const LOW_END_RENDERER_PATTERNS: readonly RegExp[] = [
  /Mali-4\d\d(?!\d)/i,
  /Adreno[^0-9]*[1-5]\d\d(?!\d)/i,
  /PowerVR/i,
  /SwiftShader/i,
  /llvmpipe/i,
];

/** renderer 字符串是否命中低端 GPU 关键字 */
export function isLowEndRenderer(renderer: string): boolean {
  return LOW_END_RENDERER_PATTERNS.some((pattern) => pattern.test(renderer));
}

/**
 * 设备档位纯分类器（判定表，单测穷举）：
 *
 * | 条件 | 档位 |
 * |---|---|
 * | saveData === true（用户显式省流请求，M5-1） | 恒 'low'（最高优先——用户明示降耗，凌驾桌面恒 high；能力不可用时字段缺省不参与判定） |
 * | pointer 非 coarse（桌面鼠标/触控板） | 恒 'high'（桌面零降档硬约束） |
 * | coarse 且命中任一低端信号：hardwareConcurrency ≤ 3 / MAX_TEXTURE_SIZE < 4096 / renderer 命中低端 GPU 关键字 | 'low' |
 * | coarse 且全部高端信号满足：hardwareConcurrency ≥ 8 且 MAX_TEXTURE_SIZE ≥ 8192 且 devicePixelRatio ≥ 2 | 'high' |
 * | 其余（含任一输入缺失——缺失不参与低端判定、也不满足高端判定） | 保守 'medium' |
 *
 * 低端判定优先于高端判定（同时命中时宁降勿超，稳定性优先）。
 */
export function classifyDeviceTier(signals: DeviceTierSignals): DeviceTier {
  // M5-1：用户显式省流（navigator.connection.saveData）→ 锁 low 档，
  // 优先于全部硬件信号（含桌面恒 high——省流为用户主动请求非能力推断）
  if (signals.saveData === true) return 'low';
  if (!signals.coarsePointer) return 'high';

  const { devicePixelRatio, hardwareConcurrency, maxTextureSize, renderer } = signals;

  const lowSignal =
    (hardwareConcurrency !== undefined && hardwareConcurrency <= 3) ||
    (maxTextureSize !== undefined && maxTextureSize < 4096) ||
    (renderer !== undefined && isLowEndRenderer(renderer));
  if (lowSignal) return 'low';

  const highSignal =
    hardwareConcurrency !== undefined &&
    hardwareConcurrency >= 8 &&
    maxTextureSize !== undefined &&
    maxTextureSize >= 8192 &&
    devicePixelRatio !== undefined &&
    devicePixelRatio >= 2;
  if (highSignal) return 'high';

  return 'medium';
}

/** WebGL 上下文读 renderer 字符串（debug 扩展优先，异常/非字符串返回 undefined） */
function readRendererString(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): string | undefined {
  try {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const pname = debugInfo !== null ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const value: unknown = gl.getParameter(pname);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** WebGL 上下文读 MAX_TEXTURE_SIZE（异常/非数值返回 undefined） */
function readMaxTextureSize(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): number | undefined {
  try {
    const value: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Network Information API 局部形状（lib.dom 未收录 connection，最小声明） */
interface NavigatorConnectionLike {
  saveData?: unknown;
}

/**
 * 读取用户省流开关（M5-1）：`navigator.connection.saveData`。
 * 能力不可用（Safari/Firefox 无 connection、字段非布尔、SSR）返回
 * undefined = 跳过本判据（REQUIREMENTS_MOBILE §M5-1 登记）。
 */
export function readSaveData(): boolean | undefined {
  if (typeof navigator === 'undefined') return undefined;
  try {
    const connection = (navigator as Navigator & { connection?: NavigatorConnectionLike })
      .connection;
    return connection !== undefined && typeof connection.saveData === 'boolean'
      ? connection.saveData
      : undefined;
  } catch {
    return undefined;
  }
}

/** 从运行环境收集档位判定信号（SSR 下全部 undefined + coarse false） */
export function collectDeviceTierSignals(
  gl?: WebGLRenderingContext | WebGL2RenderingContext,
): DeviceTierSignals {
  const hasWindow = typeof window !== 'undefined';
  const hasNavigator = typeof navigator !== 'undefined';
  return {
    saveData: readSaveData(),
    coarsePointer: isTouchPrimary(),
    devicePixelRatio:
      hasWindow && typeof window.devicePixelRatio === 'number'
        ? window.devicePixelRatio
        : undefined,
    hardwareConcurrency:
      hasNavigator && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : undefined,
    maxTextureSize: gl !== undefined ? readMaxTextureSize(gl) : undefined,
    renderer: gl !== undefined ? readRendererString(gl) : undefined,
  };
}

/**
 * 设备渲染档位（M1-1）：收集环境信号 → classifyDeviceTier 判定表分类。
 * gl 可选（无 gl 时仅按 dpr / 核数判定，缺失信号保守 medium）；
 * SSR / 桌面（pointer fine）恒 'high'。
 */
export function getDeviceTier(gl?: WebGLRenderingContext | WebGL2RenderingContext): DeviceTier {
  return classifyDeviceTier(collectDeviceTierSignals(gl));
}
