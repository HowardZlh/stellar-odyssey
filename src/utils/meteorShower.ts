/**
 * 盛夏双重流星雨实验室：物理纯函数层（M1，契约 C1）
 *
 * 全部业务逻辑下沉本模块（页面组件 M2/M3/M4 只消费不改签名）：
 * - 坐标族：LST 简化模型 / 赤道→地平 / 地平→场景方向 / 赤道→地平旋转矩阵
 * - 流量族：ZHR→可见小时率（§1.4）/ 小时率→shader 门控分数
 * - 烧蚀族：流星体烧蚀 ODE 的 RK4 求解（§1.1）/ 过原点三次多项式最小二乘拟合
 * - 调度族：槽位元数据生成（契约 C2 三独立随机属性）/ 点燃检查 CPU 镜像（供 M4 音频）
 * - 降级判定：labQualityTier（§4.5）
 *
 * 场景空间与坐标系约定（契约 C5，防东西镜像）：
 * - 1 场景单位 = 1 km（独立比例尺，与主场景 SCENE_UNITS_PER_AU 无关）
 * - +Y = 天顶、−Z = 正北、+X = 正东；方位角 Az 从北起经东量（N=0°，E=90°）
 *
 * 物理近似登记（需求 §1）：
 * - LST 简化模型：观测者经度不作输入（"当地时间"抽象化），
 *   LST(t) = LST₀ + 15.041°×(hourOffset + elapsedHours)，LST₀ 为各历元常量
 *   （由"太阳赤经 + 12h + 当地时刻"近似预算）
 * - 大气密度指数衰减 ρ_a(h) = ρ₀·e^(−h/H)，标高 H≈8.5 km（80–120 km 层近似）
 * - 烘焙轨迹用固定入射天顶角 45°（实际辐射点高度随时变，系数已烘焙）
 * - 忽略天顶吸引与辐射点周日漂移
 *
 * 单位红线（§1.1）：ODE 在 SI（m、s）中求解，拟合前位移换算为场景单位（km）。
 *
 * 数据来源：辐射点/入速/ZHR/r 取自 IAU Meteor Data Center（Perseids #7 PER、
 * kappa-Cygnids #12 KCG）。
 *
 * 硬性约束：本模块不 import React/three；RK4 与拟合只在初始化路径被调用
 * （M3 页签切换时一次性重建，契约 C2.1），函数无状态、可重入。
 */

import { createSeededRandom } from '@/utils/random';

// ---------------------------------------------------------------------------
// 常量：场景空间（契约 C5）
// ---------------------------------------------------------------------------

/** 1 场景单位 = 1 km（契约 C5） */
export const LAB_SCENE_UNITS_PER_KM = 1;

/**
 * 星穹天球半径（场景单位）——M3.6 契约 C5 变更：3000 → 10000。
 * 真实地球（半径 6371）加入后，太空档 3000 km 高度视地平 limb 斜距
 * ~6900 km，星穹必须大于该值防星点穿地球边缘伪影。
 */
export const STAR_DOME_RADIUS_UNITS = 10000;

/** 燃烧层底部高度（km = 场景单位） */
export const BURN_LAYER_BOTTOM_KM = 80;

/** 燃烧层顶部高度（km = 场景单位，流星入射起点高度） */
export const BURN_LAYER_TOP_KM = 115;

/** 燃烧层水平采样半径（km，需求 §2） */
export const BURN_LAYER_HORIZONTAL_RADIUS_KM = 300;

/** 相机漫游半径下限（场景单位） */
export const CAMERA_RADIUS_MIN_UNITS = 0.1;

/** 相机漫游半径上限（场景单位） */
export const CAMERA_RADIUS_MAX_UNITS = 1.5;

/** 槽位循环周期（秒，契约 C2 默认常量 uCyclePeriod） */
export const METEOR_CYCLE_PERIOD_SEC = 60;

/** 条痕时间跨度（秒，契约 C2 默认常量 uLagSpan） */
export const METEOR_LAG_SPAN_SEC = 0.15;

/** 默认观测纬度（度，§1.3） */
export const DEFAULT_OBSERVER_LAT_DEG = 40;

// ---------------------------------------------------------------------------
// 常量：双流星雨参数（IAU Meteor Data Center；§1.2 / §1.3）
// ---------------------------------------------------------------------------

export interface MeteorShowerParams {
  /** 标识（'perseids' | 'kappaCygnids' | 'leonids1966'——M3.7 增补流星暴场景） */
  id: 'perseids' | 'kappaCygnids' | 'leonids1966';
  /** 辐射点赤经（度，J2000） */
  radiantRaDeg: number;
  /** 辐射点赤纬（度，J2000） */
  radiantDecDeg: number;
  /** 大气入射速度（km/s） */
  entrySpeedKmPerSec: number;
  /** 天顶每时率 ZHR（极大期） */
  zhr: number;
  /** 星族指数 r（population index） */
  populationIndex: number;
  /** 初始历元本地恒星时 LST₀（度，§1.3 简化模型常量） */
  epochLst0Deg: number;
  /** 火流星槽位基础比例（天鹅座κ以慢速火流星著称 → 基数更高，§3 控件 6） */
  fireballSlotFraction: number;
  /**
   * 槽位循环周期（秒，契约 C2 默认 60 s 的按雨覆写——M3 登记差异）。
   *
   * 量化陷阱：门控激活槽位数 = HR×T/3600（期望值）。T=60 时英仙座 ≈0.88、
   * 天鹅座κ ≈0.026——固定 aGateRank 下激活集被量化为整数槽位，低流量雨
   * 将**恒为零颗可见**（与 §1.4 流量模型矛盾）。按雨取 T 使默认观测条件
   * （历元 + 纬度 40° + lm 6.0）下期望激活槽位 ≥ 1；单颗流星出现率
   * = 激活槽位数/T 恒等于 HR/3600，物理速率不受 T 影响。
   */
  cyclePeriodSec: number;
  /**
   * 槽位预算（M3.7 契约 C1 增量：按雨覆写，页签切换随 slots 重建生效）。
   *
   * 高流量饱和陷阱（与 T 联动设计）：uFluxFraction = HR/3600×T/slotCount
   * 被钳制 ≤ 1——期望激活超过 slotCount 时点燃率封顶在 slotCount/T，
   * 真实速率被截断。按雨取 (slotCount, T) 使控件全域（lm ≤ 6.5、
   * Alt ≤ 90°）期望激活 ≤ slotCount（流星暴场景的容量单测锁定）。
   */
  slotCount: number;
}

/** 默认流星槽位数（§4 全量档；M3.7 起为按雨 slotCount 的默认量，reduced 减半归 M4） */
export const METEOR_SLOT_COUNT = 200;

/**
 * 英仙座流星雨（Perseids，IAU MDC #7 PER；母体 109P/Swift-Tuttle）
 * 历元 2026-08-13 当地 02:00，LST₀≈353.5°（此时辐射点 Alt≈52°，单测锚点）
 */
export const PERSEIDS: MeteorShowerParams = {
  id: 'perseids',
  radiantRaDeg: 46,
  radiantDecDeg: 58,
  entrySpeedKmPerSec: 59,
  zhr: 100,
  populationIndex: 2.2,
  epochLst0Deg: 353.5,
  fireballSlotFraction: 0.1,
  // 默认条件 HR≈53/h → 期望激活槽位 ≈53（多样性充足；见接口注释量化说明）
  cyclePeriodSec: 3600,
  slotCount: METEOR_SLOT_COUNT,
};

/**
 * 天鹅座κ流星雨（kappa-Cygnids，IAU MDC #12 KCG；母体未确定）
 * 历元 2026-08-17 当地 23:00，LST₀≈310°（此时辐射点 Alt≈66°，单测锚点）
 */
export const KAPPA_CYGNIDS: MeteorShowerParams = {
  id: 'kappaCygnids',
  radiantRaDeg: 286,
  radiantDecDeg: 59,
  entrySpeedKmPerSec: 25,
  zhr: 3,
  populationIndex: 3.0,
  epochLst0Deg: 310,
  fireballSlotFraction: 0.25,
  // 默认条件 HR≈1.58/h → T=4800 s 期望激活 ≈2.1 槽（≥1 普通 + ≥1 火流星候选）
  cyclePeriodSec: 4800,
  slotCount: METEOR_SLOT_COUNT,
};

