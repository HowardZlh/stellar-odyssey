'use client';

import * as THREE from 'three';
import { createSoftPointCanvas } from '@/components/CelestialBody/proceduralTextures';

/**
 * 全局共享的圆形软边粒子贴图（P6 粒子贴图修复，需求 3.2）
 *
 * 所有 PointsMaterial 复用同一张贴图消除方形粒子，避免每个粒子系统各自生成
 * 一张纹理造成显存浪费。惰性生成、进程内缓存（应用生命周期内常驻，无需释放）。
 */
let cached: THREE.Texture | null = null;

export function getSoftPointTexture(): THREE.Texture {
  if (!cached) {
    cached = new THREE.CanvasTexture(createSoftPointCanvas(64));
    cached.needsUpdate = true;
  }
  return cached;
}
