/**
 * 体积子场景星点 glow sprite 共享工具（R4-7 预览页首建，R4-8 主场景复用，
 * R4-14 泛化：色调可配 + 通用星点规格——M42 Trapezium 四星 / M57 中心白矮星）
 *
 * 程序化星点 glow 纹理（径向双高斯衰减 + 可配色调，确定性无随机）与
 * 体积子场景星点挂载：sprite renderOrder 先于体积 mesh——体积发射-吸收
 * 按全程透射率压暗星点（近似登记见 NebulaVolumePreview 文件头：未按星点
 * 深度截断积分，M42 Trapezium 空腔 / M57 内腔密度低、偏差可忽略）。
 *
 * 资源生命周期：纹理/材质由调用方持有并卸载 dispose（附录 A §6）。
 */

import * as THREE from 'three';
import type { NebulaVolumeStarSpec } from '@/utils/nebulaVolumeScene';

/** 星点 glow sprite 纹理边长 */
export const STAR_SPRITE_SIZE = 64;

/** M42 Trapezium 默认色调（蓝白，O/B 型热星示意；R4-8 行为零回退） */
export const TRAPEZIUM_STAR_TINT: readonly [number, number, number] = [210, 225, 255];

/**
 * 程序化星点 glow 纹理（径向双高斯衰减 + 可配色调，确定性无随机）
 *
 * @param tint sRGB 色调 0–255（默认 M42 Trapezium 蓝白；M57 传白矮星色档）
 */
export function buildStarSpriteTexture(
  tint: readonly [number, number, number] = TRAPEZIUM_STAR_TINT,
): THREE.DataTexture {
  const size = STAR_SPRITE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  let ptr = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r2 = dx * dx + dy * dy;
      // 核心亮斑 + 宽晕（双高斯）
      const core = Math.exp(-r2 * 18);
      const halo = 0.35 * Math.exp(-r2 * 3.2);
      const v = Math.min(1, core + halo);
      data[ptr] = Math.round(tint[0] * v);
      data[ptr + 1] = Math.round(tint[1] * v);
      data[ptr + 2] = Math.round(tint[2] * v);
      data[ptr + 3] = Math.round(255 * v);
      ptr += 4;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

/**
 * 把星点 sprite 组挂到体积子场景容器（R4-14 通用化）
 *
 * @param parent 容器（体积 mesh 同级；sprite 位置按 boxEdge 缩放）
 * @param material 共享 sprite 材质（调用方持有 dispose）
 * @param boxEdge 体积包围盒世界边长
 * @param stars 星点规格（盒局部坐标 + 边长系数）
 */
export function addVolumeStarSprites(
  parent: THREE.Object3D,
  material: THREE.SpriteMaterial,
  boxEdge: number,
  stars: readonly NebulaVolumeStarSpec[],
): void {
  for (const { position, scaleFactor } of stars) {
    const sprite = new THREE.Sprite(material);
    sprite.position.set(position[0] * boxEdge, position[1] * boxEdge, position[2] * boxEdge);
    sprite.scale.setScalar(scaleFactor * boxEdge);
    sprite.renderOrder = 0; // 先于体积 mesh（renderOrder 1）绘制
    parent.add(sprite);
  }
}
