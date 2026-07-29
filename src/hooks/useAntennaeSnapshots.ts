'use client';

/**
 * R4-22 触须星系 N-body 烘焙快照 Hook：`public/data/antennae.bin`
 * （R4-5 管线烘焙产物）经 `bakedData.loadAntennae` 读取（同源静态资产
 * fetch + 二进制校验 + 内存缓存）。
 *
 * 加载完成前与加载/校验失败时返回 null——消费方（AntennaeGalaxies 近观层/
 * 预览页）降级到现状静态渲染（§R4-22 降级登记）。加载成功后仅一次
 * setState 切换到快照数据（引用稳定，usePleiadesCatalog 同范式）。
 */

import { useEffect, useState } from 'react';
import { loadAntennae, type AntennaeSnapshotsData } from '@/utils/bakedData';

/** 模块级共享结果（多个消费组件共用一次加载；loadAntennae 自带 URL 缓存） */
let resolved: AntennaeSnapshotsData | null = null;

export function useAntennaeSnapshots(): AntennaeSnapshotsData | null {
  const [data, setData] = useState<AntennaeSnapshotsData | null>(() => resolved);
  useEffect(() => {
    if (resolved) return undefined;
    let alive = true;
    void loadAntennae().then((loaded) => {
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
export function resetAntennaeSnapshotsForTest(): void {
  resolved = null;
}
