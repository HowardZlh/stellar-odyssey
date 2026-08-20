'use client';

/**
 * E-M1 日食星历 Hook：`public/data/solar_eclipses.json`（M1 烘焙产物，
 * 契约 C2）经 `bakedData.loadSolarEclipses` 读取（同源静态资产 fetch +
 * 校验 + 内存缓存；useYaleBrightStars 同范式）。
 *
 * 三态：`loading`（首帧/请求中）→ `ready`（data 非 null）/ `failed`
 * （网络/校验失败——消费方显示降级提示，实验室场景不渲染，不白屏）。
 * 加载成功后仅一次 setState（引用稳定）。
 */

import { useEffect, useState } from 'react';
import { loadSolarEclipses, type SolarEclipsesData } from '@/utils/bakedData';

export type SolarEclipsesStatus = 'loading' | 'ready' | 'failed';

export interface SolarEclipsesResult {
  /** 三事件星历（ready 前为 null） */
  data: SolarEclipsesData | null;
  status: SolarEclipsesStatus;
}

/** 模块级共享结果（多个消费组件共用一次加载；loadSolarEclipses 自带 URL 缓存） */
let resolved: SolarEclipsesData | null = null;

export function useSolarEclipses(): SolarEclipsesResult {
  const [result, setResult] = useState<SolarEclipsesResult>(() =>
    resolved ? { data: resolved, status: 'ready' } : { data: null, status: 'loading' },
  );
  useEffect(() => {
    if (resolved) return undefined;
    let alive = true;
    void loadSolarEclipses().then((loaded) => {
      if (loaded === null) {
        if (alive) setResult({ data: null, status: 'failed' });
        return;
      }
      resolved = loaded;
      if (alive) setResult({ data: loaded, status: 'ready' });
    });
    return () => {
      alive = false;
    };
  }, []);
  return result;
}

/** 测试用：清空模块级共享结果 */
export function resetSolarEclipsesForTest(): void {
  resolved = null;
}
