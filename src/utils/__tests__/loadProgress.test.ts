/**
 * 资源加载进度与优先级队列测试（P3-2，需求 §5.3）
 */

import type { LoadItem } from '@/utils/loadProgress';
import {
  computeLoadProgress,
  markLoadStatus,
  nextToStart,
  upsertLoadItem,
} from '@/utils/loadProgress';

describe('upsertLoadItem 注册加载项', () => {
  it('新 id 追加为 pending', () => {
    const items = upsertLoadItem([], '/a.jpg', 2);
    expect(items).toEqual([{ id: '/a.jpg', priority: 2, status: 'pending' }]);
  });

  it('重复注册不产生重复项', () => {
    let items = upsertLoadItem([], '/a.jpg', 2);
    items = upsertLoadItem(items, '/a.jpg', 2);
    expect(items).toHaveLength(1);
  });

  it('pending 项允许提升优先级（取更小值）', () => {
    let items = upsertLoadItem([], '/a.jpg', 3);
    items = upsertLoadItem(items, '/a.jpg', 0);
    expect(items[0].priority).toBe(0);
  });

  it('pending 项不允许降低优先级', () => {
    let items = upsertLoadItem([], '/a.jpg', 0);
    items = upsertLoadItem(items, '/a.jpg', 5);
    expect(items[0].priority).toBe(0);
  });

  it('已开始加载的项不改优先级', () => {
    let items = upsertLoadItem([], '/a.jpg', 3);
    items = markLoadStatus(items, '/a.jpg', 'loading');
    items = upsertLoadItem(items, '/a.jpg', 0);
    expect(items[0].priority).toBe(3);
  });

  it('不可变更新：不修改原数组', () => {
    const original: LoadItem[] = [{ id: '/a.jpg', priority: 1, status: 'pending' }];
    upsertLoadItem(original, '/b.jpg', 2);
    expect(original).toHaveLength(1);
  });
});

describe('nextToStart 优先级调度', () => {
  const base: LoadItem[] = [
    { id: '/low.jpg', priority: 3, status: 'pending' },
    { id: '/high.jpg', priority: 0, status: 'pending' },
    { id: '/mid.jpg', priority: 2, status: 'pending' },
  ];

  it('按优先级升序选出（数值小者优先）', () => {
    expect(nextToStart(base, 2)).toEqual(['/high.jpg', '/mid.jpg']);
  });

  it('受最大并发数限制（扣除 loading 中的项）', () => {
    const items = markLoadStatus(base, '/high.jpg', 'loading');
    expect(nextToStart(items, 2)).toEqual(['/mid.jpg']);
  });

  it('并发额度用满时返回空', () => {
    let items = markLoadStatus(base, '/high.jpg', 'loading');
    items = markLoadStatus(items, '/mid.jpg', 'loading');
    expect(nextToStart(items, 2)).toEqual([]);
  });

  it('maxConcurrent <= 0 返回空', () => {
    expect(nextToStart(base, 0)).toEqual([]);
    expect(nextToStart(base, -1)).toEqual([]);
  });

  it('loaded/failed 项不参与调度', () => {
    let items = markLoadStatus(base, '/high.jpg', 'loaded');
    items = markLoadStatus(items, '/mid.jpg', 'failed');
    expect(nextToStart(items, 3)).toEqual(['/low.jpg']);
  });

  it('同优先级按注册顺序', () => {
    const items: LoadItem[] = [
      { id: '/first.jpg', priority: 1, status: 'pending' },
      { id: '/second.jpg', priority: 1, status: 'pending' },
    ];
    expect(nextToStart(items, 2)).toEqual(['/first.jpg', '/second.jpg']);
  });
});

describe('markLoadStatus 状态标记', () => {
  it('标记指定项状态', () => {
    const items = upsertLoadItem([], '/a.jpg', 1);
    const next = markLoadStatus(items, '/a.jpg', 'loaded');
    expect(next[0].status).toBe('loaded');
  });

  it('id 不存在时原样返回（不抛错）', () => {
    const items = upsertLoadItem([], '/a.jpg', 1);
    const next = markLoadStatus(items, '/missing.jpg', 'loaded');
    expect(next).toEqual(items);
  });
});

describe('computeLoadProgress 进度统计', () => {
  it('无任务时进度为 1 且不活跃', () => {
    expect(computeLoadProgress([])).toEqual({ total: 0, done: 0, percent01: 1, active: false });
  });

  it('loaded 与 failed 均计入已完成（失败降级不阻塞进度）', () => {
    let items = upsertLoadItem([], '/a.jpg', 1);
    items = upsertLoadItem(items, '/b.jpg', 1);
    items = upsertLoadItem(items, '/c.jpg', 1);
    items = markLoadStatus(items, '/a.jpg', 'loaded');
    items = markLoadStatus(items, '/b.jpg', 'failed');
    const progress = computeLoadProgress(items);
    expect(progress.total).toBe(3);
    expect(progress.done).toBe(2);
    expect(progress.percent01).toBeCloseTo(2 / 3);
    expect(progress.active).toBe(true);
  });

  it('全部完成时 active 为 false、进度为 1', () => {
    let items = upsertLoadItem([], '/a.jpg', 1);
    items = markLoadStatus(items, '/a.jpg', 'loaded');
    expect(computeLoadProgress(items)).toEqual({
      total: 1,
      done: 1,
      percent01: 1,
      active: false,
    });
  });

  it('loading/pending 不计入已完成', () => {
    let items = upsertLoadItem([], '/a.jpg', 1);
    items = upsertLoadItem(items, '/b.jpg', 1);
    items = markLoadStatus(items, '/a.jpg', 'loading');
    const progress = computeLoadProgress(items);
    expect(progress.done).toBe(0);
    expect(progress.active).toBe(true);
  });
});
