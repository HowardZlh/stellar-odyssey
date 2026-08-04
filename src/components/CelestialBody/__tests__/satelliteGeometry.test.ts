/**
 * prepareGltfSatellite 实例化所有权模型单测（glTF 共享场景所有权缺陷修复）
 *
 * 锚定四类根因的回归防线：
 * 1. 归一化非幂等（重复挂载缩放被重置回原始尺寸 → 哈勃/TDRS 不可见）
 * 2. Reparent 抢夺（共享 scene 被"偷"进新容器，废弃容器被掏空）
 * 3. 材质污染跨挂载泄漏（淡入 opacity / 地影 color×dim 写入共享材质）
 * 4. ISS 着色重复替换泄漏（旧材质无人 dispose）
 *
 * 契约：源场景永远只读；每次调用返回独立实例（geometry 引用共享、
 * 材质实例私有）；归一化构造性幂等。
 */

import * as THREE from 'three';
import {
  prepareGltfSatellite,
  SATELLITE_MODEL_SPAN,
} from '@/components/CelestialBody/satelliteGeometry';

/** 构造已知尺寸源模型：单 mesh 盒体，最长维 X = 10（跨度 10） */
function makeSource(): { source: THREE.Group; mesh: THREE.Mesh } {
  const source = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(10, 2, 4),
    new THREE.MeshStandardMaterial({ color: '#808080' }),
  );
  source.add(mesh);
  return { source, mesh };
}

/** 收集树中全部 mesh */
function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) out.push(obj as THREE.Mesh);
  });
  return out;
}

/** 实例容器内的克隆场景（container 唯一子节点） */
function instanceScene(container: THREE.Group): THREE.Object3D {
  expect(container.children).toHaveLength(1);
  return container.children[0];
}

