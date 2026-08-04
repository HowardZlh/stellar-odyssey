'use client';

/**
 * R4-6 恒星物理参数 Hook：`public/data/star-params.json`（R4-5 烘焙产物）
 * 经 `bakedData.loadStarParams` 读取（同源静态资产 fetch + 校验 + 内存缓存），
 * 加载完成前与加载失败时降级到 `FALLBACK_STAR_PARAMS` 硬编码表（登记；
 * 降级表数值与烘焙产物逐字段一致，单测 starPhysics 断言同步防漂移）。
 *
 * 返回引用稳定：加载成功后仅一次 setState 切换到烘焙数据；由于两表数值
 * 一致，消费组件的 useMemo 材质依赖（teffK/limbU/cellScale 等标量）不会
 * 因此重建，无视觉跳变。
 */

import { useEffect, useState } from 'react';
import {
  loadStarParams,
  type StarPhysicalParams,
} from '@/utils/bakedData';
import { FALLBACK_STAR_PARAMS } from '@/utils/starPhysics';

/** 恒星物理参数映射（键见 bakedData.STAR_PARAM_KEYS） */
export type StarParamsMap = Readonly<Record<string, StarPhysicalParams>>;

/** 模块级共享结果（多个恒星组件共用一次加载；loadStarParams 自带 URL 缓存） */
let resolved: StarParamsMap | null = null;

export function useStarParams(): StarParamsMap {
  const [params, setParams] = useState<StarParamsMap>(
    () => resolved ?? FALLBACK_STAR_PARAMS,
  );
  useEffect(() => {
    if (resolved) return undefined;
    let alive = true;
    void loadStarParams().then((data) => {
      if (data === null) return; // 加载/校验失败：保持硬编码降级表（登记）
      resolved = data.stars;
      if (alive) setParams(data.stars);
    });
    return () => {
      alive = false;
    };
  }, []);
  return params;
}

/** 测试用：清空模块级共享结果 */
export function resetStarParamsForTest(): void {
  resolved = null;
}
