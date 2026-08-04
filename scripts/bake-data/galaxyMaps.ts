/**
 * R5-1 星系影像烘焙（IMPROVEMENT_REQUIREMENTS_5 §R5-1 A / §0.3 方案 E）
 *
 * 输入：scripts/bake-data/assets/galaxy-images/*.png（DSS2 彩色合成公版
 * 影像，来源/授权/下载 URL 登记见同目录 README.md；源图不进 public/）。
 * 输出：public/data/galaxy-maps/<id>-{density,color,dust,sprite}.png + <id>-meta.json
 *   - density 256²：亮度提取 + 前景星去除 + 污染源遮罩 + 归一化
 *   - color   256²：色调归一化（亮度除法 + 饱和度档）
 *   - dust    256²：暗带遮罩（相对局部平滑亮度的暗缺损，供 R5-2 体积消光）
 *   - sprite  512px：远景贴图（alpha 羽化 + 4bit 量化压缩档）
 *
 * M31 反投影登记（§R5-1 A）：77° 倾角/PA 38° 反投影到盘面坐标（薄盘
 * 短轴 1/cos i 拉伸 + 核球径向缓和，方法登记见 galaxyMapsCore.ts 文件头），
 * 残差 = 盘环带流量加权轴比（meta 登记）。M33/LMC/SMC 不反投影（M33 56°
 * 倾角为登记值——近观粒子层姿态仍由 id 哈希承载现状；不规则星系密度图
 * 直接驱动团块分布，无旋臂模型，登记）。
 *
 * 幂等性：产物为已提交源图的纯函数（retrievedAt 取自配置常量），
 * 两次运行逐字节一致。自校验失败退出非零。
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './pngCodec.ts';
import {
  annulusAxisRatio,
  buildDustMask,
  buildSpriteRgba,
  cropMapFn,
  deprojectMapFn,
  estimateBorderBackground,
  maskContaminants,
  normalizeColorTint,
  normalizeDensity,
  removeForegroundStars,
  resampleRegion,
  rgbToLuma,
  skyToPixel,
  type DustMaskOptions,
  type PixelMaskCircle,
  type SpriteOptions,
} from './galaxyMapsCore.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = join(SCRIPT_DIR, 'assets', 'galaxy-images');
const OUT_DIR = join(SCRIPT_DIR, '..', '..', 'public', 'data', 'galaxy-maps');

/** 权重图边长（§R5-1：256×256） */
export const GALAXY_MAP_SIZE = 256;

/** 远景贴图边长（§R5-1：512px） */
export const GALAXY_SPRITE_SIZE = 512;

/** 单星系全部产物上限（§R5-1：≤600 KB） */
export const PER_GALAXY_BYTE_LIMIT = 600 * 1024;

/** 影像检索时间（幂等性：写入 meta 的固定常量，非运行时时钟） */
const RETRIEVED_AT = '2026-07-30T00:00:00Z';

const SOURCE =
  'DSS2 彩色合成（STScI Digitized Sky Survey 2，HiPS CDS/P/DSS2/color），经 CDS hips2fits 服务切取';
const LICENSE =
  'DSS 基于 AAO/ROE/Caltech 摄影底片数字化数据（© AAO/ROE/Caltech/STScI），许可科学与教育用途使用并要求署名；仅分发烘焙产物（权重图/贴图），源图不随构建分发';
const CREDIT = 'STScI Digitized Sky Survey / AAO / ROE / Caltech；hips2fits (CDS, Strasbourg)';

const HIPS2FITS_BASE =
  'https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&format=png&projection=TAN&width=1024&height=1024';

/** 光年每度（小角度近似：θ[rad]×d） */
function lyPerDeg(distanceLy: number): number {
  return (Math.PI / 180) * distanceLy;
}

interface SkyMask {
  /** 遮罩对象名（登记用） */
  name: string;
  raDeg: number;
  decDeg: number;
  radiusArcmin: number;
}

interface GalaxyImageBakeConfig {
  id: string;
  nameZh: string;
  sourceFile: string;
  sourceUrl: string;
  /** 源图视场（度；1024²，北上东左，目标居中） */
  fovDeg: number;
  centerRaDeg: number;
  centerDecDeg: number;
  /** 星系距离（光年；mapRadiusLy 换算用，NED 登记值） */
  distanceLy: number;
  /** 裁剪半径（度；密度/颜色/尘埃与贴图共用视域） */
  cropRadiusDeg: number;
  /** 盘面倾角（度；仅 deproject=true 时驱动反投影，否则登记值） */
  inclinationDeg: number;
  positionAngleDeg: number;
  deproject: boolean;
  /** 核球径向缓和（deproject=true 时生效） */
  bulgeInner01: number;
  bulgeOuter01: number;
  /** 密度归一 gamma（<1 抬升暗弱旋臂） */
  densityGamma: number;
  masks: readonly SkyMask[];
  dust: DustMaskOptions;
  sprite: SpriteOptions;
}