describe('prepareGltfSatellite 实例化语义', () => {
  it('两次调用返回两个独立实例，缩放均 = SPAN/原始跨度且逐值一致（幂等锚定）', () => {
    const { source } = makeSource();
    const expectedScale = SATELLITE_MODEL_SPAN / 10;

    const c1 = prepareGltfSatellite(source, 'hubble');
    const c2 = prepareGltfSatellite(source, 'hubble');

    expect(c1).not.toBe(c2);
    const s1 = instanceScene(c1);
    const s2 = instanceScene(c2);
    expect(s1).not.toBe(s2);
    expect(s1).not.toBe(source);

    for (const s of [s1, s2]) {
      expect(s.scale.x).toBeCloseTo(expectedScale, 10);
      expect(s.scale.y).toBeCloseTo(expectedScale, 10);
      expect(s.scale.z).toBeCloseTo(expectedScale, 10);
    }
    // 逐值一致（第二次挂载与第一次完全相同，不存在奇偶交替）
    expect(s2.scale.toArray()).toEqual(s1.scale.toArray());
    expect(s2.position.toArray()).toEqual(s1.position.toArray());
    expect(s2.rotation.toArray()).toEqual(s1.rotation.toArray());
  });

  it('最长维 Z 的源模型：实例旋转对齐 X 轴，归一化后包围盒跨度 = SPAN', () => {
    const source = new THREE.Group();
    source.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(3, 2, 12),
        new THREE.MeshStandardMaterial(),
      ),
    );
    const c1 = prepareGltfSatellite(source, 'geo-satellite');
    const c2 = prepareGltfSatellite(source, 'geo-satellite');
    for (const c of [c1, c2]) {
      c.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(c);
      const size = new THREE.Vector3();
      box.getSize(size);
      expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(SATELLITE_MODEL_SPAN, 6);
      // 最长维对齐 X 轴
      expect(size.x).toBeCloseTo(SATELLITE_MODEL_SPAN, 6);
      // 居中
      const center = new THREE.Vector3();
      box.getCenter(center);
      expect(center.length()).toBeCloseTo(0, 6);
    }
    // 源模型零污染
    expect(source.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('源场景零污染：无父级、变换恒 identity、材质未替换', () => {
    const { source, mesh } = makeSource();
    const srcMaterial = mesh.material;

    prepareGltfSatellite(source, 'hubble');
    prepareGltfSatellite(source, 'hubble');

    expect(source.parent).toBeNull();
    expect(source.position.toArray()).toEqual([0, 0, 0]);
    expect(source.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(source.scale.toArray()).toEqual([1, 1, 1]);
    expect(mesh.material).toBe(srcMaterial);
    expect((srcMaterial as THREE.MeshStandardMaterial).color.getHexString()).toBe(
      '808080',
    );
  });

  it('geometry 引用共享（GPU 零增量）、材质引用独立（实例私有）', () => {
    const { source, mesh } = makeSource();
    const c1 = prepareGltfSatellite(source, 'hubble');
    const c2 = prepareGltfSatellite(source, 'hubble');
    const [m1] = meshesOf(c1);
    const [m2] = meshesOf(c2);

    expect(m1.geometry).toBe(mesh.geometry);
    expect(m2.geometry).toBe(mesh.geometry);

    expect(m1.material).not.toBe(mesh.material);
    expect(m2.material).not.toBe(mesh.material);
    expect(m1.material).not.toBe(m2.material);
  });

  it('实例材质污染（opacity/color）不泄漏到源场景与其他实例', () => {
    const { source, mesh } = makeSource();
    const c1 = prepareGltfSatellite(source, 'hubble');
    const c2 = prepareGltfSatellite(source, 'hubble');
    const [m1] = meshesOf(c1);
    const [m2] = meshesOf(c2);

    // 模拟运行时淡入 + 地影调暗写入
    const mat1 = m1.material as THREE.MeshStandardMaterial;
    mat1.transparent = true;
    mat1.opacity = 0.3;
    mat1.color.multiplyScalar(0.2);

    const srcMat = mesh.material as THREE.MeshStandardMaterial;
    expect(srcMat.transparent).toBe(false);
    expect(srcMat.opacity).toBe(1);
    expect(srcMat.color.getHexString()).toBe('808080');
    const mat2 = m2.material as THREE.MeshStandardMaterial;
    expect(mat2.opacity).toBe(1);
    expect(mat2.color.getHexString()).toBe('808080');
  });

  it('ISS 启发式着色仅作用实例；源材质未替换未 dispose；被替换克隆材质就地 dispose', () => {
    // 三种形态：扁平大面（帆板）/ 细长（桁架）/ 立方（舱体）
    const source = new THREE.Group();
    const flat = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.02, 4),
      new THREE.MeshStandardMaterial({ color: '#606060' }),
    );
    const slim = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: '#606060' }),
    );
    const bulk = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1.8, 1.6),
      new THREE.MeshStandardMaterial({ color: '#606060' }),
    );
    source.add(flat, slim, bulk);
    const srcMaterials = [flat, slim, bulk].map((m) => m.material);
    const srcDisposed: string[] = [];
    srcMaterials.forEach((m, i) =>
      (m as THREE.Material).addEventListener('dispose', () => {
        srcDisposed.push(`src-${i}`);
      }),
    );

    const disposeSpy = jest.spyOn(THREE.MeshStandardMaterial.prototype, 'dispose');
    const container = prepareGltfSatellite(source, 'iss');
    // 被替换下来的 3 个克隆材质就地 dispose（新着色材质不 dispose）
    expect(disposeSpy).toHaveBeenCalledTimes(3);
    disposeSpy.mockRestore();

    // 源材质未被 dispose、未被替换
    expect(srcDisposed).toEqual([]);
    expect(flat.material).toBe(srcMaterials[0]);
    expect(slim.material).toBe(srcMaterials[1]);
    expect(bulk.material).toBe(srcMaterials[2]);

    // 实例按形态着色（帆板深蓝 / 桁架银灰 / 舱体白色）
    const instMats = meshesOf(container).map(
      (m) => (m.material as THREE.MeshStandardMaterial).color.getHexString(),
    );
    expect(instMats).toContain('2b3f7e'); // 帆板
    expect(instMats).toContain('9aa0a6'); // 桁架
    expect(instMats).toContain('e2e5e8'); // 舱体
    expect(instMats).not.toContain('606060'); // 无残留源灰色
  });

  it('卸载释放契约：dispose 实例材质不影响源材质与共享 geometry', () => {
    const { source, mesh } = makeSource();
    const container = prepareGltfSatellite(source, 'hubble');

    let srcMatDisposed = false;
    let srcGeoDisposed = false;
    (mesh.material as THREE.Material).addEventListener('dispose', () => {
      srcMatDisposed = true;
    });
    mesh.geometry.addEventListener('dispose', () => {
      srcGeoDisposed = true;
    });

    // 模拟 SatelliteModel 卸载 effect 的 glTF 分支：只 dispose 实例材质
    meshesOf(container).forEach((m) => {
      const material = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach((x) => x.dispose());
      else material.dispose();
    });

    expect(srcMatDisposed).toBe(false);
    expect(srcGeoDisposed).toBe(false);
    // 源仍可再次实例化且归一化正确（缓存复用场景）
    const again = prepareGltfSatellite(source, 'hubble');
    expect(instanceScene(again).scale.x).toBeCloseTo(SATELLITE_MODEL_SPAN / 10, 10);
  });
});
