/**
 * R4-5 烘焙数据运行时加载器：fetch public/data/* + 校验 + 内存缓存
 *
 * 产物由 `npm run bake:data`（scripts/bake-data/）离线生成并随仓库提交，
 * 运行时零外部网络请求（仅同源静态资产 fetch）。
 * 数据来源登记见各产物 meta 字段与 scripts/bake-data/index.ts 文件头
 * （Gaia DR3 / SIMBAD+文献 / Harris 目录，IMPROVEMENT_REQUIREMENTS_4.md §0.4）。
 *
 * R4-22 起支持二进制产物（antennae.bin，Float32 小端；布局/模拟参数登记
 * 见 scripts/bake-data/antennae.ts 文件头，Toomre & Toomre 1972 图景）。
 *
 * 失败语义：网络错误 / HTTP 非 2xx / JSON 解析失败 / 结构或数值域校验失败
 * 一律返回 null，消费方须可降级到现状程序化分布；失败不缓存（允许重试），
 * 成功结果按 URL 缓存（重复调用不重复 fetch）。
 */

export interface BakedMeta {
  source: string;
  retrievedAt: string;
  license: string;
  count: number;
}

/** 昴星团成员星：{x,y,z} 为簇质心系（pc，ICRS 轴向），bv=B−V 色指数，v=V 视星等 */
export interface PleiadesStar {
  id: string;
  x: number;
  y: number;
  z: number;
  bv: number;
  v: number;
}

export interface PleiadesData {
  meta: BakedMeta;
  stars: PleiadesStar[];
}

export interface StarPhysicalParams {
  nameZh: string;
  simbadId: string;
  spectralType: string;
  teffK: number;
  radiusRsun: number;
  luminosityLsun: number;
  ref: string;
}

export interface StarParamsData {
  meta: BakedMeta;
  stars: Record<string, StarPhysicalParams>;
}

export interface M13Profile {
  id: string;
  nameZh: string;
  coreRadiusArcmin: number;
  halfLightRadiusArcmin: number;
  tidalRadiusArcmin: number;
  concentration: number;
  distanceKpc: number;
  integratedVMag: number;
  metallicityFeH: number;
  coreRadiusPc: number;
  tidalRadiusPc: number;
}

export interface M13ProfileData {
  meta: BakedMeta;
  profile: M13Profile;
}

/**
 * 触须星系 N-body 烘焙快照（R4-22；antennae.bin 解析产物）。
 * 坐标为模拟单位（近心距 r_p = 1），场景缩放在消费方进行。
 */
export interface AntennaeSnapshotsData {
  /** 快照数 S（需求域 8–12） */
  snapshotCount: number;
  /** 测试粒子总数 N（两盘合计） */
  particleCount: number;
  /** 前 diskACount 粒属盘 A（NGC 4038），其余属盘 B（NGC 4039） */
  diskACount: number;
  /** 两核位置：快照 s → [Ax,Ay,Az,Bx,By,Bz] 于 cores[s*6..s*6+5] */
  cores: Float32Array;
  /** 粒子位置：快照 s 粒子 i → positions[(s*N+i)*3..+2] */
  positions: Float32Array;
}

/** antennae.bin 魔数（NGC 4038.4039；文件内为 Float32，按 fround 比较） */
export const ANTENNAE_MAGIC = 4038.4039;

/** antennae.bin 版本号 */
export const ANTENNAE_VERSION = 1;

/** star-params.json 必须包含的 6 颗恒星键名（R4-5 需求清单） */
export const STAR_PARAM_KEYS = [
  'betelgeuse',
  'rigel',
  'siriusA',
  'siriusB',
  'deltaCephei',
  'wr124',
] as const;

// ---------------------------------------------------------------------------
// 校验（纯函数，附录 A：数值范围断言 + 无 NaN）
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateMeta(raw: unknown): BakedMeta | null {
  if (!isRecord(raw)) return null;
  const { source, retrievedAt, license, count } = raw;
  if (!isNonEmptyString(source) || !isNonEmptyString(retrievedAt) || !isNonEmptyString(license)) {
    return null;
  }
  if (!isFiniteNumber(count) || count <= 0) return null;
  return { source, retrievedAt, license, count };
}