/**
 * 1966 狮子座流星暴（Leonids storm，IAU MDC #13 LEO；母体 55P/Tempel–Tuttle）
 * —— M3.7 决策 B：真实历史事件重现（1966-11-17，"星陨如雨"级暴发）。
 *
 * 数据登记：辐射点/入速取 IAU MDC（RA 152°/Dec +22°、V∞ 71 km/s——
 * 主流雨中最快，条痕更长更蓝、烧尽更高）；ZHR 40,000 为 1966 暴发的
 * 保守文献量级（峰值估计一度达 ~40 颗/秒 ≈ 144,000/h，Jenniskens 2006，
 * 科普卡注明）；r=2.5（暴发期星族指数）。
 * 历元 1966-11-17 当地 05:00（黎明前辐射点高悬）：太阳 RA≈235° →
 * 当地子夜 LST≈55°，05:00 → LST₀≈130°（此时辐射点 Alt≈64°，单测锚点）。
 *
 * 容量设计（接口注释"高流量饱和陷阱"）：控件全域 HR 上限 = ZHR/r^0 =
 * 40,000/h（lm=6.5、Alt=90°）→ 期望激活 = HR/3600×T = 400 = slotCount，
 * 流量门控恰不饱和；默认条件（Alt≈64°、lm 6.0）HR≈22,500/h ≈ 6.3 颗/s。
 */
export const LEONIDS_STORM_1966: MeteorShowerParams = {
  id: 'leonids1966',
  radiantRaDeg: 152,
  radiantDecDeg: 22,
  entrySpeedKmPerSec: 71,
  zhr: 40000,
  populationIndex: 2.5,
  epochLst0Deg: 130,
  fireballSlotFraction: 0.15,
  cyclePeriodSec: 36,
  slotCount: 400,
};

/** 流星雨注册 map（M3.7：消费侧按页签 id 查找，替代双雨三元表达式） */
export const METEOR_SHOWERS: Record<MeteorShowerParams['id'], MeteorShowerParams> = {
  perseids: PERSEIDS,
  kappaCygnids: KAPPA_CYGNIDS,
  leonids1966: LEONIDS_STORM_1966,
};

// ---------------------------------------------------------------------------
// 常量：M3 渲染/控件（需求 §3 / §4）
// ---------------------------------------------------------------------------

/**
 * 条痕顶点数 K——M3.6-4① 变更：24 → 48（近观条痕连续无颗粒断点；
 * §4.3 原域 [16, 32] 放宽登记）。顶点总量 200×(48+18) = 13,200，预算无压力。
 * 配套 trailLag 头密尾疏非线性分布（烘焙期布局变更，契约 C2.1 初始化路径）。
 */
export const METEOR_TRAIL_VERTICES = 48;

/** 火流星碎片组数（§1.5：2–3 组独立子顶点） */
export const METEOR_FRAGMENT_GROUPS = 3;

/** 每碎片组子顶点数（mini 条痕） */
export const METEOR_FRAGMENT_VERTICES = 6;

/** 碎裂锥角半角（§1.5：≲2°） */
export const FRAGMENT_CONE_HALF_ANGLE_RAD = (2 * Math.PI) / 180;

/** 碎片横向位移上限（场景单位 km，§1.5：数百 m 至 1 km） */
export const FRAGMENT_MAX_LATERAL_KM = 1;

/** 碎裂时刻（生命周期进度，§1.5：t≈0.8 处崩溃） */
export const FRAGMENT_BREAKUP_PROGRESS = 0.8;

/** 余迹粒子预算（§4：500+ 档） */
export const AFTERGLOW_PARTICLE_BUDGET = 500;

/** 余迹绑定槽位上限（亮流星/火流星子集） */
export const AFTERGLOW_MAX_SLOTS = 50;

/** 普通流星余迹渐隐时长域（秒，§1.5：1–3 s） */
export const AFTERGLOW_FADE_ORDINARY_SEC: [number, number] = [1, 3];

/** 火流星余迹渐隐时长（秒，§1.5：~10 s） */
export const AFTERGLOW_FADE_FIREBALL_SEC = 10;

/** limitingMag 控件默认值（§3 控件 4） */
export const DEFAULT_LIMITING_MAG = 6.0;

/** fireballRate 控件默认值（§3 控件 6；uFireballFraction 直接取控件值） */
export const DEFAULT_FIREBALL_RATE = 0.3;

/** windSpeed 控件默认值（m/s，§3 控件 7） */
export const DEFAULT_WIND_SPEED_M_PER_SEC = 30;

/** 各雨历元当地时刻（小时，§1.3：英仙座 8/13 02:00 / 天鹅座κ 8/17 23:00 / 狮子座暴 11/17 05:00） */
export const EPOCH_LOCAL_HOURS: Record<MeteorShowerParams['id'], number> = {
  perseids: 2,
  kappaCygnids: 23,
  leonids1966: 5,
};

/**
 * 各雨历元太阳赤纬（度，M3.7——LabEarth 夜面 terminator 随历元自洽）：
 * 8 月中旬 ≈ +14°、11 月中旬 ≈ −19°（历元邻近数日漂移 <1.5°，登记近似）。
 */
export const EPOCH_SUN_DECLINATION_DEG: Record<MeteorShowerParams['id'], number> = {
  perseids: 14,
  kappaCygnids: 14,
  leonids1966: -19,
};

// ---------------------------------------------------------------------------
// 常量：M3.5 目验辅助 + 太空视角 + 跟随视角（§M3.5）
// ---------------------------------------------------------------------------

/** 快进提前量（真实秒；lead = 本值 × max(timeScale, 1) 场景秒，§M3.5-2） */
export const FASTFORWARD_LEAD_REAL_SEC = 1.5;

/** 跟随视角慢动作时间流速（进入跟随时自动设定，控件如实显示，§M3.5-6） */
export const FOLLOW_SLOWMO_TIMESCALE = 0.1;

/** 跟随视角烧尽后驻留时长（真实秒：展示余迹 + 汽化科普提示，§M3.5-6） */
export const FOLLOW_LINGER_REAL_SEC = 2;

/** 太空视角轨道目标：燃烧层中心（km；80–115 层中点取整，§M3.5-4） */
export const SPACE_VIEW_TARGET_UNITS: [number, number, number] = [0, 97, 0];

/**
 * 太空视角轨道半径钳制（场景单位，§M3.5-4）——M3.6 契约 C5 变更：
 * 上限 1500 → 3000（决策 D：高端拉远可见完整地平弧）。
 */
export const SPACE_CAMERA_RADIUS_MIN_UNITS = 150;
export const SPACE_CAMERA_RADIUS_MAX_UNITS = 3000;

/** 太空视角切换预设机位（场景单位，§M3.5-4） */
export const SPACE_CAMERA_PRESET_UNITS: [number, number, number] = [500, 320, 500];

/**
 * 太空视角 polar 上限（防穿地）：相机与 target 同高即为下限视角——
 * polar ≤ π/2 时相机 y ≥ target y = 97 > 0，任意半径下恒在地面上方。
 */
export const SPACE_POLAR_MAX_RAD = Math.PI / 2;

// ---------------------------------------------------------------------------
// 常量：M3.6 目验反馈修正 + 真实地球 + 流星近景（§M3.6）
// ---------------------------------------------------------------------------

/** 地球半径（km = 场景单位；1:1 真实比例，决策 C1——禁止艺术缩放） */
export const EARTH_RADIUS_KM = 6371;

/**
 * 大气辉光顶高度（km）：流星燃烧层 80–115 之上——大气辉光薄壳半径
 * = EARTH_RADIUS_KM + 本值，流星恰在辉光层内划过（M3.6-3 真实感核心）。
 */
export const ATMOSPHERE_TOP_KM = 120;

/** 跟随环绕默认距离（km，决策 B） */
export const FOLLOW_DISTANCE_DEFAULT_KM = 1.5;

/** 跟随环绕距离域（km，决策 B；滚轮缩放钳制，labGestures 同源消费） */
export const FOLLOW_DISTANCE_MIN_KM = 0.6;
export const FOLLOW_DISTANCE_MAX_KM = 6;

/** 跟随环绕仰角钳制（±75°，防正对流星头/尾方向的奇异，M3.6-2） */
export const FOLLOW_ELEVATION_MAX_RAD = (75 * Math.PI) / 180;

/** 演示自动运镜时长（秒，决策 A1：~0.6 s 球面平滑插值到位后注入） */
export const AIM_DURATION_SEC = 0.6;

/** 视锥判定边距（各向留 15%：|x/z| ≤ tan(fov/2)×(1−本值)，M3.6-1） */
export const FRUSTUM_MARGIN_FRACTION = 0.15;

/**
 * 太阳赤纬（度，8 月中旬 ≈ +14°，常量登记——labSunDirection 的默认赤纬；
 * M3.7 起按雨历元经 EPOCH_SUN_DECLINATION_DEG 覆写（11 月狮子座暴 −19°）。
 */
export const SUN_DECLINATION_MID_AUG_DEG = 14;

