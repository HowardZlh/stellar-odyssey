'use client';

/**
 * R5-3 真实巡天目录 Hook：`public/data/galaxy-catalog.bin`（2MRS 烘焙产物）
 *
 * 懒加载门控：enabled（相机进入 L4 淡入窗口）首次为 true 时才 fetch——
 * 目录 ~680 KB 不占首屏加载预算。经 bakedData.loadGalaxyCatalog
 * （fetch + 校验 + URL 缓存）；加载失败返回 null——消费方降级现状
 * 程序化宇宙网（失败不缓存，下次进入窗口可重试）。
 * 成功结果模块级缓存（多次挂载共享一次解析）。
 */

import { useEffect, useState } from 'react';
import { loadGalaxyCatalog, type GalaxyCatalogData } from '@/utils/bakedData';

let resolved: GalaxyCatalogData | null = null;

export function useGalaxyCatalog(enabled: boolean): GalaxyCatalogData | null {
  const [data, setData] = useState<GalaxyCatalogData | null>(resolved);
  useEffect(() => {
    if (!enabled) return undefined;
    // 竞态修复（无头目验发现）：L4 飞入途中 enabled 可能抖动
    // true→false→true——fetch 在 false 窗口内落地时 alive=false 跳过
    // setData，而模块缓存 resolved 已写入；此处在重新 enabled 时同步
    // 缓存到本地状态，否则目录永远不挂载（同引用 setState React 自动跳过）
    if (resolved) {
      setData(resolved);
      return undefined;
    }
    let alive = true;
    void loadGalaxyCatalog().then((loaded) => {
      if (loaded) {
        resolved = loaded;
        if (alive) setData(loaded);
      }
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return data;
}

/** 测试用：清空模块级缓存 */
export function resetGalaxyCatalogForTest(): void {
  resolved = null;
}