/** 前景星去除参数（四星系共用：DSS2 点源 FWHM ≲2px 档） */
const STAR_REMOVAL = { radius: 2, contrastFactor: 1.32, contrastBias: 13 };

/** 色调归一化参数（四星系共用观感档：低 pad + 高饱和增强星族色分层，
 * 目验调参登记——pad 26/sat 1.45 档色调近白，加性混合下星族色不可辨） */
const COLOR_TINT = { pad: 12, saturationBoost: 2.0, gain: 0.88 };

const SPRITE_DEFAULTS: SpriteOptions = {
  alphaPercentile: 0.985,
  alphaFloorPercentile: 0.55,
  alphaGamma: 0.7,
  rgbGain: 1.12,
  featherStart01: 0.78,
  quantizeLevels: 16,
};

/** 密度图噪声地板（p99.5 归一后 5% 以下归零，外围天光噪声不布点） */
const DENSITY_FLOOR_01 = 0.05;

const DUST_DEFAULTS: DustMaskOptions = {
  blurRadiusPx: 10,
  minSignal01: 0.05,
  normalizePercentile: 0.995,
};

/**
 * 四星系烘焙配置（§0.4 数据源：距离/倾角/PA 为 NED/RC3 登记值；
 * cropRadiusDeg 对齐光学等照度半径 + 少量裕量，换算出的 mapRadiusLy
 * 与 R2-8 近观参数化半径同量级——过渡尺度一致）。
 */
export const GALAXY_IMAGE_BAKE_CONFIGS: readonly GalaxyImageBakeConfig[] = [
  {
    id: 'm31',
    nameZh: '仙女座星系',
    sourceFile: 'm31-dss2.png',
    sourceUrl: `${HIPS2FITS_BASE}&object=M31&fov=4.0`,
    fovDeg: 4.0,
    centerRaDeg: 10.6847,
    centerDecDeg: 41.2687,
    distanceLy: 2537000,
    cropRadiusDeg: 1.7,
    inclinationDeg: 77,
    positionAngleDeg: 38,
    deproject: true,
    bulgeInner01: 0.1,
    bulgeOuter01: 0.3,
    densityGamma: 0.8,
    masks: [
      // 伴系为应用内独立天体，自 M31 图中移除（README 登记）
      { name: 'M32', raDeg: 10.6743, decDeg: 40.8652, radiusArcmin: 10 },
      { name: 'M110', raDeg: 10.0921, decDeg: 41.6853, radiusArcmin: 14 },
      // 亮前景星 ν And（V=4.5，halo 延展，点源去除不覆盖）
      { name: 'nu And', raDeg: 12.4535, decDeg: 41.0787, radiusArcmin: 9 },
    ],
    dust: DUST_DEFAULTS,
    sprite: SPRITE_DEFAULTS,
  },
  {
    id: 'm33',
    nameZh: '三角座星系',
    sourceFile: 'm33-dss2.png',
    sourceUrl: `${HIPS2FITS_BASE}&object=M33&fov=1.5`,
    fovDeg: 1.5,
    centerRaDeg: 23.4621,
    centerDecDeg: 30.6599,
    distanceLy: 2730000,
    cropRadiusDeg: 0.62,
    inclinationDeg: 56,
    positionAngleDeg: 23,
    deproject: false,
    bulgeInner01: 0,
    bulgeOuter01: 0,
    densityGamma: 0.8,
    masks: [],
    dust: DUST_DEFAULTS,
    sprite: SPRITE_DEFAULTS,
  },
  {
    id: 'lmc',
    nameZh: '大麦哲伦云',
    sourceFile: 'lmc-dss2.png',
    sourceUrl: `${HIPS2FITS_BASE}&object=LMC&fov=12.0`,
    fovDeg: 12.0,
    centerRaDeg: 80.8942,
    centerDecDeg: -69.7561,
    distanceLy: 163000,
    cropRadiusDeg: 5.5,
    inclinationDeg: 35,
    positionAngleDeg: 0,
    deproject: false,
    bulgeInner01: 0,
    bulgeOuter01: 0,
    densityGamma: 0.85,
    masks: [],
    dust: DUST_DEFAULTS,
    sprite: SPRITE_DEFAULTS,
  },
  {
    id: 'smc',
    nameZh: '小麦哲伦云',
    sourceFile: 'smc-dss2.png',
    sourceUrl: `${HIPS2FITS_BASE}&object=SMC&fov=6.0`,
    fovDeg: 6.0,
    centerRaDeg: 13.1583,
    centerDecDeg: -72.8003,
    distanceLy: 200000,
    cropRadiusDeg: 2.9,
    inclinationDeg: 62,
    positionAngleDeg: 45,
    deproject: false,
    bulgeInner01: 0,
    bulgeOuter01: 0,
    densityGamma: 0.85,
    masks: [
      // 银河系前景球状星团（README 登记）
      { name: 'NGC 104 (47 Tuc)', raDeg: 6.0224, decDeg: -72.0814, radiusArcmin: 28 },
      { name: 'NGC 362', raDeg: 15.8094, decDeg: -70.8489, radiusArcmin: 13 },
    ],
    dust: DUST_DEFAULTS,
    sprite: SPRITE_DEFAULTS,
  },
];

