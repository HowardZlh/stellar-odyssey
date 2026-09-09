/**
 * 分享链接组装（G5，REQUIREMENTS_GROWTH §3 M2）
 *
 * 纯函数模块（不触 DOM，可全分支单测）：把「当前此刻」组装为可深链
 * 复现的绝对 URL，消费侧为「分享此刻」按钮（主场景 HUD + 观察站页）。
 *
 * 口径（硬性约束登记）：
 * - 分享 URL **只允许携带 `body` / `lang` 两个查询参数**（及观察站路径
 *   形态 `/lab/observatory/<id>`）——严禁携带 token 或任何用户标识；
 * - 主场景 + en：路径取英文落地页 `/en`（H 迭代 H6——`/en` 原始 HTML
 *   即英文 lang/分享卡，接收方在 HN/Reddit/X 看到英文预览），不再拼
 *   `?lang=en`（`/en` 的路由默认语言即 en，见 i18n routeDefaultLocale）；
 * - 观察站 + en：仍以 `?lang=en` 携带（观察站无 en 路由）；zh 分享出的
 *   链接不带 lang，保持接收方自身的语言偏好链（?lang > localStorage >
 *   路由默认，见 launchParams 解析口径）；
 * - 主场景无选中/跟随天体时输出站点根 URL（zh：`/`；en：`/en`）；
 * - 观察站路径经 `observatoryBodyPath` 同源函数构造（与页面
 *   replaceState 规范化同一形态）。
 */

import type { Locale } from '@/types';
import { observatoryBodyPath } from '@/utils/lab';
import { EN_HOME_PATH } from '@/utils/siteMeta';

/** 分享上下文：主场景（body 可空）或观察站工位（body 必填，路径形态） */
export type ShareContext =
  | { readonly kind: 'main'; readonly bodyId: string | null }
  | { readonly kind: 'observatory'; readonly bodyId: string };

/** 默认语言（与 resolveInitialLocale 默认一致）：分享链接不显式携带 */
const SHARE_DEFAULT_LOCALE: Locale = 'zh';

/**
 * 组装分享绝对 URL（纯函数）
 *
 * @param origin  站点源（`window.location.origin` 形态；尾部斜杠安全）
 * @param context 分享上下文（主场景当前天体 / 观察站工位）
 * @param locale  当前界面语言（非默认时以 `?lang=` 携带）
 */
export function buildShareUrl(
  origin: string,
  context: ShareContext,
  locale: Locale,
): string {
  const base = origin.replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (context.kind === 'main') {
    const bodyId = context.bodyId?.trim() ?? '';
    if (bodyId !== '') params.set('body', bodyId);
  }
  let path: string;
  if (context.kind === 'observatory') {
    path = observatoryBodyPath(context.bodyId);
    if (locale !== SHARE_DEFAULT_LOCALE) params.set('lang', locale);
  } else {
    path = locale === 'en' ? EN_HOME_PATH : '/';
  }
  const query = params.toString();
  return `${base}${path}${query === '' ? '' : `?${query}`}`;
}