/** 延时摄影档位（M3.7 决策 A；×300 放弃登记：单颗流星寿命 < 1 帧退化为闪点） */
export const TIMELAPSE_GEARS: readonly number[] = [1, 10, 60];

/** 条痕跨度补偿的基准时间流速（≤ 本值时保持契约 C2 默认 uLagSpan） */
export const TIMELAPSE_LAGSPAN_BASE_TIMESCALE = 10;

// ---------------------------------------------------------------------------
// 坐标族（§1.3，契约 C5）
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/** 恒星时速率：每平太阳小时 15.041°（§1.3 简化模型） */
const SIDEREAL_DEG_PER_HOUR = 15.041;

/** 归一化角度到 [0, 2π) */
function normalizeRad(rad: number): number {
  const r = rad % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/**
 * 本地恒星时（简化模型，§1.3）：LST = LST₀ + 15.041°×(hourOffset + elapsedHours)
 *
 * 观测者经度不作输入（"当地时间"抽象化，登记简化）。
 *
 * @param epochLst0Deg 历元起点本地恒星时常量（度，见 PERSEIDS/KAPPA_CYGNIDS）
 * @param hourOffset 地方时偏移控件（小时，[-6, +6]）
 * @param elapsedHours 场景内推进时长（小时，timeScale 放大后的累计值）
 * @returns LST（弧度，[0, 2π)）
 */
export function localSiderealTime(
  epochLst0Deg: number,
  hourOffset: number,
  elapsedHours: number
): number {
  return normalizeRad((epochLst0Deg + SIDEREAL_DEG_PER_HOUR * (hourOffset + elapsedHours)) * DEG);
}

export interface AltAz {
  /** 高度角（弧度，地平以上为正） */
  altRad: number;
  /** 方位角（弧度，[0, 2π)，北起经东：N=0，E=π/2） */
  azRad: number;
}

/**
 * 赤道坐标 → 地平坐标（§1.3）
 *
 * sin(Alt) = sinδ·sinφ + cosδ·cosφ·cos(H)，H = LST − RA；
 * Az 用 atan2 处理象限，惯例北起经东（N=0°，E=90°）。
 */
export function horizontalFromEquatorial(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lstRad: number
): AltAz {
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;
  const hourAngle = lstRad - raDeg * DEG;
  const sinAlt =
    Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(hourAngle);
  const altRad = Math.asin(Math.min(1, Math.max(-1, sinAlt)));
  // cos(Alt)·sin(Az) = −cosδ·sin(H)；cos(Alt)·cos(Az) = sinδ·cosφ − cosδ·sinφ·cos(H)
  const azRad = normalizeRad(
    Math.atan2(
      -Math.cos(dec) * Math.sin(hourAngle),
      Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(hourAngle)
    )
  );
  return { altRad, azRad };
}

/**
 * 地平坐标 → 场景方向单位向量（契约 C5 轴向：+Y 天顶、−Z 正北、+X 正东）
 *
 * 锚点：Az=90°/Alt=0° → [1, 0, 0]（正东，单测锁定防东西镜像）。
 */
export function sceneDirFromAltAz(altAz: AltAz): [number, number, number] {
  const cosAlt = Math.cos(altAz.altRad);
  return [
    cosAlt * Math.sin(altAz.azRad),
    Math.sin(altAz.altRad),
    -cosAlt * Math.cos(altAz.azRad),
  ];
}

/**
 * 赤道系 → 场景地平系旋转矩阵（供 M2 星穹 shader，行主序 3×3 展平数组）
 *
 * 输入赤道单位向量约定：xe = cosδ·cosα，ye = cosδ·sinα，ze = sinδ。
 * scene = M · equatorial，与 sceneDirFromAltAz(horizontalFromEquatorial(...)) 等价
 * （单测交叉锁定）。行主序可直接喂 THREE.Matrix3.set(...m)。
 */
export function equatorialToHorizontalMatrix(
  latDeg: number,
  lstRad: number
): [number, number, number, number, number, number, number, number, number] {
  const lat = latDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLst = Math.sin(lstRad);
  const cosLst = Math.cos(lstRad);
  // 推导：east = −cosδ·sinH、up = sinAlt、north = cosAlt·cosAz 展开到赤道分量
  // scene.x = east，scene.y = up，scene.z = −north
  return [
    -sinLst,
    cosLst,
    0,
    cosLat * cosLst,
    cosLat * sinLst,
    sinLat,
    sinLat * cosLst,
    sinLat * sinLst,
    -cosLat,
  ];
}

/** 赤道坐标（度）→ 赤道系单位向量（xe = cosδ·cosα 约定，供矩阵消费侧生成 attribute） */
export function equatorialUnitVector(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)];
}

// ---------------------------------------------------------------------------
// 流量族（§1.4）
// ---------------------------------------------------------------------------

/**
 * ZHR → 可见小时率（§1.4）：HR = ZHR·sin(Alt_radiant) / r^(6.5−lm)
 *
 * Alt ≤ 0 时流量为零；是 sin(Alt) 不是线性。
 * lm 同时驱动恒星剔除与流量压低（同一物理参数，自洽联动）；
 * 登记简化：lm 只压低流星数量，不对单颗流星做亮度剔除。
 */
export function visibleHourlyRate(
  zhr: number,
  populationIndex: number,
  radiantAltRad: number,
  limitingMag: number
): number {
  if (radiantAltRad <= 0) return 0;
  return (zhr * Math.sin(radiantAltRad)) / populationIndex ** (6.5 - limitingMag);
}

/**
 * 小时率 → shader 流量门控分数（§1.4 显式公式）：
 * uFluxFraction = clamp(HR/3600 × cyclePeriod / slotCount, 0, 1)
 *
 * 每槽位每周期点燃一次，"每秒流星数 × 周期 ÷ 槽位数"即激活比例。
 * timeScale 经放大 uTime 自然放大出现频率，本公式不重复乘。
 */
export function fluxFraction(
  hourlyRate: number,
  slotCount: number,
  cyclePeriodSec: number
): number {
  if (!(slotCount > 0) || !(cyclePeriodSec > 0)) {
    throw new RangeError(`槽位数与周期必须为正，收到 slotCount=${slotCount}, cyclePeriod=${cyclePeriodSec}`);
  }
  return Math.min(1, Math.max(0, ((hourlyRate / 3600) * cyclePeriodSec) / slotCount));
}

// ---------------------------------------------------------------------------
// 烧蚀族（§1.1）：RK4 求解 + 过原点三次拟合
// ---------------------------------------------------------------------------

/** 阻力系数 Γ（§1.1） */
export const ABLATION_GAMMA = 1.0;

/** 热传导系数 Λ（§1.1） */
export const ABLATION_LAMBDA = 0.1;

/** 汽化潜热 Q = 6×10⁶ J/kg（§1.1） */
export const ABLATION_HEAT_OF_VAPORIZATION = 6e6;

/** 海平面大气密度 ρ₀ = 1.225 kg/m³（§1.1） */
export const AIR_DENSITY_SEA_LEVEL = 1.225;

/** 大气标高 H ≈ 8.5 km（80–120 km 层近似，登记） */
export const ATMOSPHERE_SCALE_HEIGHT_KM = 8.5;

/** 流星体密度 1000 kg/m³（彗星质地，球形截面） */
export const METEOROID_DENSITY = 1000;

/** 固定入射天顶角 45°（烘焙近似，登记） */
export const ENTRY_ZENITH_ANGLE_RAD = Math.PI / 4;

/** 普通流星质量对数均匀采样范围（kg） */
export const MASS_RANGE_ORDINARY_KG: [number, number] = [1e-6, 1e-3];

/** 火流星质量对数均匀采样范围（kg） */
export const MASS_RANGE_FIREBALL_KG: [number, number] = [1e-2, 1];

export interface AblationParams {
  /** 流星体初始质量（kg） */
  massKg: number;
  /** 大气入射速度（km/s） */
  entrySpeedKmPerSec: number;
  /** 求解时长（秒，默认 1 s 寿命） */
  durationSec?: number;
  /** RK4 步数（默认 200） */
  steps?: number;
}

export interface AblationCurves {
  /** 采样时刻（秒，含 t=0） */
  ts: number[];
  /** 沿入射方向累计位移（场景单位 km——SI 求解后换算，单位红线） */
  sKm: number[];
  /** 速度采样（km/s，单调递减） */
  vKmPerSec: number[];
  /** 发光强度 I ∝ ρ_a·v⁵，按峰值归一（峰值 = 1；§1.1） */
  intensity: number[];
  /** 强度峰值时刻（秒） */
  peakTimeSec: number;
}