/** 校验昴星团产物：星数 1–600、坐标模长 ≤30 pc、B−V/V 数值域、无 NaN */
export function validatePleiades(raw: unknown): PleiadesData | null {
  if (!isRecord(raw) || !Array.isArray(raw.stars)) return null;
  const meta = validateMeta(raw.meta);
  if (!meta) return null;
  const stars = raw.stars as unknown[];
  if (stars.length === 0 || stars.length > 600 || stars.length !== meta.count) return null;
  const validated: PleiadesStar[] = [];
  for (const item of stars) {
    if (!isRecord(item)) return null;
    const { id, x, y, z, bv, v } = item;
    if (!isNonEmptyString(id)) return null;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
    if (Math.sqrt(x * x + y * y + z * z) > 30) return null;
    if (!isFiniteNumber(bv) || bv < -0.5 || bv > 3.5) return null;
    if (!isFiniteNumber(v) || v < -2 || v > 20) return null;
    validated.push({ id, x, y, z, bv, v });
  }
  return { meta, stars: validated };
}

/** 校验恒星参数产物：6 颗必备恒星齐全、Teff/半径/光度数值域 */
export function validateStarParams(raw: unknown): StarParamsData | null {
  if (!isRecord(raw) || !isRecord(raw.stars)) return null;
  const meta = validateMeta(raw.meta);
  if (!meta || meta.count !== STAR_PARAM_KEYS.length) return null;
  const stars: Record<string, StarPhysicalParams> = {};
  for (const key of STAR_PARAM_KEYS) {
    const item = raw.stars[key];
    if (!isRecord(item)) return null;
    const { nameZh, simbadId, spectralType, teffK, radiusRsun, luminosityLsun, ref } = item;
    if (
      !isNonEmptyString(nameZh) ||
      !isNonEmptyString(simbadId) ||
      !isNonEmptyString(spectralType) ||
      !isNonEmptyString(ref)
    ) {
      return null;
    }
    if (!isFiniteNumber(teffK) || teffK < 1000 || teffK > 250000) return null;
    if (!isFiniteNumber(radiusRsun) || radiusRsun <= 0) return null;
    if (!isFiniteNumber(luminosityLsun) || luminosityLsun <= 0) return null;
    stars[key] = { nameZh, simbadId, spectralType, teffK, radiusRsun, luminosityLsun, ref };
  }
  return { meta, stars };
}

/** 校验 M13 结构参数产物：核/潮汐半径关系、浓度 c 数值域 */
export function validateM13Profile(raw: unknown): M13ProfileData | null {
  if (!isRecord(raw) || !isRecord(raw.profile)) return null;
  const meta = validateMeta(raw.meta);
  if (!meta || meta.count !== 1) return null;
  const p = raw.profile;
  if (!isNonEmptyString(p.id) || !isNonEmptyString(p.nameZh)) return null;
  const numericKeys = [
    'coreRadiusArcmin',
    'halfLightRadiusArcmin',
    'tidalRadiusArcmin',
    'concentration',
    'distanceKpc',
    'integratedVMag',
    'metallicityFeH',
    'coreRadiusPc',
    'tidalRadiusPc',
  ] as const;
  for (const key of numericKeys) {
    if (!isFiniteNumber(p[key])) return null;
  }
  const profile = {
    id: p.id,
    nameZh: p.nameZh,
    coreRadiusArcmin: p.coreRadiusArcmin,
    halfLightRadiusArcmin: p.halfLightRadiusArcmin,
    tidalRadiusArcmin: p.tidalRadiusArcmin,
    concentration: p.concentration,
    distanceKpc: p.distanceKpc,
    integratedVMag: p.integratedVMag,
    metallicityFeH: p.metallicityFeH,
    coreRadiusPc: p.coreRadiusPc,
    tidalRadiusPc: p.tidalRadiusPc,
  } as M13Profile;
  if (profile.coreRadiusArcmin <= 0) return null;
  if (profile.tidalRadiusArcmin <= profile.coreRadiusArcmin) return null;
  if (profile.concentration <= 0.5 || profile.concentration >= 3.5) return null;
  if (profile.distanceKpc <= 0) return null;
  return { meta, profile };
}

