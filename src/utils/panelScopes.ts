import type { ViewLevel } from '@/types';

/**
 * 控制面板选项按视角作用域注册表（R3-8，需求 IMPROVEMENT_REQUIREMENTS_3 §8.1-A）。
 *
 * 单一事实来源：面板选项 id → 可见视角集合。视角专属选项在域外整体隐藏
 * （非置灰，推翻 R2-4 置灰方案，行为变更已登记）；仅整理 UI 显示，
 * store 状态与场景渲染零改动——域外已开启的开关状态与场景效果全部保留
 * （如 V 开启切 L4 银河系仍呈椭球，属 R3-7 登记语义）。
 *
 * 判定源 = viewLevel（滚轮缩放经 syncZoomLevel/syncCameraDistance 自动同步、
 * 跟随/飞往期间层级锁定，选项不闪变，见 §8.0）。
 */

/** 面板选项 id（受作用域过滤的显示开关与演示按钮） */
export type PanelOptionId =
  | 'orbits'
  | 'labels'
  | 'realScale'
  | 'bloom'
  | 'performance'
  | 'satelliteOrbits'
  | 'flareDemo'
  | 'cmeDemo'
  | 'sunCutaway'
  | 'galacticFrame'
  | 'verticalExpand'
  | 'youAreHere'
  | 'supernovaDemo'
  | 'velocityVectors'
  | 'mergerDemo'
  | 'galaxyCatalog'
  | 'fermiBubbles';

const ALL_LEVELS: readonly ViewLevel[] = ['L1', 'L2', 'L3', 'L4'];

/**
 * 选项 → 可见视角集合注册表：
 * - 全局（四视角恒显）：轨道线 / 天体标签 / 真实比例 / 泛光 / 性能监控
 * - L1 行星视角：卫星轨道线（与卫星标签既有 L1 硬门控对齐）
 * - L1+L2：耀斑 / CME 演示（既有太阳事件域窗口 ≤2.4 覆盖两视角）
 * - L2 太阳系视角：太阳内部剖面
 * - L3 银河系视角：银心固定参考系区块 / 垂直展开（含增益滑块）/
 *   You are here 标记 / 超新星演示
 * - L4 宇宙视角：速度矢量箭头 / 合并预览（含"恢复预览前时间"按钮）/
 *   真实巡天背景（R5-3）
 * - L3+L4：费米气泡（R5-6，银河系可见的两个视角域——L3 银河系视角
 *   与 L4 近观银河系均可切换，登记）
 */
export const PANEL_OPTION_SCOPES: Record<PanelOptionId, readonly ViewLevel[]> = {
  orbits: ALL_LEVELS,
  labels: ALL_LEVELS,
  realScale: ALL_LEVELS,
  bloom: ALL_LEVELS,
  performance: ALL_LEVELS,
  satelliteOrbits: ['L1'],
  flareDemo: ['L1', 'L2'],
  cmeDemo: ['L1', 'L2'],
  sunCutaway: ['L2'],
  galacticFrame: ['L3'],
  verticalExpand: ['L3'],
  youAreHere: ['L3'],
  supernovaDemo: ['L3'],
  velocityVectors: ['L4'],
  mergerDemo: ['L4'],
  galaxyCatalog: ['L4'],
  fermiBubbles: ['L3', 'L4'],
};

/**
 * 判定选项在给定视角下是否可见。
 * @throws {RangeError} 未知 optionId
 */
export function panelOptionVisible(optionId: PanelOptionId, viewLevel: ViewLevel): boolean {
  const scopes = PANEL_OPTION_SCOPES[optionId] as readonly ViewLevel[] | undefined;
  if (!scopes) {
    throw new RangeError(`未知的面板选项 id: ${String(optionId)}`);
  }
  return scopes.includes(viewLevel);
}