/** 大气密度（kg/m³），h 为海拔 km：ρ_a = ρ₀·e^(−h/H) */
export function airDensityAtKm(heightKm: number): number {
  return AIR_DENSITY_SEA_LEVEL * Math.exp(-heightKm / ATMOSPHERE_SCALE_HEIGHT_KM);
}

/** 球形流星体迎风截面积（m²）：由当前质量与密度导出 */
function crossSectionArea(massKg: number): number {
  const radius = Math.cbrt((3 * massKg) / (4 * Math.PI * METEOROID_DENSITY));
  return Math.PI * radius * radius;
}

/**
 * 流星体烧蚀 ODE 的 RK4 求解（§1.1，初始化路径专用——禁止 useFrame 内调用）
 *
 * dv/dt = −Γ·ρ_a·A/m·v²；dm/dt = −Λ·ρ_a·A/(2Q)·v³；ds/dt = v。
 * 高度换算 h(t) = 115 km − s·cos45°（固定天顶角烘焙近似）。
 * 质量烧尽（< 初始 0.1%）后冻结（v=0、强度=0）。
 *
 * 单位红线：状态量以 SI（m、s、kg）积分，返回值换算为 km（场景单位）。
 */
export function solveAblationRK4(params: AblationParams): AblationCurves {
  const { massKg, entrySpeedKmPerSec } = params;
  const durationSec = params.durationSec ?? 1;
  const steps = params.steps ?? 200;
  if (!(massKg > 0) || !(entrySpeedKmPerSec > 0)) {
    throw new RangeError(`质量与入速必须为正，收到 m=${massKg}, v=${entrySpeedKmPerSec}`);
  }
  if (!(durationSec > 0) || !Number.isInteger(steps) || steps < 2) {
    throw new RangeError(`时长必须为正且步数为 ≥2 的整数，收到 T=${durationSec}, steps=${steps}`);
  }

  const dt = durationSec / steps;
  const massFloor = massKg * 1e-3; // 烧尽阈值：初始质量 0.1%
  const cosZenith = Math.cos(ENTRY_ZENITH_ANGLE_RAD);

  // 状态 [v(m/s), m(kg), s(m)]；导数在 SI 中计算
  type State = [number, number, number];
  const derivative = (state: State): State => {
    const [v, m] = state;
    if (m <= massFloor || v <= 0) return [0, 0, 0];
    const heightKm = BURN_LAYER_TOP_KM - (state[2] / 1000) * cosZenith;
    const rhoA = airDensityAtKm(heightKm);
    const area = crossSectionArea(m);
    return [
      (-ABLATION_GAMMA * rhoA * area * v * v) / m,
      (-ABLATION_LAMBDA * rhoA * area * v * v * v) / (2 * ABLATION_HEAT_OF_VAPORIZATION),
      v,
    ];
  };

  let state: State = [entrySpeedKmPerSec * 1000, massKg, 0];
  const ts: number[] = [0];
  const sKm: number[] = [0];
  const vKmPerSec: number[] = [state[0] / 1000];
  const rawIntensity: number[] = [airDensityAtKm(BURN_LAYER_TOP_KM) * state[0] ** 5];

  for (let i = 1; i <= steps; i++) {
    const k1 = derivative(state);
    const mid1: State = [
      state[0] + (dt / 2) * k1[0],
      state[1] + (dt / 2) * k1[1],
      state[2] + (dt / 2) * k1[2],
    ];
    const k2 = derivative(mid1);
    const mid2: State = [
      state[0] + (dt / 2) * k2[0],
      state[1] + (dt / 2) * k2[1],
      state[2] + (dt / 2) * k2[2],
    ];
    const k3 = derivative(mid2);
    const end: State = [state[0] + dt * k3[0], state[1] + dt * k3[1], state[2] + dt * k3[2]];
    const k4 = derivative(end);
    state = [
      state[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      state[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      state[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    ];
    // 数值防御：速度/质量不为负
    if (state[0] < 0) state[0] = 0;
    if (state[1] < massFloor) state[1] = massFloor;

    const t = i * dt;
    const burnedOut = state[1] <= massFloor || state[0] <= 0;
    const heightKm = BURN_LAYER_TOP_KM - (state[2] / 1000) * cosZenith;
    ts.push(t);
    sKm.push(state[2] / 1000); // 单位红线：m → km（场景单位）
    vKmPerSec.push(burnedOut ? 0 : state[0] / 1000);
    rawIntensity.push(burnedOut ? 0 : airDensityAtKm(heightKm) * state[0] ** 5);
  }

  // 强度按峰值归一（每槽位峰值 = 1，槽位间亮度差异由质量映射与 HDR 因子表达）
  let peak = 0;
  let peakIndex = 0;
  for (let i = 0; i < rawIntensity.length; i++) {
    if (rawIntensity[i] > peak) {
      peak = rawIntensity[i];
      peakIndex = i;
    }
  }
  const intensity = rawIntensity.map((raw) => (peak > 0 ? raw / peak : 0));
  return { ts, sKm, vKmPerSec, intensity, peakTimeSec: ts[peakIndex] };
}

/**
 * 烧蚀曲线截断到有效发光窗口（峰值后强度 < threshold 处）
 *
 * 动机（登记设计差异）：小质量流星在 1 s 窗口内提前烧尽，强度曲线带长零尾，
 * 三次式无法兼顾"指数增亮 + 骤灭 + 零尾"；截断后寿命 = 有效发光窗口，
 * 拟合质量显著改善（RMS ≤ 0.2）。骤灭的陡峭尾沿由 shader 首尾
 * smoothstep 抗锯齿因子叠乘表达（§1.1 明示允许）。
 * 大质量火流星在窗口内未烧尽则原样返回（终端爆发在寿命末端，符合物理）。
 */
export function truncateAblationCurves(curves: AblationCurves, threshold = 0.02): AblationCurves {
  if (!(threshold > 0 && threshold < 1)) {
    throw new RangeError(`截断阈值必须在 (0,1)，收到 ${threshold}`);
  }
  const peakIndex = curves.intensity.indexOf(Math.max(...curves.intensity));
  let end = curves.ts.length - 1;
  for (let i = peakIndex; i < curves.intensity.length; i++) {
    if (curves.intensity[i] < threshold) {
      end = i;
      break;
    }
  }
  if (end === curves.ts.length - 1) return curves;
  return {
    ts: curves.ts.slice(0, end + 1),
    sKm: curves.sKm.slice(0, end + 1),
    vKmPerSec: curves.vKmPerSec.slice(0, end + 1),
    intensity: curves.intensity.slice(0, end + 1),
    peakTimeSec: curves.peakTimeSec,
  };
}

/**
 * 过原点三次多项式最小二乘拟合（c₀ = 0）：y ≈ c₁t + c₂t² + c₃t³
 *
 * 正规方程 3×3，高斯消元（部分主元）。供位移曲线 s(t) 与强度曲线 I(t)
 * 烘焙为 shader attribute（aDispCoefs / aIntenCoefs）。
 *
 * @returns [c₁, c₂, c₃]
 */
export function fitCubicThroughOrigin(
  ts: readonly number[],
  ys: readonly number[]
): [number, number, number] {
  if (ts.length !== ys.length || ts.length < 3) {
    throw new RangeError(`样本长度需一致且 ≥3，收到 ts=${ts.length}, ys=${ys.length}`);
  }
  // 正规方程：A·c = b，A[i][j] = Σ t^(i+j+2)，b[i] = Σ y·t^(i+1)
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    const powers = [t, t * t, t * t * t];
    for (let i = 0; i < 3; i++) {
      b[i] += ys[k] * powers[i];
      for (let j = 0; j < 3; j++) {
        a[i][j] += powers[i] * powers[j];
      }
    }
  }
  // 高斯消元（部分主元）
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-30) {
      throw new RangeError('正规方程奇异（样本 t 取值退化）');
    }
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    for (let row = col + 1; row < 3; row++) {
      const factor = a[row][col] / a[col][col];
      for (let j = col; j < 3; j++) a[row][j] -= factor * a[col][j];
      b[row] -= factor * b[col];
    }
  }
  const c3 = b[2] / a[2][2];
  const c2 = (b[1] - a[1][2] * c3) / a[1][1];
  const c1 = (b[0] - a[0][1] * c2 - a[0][2] * c3) / a[0][0];
  return [c1, c2, c3];
}

/** 三次多项式（c₀=0）求值：c₁t + c₂t² + c₃t³（shader O(1) 求值的 CPU 镜像） */
export function evalCubic(coefs: readonly [number, number, number], t: number): number {
  return coefs[0] * t + coefs[1] * t * t + coefs[2] * t * t * t;
}

