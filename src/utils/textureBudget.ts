/**
 * 近观细节纹理显存预算与 LRU 保留策略（P4，需求 §4.7 硬性门控）
 *
 * 纯逻辑模块（textureManager 的策略镜像，供单元测试）：
 * - LRU 保留：仅最近使用的 N 个天体保留 4K/法线细节层，
 *   超出容量时释放最久未用天体的显存
 * - 显存估算：验证最坏组合下细节层显存增量 ≤300 MB（需求硬性指标）
 */

/** 4K 纹理（4096×2048 RGBA + mipmap ×4/3）单张显存估算（字节） */
export const TEXTURE_4K_BYTES = Math.round(4096 * 2048 * 4 * (4 / 3));

/** 细节层显存增量硬性上限（需求 §4.7：≤300 MB） */
export const DETAIL_BUDGET_BYTES = 300 * 1024 * 1024;

/** LRU 保留结果 */
export interface LruRetainResult {
  /** 新的保留顺序（最新在末尾） */
  order: string[];
  /** 被淘汰的 key（应释放显存） */
  evicted: string[];
}

/**
 * LRU 触达：把 key 移到最新位置，超出容量时淘汰最旧的 key
 */
export function lruRetain(
  order: readonly string[],
  key: string,
  capacity: number,
): LruRetainResult {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`LRU 容量必须为正整数，收到 ${capacity}`);
  }
  const next = order.filter((k) => k !== key);
  next.push(key);
  const evicted: string[] = [];
  while (next.length > capacity) {
    evicted.push(next.shift() as string);
  }
  return { order: next, evicted };
}

/** 从保留顺序中移除 key（主动释放时使用） */
export function lruRemove(order: readonly string[], key: string): string[] {
  return order.filter((k) => k !== key);
}

/**
 * 细节层显存估算（字节）：每张 4K 纹理按 TEXTURE_4K_BYTES 计
 */
export function detailBytesForTextureCount(count: number): number {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`纹理数必须为非负整数，收到 ${count}`);
  }
  return count * TEXTURE_4K_BYTES;
}
