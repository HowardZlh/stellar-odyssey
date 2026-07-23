'use client';

/**
 * 位图纹理 Hook（P3-1/P3-2）：
 * 按需请求真实位图纹理，加载完成前返回 null（调用方使用程序化纹理降级）。
 * 纹理缓存与优先级队列由共享 TextureManager 管理。
 */

import { useEffect, useState } from 'react';
import type * as THREE from 'three';
import { getTextureManager } from '@/components/CelestialBody/textureManager';

/**
 * @param url 纹理 URL（null 表示该天体无真实位图，直接返回 null）
 * @param priority 加载优先级（数值越小越优先）
 * @param enabled 是否触发加载（懒加载门控：接近对应层级时才为 true）
 */
export function useBitmapTexture(
  url: string | null,
  priority: number,
  enabled: boolean,
): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(() =>
    url ? getTextureManager().get(url) : null,
  );

  useEffect(() => {
    if (!url || !enabled) return undefined;
    const manager = getTextureManager();
    const sync = (): void => {
      setTexture(manager.get(url));
    };
    const unsubscribe = manager.subscribe(sync);
    manager.request(url, priority);
    sync();
    return unsubscribe;
  }, [url, priority, enabled]);

  return texture;
}
