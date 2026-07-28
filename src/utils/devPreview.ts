/**
 * 开发预览工位注册表（R4-1，IMPROVEMENT_REQUIREMENTS_4 §R4-1）
 *
 * 纯逻辑模块：为 `/dev/preview?body=<id>` 页面提供"天体 id → 细节模型挂载配置"的
 * 查找与调试参数默认值解析。后续 R4 各阶段把新的细节组件通过 `PREVIEW_REGISTRY`
 * 注册进来，预览页据此渲染对应组件、生成调试滑杆。
 *
 * 设计约束（附录 A §3 纯函数先行）：
 * - 本文件不 import React / three，保持纯 TS 可单测（覆盖率 gate ≥90%）。
 * - `componentKey` 为字符串标识，预览页（组件层）据此选择实际的 R3F 组件挂载，
 *   使渲染依赖不污染纯逻辑层，也让预览专用组件可被动态 import（主 bundle 零增大）。
 * - 每个条目声明 ≤8 个调试滑杆（`PreviewParam`）；超过即视为配置错误（`validatePreviewEntry`）。
 */

import {
  BLACKBODY_TEFF_MAX_K,
  BLACKBODY_TEFF_MIN_K,
  FALLBACK_STAR_PARAMS,
  granulationCellScale,
} from '@/utils/starPhysics';

/** 单个天体细节组件可声明的最大调试滑杆数（§R4-1：≤8 个） */
export const MAX_PREVIEW_PARAMS = 8;

/**
 * 调试滑杆声明（组件层据 key 读取当前值经 props/context 注入渲染组件）
 */
export interface PreviewParam {
  /** 参数键（组件内消费，需在同一条目内唯一） */
  key: string;
  /** 面板显示标签 */
  label: string;
  /** 滑杆最小值 */
  min: number;
  /** 滑杆最大值 */
  max: number;
  /** 默认值（须落在 [min,max]） */
  default: number;
  /** 滑杆步进（可选，默认 (max-min)/100） */
  step?: number;
}

/**
 * 预览条目：天体 id 对应的细节模型挂载配置
 */
export interface PreviewEntry {
  /** 天体 id（与 catalog/specialBodies/galaxies 一致） */
  bodyId: string;
  /** 面板标题（人类可读） */
  title: string;
  /** 预览组件标识（预览页据此选择实际 R3F 组件） */
  componentKey: string;
  /** 调试滑杆声明（≤MAX_PREVIEW_PARAMS 个） */
  params: readonly PreviewParam[];
  /** 相机初始距离（场景单位；OrbitControls 起始半径） */
  cameraDistance: number;
  /** 数据/近似来源登记（附录 A §4） */
  dataSource?: string;
}

/**
 * 校验预览条目合法性（注册期防错，纯函数）
 *
 * @throws RangeError 参数数量超限 / 键重复 / min>max / 默认值越界
 */
export function validatePreviewEntry(entry: PreviewEntry): void {
  if (entry.params.length > MAX_PREVIEW_PARAMS) {
    throw new RangeError(
      `预览条目 ${entry.bodyId} 声明了 ${entry.params.length} 个滑杆，超过上限 ${MAX_PREVIEW_PARAMS}`,
    );
  }
  if (!(entry.cameraDistance > 0) || !Number.isFinite(entry.cameraDistance)) {
    throw new RangeError(
      `预览条目 ${entry.bodyId} 的相机距离必须为正有限数，收到 ${entry.cameraDistance}`,
    );
  }
  const seen = new Set<string>();
  for (const p of entry.params) {
    if (seen.has(p.key)) {
      throw new RangeError(`预览条目 ${entry.bodyId} 存在重复参数键 ${p.key}`);
    }
    seen.add(p.key);
    if (!(p.min <= p.max)) {
      throw new RangeError(
        `预览参数 ${entry.bodyId}.${p.key} 的 min(${p.min}) 必须 ≤ max(${p.max})`,
      );
    }
    if (p.default < p.min || p.default > p.max) {
      throw new RangeError(
        `预览参数 ${entry.bodyId}.${p.key} 的默认值 ${p.default} 越界 [${p.min}, ${p.max}]`,
      );
    }
    if (p.step !== undefined && !(p.step > 0)) {
      throw new RangeError(
        `预览参数 ${entry.bodyId}.${p.key} 的步进必须为正数，收到 ${p.step}`,
      );
    }
  }
}

