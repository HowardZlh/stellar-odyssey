/**
 * 开发预览工位注册表（R4-1，IMPROVEMENT_REQUIREMENTS_4 §R4-1）
 *
 * 纯逻辑模块：为 `/dev/preview?body=<id>` 页面提供"天体 id → 细节模型挂载配置"的
 * 查找与调试参数默认值解析。后续 R4 各阶段把新的细节组件通过 `PREVIEW_REGISTRY`
 * 注册进来，预览页据此渲染对应组件、生成调试滑杆。
 *
 * 设计约束（附录 A §3 纯函数先行）：
 * - 本文件不 import React / three，保持纯 TS 可单测（覆盖率 gate ≥90%）。
 * - `componentKey` 为字符串标识，预览页（组件层）据此选择实际的 R3F 组件挂载，
 *   使渲染依赖不污染纯逻辑层，也让预览专用组件可被动态 import（主 bundle 零增大）。
 * - 每个条目声明 ≤8 个调试滑杆（`PreviewParam`）；超过即视为配置错误（`validatePreviewEntry`）。
 */

/** 单个天体细节组件可声明的最大调试滑杆数（§R4-1：≤8 个） */
export const MAX_PREVIEW_PARAMS = 8;

/**
 * 调试滑杆声明（组件层据 key 读取当前值经 props/context 注入渲染组件）
 */
export interface PreviewParam {
  /** 参数键（组件内消费，需在同一条目内唯一） */
  key: string;
  /** 面板显示标签 */
  label: string;
  /** 滑杆最小值 */
  min: number;
  /** 滑杆最大值 */
  max: number;
  /** 默认值（须落在 [min,max]） */
  default: number;
  /** 滑杆步进（可选，默认 (max-min)/100） */
  step?: number;
}

/**
 * 预览条目：天体 id 对应的细节模型挂载配置
 */
export interface PreviewEntry {
  /** 天体 id（与 catalog/specialBodies/galaxies 一致） */
  bodyId: string;
  /** 面板标题（人类可读） */
  title: string;
  /** 预览组件标识（预览页据此选择实际 R3F 组件） */
  componentKey: string;
  /** 调试滑杆声明（≤MAX_PREVIEW_PARAMS 个） */
  params: readonly PreviewParam[];
  /** 相机初始距离（场景单位；OrbitControls 起始半径） */
  cameraDistance: number;
  /** 数据/近似来源登记（附录 A §4） */
  dataSource?: string;
}

/**
 * 校验预览条目合法性（注册期防错，纯函数）
 *
 * @throws RangeError 参数数量超限 / 键重复 / min>max / 默认值越界
 */
export function validatePreviewEntry(entry: PreviewEntry): void {
  if (entry.params.length > MAX_PREVIEW_PARAMS) {
    throw new RangeError(
      `预览条目 ${entry.bodyId} 声明了 ${entry.params.length} 个滑杆，超过上限 ${MAX_PREVIEW_PARAMS}`,
    );
  }
  if (!(entry.cameraDistance > 0) || !Number.isFinite(entry.cameraDistance)) {
    throw new RangeError(
      `预览条目 ${entry.bodyId} 的相机距离必须为正有限数，收到 ${entry.cameraDistance}`,
    );
  }
  const seen = new Set<string>();
  for (const p of entry.params) {
    if (seen.has(p.key)) {
      throw new RangeError(`预览条目 ${entry.bodyId} 存在重复参数键 ${p.key}`);
    }
    seen.add(p.key);
    if (!(p.min <= p.max)) {
      throw new RangeError(
        `预览参数 ${entry.bodyId}.${p.key} 的 min(${p.min}) 必须 ≤ max(${p.max})`,
      );
    }
    if (p.default < p.min || p.default > p.max) {
      throw new RangeError(
        `预览参数 ${entry.bodyId}.${p.key} 的默认值 ${p.default} 越界 [${p.min}, ${p.max}]`,
      );
    }
    if (p.step !== undefined && !(p.step > 0)) {
      throw new RangeError(
        `预览参数 ${entry.bodyId}.${p.key} 的步进必须为正数，收到 ${p.step}`,
      );
    }
  }
}

/**
 * 参宿四（Betelgeuse）预览条目：接入现有 `StellarSurface`（R4-1 管线验证样例）
 *
 * 参数取自 `SpecialBodies.tsx` `RedGiant` 的 StellarSurface props（红巨星档）：
 * 强边缘昏暗、大对流胞（cellScale 小）、显著边缘偏红。
 */
const BETELGEUSE_ENTRY: PreviewEntry = {
  bodyId: 'betelgeuse',
  title: '参宿四 Betelgeuse（红超巨星 · StellarSurface）',
  componentKey: 'stellar-surface',
  cameraDistance: 3.2,
  params: [
    { key: 'limbU', label: '边缘昏暗系数 u', min: 0, max: 1, default: 0.75 },
    { key: 'cellScale', label: '对流胞尺度', min: 0.5, max: 6, default: 2.2 },
    { key: 'convection', label: '对流对比', min: 0, max: 1, default: 0.7 },
    { key: 'rednessStrength', label: '边缘偏红', min: 0, max: 1, default: 0.6 },
    { key: 'timeScale', label: '时间流速', min: 0, max: 4, default: 1 },
  ],
  dataSource: 'NASA/ESA Hipparcos-Gaia；ESO VLT/SPHERE（Montargès et al. 2021）',
};

/**
 * 预览注册表（后续 R4 阶段在此追加条目）
 *
 * 以 Map 存储便于 O(1) 查找；模块加载时对每个条目做一次合法性自检。
 */
export const PREVIEW_REGISTRY: ReadonlyMap<string, PreviewEntry> = (() => {
  const entries: readonly PreviewEntry[] = [BETELGEUSE_ENTRY];
  const map = new Map<string, PreviewEntry>();
  for (const e of entries) {
    validatePreviewEntry(e);
    map.set(e.bodyId, e);
  }
  return map;
})();

/**
 * 按天体 id 查找预览条目
 *
 * @returns 已注册返回条目；未注册返回 null（预览页显示占位提示）
 */
export function previewEntryForBody(id: string | null | undefined): PreviewEntry | null {
  if (!id) return null;
  return PREVIEW_REGISTRY.get(id) ?? null;
}

/**
 * 取条目全部参数的默认值映射（预览页初始化滑杆状态）
 *
 * 空条目 / null 返回空对象。
 */
export function defaultParamValues(
  entry: PreviewEntry | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!entry) return out;
  for (const p of entry.params) {
    out[p.key] = p.default;
  }
  return out;
}

/**
 * 将输入值钳制到参数声明区间（滑杆输入越界防护，纯函数）
 *
 * 未注册的 key 原样返回输入值（组件层未知参数不干预）。
 */
export function clampParamValue(param: PreviewParam, value: number): number {
  if (!Number.isFinite(value)) return param.default;
  return Math.max(param.min, Math.min(param.max, value));
}

/**
 * 已注册的全部天体 id（预览页占位提示可列出可用对象）
 */
export function registeredPreviewIds(): readonly string[] {
  return Array.from(PREVIEW_REGISTRY.keys());
}
