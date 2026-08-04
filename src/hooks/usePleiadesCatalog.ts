'use client';

/**
 * R4-17 昴星团真实星表 Hook：`public/data/pleiades.json`（R4-5 烘焙产物）
 * 经 `bakedData.loadPleiades` 读取（同源静态资产 fetch + 校验 + 内存缓存）。
 *
 * 加载完成前与加载/校验失败时返回 null——消费方（OpenCluster 昴星团分支/
 * 预览页）降级到现状程序化分布（§R4-17 降级登记）。加载成功后仅一次
 * setState 切换到真实星表（引用稳定，useStarParams 同范式）。
 */

import { useEffect, useState } from 'react';
import { loadPleiades, type PleiadesData } from '@/utils/bakedData';

/** 模块级共享结果（多个消费组件共用一次加载；loadPleiades 自带 URL 缓存） */
let resolved: PleiadesData | null = null;

export function usePleiadesCatalog(): PleiadesData | null {
  const [data, setData] = useState<PleiadesData | null>(() => resolved);
  useEffect(() => {
    if (resolved) return undefined;
    let alive = true;
    void loadPleiades().then((loaded) => {
      if (loaded === null) return; // 失败：保持 null，消费方降级（登记）
      resolved = loaded;
      if (alive) setData(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** 测试用：清空模块级共享结果 */
export function resetPleiadesCatalogForTest(): void {
  resolved = null;
}
