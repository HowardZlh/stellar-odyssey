/**
 * 天文实验室注册表（M2-1，IMPROVEMENT_REQUIREMENTS_METEOR_SHOWERS §M2 / 契约 C4）
 *
 * 纯逻辑模块：为 `/lab`（实验室首页条目卡片）与 `/lab/<labId>`（场景页）提供
 * 「实验条目 → i18n 键 / 场景组件标识 / 数据来源」的查找。后续条目（如日全食，
 * 另立 IMPROVEMENT_REQUIREMENTS_SOLAR_ECLIPSE.md）在 `LAB_REGISTRY` 追加。
 *
 * 设计约束（devPreview.ts 同范式）：
 * - 本文件不 import React / three，保持纯 TS 可单测（覆盖率 gate ≥90%）。
 * - `componentKey` 为字符串标识，场景页据此动态 import 实际 R3F 组件
 *   （渲染依赖不污染纯逻辑层，实验室场景独立 chunk、主页首屏 bundle 零增大）。
 * - `titleKey` / `descriptionKey` 为 i18n 字典键（`MessageKey` 编译期联合类型，
 *   非硬编码字符串——键存在性由类型系统保证，契约 C4）。
 */

import type { MessageKey } from '@/i18n';

/**
 * 实验室条目（契约 C4）：`LabEntry { labId, titleKey, descriptionKey, componentKey, dataSource }`
 */
export interface LabEntry {
  /** 条目 id（路由段 `/lab/<labId>`，注册期校验唯一） */
  labId: string;
  /** 条目标题 i18n 键（zh 为类型源，缺键编译报错） */
  titleKey: MessageKey;
  /** 条目描述 i18n 键 */
  descriptionKey: MessageKey;
  /** 场景组件标识（场景页据此动态 import 对应 R3F 组件） */
  componentKey: string;
  /** 数据/近似来源登记（署名豁免惯例：保持原文，不入 i18n 字典） */
  dataSource: string;
}

/** 路由段合法形态：小写字母/数字/连字符（静态导出路径安全） */
const LAB_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * 校验实验室条目合法性（注册期防错，纯函数）
 *
 * i18n 键存在性由 `MessageKey` 类型系统保证，此处只校验运行时不变量。
 *
 * @throws RangeError labId 形态非法 / componentKey 或 dataSource 为空
 */
export function validateLabEntry(entry: LabEntry): void {
  if (!LAB_ID_PATTERN.test(entry.labId)) {
    throw new RangeError(
      `实验室条目 labId 必须为小写字母/数字/连字符（路由段安全），收到 "${entry.labId}"`,
    );
  }
  if (entry.componentKey.length === 0) {
    throw new RangeError(`实验室条目 ${entry.labId} 的 componentKey 不得为空`);
  }
  if (entry.dataSource.length === 0) {
    throw new RangeError(`实验室条目 ${entry.labId} 的 dataSource 不得为空（来源登记强制）`);
  }
}

/**
 * 盛夏双重流星雨（本期唯一条目；M2 阶段为星穹 + 环顾相机，
 * 流星/余迹/控件随 M3、音频/移动端随 M4 递进）
 */
const METEOR_SHOWER_ENTRY: LabEntry = {
  labId: 'meteor-shower',
  titleKey: 'lab.meteorShowerTitle',
  descriptionKey: 'lab.meteorShowerDescription',
  componentKey: 'meteor-shower-lab',
  dataSource:
    'Yale Bright Star Catalog, 5th Revised Ed.（Hoffleit & Warren 1991，mag ≤ 6.5 共 8,404 颗）；IAU Meteor Data Center（英仙座 #7 PER / 天鹅座κ #12 KCG 辐射点与入速）；烧蚀模型经典近似（§1.1 登记）',
};

/**
 * 实验室注册表（后续条目在此追加）
 *
 * 以 Map 存储便于 O(1) 查找；模块加载时对每个条目做一次合法性自检，
 * 并断言 labId 唯一（重复注册即抛错）。
 */
export const LAB_REGISTRY: ReadonlyMap<string, LabEntry> = (() => {
  const entries: readonly LabEntry[] = [METEOR_SHOWER_ENTRY];
  const map = new Map<string, LabEntry>();
  for (const e of entries) {
    validateLabEntry(e);
    if (map.has(e.labId)) {
      throw new RangeError(`实验室条目 labId 重复注册：${e.labId}`);
    }
    map.set(e.labId, e);
  }
  return map;
})();

/**
 * 按 labId 查找实验室条目
 *
 * @returns 已注册返回条目；未注册返回 null（场景页显示占位提示）
 */
export function labEntryForId(id: string | null | undefined): LabEntry | null {
  if (!id) return null;
  return LAB_REGISTRY.get(id) ?? null;
}

/** 已注册的全部实验条目（`/lab` 首页卡片列表按注册序渲染） */
export function registeredLabEntries(): readonly LabEntry[] {
  return Array.from(LAB_REGISTRY.values());
}

/** 条目场景页路由路径（首页卡片链接与入口跳转共用） */
export function labScenePath(entry: LabEntry): string {
  return `/lab/${entry.labId}`;
}

/** 实验室首页路由路径（主界面入口/场景页返回链接同源常量） */
export const LAB_PAGE_PATH = '/lab';
