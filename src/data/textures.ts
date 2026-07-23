/**
 * 真实天体位图纹理清单（P3-1，需求 §3.1.1/§4.1 差异消除）
 *
 * 许可与来源登记（附录B）：
 * - 全部位图纹理来自 Solar System Scope Textures
 *   https://www.solarsystemscope.com/textures/
 * - 许可：CC BY 4.0（Creative Commons Attribution 4.0 International），
 *   基于 NASA 观测数据制作（elevation/imagery: NASA）
 * - 分辨率：2048×1024（低于需求 §5.2 的 4096×4096 上限）；
 *   土星环条带为 2048×125（x 方向 = 环内缘 → 外缘，含卡西尼缝 alpha 透明度）
 *
 * 加载策略（P3-2 懒加载）：
 * - 位图纹理按层级优先级懒加载：接近/进入 L1 行星视角时才请求（见
 *   components/CelestialBody/textureManager.ts 与 utils/loadProgress.ts）
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
];

/**
 * 查询指定天体 + 种类的纹理 URL；无真实位图时返回 null（走程序化降级路径）
 */
export function textureUrl(bodyId: string, kind: BodyTextureKind): string | null {
  const entry = BODY_TEXTURES.find((t) => t.bodyId === bodyId && t.kind === kind);
  return entry ? entry.url : null;
}
