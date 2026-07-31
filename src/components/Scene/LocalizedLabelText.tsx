'use client';

/**
 * 3D 场景标签本地化叶组件（i18n 全站覆盖）
 *
 * 性能纪律（附录 A §1 / hooks/useI18n 登记）：locale 切换仅触发 DOM 层
 * 重渲染——3D 组件（Planet/Moon/Universe 等）不直接订阅 locale，
 * 由本文件的叶组件在 Html 标签内部订阅并渲染文本，标签外的
 * three.js 场景图不因语言切换重建。
 */

import type { JSX } from 'react';
import type { MessageKey } from '@/i18n';
import { displayBodyName, t, tf } from '@/i18n';
import { useLocale } from '@/hooks/useI18n';

/**
 * 天体显示名文本（displayBodyName 收口：en 取 name、zh 取 nameZh，
 * 无英文名回退中文——与 HUD/巡游控件同一口径）
 */
export function BodyNameText({
  body,
  fallback = '',
}: {
  body: { name?: string; nameZh: string } | null | undefined;
  fallback?: string;
}): JSX.Element {
  const locale = useLocale();
  return <>{displayBodyName(locale, body, fallback)}</>;
}

/**
 * 字典键文本（`sceneLabel.*` 等场景标签键；带 params 时经 tf 插值）
 */
export function LabelText({
  k,
  params,
}: {
  k: MessageKey;
  params?: Readonly<Record<string, string | number>>;
}): JSX.Element {
  const locale = useLocale();
  return <>{params ? tf(locale, k, params) : t(locale, k)}</>;
}
