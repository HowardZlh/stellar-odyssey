/**
 * 真实天体位图纹理清单（P3-1，需求 §3.1.1/§4.1 差异消除；P4 §4.7 近观细节）
 *
 * 许可与来源登记（附录B）：
 * - 2K/4K 彩色位图纹理来自 Solar System Scope Textures
 *   https://www.solarsystemscope.com/textures/
 * - 许可：CC BY 4.0（Creative Commons Attribution 4.0 International），
 *   基于 NASA 观测数据制作（elevation/imagery: NASA）
 * - 2K 底图分辨率 2048×1024；4K 近观细节层 4096×2048（8K 源图本地降采样，
 *   符合 AGENTS.md ≤4096×4096 上限）；土星环条带 2048×125（x = 内缘→外缘，
 *   含卡西尼缝 alpha 透明度）
 * - 法线贴图（P4，本仓库由公开高程数据转换生成）：
 *   · 地球：NASA Earth Observatory GEBCO 地形图（公有领域）
 *     https://visibleearth.nasa.gov/images/73934/topography
 *   · 月球：NASA SVS CGI Moon Kit LOLA LDEM 高程（公有领域）
 *     https://svs.gsfc.nasa.gov/4720
 *   · 火星：降级路径——无可获取的轻量 MOLA DEM（USGS 全分辨率 11 GB），
 *     由 4K 色彩贴图亮度推导（§4.7 已登记的降级方案）
 * - 源图分辨率差异登记（§4.7）：SSS 对天王星/海王星/土星环仅提供 2K 源图，
 *   且无 NASA/JPL/USGS 公有领域的等效全球贴图替代——维持 2K，
 *   近观时叠加程序化细节增强（utils/planetDetail.bandDetailBoost）
 * - 矮行星真实贴图（P5 §3.4，公有领域，本地降采样至 2048×1024）：
 *   · 冥王星：NASA New Horizons LORRI/MVIC 全球拼接彩色地图
 *     （NASA/JHUAPL/SwRI，https://www.nasa.gov/image-feature/pluto-global-color-map）
 *     ——近观可辨识汤博区（心形，斯普特尼克平原）与克苏鲁暗斑；
 *     南纬约 30° 以南为黑色未测绘区（New Horizons 飞掠时处于极夜，科学事实）
 *   · 谷神星：NASA Dawn FC 全球拼接图（NASA/JPL-Caltech/UCLA/MPS/DLR/IDA，
 *     USGS Astrogeology Ceres_Dawn_FC_DLR_global_20ppd_Oct2015）
 *     ——近观可辨识欧卡托撞击坑亮斑（碳酸钠沉积）
 *   · 阋神星/鸟神星/妊神星无真实表面图（观测数据有限），维持程序化增强纹理
 *     （proceduralTextures.ts，基于观测特征的艺术化呈现，差异已登记）
 *
 * 加载策略（P3-2 懒加载 + P4 分级门控）：
 * - 2K 位图按层级优先级懒加载：接近/进入 L1 行星视角时才请求（见
 *   components/CelestialBody/textureManager.ts 与 utils/loadProgress.ts）
 * - 4K/法线细节层仅在"相机-天体距离进入近观阈值"时请求（2K 先显示防空窗），
 *   仅最近 2 个天体保留细节层（LRU，显存增量 ≤300 MB，utils/textureBudget.ts）
 * - 加载失败静默降级到程序化纹理（proceduralTextures.ts 保留为降级路径）
 */

/** 纹理种类：表面 / 夜灯 / 云层 / 行星环 */
export type BodyTextureKind = 'surface' | 'night' | 'clouds' | 'ring';

/** 单条纹理清单项 */
export interface BodyTextureEntry {
  /** 天体 id（与 data/planets.ts、data/moons.ts 一致） */
  bodyId: string;
  kind: BodyTextureKind;
  /** 纹理 URL（public/ 下静态资源） */
  url: string;
}

/** 纹理许可声明（信息登记用） */
export const TEXTURE_LICENSE =
  'Solar System Scope Textures（CC BY 4.0，https://www.solarsystemscope.com/textures/）';

/**
 * 位图纹理清单：八大行星 + 月球 + 太阳表面，
 * 地球夜灯/云层专项贴图，土星环条带（含卡西尼缝透明度）。
 */
