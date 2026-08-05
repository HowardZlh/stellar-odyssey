'use client';

/**
 * 视口类型与设备档位 hooks（M1-1，REQUIREMENTS_MOBILE §M1）
 *
 * - useViewportKind：matchMedia change 监听（横竖屏切换、平板分屏、外接
 *   鼠标插拔均动态生效），输出 { isTouch, isCompact, orientation } 并同步
 *   写 store（isTouch/isCompact；orientation 仅本地返回，store 不持有）。
 * - useDeviceTierInit：挂载时一次性探测 WebGL 能力 → getDeviceTier 判定
 *   档位写 store（M2 渲染降档消费）。
 *
 * SSR / jsdom（无 matchMedia / 无 WebGL）安全降级：保持 store 默认值
 * （'high'/false/false = 桌面现状）。
 */
import { useEffect, useState } from 'react';
import {
  COMPACT_VIEWPORT_QUERY,
  POINTER_COARSE_QUERY,
  PORTRAIT_QUERY,
  getDeviceTier,
} from '@/utils/deviceCapability';
import { useSimulationStore } from '@/store';

/** 视口方向 */
export type Orientation = 'portrait' | 'landscape';

/** useViewportKind 输出 */
export interface ViewportKind {
  /** 触屏为主设备（pointer: coarse） */
  isTouch: boolean;
  /** 紧凑视口（max-width: 767px） */
  isCompact: boolean;
  /** 视口方向（SSR 默认 landscape） */
  orientation: Orientation;
}

/**
 * matchMedia change 订阅（含 iOS ≤13 旧 API 回退），返回解绑函数。
 * addListener/removeListener 为 deprecated 回退路径，仅老 Safari 走到。
 */
function listenMediaQuery(mq: MediaQueryList, onChange: () => void): () => void {
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }
  mq.addListener(onChange);
  return () => mq.removeListener(onChange);
}

/**
 * 视口类型 hook：订阅三条 media query（coarse pointer / compact / portrait），
 * 变化时写 store（值未变不写入——零多余重渲染）并更新本地 orientation。
 */
export function useViewportKind(): ViewportKind {
  const isTouch = useSimulationStore((s) => s.isTouch);
  const isCompact = useSimulationStore((s) => s.isCompact);
  const [orientation, setOrientation] = useState<Orientation>('landscape');

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const touchMq = window.matchMedia(POINTER_COARSE_QUERY);
    const compactMq = window.matchMedia(COMPACT_VIEWPORT_QUERY);
    const portraitMq = window.matchMedia(PORTRAIT_QUERY);

    const sync = (): void => {
      const store = useSimulationStore.getState();
      if (touchMq.matches !== store.isTouch) store.setIsTouch(touchMq.matches);
      if (compactMq.matches !== store.isCompact) store.setIsCompact(compactMq.matches);
      setOrientation(portraitMq.matches ? 'portrait' : 'landscape');
    };
    sync();

    const unlisten = [touchMq, compactMq, portraitMq].map((mq) => listenMediaQuery(mq, sync));
    return () => {
      for (const off of unlisten) off();
    };
  }, []);

  return { isTouch, isCompact, orientation };
}

/**
 * 设备档位一次性初始化 hook（SolarSystemApp 挂载时调用）：
 * 临时 probe canvas 取 WebGL 能力信号（MAX_TEXTURE_SIZE / renderer），
 * getDeviceTier 判定后写 store，随即 loseContext 释放探测上下文
 * （AGENTS.md 内存管理：不留悬挂 GL 上下文）。
 */
export function useDeviceTierInit(): void {
  useEffect(() => {
    let gl: WebGLRenderingContext | WebGL2RenderingContext | undefined;
    try {
      const probe = document.createElement('canvas');
      gl = probe.getContext('webgl2') ?? probe.getContext('webgl') ?? undefined;
    } catch {
      gl = undefined;
    }
    const tier = getDeviceTier(gl);
    const store = useSimulationStore.getState();
    if (tier !== store.deviceTier) store.setDeviceTier(tier);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }, []);
}
