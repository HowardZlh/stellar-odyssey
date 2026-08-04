'use client';

/**
 * R4-19 M13 King profile Hook：`public/data/m13-profile.json`（R4-5 烘焙
 * 产物，Harris 1996/2010 目录 NGC 6205 行）经 `bakedData.loadM13Profile`
 * 读取（同源静态资产 fetch + 校验 + 内存缓存）。
 *
 * 加载完成前与加载/校验失败时返回 null——消费方（GlobularCluster / 预览
 * 页）降级到现状程序化分布（§R4-19 降级登记）。加载成功后仅一次
 * setState 切换（引用稳定，usePleiadesCatalog 同范式）。
 */

import { useEffect, useState } from 'react';
import { loadM13Profile, type M13ProfileData } from '@/utils/bakedData';

/** 模块级共享结果（多个消费组件共用一次加载；loadM13Profile 自带 URL 缓存） */
let resolved: M13ProfileData | null = null;

export function useM13Profile(): M13ProfileData | null {
  const [data, setData] = useState<M13ProfileData | null>(() => resolved);
  useEffect(() => {
    if (resolved) return undefined;
    let alive = true;
    void loadM13Profile().then((loaded) => {
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
export function resetM13ProfileForTest(): void {
  resolved = null;
}
