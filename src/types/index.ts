/**
 * 项目统一类型定义
 */

/** 视角层级：L1 行星 / L2 太阳系 / L3 银河系 / L4 宇宙 */
export type ViewLevel = 'L1' | 'L2' | 'L3' | 'L4';

export const VIEW_LEVELS: readonly ViewLevel[] = ['L1', 'L2', 'L3', 'L4'] as const;

/**
 * 界面语言（B2 i18n 基建）：默认 zh——既有中文测试断言零改动的前提，
 * 任何阶段不得变更默认语言；en 经 `?lang=en` / localStorage / setLocale 激活
 */
export type Locale = 'zh' | 'en';

/** B4 启动参数：巡游域（与 CycleScope 对齐 + `all` 四域轮转，B5 消费） */
export type LaunchTour = 'solar' | 'galaxy' | 'universe' | 'all';

/**
 * 启动 URL 参数解析结果（B4，方案 K4：`utils/launchParams.ts` 纯逻辑解析）
 *
 * 非法值静默回退默认（不抛错、控制台零错误）；`mode`/`tour`/`dwell`
 * 本阶段仅解析入 store（B5 kiosk 消费，未交付时 `mode=kiosk` 无行为，登记）。
 */
export interface LaunchParams {
  /** 展馆模式（`?mode=kiosk`）；无参数/非法值为 null */
  mode: 'kiosk' | null;
  /** 巡游域，默认 `solar` */
  tour: LaunchTour;
  /** 每站停留秒数（合法整数 5–600），默认 30 */
  dwell: number;
  /** 启动后直接飞往的天体 id（非法 id 由 `requestFlyTo` 自含校验静默忽略） */
  body: string | null;
  /** 屏幕角落客户 logo（仅 https、长度 ≤2048；onerror 即隐藏，§0.5#9 登记） */
  logo: string | null;
  /** 语言（统一解析入口；null = 沿用 B2 优先级链 localStorage > zh） */
  lang: Locale | null;
}

/** 三维向量（与 three.js 解耦，便于纯函数测试） */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 开普勒轨道六要素（J2000 历元，黄道坐标系）
 * 数据来源：NASA JPL Planetary Fact Sheet / E.M. Standish, "Keplerian Elements for
 * Approximate Positions of the Major Planets" (JPL)
 */
export interface OrbitalElements {
  /** 半长轴（AU） */
  semiMajorAxisAu: number;
  /** 离心率 */
  eccentricity: number;
  /** 轨道倾角（度，相对黄道面） */
  inclinationDeg: number;
  /** 升交点经度（度） */
  longitudeOfAscendingNodeDeg: number;
  /** 近日点幅角（度）ω = ϖ − Ω */
  argumentOfPerihelionDeg: number;
  /** J2000 历元平近点角（度）M₀ = L₀ − ϖ */
  meanAnomalyAtEpochDeg: number;
}

/** 自转参数 */
export interface RotationParams {
  /** 恒星自转周期（小时）。负值表示逆向自转（金星、天王星） */
  siderealPeriodHours: number;
  /** 轴倾角（度，相对轨道面） */
  axialTiltDeg: number;
}

/** 行星环配置（土星环等，需求 3.1.1） */
export interface PlanetRingConfig {
  /** 环内缘真实半径（km） */
  innerRadiusKm: number;
  /** 环外缘真实半径（km） */
  outerRadiusKm: number;
  /** 卡西尼缝中心（占环宽比例 0-1） */
  gapCenter01: number;
  /** 卡西尼缝宽度（占环宽比例 0-1） */
  gapWidth01: number;
  color: string;
  opacity: number;
}

/** 行星表面视觉特征（行星视角 L1 细节，需求 3.1.1） */
export interface PlanetSurfaceConfig {
  /** 是否有独立旋转的云层（地球） */
  hasCloudLayer?: boolean;
  /** 是否有大气边缘辉光 */
  hasAtmosphereGlow?: boolean;
  /** 大气辉光颜色 */
  atmosphereColor?: string;
  /** 夜半球城市灯光（地球，可选需求 3.1.1） */
  hasNightLights?: boolean;
}