/**
 * 恒星预览条目组（R4-6）：6 类恒星接入物理化 `StellarSurface`
 *
 * 每条目滑杆（§R4-6 指定三件）：Teff 覆写（黑体基色实时重算）/
 * 噪声频率（对流颗粒 uCellScale）/时间流速（虚拟时钟）。
 * 临边昏暗 u / 对流对比 / 边缘偏红由光谱型与主场景档位固定注入
 * （预览页与主场景观感同源）。默认参数取 `FALLBACK_STAR_PARAMS`
 * （与 public/data/star-params.json 烘焙产物同值，starPhysics 单测断言同步）。
 */
export interface StellarPreviewConfig {
  /** FALLBACK_STAR_PARAMS / star-params.json 键名 */
  starKey: string;
  /** 对流对比（与主场景消费组件同值） */
  convection: number;
  /** 色温梯度边缘偏红强度（与主场景消费组件同值） */
  rednessStrength: number;
}

/** 预览 bodyId → 恒星配置（组件层据此挂载 StellarSurface） */
export const STELLAR_PREVIEW_CONFIGS: ReadonlyMap<string, StellarPreviewConfig> =
  new Map([
    ['betelgeuse', { starKey: 'betelgeuse', convection: 0.7, rednessStrength: 0.6 }],
    ['rigel', { starKey: 'rigel', convection: 0.35, rednessStrength: 0 }],
    ['sirius', { starKey: 'siriusA', convection: 0.18, rednessStrength: 0 }],
    ['sirius-b', { starKey: 'siriusB', convection: 0.12, rednessStrength: 0 }],
    ['delta-cephei', { starKey: 'deltaCephei', convection: 0.5, rednessStrength: 0.3 }],
    ['wr-124', { starKey: 'wr124', convection: 0.45, rednessStrength: 0 }],
  ]);

/** 按预览 bodyId 查恒星配置（非恒星条目返回 null） */
export function stellarPreviewConfigForBody(
  id: string | null | undefined,
): StellarPreviewConfig | null {
  if (!id) return null;
  return STELLAR_PREVIEW_CONFIGS.get(id) ?? null;
}

function makeStellarEntry(bodyId: string, title: string, dataSource: string): PreviewEntry {
  const config = STELLAR_PREVIEW_CONFIGS.get(bodyId);
  if (!config) {
    throw new RangeError(`恒星预览条目 ${bodyId} 缺少 STELLAR_PREVIEW_CONFIGS 配置`);
  }
  const star = FALLBACK_STAR_PARAMS[config.starKey];
  return {
    bodyId,
    title,
    componentKey: 'stellar-surface',
    cameraDistance: 3.2,
    params: [
      {
        key: 'teffK',
        label: '有效温度 Teff（K）',
        min: BLACKBODY_TEFF_MIN_K,
        max: BLACKBODY_TEFF_MAX_K,
        default: star.teffK,
        step: 50,
      },
      {
        key: 'cellScale',
        label: '对流噪声频率',
        min: 0.5,
        max: 14,
        default: granulationCellScale(star.radiusRsun),
      },
      { key: 'timeScale', label: '时间流速', min: 0, max: 4, default: 1 },
    ],
    dataSource,
  };
}

const STELLAR_ENTRIES: readonly PreviewEntry[] = [
  makeStellarEntry(
    'betelgeuse',
    '参宿四 Betelgeuse（红超巨星 M1-M2 · StellarSurface）',
    'Joyce et al. (2020)；ESO VLT/SPHERE（Montargès et al. 2021）；Claret (2000) 临边昏暗近似档',
  ),
  makeStellarEntry(
    'rigel',
    '参宿七 Rigel（蓝超巨星 B8Ia · StellarSurface）',
    'Przybilla et al. (2010)；Claret (2000) 临边昏暗近似档',
  ),
  makeStellarEntry(
    'sirius',
    '天狼星 A Sirius A（主序星 A0mA1Va · StellarSurface）',
    'Kervella et al. (2003)；Adelman (2004)；Claret (2000) 临边昏暗近似档',
  ),
  makeStellarEntry(
    'sirius-b',
    '天狼星 B Sirius B（白矮星 DA1.9 · StellarSurface）',
    'Barstow et al. (2005)；Holberg et al. (1998)；Claret (2000) 临边昏暗近似档（WD 档）',
  ),
  makeStellarEntry(
    'delta-cephei',
    '造父一 δ Cephei（黄超巨星 F5Iab · StellarSurface）',
    'Mérand et al. (2005)；Engle et al. (2014)；Claret (2000) 临边昏暗近似档',
  ),
  makeStellarEntry(
    'wr-124',
    'WR 124（沃尔夫-拉叶星 WN8h · StellarSurface）',
    'Hamann et al. (2019)；Claret (2000) 临边昏暗近似档（O 档高温近似）',
  ),
];

