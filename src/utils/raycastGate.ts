/**
 * raycast 门控工具（跨层级点击拦截修复）
 *
 * 背景：three.js 的 Raycaster 不检查 `object.visible`，R3F 事件系统也不过滤——
 * 分层场景中已淡出（opacity=0 / visible=false）的银河系/宇宙级对象仍会拦截
 * 点击（如太阳系视角下点中隐形的猎户座星云 sprite）。
 *
 * 因此淡出后必须显式禁用对象树的 raycast：将 `raycast` 替换为空函数；
 * 恢复时还原为各对象类型原本的 prototype 方法。
 */

import type * as THREE from 'three';

/** 空 raycast：对象不参与任何射线检测 */
const NOOP_RAYCAST = (): void => {};

/** userData 键：当前门控状态缓存（避免每帧重复遍历） */
const ENABLED_KEY = '__raycastGateEnabled';
/** userData 键：被禁用前的原始 raycast 方法 */
const ORIGINAL_KEY = '__raycastGateOriginal';

/**
 * 启用/禁用整棵对象树的 raycast 命中。
 *
 * 幂等：状态未变化时直接返回（可安全地在 useFrame 中每帧调用）。
 * 与可见性门控（`group.visible = weight > 0.001`）配套使用，
 * 建议交互阈值略高于可见阈值（如 `weight > 0.05`），避免几乎不可见时仍可点击。
 */
export function setObjectTreeRaycastEnabled(root: THREE.Object3D, enabled: boolean): void {
  if (root.userData[ENABLED_KEY] === enabled) return;
  root.userData[ENABLED_KEY] = enabled;
  root.traverse((obj) => {
    if (enabled) {
      const original = obj.userData[ORIGINAL_KEY] as THREE.Object3D['raycast'] | undefined;
      if (original) {
        obj.raycast = original;
        delete obj.userData[ORIGINAL_KEY];
      }
    } else {
      if (obj.raycast !== NOOP_RAYCAST) {
        obj.userData[ORIGINAL_KEY] = obj.raycast;
        obj.raycast = NOOP_RAYCAST;
      }
    }
  });
}
