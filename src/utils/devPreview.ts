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
import {
  BETELGEUSE_SH_AMPLITUDE_DEFAULT,
  BETELGEUSE_SH_EVOLVE_SPEED_DEFAULT,
} from '@/utils/stellarNearView';
import {
  WR124_EXPAND_AMP,
  WR124_SCENE_VOLUME_PARAMS,
} from '@/utils/nebulaVolumeScene';

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
  /**
   * 低阶球谐非对称巨对流胞幅度（R4-18 参宿四专属，与主场景同值；
   * 其余恒星 0 = 关闭，均匀颗粒观感区分）
   */
  shAmplitude: number;
}

/** 预览 bodyId → 恒星配置（组件层据此挂载 StellarSurface） */
export const STELLAR_PREVIEW_CONFIGS: ReadonlyMap<string, StellarPreviewConfig> =
  new Map([
    [
      'betelgeuse',
      {
        starKey: 'betelgeuse',
        convection: 0.7,
        rednessStrength: 0.6,
        shAmplitude: BETELGEUSE_SH_AMPLITUDE_DEFAULT,
      },
    ],
    ['rigel', { starKey: 'rigel', convection: 0.35, rednessStrength: 0, shAmplitude: 0 }],
    ['sirius', { starKey: 'siriusA', convection: 0.18, rednessStrength: 0, shAmplitude: 0 }],
    ['sirius-b', { starKey: 'siriusB', convection: 0.12, rednessStrength: 0, shAmplitude: 0 }],
    [
      'delta-cephei',
      { starKey: 'deltaCephei', convection: 0.5, rednessStrength: 0.3, shAmplitude: 0 },
    ],
    ['wr-124', { starKey: 'wr124', convection: 0.45, rednessStrength: 0, shAmplitude: 0 }],
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
  const params: PreviewParam[] = [
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
  ];
  // R4-18 参宿四专属滑杆：球谐幅度 / 演化速度（§R4-18 第 3 条指定两件）
  if (bodyId === 'betelgeuse') {
    params.push(
      {
        key: 'shAmplitude',
        label: '球谐斑块幅度',
        min: 0,
        max: 1,
        default: BETELGEUSE_SH_AMPLITUDE_DEFAULT,
      },
      {
        key: 'shSpeed',
        label: '球谐演化速度',
        min: 0,
        max: 6,
        default: BETELGEUSE_SH_EVOLVE_SPEED_DEFAULT,
      },
    );
  }
  // R4-20 WR 124 专属滑杆：抛射壳体积（恒星 + M1-67 团块泡沫壳组合预览，
  // 默认值与主场景 WR124_SCENE_VOLUME_PARAMS 同源）
  if (bodyId === 'wr-124') {
    params.push(
      {
        key: 'density',
        label: '抛射壳密度倍率',
        min: 0,
        max: 6,
        default: WR124_SCENE_VOLUME_PARAMS.densityScale,
      },
      {
        key: 'expandAmp',
        label: '径向膨胀幅度',
        min: 0,
        max: 0.4,
        default: WR124_EXPAND_AMP,
      },
    );
  }
  return {
    bodyId,
    title,
    componentKey: 'stellar-surface',
    // R4-20：WR 124 相机外推（抛射壳中面 ≈ 4.2 单位、体积盒半宽 7——
    // 起始视角覆盖恒星 + 完整壳层；其余恒星维持近观 3.2）
    cameraDistance: bodyId === 'wr-124' ? 9 : 3.2,
    params,
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
    'WR 124（沃尔夫-拉叶星 WN8h · StellarSurface + M1-67 抛射壳体积）',
    'Hamann et al. (2019)；Claret (2000) 临边昏暗近似档（O 档高温近似）；M1-67 抛射壳：NASA/ESA Hubble 与 JWST（2023）公版图像观感参考（团块泡沫程序化近似 + v∝r 均匀膨胀流，非逐结贴合照片）',
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
 * 环状星云 M57 壳层体积（R4-14）：96³ RG 双通道密度场分帧烘焙 +
 * 三轴椭球壳 raymarch + 中心白矮星色档 sprite 内嵌
 *
 * 密度场：`utils/nebulaVolume.makeM57Sampler`（三轴椭球壳：赤道增密环 +
 * 极向暗瓣 + 内腔近空 + 外晕弱壳，确定性种子）；配置：
 * `utils/nebulaVolumeScene.m57VolumeLayerConfig`（主场景同源，预览页与
 * 主场景观感一致）。滑杆 6 件（≤8 上限）：步数/密度/双色权重/亮度 +
 * 质量档/抖动；无尘埃滑杆（吸收通道恒零登记）。
 */
const RING_NEBULA_ENTRY: PreviewEntry = {
  bodyId: 'ring-nebula',
  title: '环状星云 M57（壳层体积 raymarch · 三轴椭球壳密度场）',
  componentKey: 'ring-nebula-volume',
  cameraDistance: 3.2,
  params: [
    { key: 'steps', label: '基准步进数', min: 16, max: 128, default: 48, step: 1 },
    { key: 'density', label: '密度倍率', min: 0, max: 6, default: 1.6 },
    { key: 'weightBias', label: '双色权重（−OIII/+Hα）', min: -1, max: 1, default: 0 },
    { key: 'intensity', label: '亮度', min: 0.1, max: 4, default: 1.2 },
    { key: 'quality', label: '质量档（0自动 1低 2中 3高）', min: 0, max: 3, default: 0, step: 1 },
    { key: 'jitter', label: '蓝噪声抖动（0关 1开）', min: 0, max: 1, default: 1, step: 1 },
  ],
  dataSource:
    "O'Dell et al. (2013, ApJ 780, 26) 三轴椭球壳模型（形状参考，程序化近似登记：赤道增密环/极向暗瓣/内腔近空/外晕弱壳）；内缘 OIII 青绿/外缘 Hα+NII 红橙（NII 合并单档）；中心白矮星 Teff≈125 kK 经 blackbodyRGB 表上限 50 kK 档",
};

/**
 * 马头星云 Barnard 33 吸收体积（R4-15）：96³ RG 双通道密度场分帧烘焙 +
 * 吸收为主暗云柱 raymarch + IC 434 红色发射幕（烘焙进体积后半域）
 *
 * 密度场：`utils/nebulaVolume.makeHorseheadSampler`（马头轮廓 5 椭球 SDF
 * 平滑并 + fBm 边缘侵蚀，确定性种子；轮廓内发射近零）；配置：
 * `utils/nebulaVolumeScene.horseheadVolumeLayerConfig`（主场景同源）。
 * 注册 id 登记：§R4-15 指定 `?body=horsehead`（短名），与天体 id
 * `horsehead-nebula`（体积种子/detailLayer bodyId）差异登记。
 * 滑杆 6 件（≤8 上限）：步数/发射幕密度/尘埃吸收/亮度 + 质量档/抖动；
 * 无双色权重滑杆（weightBias 恒 +1 取 Hα 红档，IC 434 单色登记）。
 */
const HORSEHEAD_ENTRY: PreviewEntry = {
  bodyId: 'horsehead',
  title: '马头星云 Barnard 33（吸收体积 raymarch · 暗云柱 + IC 434 发射幕）',
  componentKey: 'horsehead-nebula-volume',
  cameraDistance: 3.4,
  params: [
    { key: 'steps', label: '基准步进数', min: 16, max: 128, default: 48, step: 1 },
    { key: 'density', label: '发射幕密度倍率', min: 0, max: 8, default: 3.0 },
    { key: 'dust', label: '尘埃吸收倍率', min: 0, max: 4, default: 2.2 },
    { key: 'intensity', label: '亮度', min: 0.1, max: 4, default: 1.1 },
    { key: 'quality', label: '质量档（0自动 1低 2中 3高）', min: 0, max: 3, default: 0, step: 1 },
    { key: 'jitter', label: '蓝噪声抖动（0关 1开）', min: 0, max: 1, default: 1, step: 1 },
  ],
  dataSource:
    'NASA/ESA Hubble 公版图像（轮廓形态参考，程序化近似登记：颈柱/头部/吻部/鬃丘 + 底部云堤 5 椭球 SDF 平滑并 + fBm 边缘侵蚀，不逐像素贴合照片）；IC 434 Hα 红色发射幕（低密度大尺度发射层方案登记）',
};

/**
 * 蟹状星云 M1 丝状体积（R4-16）：128³ RG 双通道密度场分帧烘焙 +
 * 丝状网络（12 条参数化曲线骨架沿线增密）+ OIII 青弥散 raymarch +
 * 中心脉冲星蓝白核 sprite 内嵌
 *
 * 密度场：`utils/nebulaVolume.makeCrabSampler`（丝状骨架随机游走折线 +
 * 方向场扭曲密度脊 + 椭球包络，确定性种子；吸收通道恒零）；配置：
 * `utils/nebulaVolumeScene.crabVolumeLayerConfig`（主场景同源）。
 * 登记：预览页仅体积层（PWN 环面/喷流为主场景 PulsarRemnant 近观
 * 组件，形态经主场景截图验收）。滑杆 6 件（≤8 上限）：步数/密度/
 * 双色权重/亮度 + 质量档/抖动；无尘埃滑杆（吸收通道恒零登记）。
 */
const CRAB_NEBULA_ENTRY: PreviewEntry = {
  bodyId: 'crab-pulsar',
  title: '蟹状星云 M1（丝状体积 raymarch · 曲线骨架丝网 + OIII 弥散）',
  componentKey: 'crab-nebula-volume',
  cameraDistance: 3.6,
  params: [
    { key: 'steps', label: '基准步进数', min: 16, max: 128, default: 64, step: 1 },
    { key: 'density', label: '密度倍率', min: 0, max: 8, default: 2.6 },
    { key: 'weightBias', label: '双色权重（−OIII/+Hα）', min: -1, max: 1, default: 0 },
    { key: 'intensity', label: '亮度', min: 0.1, max: 4, default: 1.15 },
    { key: 'quality', label: '质量档（0自动 1低 2中 3高）', min: 0, max: 3, default: 0, step: 1 },
    { key: 'jitter', label: '蓝噪声抖动（0关 1开）', min: 0, max: 1, default: 1, step: 1 },
  ],
  dataSource:
    'NASA/ESA Hubble 公版图像（丝状网络形态参考，程序化近似登记：12 条随机游走曲线骨架沿线增密 + 方向场扭曲，非逐丝贴合照片）；Chandra（Weisskopf et al. 2000）PWN 环面/喷流形态参考（主场景 shader 发射体，预览页仅体积层登记）；外围 Hα 红橙丝/内部 OIII 青弥散按内外分区径向近似',
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
 * 黑洞引力透镜 raymarch（R4-11 原型 + R4-12 吸积盘，人工目检检查点）：
 * 包围球弯折 raymarch——弱场积分核 + 二阶闭式预算 + 解析阴影判据 +
 * 光子环沿程积累发光 + 薄盘求交（温度黑体色/多普勒束流/引力红移/
 * 差速条纹），背景采样程序化星场 cubemap（128px/面）。
 *
 * 滑杆 7 件（≤8 上限）：§R4-11 三件——质量尺度（rsWorld = 0.5×massScale，
 * 包围球世界半径 = 7×massScale）/ 相机距离（值变化时相机径向重置；下限受
 * 预览页 OrbitControls minDistance = cameraDistance×0.5 = 4 约束，
 * 配合质量尺度 4 档可推至 ~2 r_s 近光子球距离）/ 步数（16–128）；
 * §R4-12 四件——盘倾角（0°=正视 face-on / 90°=侧视 edge-on）/ 盘内缘
 * （ISCO 档默认 3 r_s）/ 盘外缘（默认 12 r_s，经 clampDiskRadii 防交叉）/
 * 束流强度（δ 指数：0 关闭、1 物理档 δ³、2 夸大）。
 * 本阶段仅预览页可见，不接主场景（R4-13 范围）。
 */
const BLACKHOLE_LENSED_ENTRY: PreviewEntry = {
  bodyId: 'blackhole-test',
  title: '黑洞引力透镜 Black Hole Lensing（光子环 + 背景弯曲 + 吸积盘翻折像）',
  componentKey: 'blackhole-lensed',
  cameraDistance: 8,
  params: [
    { key: 'massScale', label: '质量尺度', min: 0.3, max: 4, default: 1 },
    { key: 'cameraDistance', label: '相机距离', min: 4, max: 60, default: 8 },
    { key: 'steps', label: '步进数', min: 16, max: 128, default: 64, step: 1 },
    { key: 'diskInclDeg', label: '盘倾角（°，0=正视/90=侧视）', min: 0, max: 90, default: 75, step: 1 },
    { key: 'diskInnerRs', label: '盘内缘（r_s）', min: 2, max: 6, default: 3 },
    { key: 'diskOuterRs', label: '盘外缘（r_s）', min: 6, max: 13, default: 12 },
    { key: 'beamStrength', label: '束流强度', min: 0, max: 2, default: 1 },
  ],
  dataSource:
    'Schwarzschild 二阶 PPN 偏转（Keeton & Petters 2005）+ 解析捕获截面 b_crit=3√3/2·r_s（MTW §25.6）；吸积盘 T∝r^(−3/4)（Novikov-Thorne/Shakura-Sunyaev 薄盘近似，内缘截断）+ 多普勒束流 δ³ + 引力红移 √(1−r_s/r)（峰值温度压标至可视化档登记）；观感基准 EHT M87*（2019）/Sgr A*（2022）与 Interstellar 盘翻折像；强场对数发散域以驻留发光高斯核近似（艺术化登记）',
};

/**
 * 昴星团 Gaia 真实星表（R4-17）：pleiades.json 600 颗成员星真实 3D 位置
 * + B−V→blackbodyRGB 颜色 + 视星等→粒径/亮度 + 9 颗命名亮星星芒（悬停
 * 星名）+ Merope/Maia/Alcyone/Electra 蓝色反射星云分层 sprite。
 *
 * 滑杆 3 件（≤8 上限）：粒径增益/星芒尺寸/反射星云强度（帧读 getter 直
 * 达 uniform，无材质重建）。数据未就绪/失败显示降级占位（主场景降级为
 * 程序化分布，utils/pleiadesCatalog 文件头登记）。
 */
const PLEIADES_ENTRY: PreviewEntry = {
  bodyId: 'pleiades',
  title: '昴星团 M45（Gaia DR3 真实成员星 + 蓝色反射星云）',
  componentKey: 'pleiades-catalog',
  cameraDistance: 4.5,
  params: [
    { key: 'sizeGain', label: '粒径增益', min: 0.3, max: 3, default: 1 },
    { key: 'spikeGain', label: '星芒尺寸', min: 0, max: 2, default: 1 },
    { key: 'nebulaStrength', label: '反射星云强度', min: 0, max: 2, default: 1 },
  ],
  dataSource:
    'Gaia DR3（ESA Archive，选星判据见 pleiades.json meta：锥形检索 2.5° + 视差 7.0–7.7 mas + 自行共动，按 G 取最亮 600 颗）；B−V→Teff 取 Ballesteros (2012) 黑体近似；命名星天测 SIMBAD（Gaia 缺失的最亮 5 颗径向取簇质心距离合成，登记）；反射星云为分层 sprite 艺术化近似（蓝色散射色调）',
};

/**
 * M13 球状星团 King 分布（R4-19）：King (1966) profile 逆变换采样（64 点
 * 数值反查表）替代均匀分布 + HR 图两档颜色（红黄老年星族 ~90% + 蓝离散/
 * 水平支 ~10%）→ blackbodyRGB。远观 420 粒 + 近观 +1,200 粒两级均接新
 * 分布（总预算不变）。数据未就绪/失败显示降级占位（主场景降级为现状
 * rand² 程序化分布，utils/m13Cluster 文件头登记）。
 *
 * 滑杆 2 件：粒径增益/亮度增益（帧读 getter 直达材质标量，无材质重建）。
 */
const M13_ENTRY: PreviewEntry = {
  bodyId: 'm13',
  title: 'M13 武仙座球状星团（King 分布 + HR 图颜色）',
  componentKey: 'm13-king-cluster',
  cameraDistance: 4,
  params: [
    { key: 'sizeGain', label: '粒径增益', min: 0.3, max: 3, default: 1 },
    { key: 'brightnessGain', label: '亮度增益', min: 0.2, max: 2, default: 1 },
  ],
  dataSource:
    'Harris (1996, AJ 112, 1487; 2010 版) 球状星团目录 NGC 6205（核半径 0.62′/潮汐半径 21.01′/浓度 c=1.53/距离 7.1 kpc，m13-profile.json 烘焙产物）；King (1962/1966) 三维密度解析去投影式逆变换采样（64 点数值反查表，半质量半径 ≈0.121 r_t）；HR 颜色两档近似登记：老年红黄星族 90%（Teff 3.9–5.8 kK，u² 偏冷端）+ 蓝离散星/水平支蓝端 10%（7.5–10.5 kK）→ blackbodyRGB（R4-6 复用）',
};

/**
 * 类星体 3C 273 近观（R4-21）：吸积盘（R4-12 盘着色非透镜简化版——温度
 * 剖面黑体色 + 多普勒束流 δ³ + 引力红移，透镜 raymarch 不启用登记）+
 * BLR 弥散辉光过渡层 + 尘埃环面粒子环（小型体积/粒子环二选一取粒子环，
 * 登记见 utils/quasarNearView 文件头）+ 双向相对论喷流（既有复用）。
 *
 * 滑杆 4 件（≤8 上限）：束流强度（δ 指数：0 关闭、1 物理档 δ³、2 夸大）/
 * 盘亮度/尘埃环面亮度/时间流速（盘差速条纹 + 光变闪烁联动虚拟时钟）。
 */
const QUASAR_ENTRY: PreviewEntry = {
  bodyId: 'quasar-3c273',
  title: '类星体 3C 273（近观吸积盘 + BLR 辉光 + 尘埃环面 + 喷流）',
  componentKey: 'quasar-near-view',
  cameraDistance: 6,
  params: [
    { key: 'beamStrength', label: '束流强度', min: 0, max: 2, default: 1 },
    { key: 'diskGain', label: '盘亮度', min: 0.1, max: 3, default: 1 },
    { key: 'torusGain', label: '尘埃环面亮度', min: 0, max: 2, default: 1 },
    { key: 'timeScale', label: '时间流速', min: 0, max: 4, default: 1 },
  ],
  dataSource:
    '吸积盘 T∝r^(−3/4)（Novikov-Thorne/Shakura-Sunyaev 薄盘近似）+ 多普勒束流 δ³ + 引力红移 √(1−r_s/r)（R4-12 复用；透镜 raymarch 不启用登记）；峰值色温压标 12,000 K（3C 273 真实"大蓝包"~10⁴–10⁵ K）；尘埃环面取 AGN 统一模型（Urry & Padovani 1995）粒子环近似（暗红棕艺术化档）；盘/BLR/环面尺度比例为可视化档（真实跨 3–5 量级）',
};

/**
 * 触须星系 N-body 烘焙潮汐尾近观（R4-22）：antennae.bin 快照（两核 +
 * 双潮汐尾测试粒子）随虚拟时钟映射的 simDays 快照插值演化。
 *
 * 滑杆 2 件（≤8 上限）：时间流速（1 秒 = 30 Myr 基准，加速目验演化
 * 与插值连续性）/粒径增益（帧读 getter 直达 uniform，无材质重建）。
 * 数据未就绪/失败显示降级占位（主场景降级为现状静态渲染，登记）。
 */
const ANTENNAE_ENTRY: PreviewEntry = {
  bodyId: 'antennae',
  title: '触须星系 NGC 4038/4039（N-body 烘焙潮汐尾）',
  componentKey: 'antennae-near-view',
  cameraDistance: 7,
  params: [
    { key: 'timeScale', label: '时间流速', min: 0, max: 8, default: 1 },
    { key: 'sizeGain', label: '粒径增益', min: 0.3, max: 3, default: 1 },
  ],
  dataSource:
    'Toomre & Toomre (1972, ApJ 178, 623) 潮汐相互作用图景：受限三体/测试粒子模拟离线烘焙（两 Plummer 软化质心抛物线交会 + 各 2,796 粒顺行盘、倾角 60°、RK4 定步长积分，10 快照；参数登记 scripts/bake-data/antennae.ts）；T&T 原文 Antennae 用 e≈0.5 椭圆、此处按需求取抛物线登记；快照全程 ↔ 600 Myr（三角波往返映射保证插值连续，登记）；双盘暖橙/冷蓝配色为区分尾源盘的艺术化强调档',
};

/**
 * 透镜星系团屏幕空间引力透镜（R4-23）：postprocessing 自定义 Effect
 * （方案 a 登记，ClusterLensingEffect.tsx）——SIS 模型偏转屏幕 UV，
 * 预览场景放置团块光晕 + 确定性背景源 sprite，绕行/滑杆目验背景被
 * 拉伸成切向弧/部分爱因斯坦环。
 *
 * 滑杆 3 件（≤8 上限）：爱因斯坦半径（预览场景单位，帧写持有者）/
 * 透镜强度（0 关闭对照）/背景源亮度。Effect 由预览 harness 挂入
 * EffectComposer（Bloom/ToneMapping 之前），与主场景同一 Effect 实现。
 */
const CLUSTER_LENSING_ENTRY: PreviewEntry = {
  bodyId: 'cluster-lensing',
  title: '星系团引力透镜（SIS 屏幕空间折射 · 原型 Abell 370）',
  componentKey: 'cluster-lensing-effect',
  cameraDistance: 8,
  params: [
    { key: 'einsteinRadius', label: '爱因斯坦半径（场景单位）', min: 0.5, max: 4, default: 2 },
    { key: 'strength', label: '透镜强度', min: 0, max: 1, default: 1 },
    { key: 'sourceGain', label: '背景源亮度', min: 0, max: 2, default: 1 },
  ],
  dataSource:
    'SIS 奇异等温球透镜方程 β = θ − θ_E·θ̂（Narayan & Bartelmann 1996 §3.1；Schneider, Ehlers & Falco 1992），屏幕空间 UV 重采样近似（仅对团块之后背景严格成立，前景同被偏移登记）；原型 Abell 370（真实 θ_E ≈ 30″–40″，此处压缩至近观十几度可视化档登记）；影响域窗为实现性裁剪（真实 SIS 偏转全域恒为 θ_E）',
};

/** 体积类预览条目的 componentKey 集（HUD 质量档行按此显隐） */
export const VOLUME_PREVIEW_COMPONENT_KEYS: ReadonlySet<string> = new Set([
  'volume-raymarch-test',
  'orion-nebula-volume',
  'ring-nebula-volume',
  'horsehead-nebula-volume',
  'crab-nebula-volume',
]);

/**
 * 条目是否含体积层（HUD 体积质量档行显隐；R4-20：wr-124 为
 * stellar-surface 组合抛射壳体积的特例登记）
 */
export function previewHasVolumeLayer(entry: PreviewEntry | null | undefined): boolean {
  if (!entry) return false;
  return VOLUME_PREVIEW_COMPONENT_KEYS.has(entry.componentKey) || entry.bodyId === 'wr-124';
}

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
    RING_NEBULA_ENTRY,
    HORSEHEAD_ENTRY,
    CRAB_NEBULA_ENTRY,
    ...GALAXY_NEAR_VIEW_ENTRIES,
    BLACKHOLE_LENSED_ENTRY,
    PLEIADES_ENTRY,
    M13_ENTRY,
    QUASAR_ENTRY,
    ANTENNAE_ENTRY,
    CLUSTER_LENSING_ENTRY,
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