/**
 * 体积渲染框架测试体（R4-3 框架检查点 + R4-4 半分辨率/抖动/自适应降级）：
 * 球形 fBm 密度云 raymarch
 *
 * 密度场：`utils/volume.makeSphericalFbmCloudSampler`（96³ R8 纹理）；
 * 材质：`components/Scene/volumetric/VolumeMaterial.ts`。滑杆覆盖
 * 基准步数/密度/吸收/双色（色相 A/B）/亮度 + 质量档强制切换（§R4-4）/
 * 蓝噪声抖动开关（A/B 条带对比）。
 * 登记：R4-3 的「混色阈值」滑杆为容纳 R4-4 两个新滑杆（条目上限 8）而
 * 移除，uThreshold 保持材质默认值 0.45（非核心调参，双色观感由色相覆盖）。
 */
const VOLUME_TEST_ENTRY: PreviewEntry = {
  bodyId: 'volume-test',
  title: '体积测试体 Volume Test（球形 fBm 密度云 · raymarch）',
  componentKey: 'volume-raymarch-test',
  cameraDistance: 3.2,
  params: [
    { key: 'steps', label: '基准步进数', min: 16, max: 128, default: 64, step: 1 },
    { key: 'density', label: '密度倍率', min: 0, max: 6, default: 2.2 },
    { key: 'absorption', label: '吸收系数', min: 0.2, max: 12, default: 5 },
    { key: 'hueA', label: '色相 A（Hα 红）', min: 0, max: 360, default: 352 },
    { key: 'hueB', label: '色相 B（OIII 青绿）', min: 0, max: 360, default: 172 },
    { key: 'intensity', label: '亮度', min: 0.1, max: 4, default: 1.2 },
    { key: 'quality', label: '质量档（0自动 1低 2中 3高）', min: 0, max: 3, default: 0, step: 1 },
    { key: 'jitter', label: '蓝噪声抖动（0关 1开）', min: 0, max: 1, default: 1, step: 1 },
  ],
  dataSource:
    'R4-3/R4-4 框架测试体：程序化 fBm 密度场（无真实观测数据）；双色对应 Hα/OIII 窄带映射方向',
};

/**
 * 猎户座星云 M42 体积化 ①（R4-7，人工目检检查点）：128³ RG 双通道密度场
 * 分帧烘焙 + 双通道 raymarch + Trapezium 四亮星 sprite 内嵌
 *
 * 密度场：`utils/nebulaVolume.makeM42Sampler`（发射 + 吸收双通道，确定性
 * 种子）；材质：`components/Scene/volumetric/NebulaVolumeMaterial.ts`。
 * 滑杆按 §R4-7 指定三件（密度倍率/双色权重/步数）+ 尘埃吸收/亮度/质量档/
 * 抖动（7 个 ≤ 上限 8）。本阶段仅预览页可见，不接主场景（R4-8 范围）。
 */