/**
 * M2 耶鲁亮星（yale_bright_stars.json，契约 C3）：裸数组 `{ra,dec,mag,bv}[]`，
 * ra/dec 单位为度。来源：Yale Bright Star Catalog, 5th Revised Ed.
 * (Hoffleit & Warren 1991)，烘焙登记见 scripts/bake-data/。
 */
export interface YaleBrightStar {
  /** 赤经（度，J2000，[0, 360)） */
  ra: number;
  /** 赤纬（度，J2000，[-90, 90]） */
  dec: number;
  /** 视星等（≤ 6.5，契约 C3 口径） */
  mag: number;
  /** B−V 色指数（缺失值烘焙期按 0.5 兜底；极红碳星可达 ~3.9） */
  bv: number;
}

/** 亮星条数域（M1 烘焙自校验同判据：mag ≤ 6.5 实际 8404 条，差异登记 §M1-1） */
const YALE_STAR_COUNT_MIN = 8300;
const YALE_STAR_COUNT_MAX = 9200;

/**
 * 校验耶鲁亮星产物（契约 C3）：裸数组、条数域 [8300, 9200]、
 * ra ∈ [0, 360)、dec ∈ [-90, 90]、mag ∈ [-2, 6.5]、bv ∈ [-1.5, 6]（M1 域断言同源）。
 * 失败返回 null（消费方显示降级提示，星穹不渲染）。
 */
export function validateYaleBrightStars(raw: unknown): YaleBrightStar[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < YALE_STAR_COUNT_MIN || raw.length > YALE_STAR_COUNT_MAX) return null;
  const validated: YaleBrightStar[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const { ra, dec, mag, bv } = item;
    if (!isFiniteNumber(ra) || ra < 0 || ra >= 360) return null;
    if (!isFiniteNumber(dec) || dec < -90 || dec > 90) return null;
    if (!isFiniteNumber(mag) || mag < -2 || mag > 6.5) return null;
    if (!isFiniteNumber(bv) || bv < -1.5 || bv > 6) return null;
    validated.push({ ra, dec, mag, bv });
  }
  return validated;
}

/**
 * R5-1 星系影像权重图 meta（public/data/galaxy-maps/<id>-meta.json；
 * 来源/授权/反投影方法与残差/失真登记随产物分发，附录 A §2/§3）。
 */
export interface GalaxyMapMeta {
  meta: BakedMeta;
  id: string;
  nameZh: string;
  credit: string;
  sourceUrl: string;
  mapSizePx: number;
  spriteSizePx: number;
  mapRadiusLy: number;
  pixelScaleLyPerPx: number;
  inclinationDeg: number;
  positionAngleDeg: number;
  deprojection: {
    applied: boolean;
    method: string;
    residualAxisRatio: number | null;
  };
  distortionNote: string;
}

/**
 * 校验星系影像 meta 产物（R5-1）：尺寸 256/512、物理半径与像素比例
 * 数值域、倾角 [0,90]、反投影登记结构齐全。失败返回 null（消费方
 * 降级参数化路径）。
 */
