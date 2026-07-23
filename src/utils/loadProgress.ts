/**
 * 资源加载进度与优先级队列（P3-2，需求 §5.3 加载进度显示 + 懒加载策略）
 *
 * 纯逻辑模块（不依赖 three.js / DOM），供单元测试：
 * - 加载项按优先级（数值越小越优先）排队，受最大并发数限制
 * - 进度统计：loaded + failed 均计入"已完成"（失败会降级到程序化纹理，
 *   不应阻塞进度条到达 100%）
 * - 播放端封装见 components/CelestialBody/textureManager.ts
 */

/** 加载状态 */
export type LoadStatus = 'pending' | 'loading' | 'loaded' | 'failed';

/** 单个加载项 */
export interface LoadItem {
  /** 唯一 id（纹理 URL） */
  id: string;
  /** 优先级：数值越小越优先（0 = 当前聚焦天体） */
  priority: number;
  status: LoadStatus;
}

/** 进度汇总 */
export interface LoadProgress {
  /** 总项数 */
  total: number;
  /** 已完成项数（loaded + failed） */
  done: number;
  /** 进度 [0,1]；无任务时为 1 */
  percent01: number;
  /** 是否有未完成任务（进度 UI 显示条件） */
  active: boolean;
}

/**
 * 注册/更新加载项（不可变更新）：
 * - 新 id 追加为 pending
 * - 已存在且未开始时允许提升优先级（取更小值）；已开始/完成的项不变
 */
export function upsertLoadItem(items: readonly LoadItem[], id: string, priority: number): LoadItem[] {
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) {
    return [...items, { id, priority, status: 'pending' }];
  }
  const existing = items[idx];
  if (existing.status !== 'pending' || priority >= existing.priority) {
    return [...items];
  }
  const next = [...items];
  next[idx] = { ...existing, priority };
  return next;
}

/**
 * 选出下一批应开始加载的项 id：
 * pending 按优先级升序（同优先级按注册顺序），
 * 受 maxConcurrent 限制（扣除已在 loading 的数量）。
 */
export function nextToStart(items: readonly LoadItem[], maxConcurrent: number): string[] {
  if (maxConcurrent <= 0) return [];
  const loadingCount = items.filter((item) => item.status === 'loading').length;
  const budget = maxConcurrent - loadingCount;
  if (budget <= 0) return [];
  return items
    .filter((item) => item.status === 'pending')
    .sort((a, b) => a.priority - b.priority)
    .slice(0, budget)
    .map((item) => item.id);
}

/**
 * 标记加载项状态（不可变更新）；id 不存在时原样返回
 */
export function markLoadStatus(
  items: readonly LoadItem[],
  id: string,
  status: LoadStatus,
): LoadItem[] {
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) return [...items];
  const next = [...items];
  next[idx] = { ...next[idx], status };
  return next;
}

/**
 * 移除加载项（不可变更新，P4 细节层释放）：
 * 被移除的项可在之后重新注册加载（LRU 淘汰后再次进入近观时重新请求）
 */
export function removeLoadItems(items: readonly LoadItem[], ids: readonly string[]): LoadItem[] {
  if (ids.length === 0) return [...items];
  const remove = new Set(ids);
  return items.filter((item) => !remove.has(item.id));
}

/**
 * 汇总进度：loaded + failed 计入已完成；无任务时 percent01 = 1、active = false
 */
export function computeLoadProgress(items: readonly LoadItem[]): LoadProgress {
  const total = items.length;
  let done = 0;
  for (const item of items) {
    if (item.status === 'loaded' || item.status === 'failed') {
      done += 1;
    }
  }
  return {
    total,
    done,
    percent01: total === 0 ? 1 : done / total,
    active: done < total,
  };
}
