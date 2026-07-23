/**
 * 人造卫星 glTF 模型管理器（P7 §3.1，镜像 textureManager 的持有/释放模式）
 *
 * - 按需加载：仅近观门控激活时由 SatelliteModel 请求（懒加载，
 *   加载期间维持轻量盒体表示，首屏无模型网络请求）
 * - EXT_meshopt_compression 经 three-stdlib MeshoptDecoder 解码
 *   （解码器随依赖内置，无需额外资源文件）
 * - 加载失败静默降级（状态置 failed，组件回落程序化几何组合，不报错）
 * - 释放：离开 L1 语境（近观门控 releaseNow）时 dispose 场景内全部
 *   geometry/material/texture 并移除缓存（AGENTS.md 内存管理；
 *   模型单个 ≤0.4 MB，因距离退出时保留缓存便于快速切回）
 */

import * as THREE from 'three';
import { GLTFLoader, MeshoptDecoder } from 'three-stdlib';

export type ModelStatus = 'loading' | 'ready' | 'failed';

interface ModelRecord {
  status: ModelStatus;
  scene: THREE.Group | null;
}

class SatelliteModelManager {
  private records = new Map<string, ModelRecord>();

  private listeners = new Map<string, Set<() => void>>();

  private loader: GLTFLoader;

  constructor() {
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder());
  }

  /** 当前状态（不存在时返回 null） */
  status(url: string): ModelStatus | null {
    return this.records.get(url)?.status ?? null;
  }

  /** 已就绪的模型场景（未就绪返回 null） */
  scene(url: string): THREE.Group | null {
    const rec = this.records.get(url);
    return rec?.status === 'ready' ? rec.scene : null;
  }

  /** 请求加载（幂等：已在缓存中则直接返回当前状态） */
  request(url: string): ModelStatus {
    const existing = this.records.get(url);
    if (existing) return existing.status;
    const record: ModelRecord = { status: 'loading', scene: null };
    this.records.set(url, record);
    this.loader.load(
      url,
      (gltf) => {
        // 加载完成前被释放：直接丢弃并 dispose
        if (this.records.get(url) !== record) {
          disposeObject(gltf.scene);
          return;
        }
        record.status = 'ready';
        record.scene = gltf.scene;
        this.notify(url);
      },
      undefined,
      () => {
        // 静默降级（P7 §3.1：模型加载失败回落程序化几何组合）
        if (this.records.get(url) !== record) return;
        record.status = 'failed';
        this.notify(url);
      },
    );
    return record.status;
  }

  /** 订阅状态变化（返回取消订阅函数） */
  subscribe(url: string, listener: () => void): () => void {
    let set = this.listeners.get(url);
    if (!set) {
      set = new Set();
      this.listeners.set(url, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  /** 释放模型（离开 L1 语境时调用；失败记录一并清除以便重试） */
  release(url: string): void {
    const rec = this.records.get(url);
    if (!rec) return;
    if (rec.scene) disposeObject(rec.scene);
    this.records.delete(url);
  }

  /** 应用卸载时释放全部模型 */
  disposeAll(): void {
    for (const url of Array.from(this.records.keys())) {
      this.release(url);
    }
    this.listeners.clear();
  }

  private notify(url: string): void {
    this.listeners.get(url)?.forEach((l) => l());
  }
}

/** 释放对象树的全部 GPU 资源 */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  const m = material as THREE.MeshStandardMaterial;
  m.map?.dispose();
  m.normalMap?.dispose();
  m.roughnessMap?.dispose();
  m.metalnessMap?.dispose();
  m.emissiveMap?.dispose();
  m.aoMap?.dispose();
  material.dispose();
}

let manager: SatelliteModelManager | null = null;

/** 全局单例 */
export function getSatelliteModelManager(): SatelliteModelManager {
  if (!manager) manager = new SatelliteModelManager();
  return manager;
}
