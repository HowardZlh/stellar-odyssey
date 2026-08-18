'use client';

/**
 * E-M1 月缘高程剖面 Hook：`public/data/lunar_limb_profile.json`（M1 烘焙产物，
 * 契约 C3，LRO LOLA）经 `bakedData.loadLunarLimbProfile` 读取（同源静态资产
 * fetch + 校验 + 内存缓存；useYaleBrightStars 同范式）。
 *
 * 三态：`loading` → `ready` / `failed`（失败时贝利珠降级为均匀月缘，
 * M3 消费方登记降级口径，不白屏）。加载成功后仅一次 setState（引用稳定）。
 */

import { useEffect, useState } from 'react';
import { loadLunarLimbProfile, type LunarLimbProfileData } from '@/utils/bakedData';

export type LunarLimbProfileStatus = 'loading' | 'ready' | 'failed';

export interface LunarLimbProfileResult {
  /** 月缘剖面（ready 前为 null） */
  profile: LunarLimbProfileData | null;
  status: LunarLimbProfileStatus;
}

/** 模块级共享结果（多个消费组件共用一次加载；loadLunarLimbProfile 自带 URL 缓存） */
let resolved: LunarLimbProfileData | null = null;

export function useLunarLimbProfile(): LunarLimbProfileResult {
  const [result, setResult] = useState<LunarLimbProfileResult>(() =>
    resolved ? { profile: resolved, status: 'ready' } : { profile: null, status: 'loading' },
  );
  useEffect(() => {
    if (resolved) return undefined;
    let alive = true;
    void loadLunarLimbProfile().then((loaded) => {
      if (loaded === null) {
        if (alive) setResult({ profile: null, status: 'failed' });
        return;
      }
      resolved = loaded;
      if (alive) setResult({ profile: loaded, status: 'ready' });
    });
    return () => {
      alive = false;
    };
  }, []);
  return result;
}

/** 测试用：清空模块级共享结果 */
export function resetLunarLimbProfileForTest(): void {
  resolved = null;
}
