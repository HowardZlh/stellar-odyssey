'use client';

/**
 * M2 耶鲁亮星星表 Hook：`public/data/yale_bright_stars.json`（M1 烘焙产物，
 * 契约 C3）经 `bakedData.loadYaleBrightStars` 读取（同源静态资产 fetch +
 * 校验 + 内存缓存；usePleiadesCatalog 同范式）。
 *
 * 三态：`loading`（首帧/请求中）→ `ready`（stars 非 null）/ `failed`
 * （网络/校验失败——消费方显示降级提示，星穹不渲染，不白屏）。
 * 加载成功后仅一次 setState（引用稳定）。
 */

import { useEffect, useState } from 'react';
import { loadYaleBrightStars, type YaleBrightStar } from '@/utils/bakedData';

export type YaleBrightStarsStatus = 'loading' | 'ready' | 'failed';

export interface YaleBrightStarsResult {
  /** 亮星数组（ready 前为 null） */
  stars: readonly YaleBrightStar[] | null;
  status: YaleBrightStarsStatus;
}

/** 模块级共享结果（多个消费组件共用一次加载；loadYaleBrightStars 自带 URL 缓存） */
let resolved: readonly YaleBrightStar[] | null = null;

export function useYaleBrightStars(): YaleBrightStarsResult {
  const [result, setResult] = useState<YaleBrightStarsResult>(() =>
    resolved ? { stars: resolved, status: 'ready' } : { stars: null, status: 'loading' },
  );
  useEffect(() => {
    if (resolved) return undefined;
    let alive = true;
    void loadYaleBrightStars().then((loaded) => {
      if (loaded === null) {
        if (alive) setResult({ stars: null, status: 'failed' });
        return;
      }
      resolved = loaded;
      if (alive) setResult({ stars: loaded, status: 'ready' });
    });
    return () => {
      alive = false;
    };
  }, []);
  return result;
}

/** 测试用：清空模块级共享结果 */
export function resetYaleBrightStarsForTest(): void {
  resolved = null;
}