const ORION_NEBULA_ENTRY: PreviewEntry = {
  bodyId: 'orion-nebula',
  title: '猎户座星云 M42（体积 raymarch · 双通道密度场）',
  componentKey: 'orion-nebula-volume',
  cameraDistance: 3.6,
  params: [
    { key: 'steps', label: '基准步进数', min: 16, max: 128, default: 64, step: 1 },
    { key: 'density', label: '密度倍率', min: 0, max: 8, default: 3.2 },
    { key: 'weightBias', label: '双色权重（−OIII/+Hα）', min: -1, max: 1, default: 0 },
    { key: 'dust', label: '尘埃吸收倍率', min: 0, max: 4, default: 1 },
    { key: 'intensity', label: '亮度', min: 0.1, max: 4, default: 1.3 },
    { key: 'quality', label: '质量档（0自动 1低 2中 3高）', min: 0, max: 3, default: 0, step: 1 },
    { key: 'jitter', label: '蓝噪声抖动（0关 1开）', min: 0, max: 1, default: 1, step: 1 },
  ],
  dataSource:
    'NASA/ESA Hubble 公版图像（形态参考，程序化近似登记：扇贝腔/西北亮弓/东南暗湾/Trapezium 空腔与电离前沿壳）；Hα/OIII 双色权重取纯径向近似',
};

/**
 * 星系近观多分量预览条目组（R4-10）：M31（旋涡，专属倾角/尘埃环/偏黄
 * 核球）+ LMC（不规则对照——dust/HII 新分量配额为 0，R2-8 团块分量
 * 承载，滑杆对 LMC 的 dust/HII 无可见效果属预期登记；倾角覆写生效）。
 *
 * 滑杆按 §R4-10 指定三件：dust 强度 / HII 密度（[0,1] 与形态参数表同域，
 * 经 GalaxyCompositeOverrides 重新生成分量）/ 倾角覆写（0–90°，
 * inclinedOrientationRad 以预览视线 +z 重构姿态）。默认值 = 形态参数表
 * 登记值（GALAXY_MORPHOLOGY_PARAMS，RC3/S4G/NED 近似档）。
 */
export interface GalaxyPreviewConfig {
  /** 数据层星系 id（data/galaxies） */
  galaxyId: string;
  /** 倾角覆写姿态的长轴方位角（度；M31 = PA 38 登记值） */
  positionAngleDeg: number;
}

/** 预览 bodyId → 星系近观配置（组件层据此挂载 GalaxyNearViewLayer） */
export const GALAXY_PREVIEW_CONFIGS: ReadonlyMap<string, GalaxyPreviewConfig> = new Map([
  ['m31', { galaxyId: 'm31', positionAngleDeg: 38 }],
  ['lmc', { galaxyId: 'lmc', positionAngleDeg: 0 }],
]);

/** 按预览 bodyId 查星系近观配置（非星系条目返回 null） */
export function galaxyPreviewConfigForBody(
  id: string | null | undefined,
): GalaxyPreviewConfig | null {
  if (!id) return null;
  return GALAXY_PREVIEW_CONFIGS.get(id) ?? null;
}

const GALAXY_NEAR_VIEW_ENTRIES: readonly PreviewEntry[] = [
  {
    bodyId: 'm31',
    title: '仙女座星系 M31（近观多分量粒子层 · 倾角 77°/10 kpc 尘埃环）',
    componentKey: 'galaxy-near-view',
    cameraDistance: 4.2,
    params: [
      { key: 'dustStrength', label: '尘埃带强度', min: 0, max: 1, default: 0.8 },
      { key: 'hiiDensity', label: 'HII 区密度', min: 0, max: 1, default: 0.5 },
      { key: 'inclinationDeg', label: '倾角覆写（°）', min: 0, max: 90, default: 77, step: 1 },
    ],
    dataSource:
      'RC3（de Vaucouleurs et al. 1991）SA(s)b；S4G（Sheth et al. 2010）B/D 分解近似档；倾角 77°（NED/Walterbos & Kennicutt 1988）；10 kpc 尘埃环（Spitzer/Herschel 观测，环宽/占比为示意档登记）',
  },
  {
    bodyId: 'lmc',
    title: '大麦哲伦云 LMC（近观团块粒子云 · 不规则对照）',
    componentKey: 'galaxy-near-view',
    cameraDistance: 4.2,
    params: [
      { key: 'dustStrength', label: '尘埃带强度（LMC 配额 0，登记）', min: 0, max: 1, default: 0.3 },
      { key: 'hiiDensity', label: 'HII 区密度（LMC 配额 0，登记）', min: 0, max: 1, default: 0.85 },
      { key: 'inclinationDeg', label: '倾角覆写（°）', min: 0, max: 90, default: 35, step: 1 },
    ],
    dataSource:
      'RC3（de Vaucouleurs et al. 1991）SB(s)m；倾角 35°（NED）；HII 粉与蓝白年轻星由 R2-8 团块分量承载（新分量配额 0，R4-9 登记）',
  },
];

