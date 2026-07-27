/**
 * 404 页跳转逻辑（src/app/not-found.tsx）
 *
 * GitHub Pages 托管下服务不可用/路径不存在会回落到 404.html（Next.js
 * 静态导出自 not-found 页）。页面倒计时结束后自动返回首页，跳转使用
 * location.replace——404 页不留浏览历史，用户"后退"不会再次落回 404。
 */

/** 自动返回首页的倒计时时长（真实秒） */
export const NOT_FOUND_REDIRECT_DELAY_SEC = 10;

/**
 * 倒计时推进：每秒递减 1，下钳到 0（到 0 后触发跳转，不再递减）。
 */
export function countdownNext(prevSec: number): number {
  if (!Number.isFinite(prevSec) || prevSec < 0) {
    throw new RangeError(`倒计时秒数必须为非负有限数，收到 ${prevSec}`);
  }
  return Math.max(0, prevSec - 1);
}

/**
 * 返回首页（location.replace 不留浏览历史）。
 *
 * location 参数可注入以便单测（jsdom 的 window.location 不可重定义）。
 */
export function redirectHome(location: Pick<Location, 'replace'> = window.location): void {
  location.replace('/');
}