// ---------------------------------------------------------------------------
// 调度族（契约 C2）：槽位元数据生成 + 点燃检查 CPU 镜像
// ---------------------------------------------------------------------------

export interface MeteorSlot {
  /** 循环相位随机数（shader：fract(aSeed + uTime/uCyclePeriod)） */
  aSeed: number;
  /** 流量门控随机数（shader：aGateRank < uFluxFraction；与 aSeed 独立，契约 C2 反耦合） */
  aGateRank: number;
  /** 火流星门控随机数（shader：aFireballRank < uFireballFraction；独立随机数） */
  aFireballRank: number;
  /** 火流星身份（烘焙期固定，带火流星质量档拟合系数，§4.2） */
  isFireball: boolean;
  /** 入射起点（场景单位；y = 115 燃烧层顶，水平圆盘内均匀采样） */
  startPos: [number, number, number];
  /** 单次点燃寿命（秒，= 截断后的有效发光窗口，拟合窗与之一致） */
  lifetimeSec: number;
  /** 烘焙质量（kg，对数均匀采样） */
  massKg: number;
  /** 位移曲线拟合系数 [c₁,c₂,c₃]（场景单位 km，aDispCoefs） */
  dispCoefs: [number, number, number];
  /** 强度曲线拟合系数 [c₁,c₂,c₃]（峰值归一，aIntenCoefs） */
  intenCoefs: [number, number, number];
}

/**
 * 一次性生成 N 槽位元数据（初始化/页签切换路径，契约 C2.1）
 *
 * 契约 C2 反耦合红线：aSeed / aGateRank / aFireballRank 是三个独立随机数——
 * 若复用同一随机数，门控分数小时被激活槽位的相位会集中在 [0, frac) 区间，
 * 流星将每周期挤成一团爆发（已识别设计陷阱，单测锁定独立性）。
 *
 * M3 登记差异（采样分布调整，shader 门控公式不变）：
 * - aGateRank 分层采样：rank = (随机置换名次 + 抖动)/count——边缘分布仍为
 *   均匀 [0,1) 且与 aSeed 独立（契约 C2 本义完整保留），但消除 iid 采样的
 *   激活槽位数量化方差（iid 下 uFluxFraction≈0.004 时有 ~40% 概率零槽激活，
 *   天空恒空；分层后激活数 = ⌊flux×count⌋ ± 1 确定性成立）。
 * - 火流星身份按门控名次 Bresenham 均匀铺开（份额 = fireballSlotFraction 精确
 *   命中，且任意低名次前缀含比例份额）——保证低流量下激活集内有火流星候选。
 * - 火流星槽位的 aFireballRank 按其门控名次序分层递增——fireballRate 控件
 *   单调响应（调高逐个点亮门控名次靠前的火流星），且最低名次火流星在默认
 *   fireballRate 下即激活（目验可达性）。普通槽位 aFireballRank 保持 iid
 *   （shader 不消费）。
 *
 * @param seed 确定性种子（createSeededRandom，全项目粒子系统统一）
 * @param count 槽位数（M3 全量 200+，reduced 档减半）
 * @param shower 流星雨参数（入速决定拟合系数——页签切换必须重建）
 */
export function makeMeteorSlots(
  seed: number,
  count: number,
  shower: MeteorShowerParams
): MeteorSlot[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`槽位数必须为正整数，收到 ${count}`);
  }
  const rand = createSeededRandom(seed);

  // 门控名次置换（Fisher–Yates；与后续每槽位随机数相互独立）
  const gateOrder = new Array<number>(count);
  for (let i = 0; i < count; i++) gateOrder[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [gateOrder[i], gateOrder[j]] = [gateOrder[j], gateOrder[i]];
  }

  // 火流星身份按名次 Bresenham 铺开（k 名次是否为火流星 + 火流星序号）
  const f = shower.fireballSlotFraction;
  const isFireballAtRank = new Array<boolean>(count);
  const fireballOrdinalAtRank = new Array<number>(count);
  let fireballCount = 0;
  for (let k = 0; k < count; k++) {
    const fb = Math.floor((k + 1) * f + 0.5) > Math.floor(k * f + 0.5);
    isFireballAtRank[k] = fb;
    fireballOrdinalAtRank[k] = fireballCount;
    if (fb) fireballCount++;
  }

  const slots: MeteorSlot[] = [];
  for (let i = 0; i < count; i++) {
    const gateRankIndex = gateOrder[i];
    // 相位/门控/火流星门控：三个独立随机量（契约 C2：禁止复用）
    const aSeed = rand();
    const aGateRank = (gateRankIndex + rand()) / count;
    const isFireball = isFireballAtRank[gateRankIndex];
    const aFireballRank = isFireball
      ? (fireballOrdinalAtRank[gateRankIndex] + rand()) / Math.max(fireballCount, 1)
      : rand();

    // 质量对数均匀采样（§1.1）
    const [massLo, massHi] = isFireball ? MASS_RANGE_FIREBALL_KG : MASS_RANGE_ORDINARY_KG;
    const massKg = 10 ** (Math.log10(massLo) + rand() * (Math.log10(massHi) - Math.log10(massLo)));

    // 入射起点：燃烧层顶 y=115，水平圆盘内均匀采样（√r 保证面积均匀）
    const theta = rand() * TWO_PI;
    const radius = BURN_LAYER_HORIZONTAL_RADIUS_KM * Math.sqrt(rand());
    const startPos: [number, number, number] = [
      radius * Math.cos(theta),
      BURN_LAYER_TOP_KM,
      radius * Math.sin(theta),
    ];

    // 求解窗：1 s 基准 ±20%（视觉多样性）
    const solveWindowSec = 0.8 + rand() * 0.4;

    // RK4 + 截断到有效发光窗口 + 双曲线拟合（初始化路径专用，§1.1 实现降维控制）
    const curves = truncateAblationCurves(
      solveAblationRK4({
        massKg,
        entrySpeedKmPerSec: shower.entrySpeedKmPerSec,
        durationSec: solveWindowSec,
      })
    );
    const lifetimeSec = curves.ts[curves.ts.length - 1];
    const dispCoefs = fitCubicThroughOrigin(curves.ts, curves.sKm);
    const intenCoefs = fitCubicThroughOrigin(curves.ts, curves.intensity);

    slots.push({
      aSeed,
      aGateRank,
      aFireballRank,
      isFireball,
      startPos,
      lifetimeSec,
      massKg,
      dispCoefs,
      intenCoefs,
    });
  }
  return slots;
}

/**
 * 本帧点燃槽位检查（shader 循环公式的 CPU 镜像，契约 C2；供 M4 音频触发）
 *
 * 与 shader 严格同式：相位 fract(aSeed + t/T)、门控 aGateRank < uFluxFraction。
 * 槽位在相位回绕（floor(aSeed + t/T) 递增）瞬间点燃；本函数返回
 * (prevTime, currTime] 内点燃且通过流量门控的槽位下标。
 *
 * @param prevTimeSec 上一帧 uTime（秒，timeScale 放大后）
 * @param currTimeSec 本帧 uTime（秒）
 * @param slots 槽位数组（makeMeteorSlots 产物）
 * @param fluxFrac 流量门控分数（fluxFraction 产物）
 * @param cyclePeriodSec 循环周期（默认 METEOR_CYCLE_PERIOD_SEC）
 */
export function ignitedSlots(
  prevTimeSec: number,
  currTimeSec: number,
  slots: readonly MeteorSlot[],
  fluxFrac: number,
  cyclePeriodSec: number = METEOR_CYCLE_PERIOD_SEC
): number[] {
  if (!(cyclePeriodSec > 0)) {
    throw new RangeError(`循环周期必须为正，收到 ${cyclePeriodSec}`);
  }
  if (currTimeSec < prevTimeSec) {
    throw new RangeError(`时间必须单调，收到 prev=${prevTimeSec} > curr=${currTimeSec}`);
  }
  const ignited: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.aGateRank >= fluxFrac) continue; // 门控用 aGateRank（非 aSeed，契约 C2）
    const prevCycle = Math.floor(slot.aSeed + prevTimeSec / cyclePeriodSec);
    const currCycle = Math.floor(slot.aSeed + currTimeSec / cyclePeriodSec);
    if (currCycle > prevCycle) ignited.push(i);
  }
  return ignited;
}