export function validateGalaxyMapMeta(raw: unknown): GalaxyMapMeta | null {
  if (!isRecord(raw)) return null;
  const meta = validateMeta(raw.meta);
  if (!meta) return null;
  const {
    id,
    nameZh,
    credit,
    sourceUrl,
    mapSizePx,
    spriteSizePx,
    mapRadiusLy,
    pixelScaleLyPerPx,
    inclinationDeg,
    positionAngleDeg,
    deprojection,
    distortionNote,
  } = raw;
  if (!isNonEmptyString(id) || !isNonEmptyString(nameZh)) return null;
  if (!isNonEmptyString(credit) || !isNonEmptyString(sourceUrl)) return null;
  if (!isNonEmptyString(distortionNote)) return null;
  if (mapSizePx !== 256 || spriteSizePx !== 512) return null;
  if (!isFiniteNumber(mapRadiusLy) || mapRadiusLy <= 0) return null;
  if (!isFiniteNumber(pixelScaleLyPerPx) || pixelScaleLyPerPx <= 0) return null;
  if (!isFiniteNumber(inclinationDeg) || inclinationDeg < 0 || inclinationDeg > 90) return null;
  if (!isFiniteNumber(positionAngleDeg)) return null;
  if (!isRecord(deprojection)) return null;
  const { applied, method, residualAxisRatio } = deprojection;
  if (typeof applied !== 'boolean' || !isNonEmptyString(method)) return null;
  if (residualAxisRatio !== null && !isFiniteNumber(residualAxisRatio)) return null;
  return {
    meta,
    id,
    nameZh,
    credit,
    sourceUrl,
    mapSizePx,
    spriteSizePx,
    mapRadiusLy,
    pixelScaleLyPerPx,
    inclinationDeg,
    positionAngleDeg,
    deprojection: { applied, method, residualAxisRatio },
    distortionNote,
  };
}

/**
 * R5-3 真实巡天目录（galaxy-catalog.bin 解析产物；2MRS，Huchra et al. 2012）。
 * 坐标为超星系笛卡尔（Mpc），场景旋转/压缩在 utils/galaxyCatalog 进行。
 */
export interface GalaxyCatalogData {
  /** 星系数 N */
  count: number;
  /** 超星系笛卡尔位置（N×3，Mpc） */
  positionsMpc: Float32Array;
  /** 形态档（N；0 早型/椭圆、1 晚型/旋涡、2 未知——galaxyCatalogCore 登记） */
  morphTiers: Uint8Array;
  /** J−K 量化档（N；0–98 = P1–P99 线性量化、99 = 缺失未知档——SC3，galaxyCatalogCore 登记） */
  jkTiers: Uint8Array;
  /** 亮度档（N；0–1，K_s 星等线性归一） */
  brightness01: Float32Array;
}

/** galaxy-catalog.bin 魔数（2MRS Ks ≤ 11.75 极限；scripts/bake-data/galaxyCatalog.ts 同值） */
export const GALAXY_CATALOG_MAGIC = 21175;

/** galaxy-catalog.bin 版本号（SC3 起只认 V2：w 含 J−K 量化档，V1 直接拒绝降级宇宙网） */
export const GALAXY_CATALOG_VERSION = 2;

/** 目录星系数域（烘焙自校验同判据） */
const GALAXY_CATALOG_COUNT_MIN = 20000;
const GALAXY_CATALOG_COUNT_MAX = 60000;

/** 目录坐标界（Mpc；烘焙自校验 ≤800） */
const GALAXY_CATALOG_COORD_BOUND_MPC = 800;

/** antennae.bin 头部 Float32 数（magic/version/S/N/nA） */
const ANTENNAE_HEADER_FLOATS = 5;

/** 粒子坐标界（模拟单位；烘焙自校验 <48，运行时留裕量） */
const ANTENNAE_COORD_BOUND = 64;

/** 跨 realm 安全的 ArrayBuffer 判定（instanceof 在测试环境跨 realm 失效） */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

/**
 * 校验并解析触须星系二进制快照（R4-22）：魔数/版本/快照数 8–12/
 * 粒子数域/字节长度精确匹配/坐标有限且 |r| ≤ 64 r_p。
 * 布局登记见 scripts/bake-data/antennae.ts 文件头。
 */