/** 行星静态数据 */
export interface PlanetData {
  id: string;
  name: string;
  nameZh: string;
  /** 真实半径（km） */
  radiusKm: number;
  /** 基础颜色（无纹理时的近似观测色） */
  color: string;
  orbit: OrbitalElements;
  rotation: RotationParams;
  /** 公转周期（地球年，用于展示与校验） */
  orbitalPeriodYears: number;
  /** 质量（kg，信息面板质量字段，需求 3.5.2） */
  massKg?: number;
  /** 数据来源说明 */
  dataSource: string;
  /** 行星环（土星等） */
  ring?: PlanetRingConfig;
  /** 表面视觉特征 */
  surface?: PlanetSurfaceConfig;
  /** 天体分类展示（默认行星；冥王星为矮行星） */
  classificationZh?: string;
}

/** 卫星类别：自然卫星 / 人造卫星 */
export type SatelliteKind = 'natural' | 'artificial';

/**
 * 卫星轨道参考平面（需求 3.1.1）：
 * 统一为所属行星赤道面（planetEquator）；月球例外，相对黄道面约 5.1°（ecliptic）
 */
export type SatelliteReferencePlane = 'planetEquator' | 'ecliptic';

/** 卫星轨道参数（相对所属行星；周期直接给出，因中心天体质量各异） */
export interface SatelliteOrbit {
  /** 半长轴（km，相对行星中心） */
  semiMajorAxisKm: number;
  eccentricity: number;
  /** 倾角（度，相对参考平面） */
  inclinationDeg: number;
  /** 升交点经度（度） */
  longitudeOfAscendingNodeDeg: number;
  /** 近点幅角（度） */
  argumentOfPeriapsisDeg: number;
  /** J2000 历元平近点角（度） */
  meanAnomalyAtEpochDeg: number;
  /** 公转周期（天） */
  periodDays: number;
}

/** 卫星数据（自然卫星与人造卫星统一结构） */
export interface MoonData {
  id: string;
  name: string;
  nameZh: string;
  /** 所属行星 id */
  parentId: string;
  kind: SatelliteKind;
  /** 真实半径（km；人造卫星用等效尺寸） */
  radiusKm: number;
  color: string;
  orbit: SatelliteOrbit;
  referencePlane: SatelliteReferencePlane;
  /** 潮汐锁定（始终同一面朝向行星，如月球） */
  tidallyLocked?: boolean;
  /** 质量（kg，信息面板质量字段，需求 3.5.2） */
  massKg?: number;
  /**
   * 真实特征尺寸（米，人造卫星专用，P7 §3.2）：
   * 取航天器最大跨度（ISS 桁架 109 m / 天宫约 55 m / TDRS 帆板翼展约 21 m /
   * 哈勃镜筒 13.2 m），用于差异化视觉尺寸映射与信息面板对照展示
   */
  spanMeters?: number;
  /** 备注（共振关系、大气特征等） */
  noteZh?: string;
  dataSource: string;
}

/** 彗星数据（需求 3.1.1 小天体） */
export interface CometData {
  id: string;
  name: string;
  nameZh: string;
  /** 彗核半径（km） */
  nucleusRadiusKm: number;
  color: string;
  /** 高离心率椭圆轨道；倾角 >90° 表示逆行（哈雷约 162°） */
  orbit: OrbitalElements;
  orbitalPeriodYears: number;
  /** 彗发/彗尾出现的日心距离阈值（AU） */
  tailActivationAu: number;
  /** 质量（kg，信息面板质量字段，需求 3.5.2） */
  massKg?: number;
  dataSource: string;
}

