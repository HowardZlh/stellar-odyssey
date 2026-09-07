/**
 * 银河系视角 DOM 文字标签的显隐判定（纯逻辑，Galaxy.tsx 消费）
 *
 * 根因登记：「You are here（太阳系）」与「银河年 N%」均为 drei `<Html>`
 * DOM 元素——drei Html 只在物体位于相机背后或设 `occlude` 时切换
 * `display`，**从不检查 Object3D.visible**，DOM 被 portal 到 canvas 父容器，
 * 与场景图脱钩。因此父 `<group visible={false}>` 对其无效，标签必须以
 * React 条件渲染（挂载/卸载）门控，不能依赖 three 可见性。
 *
 * 开关归属（修订 R3-4 用户确认项 2）：原决策为两标签只受「You are here
 * 标记」开关、不受 L 键标签开关。修订为**两开关同时为真才显示**——
 * Universe/OortCloud/Heliopause/SpecialBodies/ExtragalacticObjects 的全部
 * 场景 Html 标签均受 `showLabels`（L 键）控制，Galaxy 为唯一例外，导致
 * 隐 UI 截图/录屏/kiosk 纯画面态残留文字、用户按 L 预期落空。sprite/
 * 箭头/高度线等非文字视觉标记仍只随 `showYouAreHere`（与 L 键"关文字
 * 标签"语义一致）。
 */

/** 银河系内容可见的连续层级下限（L2/L3 边界起，Galaxy.tsx 原 `> 2.5` 判据同源） */
export const GALAXY_LABEL_MIN_CONTINUOUS_LEVEL = 2.5;

/** 判定所需的 store 切片（与 SimulationStore 字段同名，便于直接传 state） */
export interface GalaxyLabelVisibilityState {
  showLabels: boolean;
  showYouAreHere: boolean;
  continuousLevel: number;
}

/** 银河系内容是否已进入可见层级（Html 标签不随父级 visible 隐藏，需单独按层级门控） */
export function galaxyLabelInRange(continuousLevel: number): boolean {
  return continuousLevel > GALAXY_LABEL_MIN_CONTINUOUS_LEVEL;
}

/**
 * 「You are here」与「银河年 N%」文字标签是否应挂载：
 * 层级在范围内 且 L 键标签开 且 You are here 标记开。
 */
export function galaxyTextLabelVisible(state: GalaxyLabelVisibilityState): boolean {
  return galaxyLabelInRange(state.continuousLevel) && state.showLabels && state.showYouAreHere;
}