export function validateAntennae(raw: ArrayBuffer | null): AntennaeSnapshotsData | null {
  if (!isArrayBuffer(raw)) return null;
  if (raw.byteLength < ANTENNAE_HEADER_FLOATS * 4 || raw.byteLength % 4 !== 0) return null;
  const data = new Float32Array(raw);
  if (data[0] !== Math.fround(ANTENNAE_MAGIC)) return null;
  if (data[1] !== ANTENNAE_VERSION) return null;
  const snapshotCount = data[2];
  const particleCount = data[3];
  const diskACount = data[4];
  if (!Number.isInteger(snapshotCount) || snapshotCount < 8 || snapshotCount > 12) return null;
  if (!Number.isInteger(particleCount) || particleCount < 16 || particleCount > 6000) return null;
  if (!Number.isInteger(diskACount) || diskACount < 1 || diskACount >= particleCount) return null;
  const floatsPerSnap = 6 + particleCount * 3;
  const expected = (ANTENNAE_HEADER_FLOATS + snapshotCount * floatsPerSnap) * 4;
  if (raw.byteLength !== expected) return null;
  const cores = new Float32Array(snapshotCount * 6);
  const positions = new Float32Array(snapshotCount * particleCount * 3);
  for (let s = 0; s < snapshotCount; s += 1) {
    const base = ANTENNAE_HEADER_FLOATS + s * floatsPerSnap;
    for (let i = 0; i < floatsPerSnap; i += 1) {
      const v = data[base + i];
      if (!Number.isFinite(v) || Math.abs(v) > ANTENNAE_COORD_BOUND) return null;
      if (i < 6) cores[s * 6 + i] = v;
      else positions[s * particleCount * 3 + (i - 6)] = v;
    }
  }
  return { snapshotCount, particleCount, diskACount, cores, positions };
}

/**
 * 校验并解析真实巡天目录二进制（R5-3；SC3 起 bin V2）：魔数/版本/星系数域/
 * 字节长度精确匹配/坐标有限且 |r| ≤ 800 Mpc/w 通道为 [0,299999] 整数且
 * 形态档 ≤ 2。w 解码与 galaxyCatalogCore.unpackCatalogW 同式（单测同源断言，
 * 防两侧漂移）；布局登记见 scripts/bake-data/galaxyCatalog.ts 文件头。
 * 失败返回 null（消费方降级现状程序化宇宙网）。
 */
export function validateGalaxyCatalog(raw: ArrayBuffer | null): GalaxyCatalogData | null {
  if (!isArrayBuffer(raw)) return null;
  if (raw.byteLength < 3 * 4 || raw.byteLength % 4 !== 0) return null;
  const data = new Float32Array(raw);
  if (data[0] !== GALAXY_CATALOG_MAGIC) return null;
  if (data[1] !== GALAXY_CATALOG_VERSION) return null;
  const count = data[2];
  if (
    !Number.isInteger(count) ||
    count < GALAXY_CATALOG_COUNT_MIN ||
    count > GALAXY_CATALOG_COUNT_MAX
  ) {
    return null;
  }
  if (raw.byteLength !== (3 + count * 4) * 4) return null;
  const positionsMpc = new Float32Array(count * 3);
  const morphTiers = new Uint8Array(count);
  const jkTiers = new Uint8Array(count);
  const brightness01 = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const x = data[3 + i * 4];
    const y = data[3 + i * 4 + 1];
    const z = data[3 + i * 4 + 2];
    const w = data[3 + i * 4 + 3];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    const r = Math.hypot(x, y, z);
    if (r <= 0 || r > GALAXY_CATALOG_COORD_BOUND_MPC) return null;
    // w ≤ 299,999 已保证形态档 floor(w/1e5) ≤ 2（域校验即档位校验）
    if (!Number.isInteger(w) || w < 0 || w > 299999) return null;
    const tier = Math.floor(w / 100000);
    positionsMpc[i * 3] = x;
    positionsMpc[i * 3 + 1] = y;
    positionsMpc[i * 3 + 2] = z;
    morphTiers[i] = tier;
    jkTiers[i] = Math.floor((w - tier * 100000) / 1000);
    brightness01[i] = (w % 1000) / 999;
  }
  return { count, positionsMpc, morphTiers, jkTiers, brightness01 };
}