/** 循环相位（shader fract(aSeed + t/T) 的 CPU 镜像，供测试与 M4 消费） */
export function slotPhase(aSeed: number, timeSec: number, cyclePeriodSec: number): number {
  const x = aSeed + timeSec / cyclePeriodSec;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// M3 渲染/控件联动纯函数（§1.5 / §3 / §4.3）
// ---------------------------------------------------------------------------

/**
 * 火流星碎片横向位移量级（场景单位 km，§1.5）
 *
 * 碎片速度矢量偏离主体 ≤ FRAGMENT_CONE_HALF_ANGLE_RAD（半角 2°）：
 * 横向位移 = tan(半角) × 崩溃后剩余路径长（位移多项式在 [0.8T, T] 段增量），
 * 上限钳制 FRAGMENT_MAX_LATERAL_KM（数百 m 至 1 km 量级）。
 * 供 aFragDir attribute 烘焙（方向随机单位向量 × 本量级）。
 */
export function fragmentLateralMagnitudeKm(
  dispCoefs: readonly [number, number, number],
  lifetimeSec: number
): number {
  if (!(lifetimeSec > 0)) {
    throw new RangeError(`寿命必须为正，收到 ${lifetimeSec}`);
  }
  const sEnd = evalCubic(dispCoefs, lifetimeSec);
  const sBreak = evalCubic(dispCoefs, FRAGMENT_BREAKUP_PROGRESS * lifetimeSec);
  const lateral = Math.tan(FRAGMENT_CONE_HALF_ANGLE_RAD) * Math.max(sEnd - sBreak, 0);
  return Math.min(FRAGMENT_MAX_LATERAL_KM, lateral);
}

/**
 * 场景当地时钟（小时，[0, 24)；HUD 显示用，§3 控件 3）
 *
 * 当地时 = 历元时刻 + hourOffset + 场景推进时长（timeScale 放大后），
 * 与 LST 简化模型共用同一 (hourOffset + elapsedHours) 输入——时钟与
 * 星穹旋转自洽联动。
 */
export function localClockHours(
  epochLocalHour: number,
  hourOffset: number,
  elapsedHours: number
): number {
  const h = (epochLocalHour + hourOffset + elapsedHours) % 24;
  return h < 0 ? h + 24 : h;
}

/** 小时数 → "HH:MM"（HUD 地方时展示；输入任意实数小时，先归一到 [0,24)） */
export function formatClockHHMM(hours: number): string {
  if (!Number.isFinite(hours)) {
    throw new RangeError(`小时数必须有限，收到 ${hours}`);
  }
  const normalized = ((hours % 24) + 24) % 24;
  const totalMinutes = Math.floor(normalized * 60) % (24 * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * 余迹绑定槽位选择（§1.5：电离余迹只挂"亮流星/火流星"）
 *
 * 排序规则（确定性）：火流星优先（质量降序），其后普通槽位按质量降序
 * （质量 → 峰值光度的单调映射，§1.1 强度归一登记），截取前 maxSlots 个。
 *
 * @returns 入选槽位在 slots 中的下标数组
 */
export function selectAfterglowSlots(
  slots: readonly MeteorSlot[],
  maxSlots: number
): number[] {
  if (!Number.isInteger(maxSlots) || maxSlots < 1) {
    throw new RangeError(`余迹槽位上限必须为正整数，收到 ${maxSlots}`);
  }
  const indices = slots.map((_, i) => i);
  indices.sort((a, b) => {
    const sa = slots[a];
    const sb = slots[b];
    if (sa.isFireball !== sb.isFireball) return sa.isFireball ? -1 : 1;
    return sb.massKg - sa.massKg;
  });
  return indices.slice(0, Math.min(maxSlots, slots.length));
}

// ---------------------------------------------------------------------------
// M3.5 目验辅助纯函数（§M3.5：倒计时/快进/演示挑选/跟随位姿）
// ---------------------------------------------------------------------------

export interface NextIgnitionEvent {
  /** 点燃槽位下标 */
  slotIndex: number;
  /** 点燃时刻（场景秒，严格 > fromSec） */
  igniteAtSec: number;
}

/**
 * 下一次点燃解析解（§M3.5-1；契约 C2 调度公式的前瞻镜像）
 *
 * 每槽位相位回绕时刻解析解：t = (⌊aSeed + from/T⌋ + 1 − aSeed) × T（严格
 * > from——禁止逐帧扫描仿真）；门控与 shader 严格同式（aGateRank <
 * fluxFrac；火流星槽位还需 aFireballRank < fireballFrac，§4.2 双门控），
 * 全部通过门控槽位取最小 t。与 `ignitedSlots` 交叉单测锁定。
 *
 * 登记近似：门控分数取调用时刻的流量链快照——点燃时刻最远 T 秒后，
 * 期间辐射点高度变化导致的 flux 漂移不回溯修正（倒计时/快进口径一致）。
 *
 * @param fireballOnly 只扫火流星槽位（"下一颗火流星"倒计时/快进）
 * @returns 无候选（流量为零/火流星门控全关）时 null
 */
export function nextIgnition(
  slots: readonly MeteorSlot[],
  fluxFrac: number,
  fireballFrac: number,
  fromSec: number,
  cyclePeriodSec: number,
  fireballOnly: boolean
): NextIgnitionEvent | null {
  if (!(cyclePeriodSec > 0)) {
    throw new RangeError(`循环周期必须为正，收到 ${cyclePeriodSec}`);
  }
  let best: NextIgnitionEvent | null = null;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (fireballOnly && !slot.isFireball) continue;
    if (slot.aGateRank >= fluxFrac) continue; // 门控用 aGateRank（契约 C2）
    if (slot.isFireball && slot.aFireballRank >= fireballFrac) continue; // 火流星门控（§4.2）
    const igniteAtSec =
      (Math.floor(slot.aSeed + fromSec / cyclePeriodSec) + 1 - slot.aSeed) * cyclePeriodSec;
    if (best === null || igniteAtSec < best.igniteAtSec) {
      best = { slotIndex: i, igniteAtSec };
    }
  }
  return best;
}

/** 相机视锥描述（pickDemoSlot v2 输入；CameraPoseBridge 每帧 mutate 同构） */
export interface DemoCameraView {
  /** 相机世界坐标（场景单位） */
  position: readonly [number, number, number];
  /** 视线方向（单位向量，相机 −Z 世界方向） */
  viewDir: readonly [number, number, number];
  /** 相机上方向（单位向量，matrixWorld 第 2 列） */
  upDir: readonly [number, number, number];
  /** 垂直视野角（弧度） */
  fovYRad: number;
  /** 宽高比（fovX 由 tan(fovY/2)×aspect 推出） */
  aspect: number;
}

/** 演示槽位挑选结果（M3.6-1） */
export interface DemoSlotPick {
  /** 最优槽位下标 */
  slotIndex: number;
  /** 无"全轨迹入视锥"候选 → 需自动运镜保底（决策 A1） */
  needsAim: boolean;
  /** 轨迹中点（needsAim 时 aim 机位计算复用，避免消费侧重算） */
  midPoint: [number, number, number];
}

/**
 * 点的视锥内判定（各向留 FRUSTUM_MARGIN_FRACTION 边距）：
 * 点投影到相机正交基（forward/right/up），forward 分量 > 0 且
 * |x/z| ≤ tan(fovX/2)×(1−margin)、|y/z| ≤ tan(fovY/2)×(1−margin)。
 */
function pointInFrustum(
  px: number,
  py: number,
  pz: number,
  view: DemoCameraView,
  right: readonly [number, number, number],
  trueUp: readonly [number, number, number],
  forward: readonly [number, number, number]
): boolean {
  const dx = px - view.position[0];
  const dy = py - view.position[1];
  const dz = pz - view.position[2];
  const z = dx * forward[0] + dy * forward[1] + dz * forward[2];
  if (!(z > 0)) return false; // 背向相机
  const tanY = Math.tan(view.fovYRad / 2) * (1 - FRUSTUM_MARGIN_FRACTION);
  const tanX = Math.tan(view.fovYRad / 2) * view.aspect * (1 - FRUSTUM_MARGIN_FRACTION);
  const x = dx * right[0] + dy * right[1] + dz * right[2];
  if (Math.abs(x) > tanX * z) return false;
  const y = dx * trueUp[0] + dy * trueUp[1] + dz * trueUp[2];
  return Math.abs(y) <= tanY * z;
}

/**
 * 演示槽位挑选 v2（M3.6-1，契约 C1 签名变更登记——M3.5 版为
 * (slots, velocityDir, cameraPos, viewDir, fireballOnly) → number）：
 * 视锥感知——硬性过滤"轨迹起点与烧尽点（= startPos + v×evalCubic(disp,
 * lifetime)）均在视锥内（各向留 15% 边距）"的槽位，合格集内挑轨迹中点
 * 最贴近视野中心者；无合格槽位时返回全域最优（原 M3.5 视线贴近度评分）
 * + needsAim 标记（消费侧自动运镜保底，决策 A1）。
 *
 * @param velocityDir 当前流星飞行方向（单位向量，= −辐射点方向）
 * @param view 相机视锥描述（position/viewDir/upDir/fovY/aspect）
 * @param fireballOnly 只挑火流星槽位（"演示火流星"按钮）
 * @returns 挑选结果；无候选（含中点与相机重合的退化）时 null
 */
/** 相机正交基（forward/right/trueUp；pickDemoSlot 与 slotTrajectoryInView 共用） */
interface ViewBasis {
  forward: [number, number, number];
  right: [number, number, number];
  trueUp: [number, number, number];
}

/** 由视锥描述建正交基（视线归一 + upDir 叉积；退化时 +Y/+X 轴兜底重建） */
function buildViewBasis(view: DemoCameraView): ViewBasis {
  const viewLen = Math.hypot(view.viewDir[0], view.viewDir[1], view.viewDir[2]);
  if (!(viewLen > 0)) {
    throw new RangeError('视线方向不能为零向量');
  }
  if (!(view.fovYRad > 0) || !(view.aspect > 0)) {
    throw new RangeError(`视野角与宽高比必须为正，收到 fovY=${view.fovYRad}, aspect=${view.aspect}`);
  }
  const forward: [number, number, number] = [
    view.viewDir[0] / viewLen,
    view.viewDir[1] / viewLen,
    view.viewDir[2] / viewLen,
  ];
  let rx = forward[1] * view.upDir[2] - forward[2] * view.upDir[1];
  let ry = forward[2] * view.upDir[0] - forward[0] * view.upDir[2];
  let rz = forward[0] * view.upDir[1] - forward[1] * view.upDir[0];
  let rLen = Math.hypot(rx, ry, rz);
  if (rLen < 1e-6) {
    // upDir 与视线平行（退化）：世界 +Y 重建，再退化用 +X
    rx = forward[1] * 0 - forward[2] * 1;
    ry = forward[2] * 0 - forward[0] * 0;
    rz = forward[0] * 1 - forward[1] * 0;
    rLen = Math.hypot(rx, ry, rz);
    if (rLen < 1e-6) {
      rx = forward[1] * 0 - forward[2] * 0;
      ry = forward[2] * 1 - forward[0] * 0;
      rz = forward[0] * 0 - forward[1] * 1;
      rLen = Math.hypot(rx, ry, rz);
    }
  }
  const right: [number, number, number] = [rx / rLen, ry / rLen, rz / rLen];
  const trueUp: [number, number, number] = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { forward, right, trueUp };
}

/**
 * 槽位全轨迹入视锥判定（M3.7-3 快进入画消费；判定口径与 pickDemoSlot
 * 硬性过滤严格同式）：轨迹起点与烧尽点均在视锥内（各向留 15% 边距）。
 */
export function slotTrajectoryInView(
  slot: MeteorSlot,
  velocityDir: readonly [number, number, number],
  view: DemoCameraView
): boolean {
  const { forward, right, trueUp } = buildViewBasis(view);
  if (
    !pointInFrustum(slot.startPos[0], slot.startPos[1], slot.startPos[2], view, right, trueUp, forward)
  ) {
    return false;
  }
  const endDisp = evalCubic(slot.dispCoefs, slot.lifetimeSec);
  return pointInFrustum(
    slot.startPos[0] + velocityDir[0] * endDisp,
    slot.startPos[1] + velocityDir[1] * endDisp,
    slot.startPos[2] + velocityDir[2] * endDisp,
    view,
    right,
    trueUp,
    forward
  );
}

export function pickDemoSlot(
  slots: readonly MeteorSlot[],
  velocityDir: readonly [number, number, number],
  view: DemoCameraView,
  fireballOnly: boolean
): DemoSlotPick | null {
  const { forward, right, trueUp } = buildViewBasis(view);

  let bestInIndex = -1; // 全轨迹入视锥集内最优（中点最贴近视野中心）
  let bestInScore = -Infinity;
  let bestInMid: [number, number, number] = [0, 0, 0];
  let bestAnyIndex = -1; // 全域最优（原 M3.5 评分，needsAim 保底）
  let bestAnyScore = -Infinity;
  let bestAnyMid: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (fireballOnly && !slot.isFireball) continue;
    const midDisp = evalCubic(slot.dispCoefs, 0.5 * slot.lifetimeSec);
    const mx = slot.startPos[0] + velocityDir[0] * midDisp;
    const my = slot.startPos[1] + velocityDir[1] * midDisp;
    const mz = slot.startPos[2] + velocityDir[2] * midDisp;
    const dx = mx - view.position[0];
    const dy = my - view.position[1];
    const dz = mz - view.position[2];
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 0)) continue; // 中点与相机重合：方向未定义，跳过
    const score = (dx * forward[0] + dy * forward[1] + dz * forward[2]) / len;
    if (score > bestAnyScore) {
      bestAnyScore = score;
      bestAnyIndex = i;
      bestAnyMid = [mx, my, mz];
    }
    // 硬性过滤：轨迹起点与烧尽点都入画才合格（M3.6-1）
    const endDisp = evalCubic(slot.dispCoefs, slot.lifetimeSec);
    const startIn = pointInFrustum(
      slot.startPos[0],
      slot.startPos[1],
      slot.startPos[2],
      view,
      right,
      trueUp,
      forward
    );
    const endIn =
      startIn &&
      pointInFrustum(
        slot.startPos[0] + velocityDir[0] * endDisp,
        slot.startPos[1] + velocityDir[1] * endDisp,
        slot.startPos[2] + velocityDir[2] * endDisp,
        view,
        right,
        trueUp,
        forward
      );
    if (startIn && endIn && score > bestInScore) {
      bestInScore = score;
      bestInIndex = i;
      bestInMid = [mx, my, mz];
    }
  }
  if (bestInIndex >= 0) {
    return { slotIndex: bestInIndex, needsAim: false, midPoint: bestInMid };
  }
  if (bestAnyIndex >= 0) {
    return { slotIndex: bestAnyIndex, needsAim: true, midPoint: bestAnyMid };
  }
  return null;
}

