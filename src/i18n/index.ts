/**
 * i18n 基建（B2，方案 K2：客户端切换）
 *
 * 架构红线（登记）：Next.js 内置 i18n 路由与 `output: 'export'` 静态导出
 * 不兼容（next.config.mjs）——只做客户端 locale 切换（Zustand 状态 +
 * 字典查找）；UI 语言不由 URL 路径决定。
 * H 迭代 H2 增补（2026-09-09）：唯一的例外是英文落地页 `/en`（路由组
 * 双根布局，见 `src/app/(en)/`）——它只改变**路由默认语言**（优先级链
 * 最末位），`?lang=` 与 localStorage 存值仍然优先；其余页面无 en 镜像。
 *
 * 核心降本设计（不得变更）：zh 为默认 locale——既有约 4,800 行中文测试
 * 断言零改动，测试永远跑 zh 默认态。
 *
 * 登记项：
 * - 查找函数签名：`t(locale, key)`（key 为编译期点分路径联合类型
 *   `MessageKey`，由 zh 字典推导；运行时防御性回退 zh → 键名本身）；
 * - localStorage 键名：`stellar-odyssey:locale`；
 * - 启动优先级：`?lang=` > localStorage > 路由默认（`/en` → en，其余 →
 *   zh；`routeDefaultLocale` 纯函数）（`resolveInitialLocale` 纯函数）；`lang` 参数解析已统一迁移至 `utils/launchParams.ts`
 *   单一入口（B4 收口登记：原 B2 独立轻量解析 `parseLangParam` 删除，
 *   语义零变更——大小写不敏感、非法值不短路优先级链）；
 * - `<html lang>`：locale 变更时客户端写 `document.documentElement.lang`
 *   （zh → 'zh-CN' 与 SSR 初始值一致，en → 'en'）；SEO metadata 保持
 *   zh-CN 不动（档位 3 边界登记）。
 */
import type { Locale, ViewLevel } from '@/types';
import type { CycleScope } from '@/utils/cycleScopes';
import { parseLaunchParams } from '@/utils/launchParams';
import { en } from './en';
import { zh } from './zh';

export type { I18nDict } from './zh';
export { en } from './en';
export { zh } from './zh';

/** locale 持久化 localStorage 键名（登记） */
export const LOCALE_STORAGE_KEY = 'stellar-odyssey:locale';

/** 默认 locale（勿改：既有中文测试断言零改动的前提） */
export const DEFAULT_LOCALE: Locale = 'zh';

