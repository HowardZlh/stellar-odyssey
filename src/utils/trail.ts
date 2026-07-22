/**
 * 历史尾迹环形缓冲（需求 4.3 非闭合轨迹）
 *
 * - "历史尾迹 + 未来预测线"中的历史段：已走过路径的有限长度实线
 * - 环形缓冲保证尾迹积累不导致内存增长（容量固定，旧点被覆盖）
 * - 纯数据结构，与渲染解耦，便于测试
 */

export interface TrailBuffer {
  /** 容量（点数） */
  readonly capacity: number;
  /** 平铺的 xyz 坐标（长度 capacity*3） */
  readonly data: Float32Array;
  /** 下一个写入位置（点索引） */
  head: number;
  /** 当前有效点数（≤ capacity） */
  count: number;
}

/**
 * 创建尾迹缓冲
 */
export function createTrailBuffer(capacity: number): TrailBuffer {
  if (!Number.isInteger(capacity) || capacity < 2) {
    throw new RangeError(`尾迹容量必须为 ≥2 的整数，收到 ${capacity}`);
  }
  return { capacity, data: new Float32Array(capacity * 3), head: 0, count: 0 };
}

/**
 * 追加一个尾迹点（满时覆盖最旧点）
 */
export function pushTrailPoint(buffer: TrailBuffer, x: number, y: number, z: number): void {
  const i = buffer.head * 3;
  buffer.data[i] = x;
  buffer.data[i + 1] = y;
  buffer.data[i + 2] = z;
  buffer.head = (buffer.head + 1) % buffer.capacity;
  buffer.count = Math.min(buffer.count + 1, buffer.capacity);
}

/**
 * 导出按时间顺序（最旧 → 最新）排列的坐标数组（长度 count*3）
 */
export function trailToOrderedArray(buffer: TrailBuffer): Float32Array {
  const result = new Float32Array(buffer.count * 3);
  const start = buffer.count < buffer.capacity ? 0 : buffer.head;
  for (let i = 0; i < buffer.count; i += 1) {
    const src = ((start + i) % buffer.capacity) * 3;
    result[i * 3] = buffer.data[src];
    result[i * 3 + 1] = buffer.data[src + 1];
    result[i * 3 + 2] = buffer.data[src + 2];
  }
  return result;
}

/**
 * 清空尾迹（跨层级/参考系切换时调用，避免坐标残留，需求 4.3）
 */
export function clearTrail(buffer: TrailBuffer): void {
  buffer.head = 0;
  buffer.count = 0;
}
