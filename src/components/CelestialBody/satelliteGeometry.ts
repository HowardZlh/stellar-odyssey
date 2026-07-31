/**
 * 人造卫星程序化几何组合与 glTF 后处理（P7 §3.1）
 *
 * 程序化几何（glTF 缺失/加载失败的降级路径；天宫为主路径——无 NASA
 * 公版模型且未找到开放许可社区模型，降级已登记于 data/models.ts）：
 * - 天宫：T 字三舱构型（天和核心舱 + 问天/梦天实验舱圆柱体 + 柔性帆板平板）
 * - ISS：桁架 + 多组太阳能帆板 + 加压舱段圆柱
 * - 哈勃：镜筒 + 双侧帆板 + 遮光罩开口
 * - TDRS：抛物面天线 + 双帆板
 *
 * 模型轴约定（与 utils/satelliteAttitude 统一）：+X 飞行方向、−Y 指向地心；
 * 整体最长跨度 ≈ SATELLITE_MODEL_SPAN（2.4 单位），组件按本体视觉半径缩放
 * （与远观盒体 bodyRadius*2.4 长边一致，LOD 切换尺寸连续）。
 *
 * 材质：帆板（深蓝金属光泽）、舱体（白色隔热层）、桁架（银灰金属）、
 * 镀金隔热箔（哈勃/TDRS），无自发光（真实航天器不发光，P7 §3.1）。
 *
 * glTF 后处理（实例化所有权模型）：
 * - modelManager 缓存的源场景**只读**：每次挂载克隆独立实例（geometry/
 *   texture 按引用共享、GPU 零增量；材质逐 mesh 克隆为实例私有），
 *   归一化/着色/运行时污染（淡入 opacity、地影 color×dim）只作用实例，
 *   源场景零污染——重复挂载（StrictMode 双调用 / 门控进出复用缓存）幂等
 * - 归一化：包围盒最长维对齐 X 轴并缩放至 SATELLITE_MODEL_SPAN、居中
 *   （差异登记：glb 模型语义轴向未知，按"最长维 = X"近似对齐）
 * - ISS (B) 源模型全部材质为统一灰色（无贴图），按网格形态启发式着色
 *   （扁平大面 → 帆板深蓝 / 细长 → 桁架银灰 / 其余 → 舱体白色）——
 *   基于真实 ISS 外观的艺术化增强，登记；被替换的实例材质就地 dispose
 *
 * 帆板对日跟踪标记：userData.sunTrackAxis = 'x' | 'z'（绕模型 X / Z 轴旋转），
 * 由 SatelliteModel 每帧按太阳方向驱动。
 */

import * as THREE from 'three';

/** 模型整体跨度（单位尺度，组件按 bodyRadius 缩放后 = bodyRadius*2.4） */
export const SATELLITE_MODEL_SPAN = 2.4;

function panelMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#2b3f7e',
    metalness: 0.45,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });
}

function hullMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#e2e5e8', metalness: 0.15, roughness: 0.55 });
}

function trussMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.6, roughness: 0.45 });
}

function foilMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#b98a3d', metalness: 0.65, roughness: 0.4 });
}

/** 帆板平板（法线初始 +Y） */
function panel(
  width: number,
  depth: number,
  material: THREE.MeshStandardMaterial,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.012, depth), material);
  return mesh;
}

/** ISS 程序化降级模型：桁架 + 4 组帆板对 + 舱段 */
function buildIss(): THREE.Group {
  const g = new THREE.Group();
  const pMat = panelMaterial();
  const hMat = hullMaterial();
  const tMat = trussMaterial();

  // 主桁架（X 向）
  const truss = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 0.07), tMat);
  g.add(truss);

  // 4 组帆板对（桁架两端，绕 X 轴对日跟踪）
  for (const x of [-1.05, -0.72, 0.72, 1.05]) {
    const wing = new THREE.Group();
    wing.position.set(x, 0, 0);
    wing.userData.sunTrackAxis = 'x';
    const p1 = panel(0.22, 0.55, pMat);
    p1.position.set(0, 0, 0.34);
    const p2 = panel(0.22, 0.55, pMat);
    p2.position.set(0, 0, -0.34);
    wing.add(p1, p2);
    g.add(wing);
  }

  // 加压舱段（Z 向舱列 + X 向舱列，穿过桁架中心）
  const moduleZ = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.85, 16), hMat);
  moduleZ.rotation.x = Math.PI / 2;
  g.add(moduleZ);
  const moduleX = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.55, 16), hMat);
  moduleX.rotation.z = Math.PI / 2;
  moduleX.position.set(0.12, 0, 0.28);
  g.add(moduleX);

  // 散热器（白灰竖板）
  const radMat = new THREE.MeshStandardMaterial({
    color: '#cfd4d8',
    metalness: 0.2,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  for (const x of [-0.38, 0.38]) {
    const rad = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.34), radMat);
    rad.position.set(x, -0.16, 0);
    rad.rotation.x = Math.PI / 2.4;
    g.add(rad);
  }
  return g;
}

