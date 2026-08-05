/**
 * 设备能力检测单测（M1-1）：classifyDeviceTier 判定表穷举 +
 * matchMedia 判据（SSR/jsdom 降级）+ WebGL 信号收集降级路径。
 */

import {
  COMPACT_VIEWPORT_QUERY,
  POINTER_COARSE_QUERY,
  classifyDeviceTier,
  collectDeviceTierSignals,
  getDeviceTier,
  isCompactViewport,
  isLowEndRenderer,
  isTouchPrimary,
} from '@/utils/deviceCapability';
import type { DeviceTierSignals } from '@/utils/deviceCapability';

/** 触屏 + 全高端信号基线（单项变异用） */
const HIGH_TOUCH_SIGNALS: DeviceTierSignals = {
  coarsePointer: true,
  devicePixelRatio: 3,
  hardwareConcurrency: 8,
  maxTextureSize: 16384,
  renderer: 'Apple GPU',
};

/** matchMedia mock（matches 按 query 表返回）；用后须 restoreMatchMedia */
function mockMatchMedia(matchesByQuery: Record<string, boolean>): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn((query: string) => ({
      matches: matchesByQuery[query] ?? false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
}

function restoreMatchMedia(): void {
  // jsdom 默认不实现 matchMedia：删除 mock 即回到 undefined 现状
  delete (window as { matchMedia?: unknown }).matchMedia;
}

afterEach(restoreMatchMedia);

describe('classifyDeviceTier 判定表（穷举）', () => {
  it('pointer fine（桌面）恒 high——即使全部信号低端', () => {
    expect(
      classifyDeviceTier({
        coarsePointer: false,
        devicePixelRatio: 1,
        hardwareConcurrency: 2,
        maxTextureSize: 2048,
        renderer: 'SwiftShader',
      }),
    ).toBe('high');
  });

  it('pointer fine 且全部信号缺失仍 high（SSR 降级路径）', () => {
    expect(
      classifyDeviceTier({
        coarsePointer: false,
        devicePixelRatio: undefined,
        hardwareConcurrency: undefined,
        maxTextureSize: undefined,
        renderer: undefined,
      }),
    ).toBe('high');
  });

  it('触屏全高端信号 → high（边界值 hc=8 / tex=8192 / dpr=2 齐平即 high）', () => {
    expect(classifyDeviceTier(HIGH_TOUCH_SIGNALS)).toBe('high');
    expect(
      classifyDeviceTier({
        ...HIGH_TOUCH_SIGNALS,
        devicePixelRatio: 2,
        hardwareConcurrency: 8,
        maxTextureSize: 8192,
      }),
    ).toBe('high');
  });

  it.each([
    ['hardwareConcurrency ≤ 3（=3 触界）', { hardwareConcurrency: 3 }],
    ['MAX_TEXTURE_SIZE < 4096（=4095 触界）', { maxTextureSize: 4095 }],
    ['renderer Mali-4xx', { renderer: 'Mali-450 MP4' }],
    ['renderer Adreno 5xx', { renderer: 'Adreno (TM) 505' }],
    ['renderer PowerVR', { renderer: 'PowerVR Rogue GE8320' }],
    ['renderer SwiftShader 软件渲染', { renderer: 'Google SwiftShader' }],
    ['renderer llvmpipe 软件渲染', { renderer: 'Mesa/X.org llvmpipe (LLVM 12.0.0)' }],
  ] as const)('触屏低端信号：%s → low', (_name, override) => {
    expect(classifyDeviceTier({ ...HIGH_TOUCH_SIGNALS, ...override })).toBe('low');
  });

  it('低端判定优先于高端判定（同时命中宁降勿超）', () => {
    // 高端信号全满足但 renderer 为软件渲染 → low
    expect(classifyDeviceTier({ ...HIGH_TOUCH_SIGNALS, renderer: 'SwiftShader' })).toBe('low');
  });

  it.each([
    ['hc=4（脱离低端未及高端）', { hardwareConcurrency: 4 }],
    ['hc=7（高端差一）', { hardwareConcurrency: 7 }],
    ['tex=4096（脱离低端未及高端）', { maxTextureSize: 4096 }],
    ['tex=8191（高端差一）', { maxTextureSize: 8191 }],
    ['dpr=1.5（高端差一）', { devicePixelRatio: 1.5 }],
  ] as const)('触屏中间信号：%s → medium', (_name, override) => {
    expect(classifyDeviceTier({ ...HIGH_TOUCH_SIGNALS, ...override })).toBe('medium');
  });

  it.each([
    ['dpr 缺失', { devicePixelRatio: undefined }],
    ['hc 缺失', { hardwareConcurrency: undefined }],
    ['tex 缺失', { maxTextureSize: undefined }],
    ['renderer 缺失（其余中间档）', { renderer: undefined, hardwareConcurrency: 6 }],
  ] as const)('触屏输入缺失保守 medium：%s', (_name, override) => {
    expect(classifyDeviceTier({ ...HIGH_TOUCH_SIGNALS, ...override })).toBe('medium');
  });

  it('触屏全部信号缺失 → medium（保守回落）', () => {
    expect(
      classifyDeviceTier({
        coarsePointer: true,
        devicePixelRatio: undefined,
        hardwareConcurrency: undefined,
        maxTextureSize: undefined,
        renderer: undefined,
      }),
    ).toBe('medium');
  });
});

describe('isLowEndRenderer 关键字匹配', () => {
  it.each(['Mali-400 MP', 'Adreno 330', 'Adreno (TM) 512', 'PowerVR SGX 543', 'SwiftShader'])(
    '低端：%s',
    (renderer) => {
      expect(isLowEndRenderer(renderer)).toBe(true);
    },
  );

  it.each([
    'Apple GPU',
    'Mali-G78 MC14', // 新架构非 Mali-4xx
    'Adreno (TM) 640', // 6 系不命中 1-5xx
    'Adreno (TM) 610', // 首位 6 不命中
    'NVIDIA GeForce RTX 3080',
    'Mali-4000X', // 4 位数字不误伤（负向前瞻）
  ])('非低端：%s', (renderer) => {
    expect(isLowEndRenderer(renderer)).toBe(false);
  });
});

describe('matchMedia 判据（isTouchPrimary / isCompactViewport）', () => {
  it('jsdom 无 matchMedia → 双双安全降级 false', () => {
    expect(window.matchMedia).toBeUndefined();
    expect(isTouchPrimary()).toBe(false);
    expect(isCompactViewport()).toBe(false);
  });

  it('matchMedia 按 query 返回 matches', () => {
    mockMatchMedia({ [POINTER_COARSE_QUERY]: true, [COMPACT_VIEWPORT_QUERY]: false });
    expect(isTouchPrimary()).toBe(true);
    expect(isCompactViewport()).toBe(false);
  });

  it('matchMedia 抛异常 → 降级 false', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('boom');
      },
    });
    expect(isTouchPrimary()).toBe(false);
    expect(isCompactViewport()).toBe(false);
  });
});