export const BODY_TEXTURES: readonly BodyTextureEntry[] = [
  { bodyId: 'mercury', kind: 'surface', url: '/textures/2k_mercury.jpg' },
  { bodyId: 'venus', kind: 'surface', url: '/textures/2k_venus_atmosphere.jpg' },
  { bodyId: 'earth', kind: 'surface', url: '/textures/2k_earth_daymap.jpg' },
  { bodyId: 'earth', kind: 'night', url: '/textures/2k_earth_nightmap.jpg' },
  { bodyId: 'earth', kind: 'clouds', url: '/textures/2k_earth_clouds.jpg' },
  { bodyId: 'mars', kind: 'surface', url: '/textures/2k_mars.jpg' },
  { bodyId: 'jupiter', kind: 'surface', url: '/textures/2k_jupiter.jpg' },
  { bodyId: 'saturn', kind: 'surface', url: '/textures/2k_saturn.jpg' },
  { bodyId: 'saturn', kind: 'ring', url: '/textures/2k_saturn_ring_alpha.png' },
  { bodyId: 'uranus', kind: 'surface', url: '/textures/2k_uranus.jpg' },
  { bodyId: 'neptune', kind: 'surface', url: '/textures/2k_neptune.jpg' },
  { bodyId: 'moon', kind: 'surface', url: '/textures/2k_moon.jpg' },
  { bodyId: 'sun', kind: 'surface', url: '/textures/2k_sun.jpg' },
  // 矮行星真实贴图（P5 §3.4，NASA 公有领域，来源见文件头）
  { bodyId: 'pluto', kind: 'surface', url: '/textures/2k_pluto.jpg' },
  { bodyId: 'ceres', kind: 'surface', url: '/textures/2k_ceres.jpg' },
];

/** 矮行星贴图许可声明（P5 §3.4，信息登记用） */
export const DWARF_TEXTURE_LICENSE =
  'NASA New Horizons（冥王星）/ NASA Dawn（谷神星）全球拼接图（公有领域，NASA/JHUAPL/SwRI 与 NASA/JPL-Caltech/UCLA/MPS/DLR/IDA）';

/**
 * 查询指定天体 + 种类的纹理 URL；无真实位图时返回 null（走程序化降级路径）
 */
export function textureUrl(bodyId: string, kind: BodyTextureKind): string | null {
  const entry = BODY_TEXTURES.find((t) => t.bodyId === bodyId && t.kind === kind);
  return entry ? entry.url : null;
}

/**
 * 4K 近观细节层清单（P4 §4.7）：八大行星 + 月球 + 地球夜灯/云层。
 * 天王星/海王星/土星环无 4K 合规源（差异登记见文件头），近观维持 2K
 * + 程序化细节增强。
 */
export const BODY_DETAIL_TEXTURES: readonly BodyTextureEntry[] = [
  { bodyId: 'mercury', kind: 'surface', url: '/textures/4k_mercury.jpg' },
  { bodyId: 'venus', kind: 'surface', url: '/textures/4k_venus_atmosphere.jpg' },
  { bodyId: 'earth', kind: 'surface', url: '/textures/4k_earth_daymap.jpg' },
  { bodyId: 'earth', kind: 'night', url: '/textures/4k_earth_nightmap.jpg' },
  { bodyId: 'earth', kind: 'clouds', url: '/textures/4k_earth_clouds.jpg' },
  { bodyId: 'mars', kind: 'surface', url: '/textures/4k_mars.jpg' },
  { bodyId: 'jupiter', kind: 'surface', url: '/textures/4k_jupiter.jpg' },
  { bodyId: 'saturn', kind: 'surface', url: '/textures/4k_saturn.jpg' },
  { bodyId: 'moon', kind: 'surface', url: '/textures/4k_moon.jpg' },
  // 矮行星 4K 近观层（P5 §3.4 可选项）：与 2K 同源（NASA 源图分辨率足够），
  // 接入 P4 近观门控与 LRU；法线贴图无轻量公有领域 DEM 源，顺延（登记）
  { bodyId: 'pluto', kind: 'surface', url: '/textures/4k_pluto.jpg' },
  { bodyId: 'ceres', kind: 'surface', url: '/textures/4k_ceres.jpg' },
];

/** 查询 4K 近观细节层 URL；无 4K 源时返回 null（近观维持 2K） */
export function detailTextureUrl(bodyId: string, kind: BodyTextureKind): string | null {
  const entry = BODY_DETAIL_TEXTURES.find((t) => t.bodyId === bodyId && t.kind === kind);
  return entry ? entry.url : null;
}

/**
 * 法线贴图清单（P4 §4.7 近观立体细节）：
 * 地球（GEBCO 地形）、月球（LOLA LDEM）、火星（色彩亮度推导降级）。
 * URL 含 "_normal" 的纹理由 textureManager 按线性色彩空间加载（法线数据非 sRGB）。
 */
export const BODY_NORMAL_MAPS: readonly { bodyId: string; url: string }[] = [
  { bodyId: 'earth', url: '/textures/4k_earth_normal.jpg' },
  { bodyId: 'mars', url: '/textures/4k_mars_normal.jpg' },
  { bodyId: 'moon', url: '/textures/4k_moon_normal.jpg' },
];

/** 查询法线贴图 URL；无法线数据的天体返回 null */
export function normalMapUrl(bodyId: string): string | null {
  const entry = BODY_NORMAL_MAPS.find((t) => t.bodyId === bodyId);
  return entry ? entry.url : null;
}