/** 天宫程序化模型（主路径）：T 字三舱构型 + 柔性太阳翼 */
function buildTiangong(): THREE.Group {
  const g = new THREE.Group();
  const pMat = panelMaterial();
  const hMat = hullMaterial();
  const fMat = foilMaterial();

  // 天和核心舱（X 向，含后端小柱段）
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.95, 20), hMat);
  core.rotation.z = Math.PI / 2;
  core.position.set(-0.25, 0, 0);
  g.add(core);
  const coreTail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 16), fMat);
  coreTail.rotation.z = Math.PI / 2;
  coreTail.position.set(-0.85, 0, 0);
  g.add(coreTail);

  // 节点舱（T 字交点）
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 16), hMat);
  hub.position.set(0.28, 0, 0);
  g.add(hub);

  // 问天/梦天实验舱（Z 向两侧）
  for (const sign of [1, -1]) {
    const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.6, 20), hMat);
    lab.rotation.x = Math.PI / 2;
    lab.position.set(0.28, 0, sign * 0.42);
    g.add(lab);

    // 实验舱末端柔性太阳翼（沿 X 向展开，绕 Z 轴对日跟踪）
    const wing = new THREE.Group();
    wing.position.set(0.28, 0, sign * 0.72);
    wing.userData.sunTrackAxis = 'z';
    const w1 = panel(0.62, 0.15, pMat);
    w1.position.set(0.4, 0, 0);
    const w2 = panel(0.62, 0.15, pMat);
    w2.position.set(-0.4, 0, 0);
    wing.add(w1, w2);
    g.add(wing);
  }

  // 核心舱尾部小太阳翼（绕 X 轴对日跟踪）
  const tailWing = new THREE.Group();
  tailWing.position.set(-0.92, 0, 0);
  tailWing.userData.sunTrackAxis = 'x';
  const t1 = panel(0.14, 0.42, pMat);
  t1.position.set(0, 0, 0.26);
  const t2 = panel(0.14, 0.42, pMat);
  t2.position.set(0, 0, -0.26);
  tailWing.add(t1, t2);
  g.add(tailWing);
  return g;
}

/** 哈勃程序化降级模型：镜筒 + 遮光罩开口 + 双帆板（帆板固定，不跟踪） */
function buildHubble(): THREE.Group {
  const g = new THREE.Group();
  const pMat = panelMaterial();
  const fMat = foilMaterial();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.5, 24), fMat);
  tube.rotation.z = Math.PI / 2;
  g.add(tube);
  // 遮光罩开口（前端深色环）
  const apertureMat = new THREE.MeshStandardMaterial({
    color: '#15181c',
    metalness: 0.3,
    roughness: 0.7,
  });
  const aperture = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 24), apertureMat);
  aperture.rotation.z = Math.PI / 2;
  aperture.position.set(0.78, 0, 0);
  g.add(aperture);
  // 尾部设备段
  const aft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.35, 20), fMat);
  aft.rotation.z = Math.PI / 2;
  aft.position.set(-0.9, 0, 0);
  g.add(aft);
  // 双侧帆板（哈勃帆板固定）
  for (const sign of [1, -1]) {
    const p = panel(0.55, 0.5, pMat);
    p.position.set(-0.1, 0, sign * 0.62);
    g.add(p);
  }
  return g;
}

/** TDRS 程序化降级模型：抛物面天线 + 双帆板 */
function buildTdrs(): THREE.Group {
  const g = new THREE.Group();
  const pMat = panelMaterial();
  const fMat = foilMaterial();
  // 中心平台
  const bus = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.35), fMat);
  g.add(bus);
  // 双抛物面天线（球面截段近似）
  const dishMat = new THREE.MeshStandardMaterial({
    color: '#d8d6cd',
    metalness: 0.35,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  for (const sign of [1, -1]) {
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3),
      dishMat,
    );
    dish.rotation.z = -Math.PI / 2;
    dish.position.set(0.15, sign * 0.45, 0);
    g.add(dish);
  }
  // 双帆板（Z 向展开，绕 Z 轴对日跟踪）
  for (const sign of [1, -1]) {
    const wing = new THREE.Group();
    wing.position.set(0, 0, sign * 0.35);
    wing.userData.sunTrackAxis = 'z';
    const p = panel(0.35, 0.8, pMat);
    p.position.set(0, 0, sign * 0.45);
    wing.add(p);
    g.add(wing);
  }
  return g;
}

