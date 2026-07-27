/**
 * 确定性伪随机数（星场等程序化内容要求位置稳定，需求 4.5）
 *
 * mulberry32：快速、分布均匀、种子确定则序列确定。
 */

/**
 * 创建种子化随机数生成器，返回 [0, 1) 区间随机数的函数
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
