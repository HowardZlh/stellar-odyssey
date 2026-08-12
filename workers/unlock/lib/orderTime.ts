/**
 * 爱发电订单号 → 下单时间（REQUIREMENTS_UNLOCK.md §0.6 平移项）：
 * 订单号以下单时间开头 `YYYYMMDDHHMMSS...`（北京时间 UTC+8），
 * 作为解锁 token 的 exp 起算点。
 */

/**
 * 解析订单号前 14 位为 epoch 秒；任何非法输入（长度不足、日历越界
 * 如 13 月/32 日/25 时）返回 null，不抛异常。
 */
export function parseOrderEpochSec(orderId: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(orderId);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s] = m;
  // ISO 8601 带时区字符串：各引擎对越界分量（月>12/日>31/时>23…）
  // 一律返回 NaN，天然完成日历校验
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}