/** 粒子带配置（小行星带 / 柯伊伯带，需求 3.1.1） */
export interface BeltConfig {
  id: string;
  nameZh: string;
  /** 内缘半长轴（AU） */
  innerAu: number;
  /** 外缘半长轴（AU） */
  outerAu: number;
  /** 粒子数 */
  count: number;
  /** 最大离心率 */
  maxEccentricity: number;
  /** 最大倾角（度） */
  maxInclinationDeg: number;
  /** 基准颜色 */
  color: string;
  /** 颜色随机变化幅度（0-1） */
  colorVariation: number;
  /** 粒子渲染尺寸（场景单位） */
  particleSize: number;
  /** 确定性种子 */
  seed: number;
  dataSource: string;
}

/** 星系形态（需求 3.1.3：四类形态可辨识） */
export type GalaxyMorphology = 'spiral' | 'barred-spiral' | 'elliptical' | 'irregular';

/** 河外星系 / 星系团成员数据（需求 3.1.3） */
export interface GalaxyData {
  id: string;
  name: string;
  nameZh: string;
  morphology: GalaxyMorphology;
  /** 距银河系距离（光年） */
  distanceLy: number;
  /** 直径（光年） */
  diameterLy: number;
  /**
   * 方向单位矢量（场景坐标，近似真实天区方位的示意方向；
   * 精确的三维位置重建超出可视化需要，已在注释登记为近似处理）
   */
  direction: Vec3;
  /** 视向速度（km/s，负值表示接近） */
  radialVelocityKmS: number;
  /** 所属结构（本星系群 / 室女座星系团等） */
  groupZh: string;
  descriptionZh: string;
  dataSource: string;
}

/** 相机视角锚点配置 */
export interface CameraViewConfig {
  level: ViewLevel;
  nameZh: string;
  /** 相机位置（场景单位） */
  position: Vec3;
  /** 观察目标 */
  target: Vec3;
  /** 视场角（度） */
  fov: number;
  /** 轨道控制距离范围 */
  minDistance: number;
  maxDistance: number;
  /** 背景色（附录A 参考值） */
  background: string;
}