/** WebGL mock 上下文（结构化最小面） */
function mockGl(options: {
  maxTextureSize?: unknown;
  renderer?: unknown;
  hasDebugExt?: boolean;
  throwOnGetParameter?: boolean;
}): WebGLRenderingContext {
  const MAX_TEXTURE_SIZE = 0x0d33;
  const RENDERER = 0x1f01;
  const UNMASKED = 0x9246;
  const gl = {
    MAX_TEXTURE_SIZE,
    RENDERER,
    getExtension: (name: string) =>
      name === 'WEBGL_debug_renderer_info' && (options.hasDebugExt ?? true)
        ? { UNMASKED_RENDERER_WEBGL: UNMASKED }
        : null,
    getParameter: (pname: number): unknown => {
      if (options.throwOnGetParameter === true) throw new Error('context lost');
      if (pname === MAX_TEXTURE_SIZE) return options.maxTextureSize;
      if (pname === UNMASKED || pname === RENDERER) return options.renderer;
      return null;
    },
  };
  return gl as unknown as WebGLRenderingContext;
}

describe('collectDeviceTierSignals / getDeviceTier（环境信号收集）', () => {
  it('无 gl → 纹理/renderer 信号缺失；dpr/核数取自环境', () => {
    const signals = collectDeviceTierSignals();
    expect(signals.maxTextureSize).toBeUndefined();
    expect(signals.renderer).toBeUndefined();
    expect(signals.coarsePointer).toBe(false); // jsdom 无 matchMedia 降级
    expect(typeof signals.devicePixelRatio).toBe('number'); // jsdom 提供 dpr=1
  });

  it('gl 经 debug 扩展读 renderer + MAX_TEXTURE_SIZE', () => {
    const signals = collectDeviceTierSignals(
      mockGl({ maxTextureSize: 16384, renderer: 'Apple GPU' }),
    );
    expect(signals.maxTextureSize).toBe(16384);
    expect(signals.renderer).toBe('Apple GPU');
  });

  it('无 debug 扩展 → 回退 gl.RENDERER 常量读取', () => {
    const signals = collectDeviceTierSignals(
      mockGl({ maxTextureSize: 8192, renderer: 'WebKit WebGL', hasDebugExt: false }),
    );
    expect(signals.renderer).toBe('WebKit WebGL');
  });

  it('getParameter 抛异常 → 信号缺失（不冒泡）', () => {
    const signals = collectDeviceTierSignals(mockGl({ throwOnGetParameter: true }));
    expect(signals.maxTextureSize).toBeUndefined();
    expect(signals.renderer).toBeUndefined();
  });

  it('非法类型（非数值纹理尺寸/非字符串 renderer）→ 信号缺失', () => {
    const signals = collectDeviceTierSignals(mockGl({ maxTextureSize: '4096', renderer: 42 }));
    expect(signals.maxTextureSize).toBeUndefined();
    expect(signals.renderer).toBeUndefined();
  });

  it('getDeviceTier：jsdom（无 matchMedia = pointer fine）恒 high', () => {
    expect(getDeviceTier()).toBe('high');
  });

  it('getDeviceTier：触屏 + 低端 gl → low；触屏无 gl → medium', () => {
    mockMatchMedia({ [POINTER_COARSE_QUERY]: true });
    expect(getDeviceTier(mockGl({ maxTextureSize: 2048, renderer: 'Mali-450' }))).toBe('low');
    expect(getDeviceTier()).toBe('medium');
  });
});
