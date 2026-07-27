'use client';

import * as THREE from 'three';
import {
  generateNebulaTextureData,
  type NebulaTextureParams,
} from '@/utils/nebulaTexture';

/**
 * 程序化星云 DataTexture 工厂 + 进程内缓存（P6 §3.2 / §4）
 *
 * 将 utils/nebulaTexture 生成的确定性 RGBA 数据包装为 THREE.DataTexture。
 * 按参数键缓存：**同参数生成一次复用**（需求 §4 硬性约束）；纹理 ≤512px。
 * 生成不依赖 DOM canvas（纯像素数组），首屏无位图网络请求。
 */
const cache = new Map<string, THREE.DataTexture>();

function keyOf(p: NebulaTextureParams): string {
  return [
    p.size,
    p.seed,
    p.innerColor,
    p.outerColor,
    p.filamentStrength,
    p.irregularity,
    p.octaves,
    p.shape,
  ].join('|');
}

export function getNebulaTexture(params: NebulaTextureParams): THREE.DataTexture {
  const key = keyOf(params);
  const hit = cache.get(key);
  if (hit) return hit;
  const data = generateNebulaTextureData(params);
  // THREE.DataTexture 需要 Uint8Array（非 Clamped），复制一份
  const buffer = new Uint8Array(data.pixels.length);
  buffer.set(data.pixels);
  const tex = new THREE.DataTexture(buffer, data.size, data.size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  cache.set(key, tex);
  return tex;
}