/**
 * 黑洞引力透镜 raymarch 原型（R4-11，人工目检检查点）：包围球弯折
 * raymarch——弱场积分核 + 二阶闭式预算 + 解析阴影判据 + 光子环沿程
 * 积累发光，背景采样程序化星场 cubemap（128px/面）。
 *
 * 滑杆按 §R4-11 指定三件：质量尺度（rsWorld = 0.5×massScale，包围球
 * 世界半径 = 7×massScale）/ 相机距离（值变化时相机径向重置；下限受
 * 预览页 OrbitControls minDistance = cameraDistance×0.5 = 4 约束，
 * 配合质量尺度 4 档可推至 ~2 r_s 近光子球距离）/ 步数（16–128）。
 * 本阶段仅预览页可见，不接主场景（R4-13 范围）。
 */
const BLACKHOLE_LENSED_ENTRY: PreviewEntry = {
  bodyId: 'blackhole-test',
  title: '黑洞引力透镜 Black Hole Lensing（raymarch 原型 · 光子环 + 背景弯曲）',
  componentKey: 'blackhole-lensed',
  cameraDistance: 8,
  params: [
    { key: 'massScale', label: '质量尺度', min: 0.3, max: 4, default: 1 },
    { key: 'cameraDistance', label: '相机距离', min: 4, max: 60, default: 8 },
    { key: 'steps', label: '步进数', min: 16, max: 128, default: 64, step: 1 },
  ],
  dataSource:
    'Schwarzschild 二阶 PPN 偏转（Keeton & Petters 2005）+ 解析捕获截面 b_crit=3√3/2·r_s（MTW §25.6）；光子环观感基准 EHT M87*（2019）/Sgr A*（2022）；强场对数发散域以驻留发光高斯核近似（艺术化登记）',
};

/** 体积类预览条目的 componentKey 集（HUD 质量档行按此显隐） */
export const VOLUME_PREVIEW_COMPONENT_KEYS: ReadonlySet<string> = new Set([
  'volume-raymarch-test',
  'orion-nebula-volume',
]);

/**
 * 预览注册表（后续 R4 阶段在此追加条目）
 *
 * 以 Map 存储便于 O(1) 查找；模块加载时对每个条目做一次合法性自检。
 */
export const PREVIEW_REGISTRY: ReadonlyMap<string, PreviewEntry> = (() => {
  const entries: readonly PreviewEntry[] = [
    ...STELLAR_ENTRIES,
    VOLUME_TEST_ENTRY,
    ORION_NEBULA_ENTRY,
    ...GALAXY_NEAR_VIEW_ENTRIES,
    BLACKHOLE_LENSED_ENTRY,
  ];
  const map = new Map<string, PreviewEntry>();
  for (const e of entries) {
    validatePreviewEntry(e);
    map.set(e.bodyId, e);
  }
  return map;
})();

/**
 * 按天体 id 查找预览条目
 *
 * @returns 已注册返回条目；未注册返回 null（预览页显示占位提示）
 */
export function previewEntryForBody(id: string | null | undefined): PreviewEntry | null {
  if (!id) return null;
  return PREVIEW_REGISTRY.get(id) ?? null;
}

/**
 * 取条目全部参数的默认值映射（预览页初始化滑杆状态）
 *
 * 空条目 / null 返回空对象。
 */
export function defaultParamValues(
  entry: PreviewEntry | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!entry) return out;
  for (const p of entry.params) {
    out[p.key] = p.default;
  }
  return out;
}

/**
 * 将输入值钳制到参数声明区间（滑杆输入越界防护，纯函数）
 *
 * 未注册的 key 原样返回输入值（组件层未知参数不干预）。
 */
export function clampParamValue(param: PreviewParam, value: number): number {
  if (!Number.isFinite(value)) return param.default;
  return Math.max(param.min, Math.min(param.max, value));
}

/**
 * 已注册的全部天体 id（预览页占位提示可列出可用对象）
 */
export function registeredPreviewIds(): readonly string[] {
  return Array.from(PREVIEW_REGISTRY.keys());
}
