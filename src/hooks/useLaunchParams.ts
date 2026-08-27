'use client';

/**
 * 启动 URL 参数运行时接入（B4，方案 K4）
 *
 * 挂载后读 `window.location.search`（**勿用 `useSearchParams`**——静态导出 +
 * Suspense 边界要求，登记）经 parseLaunchParams 纯函数解析写入 store
 * `launch` 字段；`body` 参数在场景就绪后一次性 `requestFlyTo`。
 *
 * 就绪信号锚点（登记）：纹理管理器加载进度（getTextureManager().getProgress()，
 * 与 LoadingProgress 隐藏逻辑同源——`total > 0 && !active` 即"首批纹理加载
 * 完成"）；兜底定时器覆盖纹理零注册路径（全程序化纹理/缓存命中），超时
 * 未就绪也触发飞往（requestFlyTo 任意时刻安全，运镜与加载并行不冲突）。
 */
import { useEffect } from 'react';
import { parseLaunchParams } from '@/utils/launchParams';
import { configureRecLog } from '@/utils/devRecLog';
import { getTextureManager } from '@/components/CelestialBody/textureManager';
import { useSimulationStore } from '@/store';

/** body 飞往兜底触发时限（毫秒）：就绪信号未达时超时触发（登记） */
export const BODY_FLY_FALLBACK_MS = 3000;

/**
 * 启动参数初始化（应用根组件挂载时一次）：
 * - 解析结果整体写入 store（`mode`/`tour`/`dwell` 仅存储，B5 消费）；
 * - `lang` 由 useLocaleInit 经统一入口消费（本 hook 不重复处理）；
 * - `body` 就绪后一次性飞往（闭包 done 标志防重复运镜；非法 id 由
 *   requestFlyTo 自含校验静默忽略）。
 */
export function useLaunchInit(): void {
  const setLaunchParams = useSimulationStore((s) => s.setLaunchParams);

  useEffect(() => {
    const params = parseLaunchParams(window.location.search);
    setLaunchParams(params);
    // dev 录制诊断日志门控（devRecLog）：任一 rec* 参数出现即开
    // （rec.active 生产构建恒 false——生产零输出）
    configureRecLog(params.rec.active);

    const body = params.body;
    if (body === null) return undefined;

    let done = false;
    const fly = (): void => {
      if (done) return;
      done = true;
      useSimulationStore.getState().requestFlyTo(body);
    };
    const manager = getTextureManager();
    const checkReady = (): void => {
      const progress = manager.getProgress();
      if (progress.total > 0 && !progress.active) fly();
    };
    const unsubscribe = manager.subscribe(checkReady);
    const fallbackTimer = setTimeout(fly, BODY_FLY_FALLBACK_MS);
    checkReady();
    return () => {
      unsubscribe();
      clearTimeout(fallbackTimer);
    };
  }, [setLaunchParams]);
}