/**
 * 地面档 aim 目标机位（M3.6-1，决策 A1）：反转轨道范式（target 固定原点）
 * 下 lookAt 原点即正对轨迹中点——机位 = −normalize(mid) × 当前轨道半径。
 */
export function groundAimPosition(
  midPoint: readonly [number, number, number],
  radiusUnits: number
): [number, number, number] {
  const len = Math.hypot(midPoint[0], midPoint[1], midPoint[2]);
  if (!(len > 0) || !(radiusUnits > 0)) {
    throw new RangeError(`轨迹中点不可为原点且半径必须为正，收到 |mid|=${len}, r=${radiusUnits}`);
  }
  return [
    (-midPoint[0] / len) * radiusUnits,
    (-midPoint[1] / len) * radiusUnits,
    (-midPoint[2] / len) * radiusUnits,
  ];
}

/**
 * 太空档 aim 目标机位（M3.6-1，决策 A1）：相机在 target 与轨迹中点连线的
 * 延长线外侧——lookAt target 时中点居中偏后。
 * 机位 = target + normalize(target − mid) × 当前距离。
 */
export function spaceAimPosition(
  midPoint: readonly [number, number, number],
  targetUnits: readonly [number, number, number],
  distUnits: number
): [number, number, number] {
  const dx = targetUnits[0] - midPoint[0];
  const dy = targetUnits[1] - midPoint[1];
  const dz = targetUnits[2] - midPoint[2];
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0) || !(distUnits > 0)) {
    throw new RangeError(`中点不可与 target 重合且距离必须为正，收到 |d|=${len}, dist=${distUnits}`);
  }
  return [
    targetUnits[0] + (dx / len) * distUnits,
    targetUnits[1] + (dy / len) * distUnits,
    targetUnits[2] + (dz / len) * distUnits,
  ];
}

export interface FollowCameraPose {
  /** 相机位置（场景单位 km） */
  position: [number, number, number];
  /** 注视点 = 流星头部（场景单位 km） */
  target: [number, number, number];
}

