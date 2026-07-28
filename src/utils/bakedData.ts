/**
 * R4-5 烘焙数据运行时加载器：fetch public/data/*.json + 校验 + 内存缓存
 *
 * 产物由 `npm run bake:data`（scripts/bake-data/）离线生成并随仓库提交，
 * 运行时零外部网络请求（仅同源静态资产 fetch）。
 * 数据来源登记见各产物 meta 字段与 scripts/bake-data/index.ts 文件头
 * （Gaia DR3 / SIMBAD+文献 / Harris 目录，IMPROVEMENT_REQUIREMENTS_4.md §0.4）。
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

/** 清空内存缓存（测试用） */
export function resetBakedDataCache(): void {
  cache.clear();
}