function fail(message: string): never {
  console.error(`[bake-data] galaxy-maps 自校验失败：${message}`);
  process.exit(1);
}

function assertBake(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

export interface GalaxyMapsBakeResult {
  /** [文件名, 字节数] 列表（index.ts 总量核算用） */
  sizes: Array<[string, number]>;
}

/** 单星系烘焙（返回产物文件与字节数） */
function bakeOne(cfg: GalaxyImageBakeConfig): Array<[string, number]> {
  const source = decodePng(readFileSync(join(ASSET_DIR, cfg.sourceFile)));
  assertBake(
    source.width === 1024 && source.height === 1024,
    `${cfg.id} 源图应为 1024²，实际 ${source.width}×${source.height}`,
  );
  const frame = {
    centerRaDeg: cfg.centerRaDeg,
    centerDecDeg: cfg.centerDecDeg,
    fovDeg: cfg.fovDeg,
    sizePx: source.width,
  };
  const degPerPx = cfg.fovDeg / source.width;

  // 1) 前景星去除 → 2) 污染源遮罩（天球坐标 → 像素圆）
  const starless = removeForegroundStars(source, STAR_REMOVAL);
  const maskCircles: PixelMaskCircle[] = cfg.masks.map((m) => {
    const p = skyToPixel(m.raDeg, m.decDeg, frame);
    return { x: p.x, y: p.y, radiusPx: m.radiusArcmin / 60 / degPerPx };
  });
  const cleaned = maskContaminants(starless, maskCircles);

  // 3) 背景扣除基准（边框中值）
  const bg = estimateBorderBackground(cleaned, 0.03);

  // 4) 几何重采样：密度/颜色/尘埃（M31 反投影；其余中心裁剪）
  const cropRadiusPx = cfg.cropRadiusDeg / degPerPx;
  const cx = source.width / 2;
  const cy = source.height / 2;
  const mapFn = cfg.deproject
    ? deprojectMapFn({
        cx,
        cy,
        radiusPx: cropRadiusPx,
        inclinationDeg: cfg.inclinationDeg,
        positionAngleDeg: cfg.positionAngleDeg,
        bulgeInner01: cfg.bulgeInner01,
        bulgeOuter01: cfg.bulgeOuter01,
      })
    : cropMapFn(cx, cy, cropRadiusPx);
  const map256 = resampleRegion(cleaned, mapFn, GALAXY_MAP_SIZE, 4, bg);
  const luma = rgbToLuma(map256.rgb, GALAXY_MAP_SIZE);
  const density = normalizeDensity(luma, cfg.densityGamma, DENSITY_FLOOR_01);
  const color = normalizeColorTint(map256.rgb, GALAXY_MAP_SIZE, COLOR_TINT);
  const dust = buildDustMask(luma, cfg.dust);

  // 5) 远景贴图（天空投影原始形态：与远观 billboard 观感一致，不反投影）
  const sprite512 = resampleRegion(
    cleaned,
    cropMapFn(cx, cy, cropRadiusPx),
    GALAXY_SPRITE_SIZE,
    3,
    bg,
  );
  const sprite = buildSpriteRgba(sprite512.rgb, GALAXY_SPRITE_SIZE, cfg.sprite);

  // 6) 自校验（数值域/覆盖率/羽化边缘/中心信号）
  let covered = 0;
  for (let i = 0; i < density.length; i += 1) {
    if (density[i] > 25) covered += 1;
  }
  assertBake(
    covered / density.length > 0.03,
    `${cfg.id} 密度图有效覆盖率 ${(covered / density.length) * 100}% 过低`,
  );
  const centerIdx = (GALAXY_MAP_SIZE / 2) * GALAXY_MAP_SIZE + GALAXY_MAP_SIZE / 2;
  assertBake(density[centerIdx] > 40, `${cfg.id} 密度图中心信号 ${density[centerIdx]} 过低`);
  assertBake(sprite[3] === 0, `${cfg.id} 贴图左上角 alpha 应羽化归零`);
  assertBake(
    sprite[(GALAXY_SPRITE_SIZE * GALAXY_SPRITE_SIZE - 1) * 4 + 3] === 0,
    `${cfg.id} 贴图右下角 alpha 应羽化归零`,
  );

  // 7) 反投影残差登记（盘环带流量加权轴比，理想圆盘 ≈1）
  const residualAxisRatio = cfg.deproject
    ? Math.round(annulusAxisRatio(density, GALAXY_MAP_SIZE, 0.45, 0.9) * 1000) / 1000
    : null;
  if (residualAxisRatio !== null) {
    assertBake(
      residualAxisRatio > 0.4 && residualAxisRatio < 1.4,
      `${cfg.id} 反投影残差轴比 ${residualAxisRatio} 超出健全域 [0.4, 1.4]`,
    );
  }

  // 8) 写产物
  mkdirSync(OUT_DIR, { recursive: true });
  const mapRadiusLy = Math.round(cfg.cropRadiusDeg * lyPerDeg(cfg.distanceLy));
  const files: Array<[string, Uint8Array | string]> = [
    [
      `${cfg.id}-density.png`,
      encodePng({ width: GALAXY_MAP_SIZE, height: GALAXY_MAP_SIZE, channels: 1, data: density }),
    ],
    [
      `${cfg.id}-color.png`,
      encodePng({ width: GALAXY_MAP_SIZE, height: GALAXY_MAP_SIZE, channels: 3, data: color }),
    ],
    [
      `${cfg.id}-dust.png`,
      encodePng({ width: GALAXY_MAP_SIZE, height: GALAXY_MAP_SIZE, channels: 1, data: dust }),
    ],
    [
      `${cfg.id}-sprite.png`,
      encodePng({
        width: GALAXY_SPRITE_SIZE,
        height: GALAXY_SPRITE_SIZE,
        channels: 4,
        data: sprite,
      }),
    ],
    [
      `${cfg.id}-meta.json`,
      `${JSON.stringify(
        {
          meta: { source: SOURCE, retrievedAt: RETRIEVED_AT, license: LICENSE, count: 4 },
          id: cfg.id,
          nameZh: cfg.nameZh,
          credit: CREDIT,
          sourceUrl: cfg.sourceUrl,
          mapSizePx: GALAXY_MAP_SIZE,
          spriteSizePx: GALAXY_SPRITE_SIZE,
          mapRadiusLy,
          pixelScaleLyPerPx: Math.round(((2 * mapRadiusLy) / GALAXY_MAP_SIZE) * 10) / 10,
          inclinationDeg: cfg.inclinationDeg,
          positionAngleDeg: cfg.positionAngleDeg,
          deprojection: {
            applied: cfg.deproject,
            method: cfg.deproject
              ? '薄盘假设短轴 1/cos i 拉伸（倾角 77°/PA 38°）+ 核球径向缓和（r01 0.1→0.3 smoothstep，球状核球不拉伸）；残差 = 盘环带（r01 0.45–0.9）流量加权二阶矩轴比（理想圆盘 ≈1）'
              : '未反投影（M33 倾角为登记值——近观姿态由现状承载；不规则星系密度图直接驱动团块分布，无旋臂模型，登记）',
            residualAxisRatio,
          },
          distortionNote:
            '真实数据失真登记（附录 A §3）：前景星去除为局部中值对比钳制（亮星残芯 256² 降采样后不可辨）；伴系/前景球状星团圆形遮罩以宿主径向剖面填充；密度 gamma 压缩抬升暗弱结构（非线性流量标度）；颜色为亮度归一色调（非测光校准色）；盘面外 z 向厚度由参数模型承载（盘面分布真实、垂直分布参数化口径）',
          contaminantMasks: cfg.masks.map((m) => m.name),
        },
        null,
        2,
      )}\n`,
    ],
  ];

  const sizes: Array<[string, number]> = [];
  let totalBytes = 0;
  for (const [name, payload] of files) {
    const path = join(OUT_DIR, name);
    writeFileSync(path, payload);
    const size = statSync(path).size;
    sizes.push([`galaxy-maps/${name}`, size]);
    totalBytes += size;
  }
  assertBake(
    totalBytes <= PER_GALAXY_BYTE_LIMIT,
    `${cfg.id} 产物合计 ${(totalBytes / 1024).toFixed(1)} KB 超出单星系 600 KB 上限`,
  );
  console.log(
    `[bake-data] galaxy-maps/${cfg.id}：${(totalBytes / 1024).toFixed(1)} KB` +
      (residualAxisRatio !== null ? `（反投影残差轴比 ${residualAxisRatio}）` : ''),
  );
  return sizes;
}

/** 烘焙全部四星系影像产物（index.ts 主流程调用） */
export function bakeGalaxyMaps(): GalaxyMapsBakeResult {
  const sizes: Array<[string, number]> = [];
  for (const cfg of GALAXY_IMAGE_BAKE_CONFIGS) {
    sizes.push(...bakeOne(cfg));
  }
  return { sizes };
}