/** 相机插值状态 */
export interface CameraState {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** 音景定义 */
export interface SoundscapeConfig {
  level: ViewLevel;
  nameZh: string;
  /** 音频文件地址（缺失时静默降级） */
  src: string;
  /** 基准音量（0-1） */
  baseVolume: number;
}

// ---------------------------------------------------------------------------
// P2：特殊天体与动态事件系统（需求 3.1.5）
// ---------------------------------------------------------------------------

/** 特殊天体类别（恒星类 / 星云类 / 河外对象） */
export type SpecialBodyKind =
  | 'red-giant'
  | 'blue-giant'
  | 'binary-white-dwarf'
  | 'pulsar-remnant'
  | 'black-hole'
  | 'emission-nebula'
  | 'planetary-nebula'
  | 'globular-cluster'
  | 'quasar'
  // ---- 可选项扩展（需求 3.1.5 可选特殊天体） ----
  | 'wolf-rayet'
  | 'cepheid'
  | 'open-cluster'
  | 'dark-nebula'
  | 'galaxy-collision'
  | 'lensing-cluster'
  | 'gamma-ray-burst';

/** 特殊天体位置模式 */
export type SpecialBodyPositionMode =
  /** 相对太阳的银心系偏移（随太阳一起绕银心运动，近似处理已登记） */
  | 'sun-relative'
  /** 固定于银心（人马座A*） */
  | 'galactic-center'
  /** 河外对象：方向单位矢量 + 距离（宇宙距离压缩） */
  | 'extragalactic';

/** 信息面板行（特殊天体关键参数用，与 catalog.BodyInfoLine 结构一致） */
export interface SpecialBodyFact {
  label: string;
  value: string;
}

/** 特殊天体数据（静态形态 + 动态效果定义，基于真实原型，需求 3.1.5） */
export interface SpecialBodyData {
  id: string;
  name: string;
  nameZh: string;
  kind: SpecialBodyKind;
  /** 类型中文名（信息面板显示） */
  typeZh: string;
  /** 所属层级：恒星级/星云属 L3，河外对象属 L4 */
  level: 'L3' | 'L4';
  positionMode: SpecialBodyPositionMode;
  /**
   * sun-relative 模式：相对太阳的银心系视觉偏移（光年）。
   * 为保证 L3 尺度下可辨识，偏移量为视觉夸大值（已登记），
   * 真实距离见 realDistanceLy。
   */
  offsetLy?: Vec3;
  /** extragalactic 模式：方向单位矢量（场景坐标近似天区方位） */
  direction?: Vec3;
  /** 真实距离（光年，信息面板显示） */
  realDistanceLy: number;
  /** 视觉尺寸（光年，L3 场景内的可视半径，视觉夸大已登记） */
  visualRadiusLy: number;
  /** 主色 */
  color: string;
  /** 关键参数（信息面板行） */
  factsZh: SpecialBodyFact[];
  /** 动态效果的科学解释（需求 3.1.5 通用要求） */
  dynamicsZh: string;
  dataSource: string;
}

/** 耀斑级别（NOAA GOES 软 X 射线通量分级，S2 §4.3-2） */
export type SolarFlareClass = 'C' | 'M' | 'X';

/** 太阳耀斑事件（S2 §4.3-2，模拟时间轴驱动：暂停冻结、快进联动） */
export interface SolarFlareEvent {
  /** 事件 id（flare-<序号>） */
  id: string;
  /** 级别（C/M/X） */
  flareClass: SolarFlareClass;
  /** 级内量级（如 X2.3 的 2.3） */
  magnitude: number;
  /** 触发时刻（模拟天） */
  startedAtSimDays: number;
  /** 阶段动画总时长（模拟天，utils/solarActivity.FLARE_DURATION_DAYS） */
  durationDays: number;
  /** 源活动区方位（太阳对象空间单位矢量，锚定黑子群附近） */
  sourceDir: Vec3;
  /** 是否联动触发 CME（触发时按级别概率判定） */
  cmeLinked: boolean;
}

/**
 * 耀斑通知卡片快照：通知展示与事件生命周期解耦（最短展示时长机制，
 * utils/eventScopes.EVENT_NOTICE_MIN_VISIBLE_REAL_SEC）——事件完成后
 * activeSolarFlare 置空，通知卡片仍需展示级别等信息，故触发时快照。
 */
export type SolarFlareNoticeInfo = Pick<SolarFlareEvent, 'flareClass' | 'magnitude' | 'cmeLinked'>;

/** 日冕物质抛射事件（S2 §4.3-3） */
export interface CmeEvent {
  /** 事件 id（cme-<序号>） */
  id: string;
  /** 抛射方向（场景/太阳对象空间单位矢量） */
  direction: Vec3;
  /** 速度（km/s，250–3,000 真实量级） */
  speedKmS: number;
  /** 触发时刻（模拟天） */
  startedAtSimDays: number;
  /** 是否朝向地球（通知附加地磁暴科普） */
  earthDirected: boolean;
}

/** CME 通知卡片快照（语义同 SolarFlareNoticeInfo） */
export type CmeNoticeInfo = Pick<CmeEvent, 'speedKmS' | 'earthDirected'>;

/** 超新星事件（需求 3.1.5 动态事件） */
export interface SupernovaEvent {
  /** 事件 id（sn-<序号>） */
  id: string;
  /** 爆发位置（银心系本地坐标，光年；位于旋臂内） */
  positionLy: Vec3;
  /** 触发时刻（真实时间毫秒，performance/Date.now） */
  startedAtMs: number;
  /** 完整阶段动画总时长（秒，10–30 可配置） */
  durationSec: number;
  /** 前身星质量（太阳质量，决定遗迹致密天体类型） */
  progenitorMassSun: number;
}