/** 通用降级模型：平台 + 双帆板 */
function buildGeneric(): THREE.Group {
  const g = new THREE.Group();
  const bus = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.35), hullMaterial());
  g.add(bus);
  for (const sign of [1, -1]) {
    const p = panel(0.4, 0.7, panelMaterial());
    p.position.set(0, 0, sign * 0.62);
    g.add(p);
  }
  return g;
}

/**
 * 程序化卫星模型（glTF 缺失/失败时的降级路径；天宫为主路径）
 */
export function buildProceduralSatellite(bodyId: string): THREE.Group {
  switch (bodyId) {
    case 'iss':
      return buildIss();
    case 'tiangong':
      return buildTiangong();
    case 'hubble':
      return buildHubble();
    case 'geo-satellite':
      return buildTdrs();
    default:
      return buildGeneric();
  }
}

/** 收集帆板对日跟踪组（userData.sunTrackAxis 标记） */
export function collectPanelGroups(root: THREE.Object3D): THREE.Object3D[] {
  const groups: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj.userData.sunTrackAxis === 'x' || obj.userData.sunTrackAxis === 'z') {
      groups.push(obj);
    }
  });
  return groups;
}

/** 释放实例材质（不碰共享 geometry/texture，Material.dispose 不释放纹理） */
function disposeInstanceMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((m) => m.dispose());
  } else {
    material.dispose();
  }
}

/**
 * ISS (B) glb 启发式着色（源模型全部材质为统一灰色，登记于文件头）：
 * 按网格包围盒形态分类——扁平大面 → 帆板 / 细长 → 桁架 / 其余 → 舱体。
 * 只作用于克隆实例；被替换下来的实例私有材质就地 dispose（防泄漏）。
 */
function colorizeIssMeshes(root: THREE.Object3D): void {
  const size = new THREE.Vector3();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox?.getSize(size);
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
    const [min, mid, max] = dims;
    if (max <= 0) return;
    const replaced = mesh.material as THREE.Material | THREE.Material[];
    if (min / max < 0.06 && mid / max > 0.3) {
      // 扁平大面：太阳能帆板
      mesh.material = panelMaterial();
    } else if (mid / max < 0.22) {
      // 细长：桁架
      mesh.material = trussMaterial();
    } else {
      // 舱体
      mesh.material = hullMaterial();
    }
    if (replaced) disposeInstanceMaterial(replaced);
  });
}

/**
 * glTF 卫星场景后处理（实例化语义，登记于文件头）：克隆源场景为独立实例，
 * 归一化尺寸/轴向 + 居中，返回可直接挂载的容器组。
 *
 * - 源场景只读（modelManager 单一所有者）：不 reparent、不改变换、不换材质
 * - clone(true) 共享 geometry/texture 引用（GPU 零增量），材质逐 mesh
 *   克隆为实例私有——运行时 opacity/color 污染不跨挂载泄漏
 * - 归一化在全新克隆上计算（构造性幂等，重复挂载缩放恒 = SPAN/原始跨度）
 * - 最长维对齐模型 X 轴（差异登记于文件头）并缩放至 SATELLITE_MODEL_SPAN
 * - ISS 应用启发式着色（源模型无颜色差异），仅作用实例
 *
 * 释放契约：实例材质由挂载方（SatelliteModel 卸载 effect）dispose；
 * 共享 geometry/texture 归 modelManager release() 统一释放。
 */
export function prepareGltfSatellite(source: THREE.Group, bodyId: string): THREE.Group {
  const scene = source.clone(true);
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => m.clone());
    } else {
      mesh.material = mesh.material.clone();
    }
  });

  const container = new THREE.Group();
  container.add(scene);

  if (bodyId === 'iss') {
    colorizeIssMeshes(scene);
  }

  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // 最长维对齐 X 轴
  if (size.z >= size.x && size.z >= size.y) {
    scene.rotation.y = Math.PI / 2;
  } else if (size.y >= size.x && size.y >= size.z) {
    scene.rotation.z = -Math.PI / 2;
  }

  // 旋转后重新计算包围盒，居中并缩放
  scene.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(scene);
  box2.getSize(size);
  box2.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? SATELLITE_MODEL_SPAN / maxDim : 1;
  scene.scale.setScalar(scale);
  scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  return container;
}