// ---------------------------------------------------------------------------
// E-M1 日食星历 + 月缘剖面（契约 C2 / C3；scripts/bake-data/solarEclipses.ts
// 与 lunarLimb.ts 文件头登记来源——JPL Horizons + NASA Eclipse Web Site /
// Espenak、LRO LOLA LDEM_4）
// ---------------------------------------------------------------------------

/** 星历采样序列（契约 C2 topo/fineC2/fineC3/geo 块；与 solarEclipse.EphemerisSeries 结构兼容） */
export interface SolarEclipseSeriesData {
  /** 首行时刻（UTC 秒，Unix 纪元） */
  t0: number;
  /** 采样间隔（秒） */
  dtSec: number;
  /** 采样行（topo 族 7 列度值 / geo 8 列单位方向+距离 km） */
  rows: number[][];
}

/** 单场日食事件（契约 C2） */
export interface SolarEclipseEventData {
  id: 'e2027' | 'e2035' | 'e1919';
  /** 事件日期（UTC，YYYY-MM-DD） */
  dateUtc: string;
  saros: number;
  kind: 'total';
  /** 事件食分（Espenak 路径表最大直径比） */
  magnitude: number;
  /** |γ|（影轴离地心最小距离，地球赤道半径单位） */
  gammaAbs: number;
  /** 食甚中心线固定观测点 */
  observer: { latDeg: number; lonDeg: number; altM: number; label: string };
  /** 五接触点（UTC 秒；贝塞尔要素权威值） */
  contacts: { c1: number; c2: number; max: number; c3: number; c4: number };
  /** 站心序列（C1−15min→C4+15min @60s） */
  topo: SolarEclipseSeriesData;
  /** C2±3min @1s 细采样段 */
  fineC2: SolarEclipseSeriesData;
  /** C3±3min @1s 细采样段 */
  fineC3: SolarEclipseSeriesData;
  /** 地心 J2000 赤道系序列（±6h @120s） */
  geo: SolarEclipseSeriesData;
  /** 全食带中心线折线 [[latDeg, lonDeg, durationSec], …] */
  path: number[][];
}

export interface SolarEclipsesData {
  events: SolarEclipseEventData[];
}

/** 月缘高程剖面（契约 C3） */
export interface LunarLimbProfileData {
  source: string;
  /** 平均半径（km，LDEM 基准 1737.4） */
  meanRadiusKm: number;
  /** 720 点 @0.5° 极角步长的高程偏差（km） */
  samples: number[];
}

const SOLAR_ECLIPSE_IDS = ['e2027', 'e2035', 'e1919'] as const;

/** 月缘剖面点数/偏差域（烘焙自校验同判据） */
const LUNAR_LIMB_SAMPLE_COUNT = 720;
const LUNAR_LIMB_DEVIATION_BOUND_KM = 9;

function validateSeries(raw: unknown, rowWidth: number): SolarEclipseSeriesData | null {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) return null;
  const { t0, dtSec } = raw;
  if (!isFiniteNumber(t0) || !isFiniteNumber(dtSec) || dtSec <= 0) return null;
  if (raw.rows.length < 2) return null;
  const rows: number[][] = [];
  for (const row of raw.rows as unknown[]) {
    if (!Array.isArray(row) || row.length !== rowWidth) return null;
    if (!row.every(isFiniteNumber)) return null;
    rows.push(row as number[]);
  }
  return { t0, dtSec, rows };
}

/**
 * 校验日食星历产物（契约 C2）：三事件齐全、接触时刻有序且落在采样窗内、
 * 序列结构/数值域完整。失败返回 null（消费方显示降级提示，实验室不渲染）。
 */
