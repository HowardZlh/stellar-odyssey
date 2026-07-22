/**
 * 项目统一类型定义
 */

/** 视角层级：L1 行星 / L2 太阳系 / L3 银河系 / L4 宇宙 */
export type ViewLevel = 'L1' | 'L2' | 'L3' | 'L4';

export const VIEW_LEVELS: readonly ViewLevel[] = ['L1', 'L2', 'L3', 'L4'] as const;

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
  /** 数据来源说明 */
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
