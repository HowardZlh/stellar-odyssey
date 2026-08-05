/**
 * 位图纹理加载管理器（P3-1/P3-2，P4 细节层 LRU）
 *
 * - THREE.TextureLoader 异步加载（AGENTS.md 规范），按优先级懒加载
 *   （队列纯逻辑见 utils/loadProgress.ts，可单元测试）
 * - 加载失败静默降级：调用方拿不到位图时继续使用程序化纹理
 *   （proceduralTextures.ts 为降级路径，符合项目静默降级哲学）
 * - 纹理缓存共享（同一 URL 只加载一次），disposeAll() 在应用卸载时
 *   释放全部 GPU 资源（AGENTS.md 强制内存管理）
 * - P4（需求 §4.7）：4K/法线近观细节层按天体分组做 LRU 保留——
 *   仅最近 DETAIL_LRU_CAPACITY 个天体保留细节层显存（≤300 MB），
 *   切换天体/离开 L1 时释放（策略纯逻辑见 utils/textureBudget.ts）
 * - 法线贴图（URL 含 "_normal"）按线性色彩空间加载（法线数据非 sRGB）
 *
 * 纹理来源与许可：Solar System Scope（CC BY 4.0）+ NASA 公有领域高程
 * 数据转换的法线贴图，登记见 data/textures.ts
 */

import * as THREE from 'three';
import type { LoadItem, LoadProgress } from '@/utils/loadProgress';
import {
  computeLoadProgress,
  markLoadStatus,
  nextToStart,
  removeLoadItems,
  upsertLoadItem,
} from '@/utils/loadProgress';
import { DETAIL_LRU_CAPACITY } from '@/utils/planetDetail';
import { lruRemove, lruRetain } from '@/utils/textureBudget';

/** 最大并发加载数（保证高优先级纹理先到；M2-4 触屏降 2 经 configureQuality） */
const MAX_CONCURRENT_LOADS = 3;

/** 纹理各向异性过滤默认值（M2-4 medium/low 降 2 经 configureQuality） */
const DEFAULT_ANISOTROPY = 4;

/** 质量档配置项（M2-4，SolarSystemApp 启动时按 qualityTier 档位表写入一次） */
export interface TextureQualityOptions {
  /** 细节层 LRU 天体容量（qualityTier.detailLruCapacityForBudgetMB 换算） */
  detailLruCapacity: number;
  /** 各向异性过滤（4 / 2 / 2） */
  anisotropy: number;
  /** 并发加载数（桌面 3 / 触屏 2） */
  maxConcurrentLoads: number;
}

type Listener = () => void;

class TextureManager {
  private items: LoadItem[] = [];

  private textures = new Map<string, THREE.Texture>();

  private listeners = new Set<Listener>();

  private loader: THREE.TextureLoader | null = null;

  /** 细节层 LRU：天体保留顺序（最新在末尾）与各天体的细节纹理 URL */
  private detailOrder: string[] = [];

  private detailUrls = new Map<string, string[]>();

  /** M2-4 质量档参数（默认 = 现状 high 档；启动时可经 configureQuality 降档） */
  private detailCapacity = DETAIL_LRU_CAPACITY;

  private anisotropy = DEFAULT_ANISOTROPY;

  private maxConcurrent = MAX_CONCURRENT_LOADS;

  /** 应用质量档配置（M2-4：启动一次性调用；已加载纹理不回溯改写） */
  configureQuality(options: TextureQualityOptions): void {
    if (!Number.isInteger(options.detailLruCapacity) || options.detailLruCapacity < 1) {
      throw new RangeError(`LRU 容量必须为正整数，收到 ${options.detailLruCapacity}`);
    }
    if (!Number.isInteger(options.maxConcurrentLoads) || options.maxConcurrentLoads < 1) {
      throw new RangeError(`并发加载数必须为正整数，收到 ${options.maxConcurrentLoads}`);
    }
    if (!(options.anisotropy >= 1)) {
      throw new RangeError(`anisotropy 必须 ≥1，收到 ${options.anisotropy}`);
    }
    this.detailCapacity = options.detailLruCapacity;
    this.anisotropy = options.anisotropy;
    this.maxConcurrent = options.maxConcurrentLoads;
  }

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

  /**
   * 细节层 LRU 保留（P4）：登记天体的近观细节纹理组并触达 LRU，
   * 超出容量时释放最久未用天体的细节层显存
   */
  retainDetail(bodyId: string, urls: readonly string[]): void {
    this.detailUrls.set(bodyId, [...urls]);
    const { order, evicted } = lruRetain(this.detailOrder, bodyId, this.detailCapacity);
    this.detailOrder = order;
    for (const evictedBody of evicted) {
      this.releaseUrls(this.detailUrls.get(evictedBody) ?? []);
      this.detailUrls.delete(evictedBody);
    }
    if (evicted.length > 0) {
      this.notify();
    }
  }

  /** 主动释放指定天体的细节层显存（离开 L1 语境时调用，P4） */
  releaseDetail(bodyId: string): void {
    const urls = this.detailUrls.get(bodyId);
    if (!urls) return;
    this.detailOrder = lruRemove(this.detailOrder, bodyId);
    this.detailUrls.delete(bodyId);
    this.releaseUrls(urls);
    this.notify();
  }

  /** 释放全部纹理与状态（应用卸载时调用，AGENTS.md 内存管理） */
  disposeAll(): void {
    for (const texture of this.textures.values()) {
      texture.dispose();
    }
    this.textures.clear();
    this.items = [];
    this.detailOrder = [];
    this.detailUrls.clear();
    this.notify();
  }

  private releaseUrls(urls: readonly string[]): void {
    for (const url of urls) {
      const texture = this.textures.get(url);
      if (texture) {
        texture.dispose();
        this.textures.delete(url);
      }
    }
    // 从队列移除：之后可重新注册加载（再次进入近观时重新请求）
    this.items = removeLoadItems(this.items, urls);
  }

  private pump(): void {
    // SSR/测试环境无 Image，静默跳过（组件端只在浏览器调用）
    if (typeof window === 'undefined') return;
    if (!this.loader) {
      this.loader = new THREE.TextureLoader();
    }
    const startIds = nextToStart(this.items, this.maxConcurrent);
    if (startIds.length === 0) return;
    for (const url of startIds) {
      this.items = markLoadStatus(this.items, url, 'loading');
      this.loader.load(
        url,
        (texture) => {
          // 加载期间被释放（LRU 淘汰）：丢弃结果，避免孤儿 GPU 资源
          if (!this.items.some((item) => item.id === url)) {
            texture.dispose();
            this.pump();
            return;
          }
          // 法线贴图为线性数据（非 sRGB），色彩贴图按 sRGB 处理
          texture.colorSpace = url.includes('_normal')
            ? THREE.NoColorSpace
            : THREE.SRGBColorSpace;
          texture.anisotropy = this.anisotropy;
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