export function validateSolarEclipses(raw: unknown): SolarEclipsesData | null {
  if (!isRecord(raw) || !Array.isArray(raw.events)) return null;
  if (raw.events.length !== SOLAR_ECLIPSE_IDS.length) return null;
  const events: SolarEclipseEventData[] = [];
  for (let i = 0; i < SOLAR_ECLIPSE_IDS.length; i += 1) {
    const ev = raw.events[i] as unknown;
    if (!isRecord(ev)) return null;
    if (ev.id !== SOLAR_ECLIPSE_IDS[i]) return null;
    if (!isNonEmptyString(ev.dateUtc) || ev.kind !== 'total') return null;
    if (!isFiniteNumber(ev.saros) || !Number.isInteger(ev.saros) || ev.saros <= 0) return null;
    if (!isFiniteNumber(ev.magnitude) || ev.magnitude <= 1 || ev.magnitude >= 1.1) return null;
    if (!isFiniteNumber(ev.gammaAbs) || ev.gammaAbs < 0 || ev.gammaAbs >= 1) return null;
    const obs = ev.observer;
    if (!isRecord(obs)) return null;
    const { latDeg, lonDeg, altM, label } = obs;
    if (!isFiniteNumber(latDeg) || Math.abs(latDeg) > 90) return null;
    if (!isFiniteNumber(lonDeg) || Math.abs(lonDeg) > 180) return null;
    if (!isFiniteNumber(altM) || !isNonEmptyString(label)) return null;
    const contacts = ev.contacts;
    if (!isRecord(contacts)) return null;
    const { c1, c2, max, c3, c4 } = contacts;
    if (
      !isFiniteNumber(c1) ||
      !isFiniteNumber(c2) ||
      !isFiniteNumber(max) ||
      !isFiniteNumber(c3) ||
      !isFiniteNumber(c4)
    ) {
      return null;
    }
    if (!(c1 < c2 && c2 < max && max < c3 && c3 < c4)) return null;
    const topo = validateSeries(ev.topo, 7);
    const fineC2 = validateSeries(ev.fineC2, 7);
    const fineC3 = validateSeries(ev.fineC3, 7);
    const geo = validateSeries(ev.geo, 8);
    if (!topo || !fineC2 || !fineC3 || !geo) return null;
    const coversContacts =
      topo.t0 <= c1 && topo.t0 + (topo.rows.length - 1) * topo.dtSec >= c4;
    const coversC2 =
      fineC2.t0 <= c2 && fineC2.t0 + (fineC2.rows.length - 1) * fineC2.dtSec >= c2;
    const coversC3 =
      fineC3.t0 <= c3 && fineC3.t0 + (fineC3.rows.length - 1) * fineC3.dtSec >= c3;
    if (!coversContacts || !coversC2 || !coversC3) return null;
    if (!Array.isArray(ev.path) || ev.path.length < 10) return null;
    const path: number[][] = [];
    for (const p of ev.path as unknown[]) {
      if (!Array.isArray(p) || p.length !== 3 || !p.every(isFiniteNumber)) return null;
      path.push(p as number[]);
    }
    events.push({
      id: SOLAR_ECLIPSE_IDS[i],
      dateUtc: ev.dateUtc,
      saros: ev.saros,
      kind: 'total',
      magnitude: ev.magnitude,
      gammaAbs: ev.gammaAbs,
      observer: { latDeg, lonDeg, altM, label },
      contacts: { c1, c2, max, c3, c4 },
      topo,
      fineC2,
      fineC3,
      geo,
      path,
    });
  }
  return { events };
}

/**
 * 校验月缘剖面产物（契约 C3）：720 点、偏差 ∈ [−9, +9] km、平均半径 1737.4。
 * 失败返回 null（消费方降级——贝利珠退化为均匀月缘，M3 登记）。
 */
export function validateLunarLimbProfile(raw: unknown): LunarLimbProfileData | null {
  if (!isRecord(raw)) return null;
  const { source, meanRadiusKm, samples } = raw;
  if (!isNonEmptyString(source)) return null;
  if (!isFiniteNumber(meanRadiusKm) || Math.abs(meanRadiusKm - 1737.4) > 0.1) return null;
  if (!Array.isArray(samples) || samples.length !== LUNAR_LIMB_SAMPLE_COUNT) return null;
  const validated: number[] = [];
  for (const v of samples as unknown[]) {
    if (!isFiniteNumber(v) || Math.abs(v) > LUNAR_LIMB_DEVIATION_BOUND_KM) return null;
    validated.push(v);
  }
  return { source, meanRadiusKm, samples: validated };
}

