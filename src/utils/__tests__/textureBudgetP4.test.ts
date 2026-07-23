/**
 * 细节纹理显存预算 / LRU 保留策略 / 队列移除测试（P4，需求 §4.7 硬性门控）
 */

import { removeLoadItems, upsertLoadItem } from '@/utils/loadProgress';
import type { LoadItem } from '@/utils/loadProgress';
import { DETAIL_LRU_CAPACITY } from '@/utils/planetDetail';
import {
  DETAIL_BUDGET_BYTES,
  TEXTURE_4K_BYTES,
  detailBytesForTextureCount,
  lruRemove,
  lruRetain,
} from '@/utils/textureBudget';

describe('LRU 保留策略（仅最近天体保留 4K 层）', () => {
  it('触达把 key 移到最新位置', () => {
    const r = lruRetain(['earth', 'mars'], 'earth', 3);
    expect(r.order).toEqual(['mars', 'earth']);
    expect(r.evicted).toEqual([]);
  });

  it('超出容量时淘汰最旧 key', () => {
    const r = lruRetain(['earth', 'mars'], 'jupiter', 2);
    expect(r.order).toEqual(['mars', 'jupiter']);
    expect(r.evicted).toEqual(['earth']);
  });

  it('切换序列场景：连续切换仅保留最近 2 个天体', () => {
    let order: string[] = [];
    const allEvicted: string[] = [];
    for (const body of ['earth', 'moon', 'mars', 'jupiter']) {
      const r = lruRetain(order, body, DETAIL_LRU_CAPACITY);
      order = r.order;
      allEvicted.push(...r.evicted);
    }
    expect(order).toEqual(['mars', 'jupiter']);
    expect(allEvicted).toEqual(['earth', 'moon']);
  });

  it('容量非法抛错', () => {
    expect(() => lruRetain([], 'earth', 0)).toThrow(RangeError);
  });

  it('lruRemove 移除指定 key（不存在时原样）', () => {
    expect(lruRemove(['a', 'b'], 'a')).toEqual(['b']);
    expect(lruRemove(['a', 'b'], 'c')).toEqual(['a', 'b']);
  });
});

describe('显存预算（需求 4.7：细节层增量 ≤300MB）', () => {
  it('单张 4K 纹理估算 ~44.7MB（RGBA + mipmap）', () => {
    expect(TEXTURE_4K_BYTES).toBeCloseTo(4096 * 2048 * 4 * (4 / 3), -3);
  });

  it('最坏 LRU 组合不超预算：地球 4 张（日/夜/云/法线）+ 火星 2 张（面/法线）', () => {
    const worstCase = detailBytesForTextureCount(4 + 2);
    expect(worstCase).toBeLessThanOrEqual(DETAIL_BUDGET_BYTES);
  });

  it('纹理数非法抛错', () => {
    expect(() => detailBytesForTextureCount(-1)).toThrow(RangeError);
    expect(() => detailBytesForTextureCount(1.5)).toThrow(RangeError);
  });
});

describe('加载队列移除（LRU 释放后可重新请求）', () => {
  const items: LoadItem[] = [
    { id: 'a', priority: 0, status: 'loaded' },
    { id: 'b', priority: 1, status: 'loading' },
    { id: 'c', priority: 2, status: 'pending' },
  ];

  it('移除指定 id（含 loading 中的项）', () => {
    const next = removeLoadItems(items, ['a', 'b']);
    expect(next.map((i) => i.id)).toEqual(['c']);
  });

  it('空移除列表返回等价副本', () => {
    const next = removeLoadItems(items, []);
    expect(next).toEqual(items);
    expect(next).not.toBe(items);
  });

  it('移除后可重新注册加载（重新进入近观时重新请求）', () => {
    let next = removeLoadItems(items, ['a']);
    next = upsertLoadItem(next, 'a', 0);
    expect(next.find((i) => i.id === 'a')?.status).toBe('pending');
  });

  it('不存在的 id 原样返回', () => {
    expect(removeLoadItems(items, ['zzz'])).toEqual(items);
  });
});