/**
 * 跟随视角环绕位姿（M3.6-2，契约 C1 签名变更登记——替换 M3.5 的
 * followCameraPose(startPos, dispCoefs, lifetimeSec, velocityDir, elapsedSec)
 * 固定侧后方位姿版本）。
 *
 * 头部 = startPos + velocityDir × evalCubic(dispCoefs, clamp(elapsed, 0,
 * lifetime))——烧尽后钳制在烧尽点（驻留展示余迹，无落地/成坑：彗星质地
 * 流星体在 80–115 km 完全汽化，科学准确性红线）。
 *
 * 以头部为中心、飞行方向 v 为轴建正交坐标系：
 * - n1 = normalize(up×v)（侧向基；up=[0,1,0]，退化 |up×v|<1e-6 时
 *   +X 对 v 正交化兜底）
 * - n2 = v×n1
 * - offset = cosE·(cosA·n1 + sinA·n2) − sinE·v（单位向量）
 * 相机 = 头部 + offset×distance、target 恒为头部。
 * 默认 azimuth=0 / elevation=0 → offset = n1：纯侧视且视线水平
 * （n1 ⊥ up 分量为零，n1 ⊥ v，单测锁定）。
 *
 * @param velocityDir 流星飞行方向（单位向量）
 * @param azimuthRad 环绕方位角（绕 v 轴，360° 无限制）
 * @param elevationRad 环绕仰角（消费侧经 clampFollowElevation 钳制 ±75°）
 * @param distanceKm 相机—头部距离（消费侧经 clampFollowDistance 钳制 [0.6, 6]）
 */
export function followOrbitPose(
  startPos: readonly [number, number, number],
  dispCoefs: readonly [number, number, number],
  lifetimeSec: number,
  velocityDir: readonly [number, number, number],
  elapsedSec: number,
  azimuthRad: number,
  elevationRad: number,
  distanceKm: number
): FollowCameraPose {
  if (!(lifetimeSec > 0)) {
    throw new RangeError(`寿命必须为正，收到 ${lifetimeSec}`);
  }
  if (!(distanceKm > 0)) {
    throw new RangeError(`距离必须为正，收到 ${distanceKm}`);
  }
  const t = Math.min(Math.max(elapsedSec, 0), lifetimeSec);
  const disp = evalCubic(dispCoefs, t);
  const target: [number, number, number] = [
    startPos[0] + velocityDir[0] * disp,
    startPos[1] + velocityDir[1] * disp,
    startPos[2] + velocityDir[2] * disp,
  ];
  // n1 = up×v（up=[0,1,0]）= (vz, 0, −vx)
  let n1x = velocityDir[2];
  let n1y = 0;
  let n1z = -velocityDir[0];
  let n1Len = Math.hypot(n1x, n1y, n1z);
  if (n1Len < 1e-6) {
    // 速度平行铅垂线：+X 对 v 正交化兜底（Gram–Schmidt）
    const dotX = velocityDir[0];
    n1x = 1 - dotX * velocityDir[0];
    n1y = -dotX * velocityDir[1];
    n1z = -dotX * velocityDir[2];
    n1Len = Math.hypot(n1x, n1y, n1z);
  }
  n1x /= n1Len;
  n1y /= n1Len;
  n1z /= n1Len;
  // n2 = v×n1（与 v、n1 构成右手正交基）
  const n2x = velocityDir[1] * n1z - velocityDir[2] * n1y;
  const n2y = velocityDir[2] * n1x - velocityDir[0] * n1z;
  const n2z = velocityDir[0] * n1y - velocityDir[1] * n1x;
  const cosA = Math.cos(azimuthRad);
  const sinA = Math.sin(azimuthRad);
  const cosE = Math.cos(elevationRad);
  const sinE = Math.sin(elevationRad);
  const ox = cosE * (cosA * n1x + sinA * n2x) - sinE * velocityDir[0];
  const oy = cosE * (cosA * n1y + sinA * n2y) - sinE * velocityDir[1];
  const oz = cosE * (cosA * n1z + sinA * n2z) - sinE * velocityDir[2];
  const position: [number, number, number] = [
    target[0] + ox * distanceKm,
    target[1] + oy * distanceKm,
    target[2] + oz * distanceKm,
  ];
  return { position, target };
}

/**
 * 实验室太阳方向（M3.6-3；LabEarth 昼夜 terminator 驱动）：
 * 复用 horizontalFromEquatorial（ra=0、dec=太阳赤纬、lst = 时角 =
 * (clock−12)×15°——ra=0 时 H = LST）→ sceneDirFromAltAz
 * （alt 可为负：历元 ~02:00 太阳深居地平下 → 夜面朝上 + 城市夜灯）。
 *
 * @param clockHours 当地时钟（小时，localClockHours 产物）
 * @param latDeg 观测纬度（度）
 * @param sunDecDeg 太阳赤纬（度；M3.7 契约 C1 增量：可选参数，默认 8 月
 *   中旬 +14°，消费侧按雨历元传 EPOCH_SUN_DECLINATION_DEG）
 * @returns 指向太阳的场景方向单位向量（契约 C5 轴向）
 */
export function labSunDirection(
  clockHours: number,
  latDeg: number,
  sunDecDeg: number = SUN_DECLINATION_MID_AUG_DEG
): [number, number, number] {
  if (!Number.isFinite(clockHours) || !Number.isFinite(latDeg) || !Number.isFinite(sunDecDeg)) {
    throw new RangeError(
      `时钟/纬度/赤纬必须有限，收到 clock=${clockHours}, lat=${latDeg}, dec=${sunDecDeg}`
    );
  }
  const hourAngleRad = (clockHours - 12) * 15 * DEG;
  const altAz = horizontalFromEquatorial(0, sunDecDeg, latDeg, hourAngleRad);
  return sceneDirFromAltAz(altAz);
}

/**
 * 延时摄影条痕跨度补偿（M3.7 决策 A，契约 C2 uLagSpan 默认量的动态覆写
 * 登记——uniform-only，调度公式不变）：≤×10 保持默认 0.15 s（既有观感
 * 零变化）；>×10 线性放大（×60 → 0.9 s）——高倍率下单颗流星真实存续
 * < 数帧，条痕跨度放大为整条飞行路径的"积分成像"（延时摄影相机口径）。
 */
export function timeLapseLagSpanSec(timeScale: number): number {
  if (!Number.isFinite(timeScale) || timeScale <= TIMELAPSE_LAGSPAN_BASE_TIMESCALE) {
    return METEOR_LAG_SPAN_SEC;
  }
  return METEOR_LAG_SPAN_SEC * (timeScale / TIMELAPSE_LAGSPAN_BASE_TIMESCALE);
}

/**
 * 条痕滞后非线性分布（M3.6-4①）：lag = (index/(count−1))^exponent——
 * exponent > 1 时头密尾疏（头部相邻间距 < 尾部，近观条痕连续无颗粒断点）。
 * 端点锁定：index=0 → 0（头）、index=count−1 → 1（尾）；单调递增。
 *
 * @param exponent 非线性指数（默认 1.6，M3.6 决策 E①）
 */
export function trailLag(index: number, count: number, exponent = 1.6): number {
  if (!Number.isInteger(count) || count < 2) {
    throw new RangeError(`顶点数必须为 ≥2 的整数，收到 ${count}`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`下标必须在 [0, ${count - 1}]，收到 ${index}`);
  }
  if (!(exponent > 0)) {
    throw new RangeError(`指数必须为正，收到 ${exponent}`);
  }
  return (index / (count - 1)) ** exponent;
}

/**
 * 倒计时格式化（§M3.5-1）："m:ss"（< 1 h）/ "h:mm:ss"（≥ 1 h）。
 * 秒数向上取整（倒计时口径：剩余 0.5 s 显示 "0:01" 而非 "0:00"）；
 * 负值钳制为 0。
 */
export function formatDurationClock(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    throw new RangeError(`秒数必须有限，收到 ${seconds}`);
  }
  const total = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// ---------------------------------------------------------------------------
// 降级判定（§4.5）
// ---------------------------------------------------------------------------

export interface LabQualityEnv {
  /** window.devicePixelRatio */
  dpr: number;
  /** navigator.userAgent */
  userAgent: string;
  /** screen.width（CSS px） */
  screenWidth: number;
  /** screen.height（CSS px） */
  screenHeight: number;
  /** navigator.deviceMemory（GB，可能缺失） */
  deviceMemoryGb?: number;
}

export type LabQualityTier = 'full' | 'reduced';

/**
 * 实验室画质档判定（§4.5，参数注入便于测试）
 *
 * 启发式（任一命中即 reduced）：
 * - UA 含移动端标识（Android/iPhone/iPad/iPod/Mobile）
 * - 屏幕短边 < 768 CSS px（小屏设备）
 * - deviceMemory ≤ 4 GB（低内存设备，缺失时不参与判定）
 * - DPR ≥ 3 且屏幕短边 < 1024（高密度小屏，像素总量爆炸）
 */
export function labQualityTier(env: LabQualityEnv): LabQualityTier {
  const shortSide = Math.min(env.screenWidth, env.screenHeight);
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(env.userAgent)) return 'reduced';
  if (shortSide < 768) return 'reduced';
  if (env.deviceMemoryGb !== undefined && env.deviceMemoryGb <= 4) return 'reduced';
  if (env.dpr >= 3 && shortSide < 1024) return 'reduced';
  return 'full';
}
