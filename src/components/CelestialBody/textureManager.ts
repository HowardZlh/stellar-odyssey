/**
 * 位图纹理加载管理器（P3-1/P3-2）
 *
 * - THREE.TextureLoader 异步加载（AGENTS.md 规范），按优先级懒加载
 *   （队列纯逻辑见 utils/loadProgress.ts，可单元测试）
 * - 加载失败静默降级：调用方拿不到位图时继续使用程序化纹理
 *   （proceduralTextures.ts 为降级路径，符合项目静默降级哲学）
 * - 纹理缓存共享（同一 URL 只加载一次），disposeAll() 在应用卸载时
 *   释放全部 GPU 资源（AGENTS.md 强制内存管理）
 *
 * 纹理来源与许可：Solar System Scope（CC BY 4.0），登记见 data/textures.ts
 */

import * as THREE from 'three';
import type { LoadItem, LoadProgress } from '@/utils/loadProgress';
import {
  computeLoadProgress,
  markLoadStatus,
  nextToStart,
  upsertLoadItem,
} from '@/utils/loadProgress';

/** 最大并发加载数（保证高优先级纹理先到） */
const MAX_CONCURRENT_LOADS = 3;

type Listener = () => void;

class TextureManager {
  private items: LoadItem[] = [];

  private textures = new Map<string, THREE.Texture>();

  private listeners = new Set<Listener>();

  private loader: THREE.TextureLoader | null = null;

  /**
   * 请求加载纹理（幂等）：已缓存/已在队列时仅可能提升优先级
   */
  request(url: string, priority: number): void {
    this.items = upsertLoadItem(this.items, url, priority);
    this.pump();
  }

  /** 获取已加载纹理；未加载完成（或失败）时返回 null */
  get(url: string): THREE.Texture | null {
    return this.textures.get(url) ?? null;
  }

  /** 当前进度汇总（进度 UI 使用） */
  getProgress(): LoadProgress {
    return computeLoadProgress(this.items);
  }

  /** 订阅状态变化（加载完成/失败时通知） */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 释放全部纹理与状态（应用卸载时调用，AGENTS.md 内存管理） */
  disposeAll(): void {
    for (const texture of this.textures.values()) {
      texture.dispose();
    }
    this.textures.clear();
    this.items = [];
    this.notify();
  }

  private pump(): void {
    // SSR/测试环境无 Image，静默跳过（组件端只在浏览器调用）
    if (typeof window === 'undefined') return;
    if (!this.loader) {
      this.loader = new THREE.TextureLoader();
    }
    const startIds = nextToStart(this.items, MAX_CONCURRENT_LOADS);
    if (startIds.length === 0) return;
    for (const url of startIds) {
      this.items = markLoadStatus(this.items, url, 'loading');
      this.loader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          this.textures.set(url, texture);
          this.items = markLoadStatus(this.items, url, 'loaded');
          this.notify();
          this.pump();
        },
        undefined,
        () => {
          // 静默降级：标记失败，调用方继续使用程序化纹理
          this.items = markLoadStatus(this.items, url, 'failed');
          this.notify();
          this.pump();
        },
      );
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

let sharedManager: TextureManager | null = null;

/** 共享纹理管理器单例（全场景共用缓存与进度） */
export function getTextureManager(): TextureManager {
  if (!sharedManager) {
    sharedManager = new TextureManager();
  }
  return sharedManager;
}