/** 嵌套字典点分路径联合类型（编译期由字典结构推导） */
type DotKeys<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotKeys<T[K]>}`;
}[keyof T & string];

/** 全部合法消息键（以 zh 字典为单一事实来源） */
export type MessageKey = DotKeys<typeof zh>;

/**
 * 嵌套字典拍平为「点分键 → 文案」查找表（纯函数；模块加载时对 zh/en
 * 各预计算一次，运行时查找 O(1) 零分配——附录 A 渲染纪律）
 */
export function flattenMessages(
  dict: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') {
      out[path] = value;
    } else {
      Object.assign(out, flattenMessages(value as Record<string, unknown>, path));
    }
  }
  return out;
}

/** 预计算查找表（zh/en 各一份） */
const MESSAGES: Readonly<Record<Locale, Record<string, string>>> = {
  zh: flattenMessages(zh),
  en: flattenMessages(en),
};

/**
 * 字典查找纯函数（签名登记：`t(locale, key)`）
 *
 * key 为编译期校验的点分路径（`MessageKey`），正常路径必命中；
 * 运行时仍做防御性回退：目标 locale 缺键 → zh → 键名本身。
 */
export function t(locale: Locale, key: MessageKey): string {
  return MESSAGES[locale][key] ?? MESSAGES.zh[key] ?? key;
}

/**
 * 带参数插值的字典查找（B3 登记）：`{param}` 占位符简单替换，
 * 未提供的占位符原样保留（防御性：便于发现漏传参数）。
 * 同一键在 zh/en 可使用不同占位符子集（如 `hud.mergerTau` 的 {yi}/{myr}），
 * 消费侧一次性传入全部参数、按 locale 取用。
 */
export function tf(
  locale: Locale,
  key: MessageKey,
  params: Readonly<Record<string, string | number>>,
): string {
  return t(locale, key).replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** catalogText 组键前缀（键=中文原文，见 zh.ts 登记） */
const CATALOG_TEXT_PREFIX = 'catalogText.';

/**
 * 信息面板标签列/类型行本地化（B3 方案 K3 迁移边界）：
 * zh 态零开销直返原文；en 态查 `catalogText` 直映射，
 * 未收录条目（数据驱动的长尾标签）回退中文原文（豁免登记——
 * 英文态混排为已知可接受）。
 */
export function localizeCatalogText(locale: Locale, zhText: string): string {
  if (locale === 'zh') return zhText;
  return MESSAGES[locale][CATALOG_TEXT_PREFIX + zhText] ?? zhText;
}

/**
 * 天体显示名收口函数（B3-C 登记锚点）：en 取既有 `name` 英文字段、
 * zh 取 `nameZh`；无英文名（或空串）回退中文（豁免清单登记——当前
 * catalog 全量条目均有 name，仅防御数据驱动长尾）。
 *
 * @param fallback body 缺失（如 id 未入目录）时的回退文案（一般传 id）
 */
export function displayBodyName(
  locale: Locale,
  body: { name?: string; nameZh: string } | null | undefined,
  fallback = '',
): string {
  if (!body) return fallback;
  if (locale === 'en' && body.name !== undefined && body.name !== '') return body.name;
  return body.nameZh;
}

/**
 * 双语字段选择收口函数（i18n 全站覆盖）：en 态取英文字段（`*En`），
 * 缺失（undefined/空串）回退中文——数据层英文字段允许渐进补齐，
 * 未收录条目英文态混排为已知可接受（豁免登记沿用 B3 口径）。
 */
export function pickLocalized(
  locale: Locale,
  zhText: string,
  enText?: string,
): string {
  if (locale === 'en' && enText !== undefined && enText !== '') return enText;
  return zhText;
}

/** 视角层级 → 视角名键（ControlPanel 锚点按钮 + HUD 标题共用） */
export const VIEW_LEVEL_NAME_KEYS: Readonly<Record<ViewLevel, MessageKey>> = {
  L1: 'viewLevel.L1',
  L2: 'viewLevel.L2',
  L3: 'viewLevel.L3',
  L4: 'viewLevel.L4',
};

/** 巡游域 → 域名键（BodyCycleSwitcher；SCOPE_NAME_ZH 常量保留供纯逻辑侧） */
export const SCOPE_NAME_KEYS: Readonly<Record<CycleScope, MessageKey>> = {
  system: 'scopeName.system',
  solar: 'scopeName.solar',
  galaxy: 'scopeName.galaxy',
  universe: 'scopeName.universe',
};

/** 英文落地页路径（与 utils/siteMeta EN_HOME_PATH 同值；此处独立常量避免 i18n 反向依赖站点元信息模块） */
const EN_ROUTE_PATH = '/en';

/**
 * 路由默认语言（纯函数，H2）：`/en`、`/en/`、`/en.html`（大小写不敏感；
 * 静态导出产物为 en.html，GitHub Pages 以 `/en` 提供，本地静态预览为
 * `/en.html`）→ en，其余任意路径 → 站点默认 zh。只作为启动优先级链的
 * **最末位**。
 *
 * @param pathname `window.location.pathname`（不含查询串）
 */
export function routeDefaultLocale(pathname: string): Locale {
  const normalized = pathname
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.html$/, '');
  return normalized === EN_ROUTE_PATH ? 'en' : DEFAULT_LOCALE;
}

/**
 * 启动 locale 解析（纯函数）：优先级 `?lang=` > localStorage 存值 > 路由默认
 * （`fallback`，省略时为站点默认 zh——既有调用方与测试语义零变更）
 *
 * `lang` 参数经 B4 统一解析入口 `parseLaunchParams` 取值（B2 独立
 * `parseLangParam` 已迁移删除，语义零变更登记）。
 *
 * @param search `window.location.search`（含 `?` 或空串均可）
 * @param stored localStorage 读出的原始值（可能为 null/非法值）
 * @param fallback 路由默认语言（`routeDefaultLocale(pathname)`）
 */
export function resolveInitialLocale(
  search: string,
  stored: string | null,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  const fromParam = parseLaunchParams(search).lang;
  if (fromParam !== null) return fromParam;
  return stored === 'en' || stored === 'zh' ? stored : fallback;
}

/** locale → `<html lang>` 值（zh 取 'zh-CN' 与 SSR 初始值/SEO metadata 一致） */
export function htmlLangFor(locale: Locale): string {
  return locale === 'en' ? 'en' : 'zh-CN';
}

/** 读取持久化 locale 原始值（隐私模式等存取异常时静默返回 null） */
export function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 持久化 locale（存取异常时静默忽略——持久化失败不影响本次会话切换） */
export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 隐私模式/配额异常：忽略（会话内切换仍生效）
  }
}

/** `<html lang>` 客户端同步（无 DOM 环境静默忽略） */
export function syncHtmlLang(locale: Locale): void {
  try {
    document.documentElement.lang = htmlLangFor(locale);
  } catch {
    // SSR/无 DOM 环境：忽略（客户端挂载后由 setLocale/初始化同步）
  }
}