// ---------------------------------------------------------------------------
// 加载（fetch + 内存缓存；失败返回 null 且不缓存）
// ---------------------------------------------------------------------------

const cache = new Map<string, unknown>();

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function loadValidated<T>(
  url: string,
  validate: (raw: unknown) => T | null
): Promise<T | null> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached as T;
  const data = validate(await fetchJson(url));
  if (data !== null) cache.set(url, data);
  return data;
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/** 加载昴星团成员星（失败返回 null，消费方降级到程序化分布） */
export async function loadPleiades(baseUrl = '/data'): Promise<PleiadesData | null> {
  return loadValidated(`${baseUrl}/pleiades.json`, validatePleiades);
}

/** 加载 R4 恒星物理参数（失败返回 null） */
export async function loadStarParams(baseUrl = '/data'): Promise<StarParamsData | null> {
  return loadValidated(`${baseUrl}/star-params.json`, validateStarParams);
}

/** 加载 M13 King profile 结构参数（失败返回 null） */
export async function loadM13Profile(baseUrl = '/data'): Promise<M13ProfileData | null> {
  return loadValidated(`${baseUrl}/m13-profile.json`, validateM13Profile);
}

/**
 * 加载触须星系 N-body 快照（R4-22 二进制产物；失败返回 null，
 * 消费方降级到现状静态渲染）。成功结果按 URL 缓存，失败不缓存。
 */
export async function loadAntennae(baseUrl = '/data'): Promise<AntennaeSnapshotsData | null> {
  const url = `${baseUrl}/antennae.bin`;
  const cached = cache.get(url);
  if (cached !== undefined) return cached as AntennaeSnapshotsData;
  const data = validateAntennae(await fetchArrayBuffer(url));
  if (data !== null) cache.set(url, data);
  return data;
}

/**
 * 加载真实巡天目录（R5-3 二进制产物；失败返回 null，消费方降级
 * 现状程序化宇宙网）。成功结果按 URL 缓存，失败不缓存。
 */
export async function loadGalaxyCatalog(baseUrl = '/data'): Promise<GalaxyCatalogData | null> {
  const url = `${baseUrl}/galaxy-catalog.bin`;
  const cached = cache.get(url);
  if (cached !== undefined) return cached as GalaxyCatalogData;
  const data = validateGalaxyCatalog(await fetchArrayBuffer(url));
  if (data !== null) cache.set(url, data);
  return data;
}

/** 加载耶鲁亮星目录（M2 星穹；失败返回 null，消费方显示降级提示） */
export async function loadYaleBrightStars(baseUrl = '/data'): Promise<YaleBrightStar[] | null> {
  return loadValidated(`${baseUrl}/yale_bright_stars.json`, validateYaleBrightStars);
}

/** 加载三事件日食星历（E-M1，契约 C2；失败返回 null，消费方显示降级提示） */
export async function loadSolarEclipses(baseUrl = '/data'): Promise<SolarEclipsesData | null> {
  return loadValidated(`${baseUrl}/solar_eclipses.json`, validateSolarEclipses);
}

/** 加载月缘高程剖面（E-M1，契约 C3；失败返回 null，贝利珠降级均匀月缘） */
export async function loadLunarLimbProfile(
  baseUrl = '/data'
): Promise<LunarLimbProfileData | null> {
  return loadValidated(`${baseUrl}/lunar_limb_profile.json`, validateLunarLimbProfile);
}

/** 加载星系影像权重图 meta（R5-1；失败返回 null，消费方降级参数化） */
export async function loadGalaxyMapMeta(
  galaxyId: string,
  baseUrl = '/data/galaxy-maps'
): Promise<GalaxyMapMeta | null> {
  return loadValidated(`${baseUrl}/${galaxyId}-meta.json`, validateGalaxyMapMeta);
}

/** 清空内存缓存（测试用） */
export function resetBakedDataCache(): void {
  cache.clear();
}
