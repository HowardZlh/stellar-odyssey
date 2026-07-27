/**
 * raycast 门控测试（跨层级点击拦截修复）
 *
 * 回归背景：three.js Raycaster 不检查 object.visible，太阳系视角（L2）下
 * 已淡出的银河系层对象（如猎户座星云 sprite、星团透明点选热区球）仍会
 * 拦截点击并弹出信息面板。修复：淡出后显式禁用对象树的 raycast。
 */

import * as THREE from 'three';
import { setObjectTreeRaycastEnabled } from '../raycastGate';

/** 构造：group 下挂一个位于原点的单位球 mesh 与一个 sprite */
function buildGroup(): { group: THREE.Group; mesh: THREE.Mesh; sprite: THREE.Sprite } {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 8, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
  );
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ opacity: 0 }));
  group.add(mesh);
  group.add(sprite);
  group.updateMatrixWorld(true);
  return { group, mesh, sprite };
}

/** 从 +Z 朝原点发射射线 */
function castRay(target: THREE.Object3D): THREE.Intersection[] {
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(0, 0, 5),
    new THREE.Vector3(0, 0, -1),
  );
  // Sprite.raycast 需要相机矩阵信息；本测试仅针对 mesh 命中断言，
  // sprite 通过方法替换断言（避免依赖渲染器）
  return raycaster.intersectObject(target, true);
}

describe('setObjectTreeRaycastEnabled', () => {
  it('隐形对象默认仍可被 Raycaster 命中（bug 前提确认）', () => {
    const { group, mesh } = buildGroup();
    mesh.visible = false;
    group.visible = false;
    // three.js Raycaster 不检查 visible —— 这正是修复所针对的行为
    const hits = castRay(mesh);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('禁用后对象树不再被命中', () => {
    const { group, mesh } = buildGroup();
    setObjectTreeRaycastEnabled(group, false);
    expect(castRay(group)).toHaveLength(0);
    expect(castRay(mesh)).toHaveLength(0);
  });

  it('禁用后 sprite 的 raycast 也被替换为空实现', () => {
    const { group, sprite } = buildGroup();
    const original = sprite.raycast;
    setObjectTreeRaycastEnabled(group, false);
    expect(sprite.raycast).not.toBe(original);
    const intersections: THREE.Intersection[] = [];
    sprite.raycast(new THREE.Raycaster(), intersections);
    expect(intersections).toHaveLength(0);
  });

  it('重新启用后恢复原始 raycast 行为', () => {
    const { group, mesh, sprite } = buildGroup();
    const originalSpriteRaycast = sprite.raycast;
    setObjectTreeRaycastEnabled(group, false);
    setObjectTreeRaycastEnabled(group, true);
    expect(castRay(mesh).length).toBeGreaterThan(0);
    expect(sprite.raycast).toBe(originalSpriteRaycast);
  });

  it('幂等：重复调用同一状态不产生副作用', () => {
    const { group, mesh } = buildGroup();
    setObjectTreeRaycastEnabled(group, false);
    setObjectTreeRaycastEnabled(group, false);
    setObjectTreeRaycastEnabled(group, true);
    setObjectTreeRaycastEnabled(group, true);
    expect(castRay(mesh).length).toBeGreaterThan(0);
    // 再次禁用仍然生效
    setObjectTreeRaycastEnabled(group, false);
    expect(castRay(mesh)).toHaveLength(0);
  });
});
