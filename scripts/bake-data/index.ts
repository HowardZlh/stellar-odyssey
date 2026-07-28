/**
 * R4-5 离线数据烘焙管线：scripts/bake-data → public/data/
 *
 * 用法：
 *   npm run bake:data            —— 从内嵌快照（snapshots/）烘焙，离线、幂等
 *   npm run bake:data -- --fetch —— 先从 Gaia TAP 重新拉取快照再烘焙（需网络）
 *
 * 产物（均含 meta { source, retrievedAt, license, count }）：
 *   public/data/pleiades.json     昴星团成员星 ≤600 颗（{x,y,z} pc 簇质心系、B−V、V 视星等）
 *   public/data/star-params.json  R4 涉及恒星物理参数（Teff/半径/光度/光谱型）
 *   public/data/m13-profile.json  M13 King profile 结构参数（Harris 目录）
 *
 * 数据来源登记（IMPROVEMENT_REQUIREMENTS_4.md §0.4）：
 * - 昴星团：Gaia DR3 TAP 查询（ADQL 语句与选星判据见 snapshots/pleiades-gaia-dr3.meta.json）。
 *   G→V 与 BP−RP→B−V 转换用 Gaia DR3 文档 §5.5.1 表 5.9 Johnson-Cousins 关系
 *   （Carrasco & Bellazzini；G−V=f(GBP−GRP) σ=0.030，GBP−GRP=f(B−V) σ=0.066，后者数值反解）。
 * - 恒星参数：SIMBAD 光谱型 + 文献数值（逐星登记于 STAR_PARAMS 表内 ref 字段）。
 * - M13：Harris (1996, AJ 112, 1487; 2010 版) 银河系球状星团目录 NGC 6205 行；
 *   潮汐半径由 r_t = r_c·10^c 导出（King 模型定义），pc 值由距离 7.1 kpc 小角度近似导出。
 *
 * 自校验：星数范围/坐标模长/数值域/无 NaN，失败退出非零。
 * 幂等性：默认模式产物为快照的纯函数（retrievedAt 取自快照 meta），两次运行逐字节一致。
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(SCRIPT_DIR, 'snapshots');
const OUT_DIR = join(SCRIPT_DIR, '..', '..', 'public', 'data');
const GAIA_TAP_SYNC = 'https://gea.esac.esa.int/tap-server/tap/sync';

/** public/data/ 总量硬性上限（gzip 前，附录 A）：5 MB */
const TOTAL_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`[bake-data] 自校验失败：${message}`);
  process.exit(1);
}

function assertBake(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

/** 四舍五入到 digits 位小数，并把 -0 归一为 0（保证输出字节级幂等） */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const r = Math.round(value * factor) / factor;
  return r === 0 ? 0 : r;
}

const DEG_TO_RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Gaia DR3 → Johnson-Cousins 光度转换（Gaia DR3 文档 §5.5.1 表 5.9）
// ---------------------------------------------------------------------------

/**
 * G − V = f(GBP−GRP)，适用范围 −0.5 < BP−RP < 5.0，σ = 0.03017
 * 系数：−0.02704, +0.01424, −0.2156, +0.01426
 */
export function gMinusV(bpRp: number): number {
  return -0.02704 + 0.01424 * bpRp - 0.2156 * bpRp ** 2 + 0.01426 * bpRp ** 3;
}

/**
 * GBP−GRP = f(B−V)，适用范围 −0.5 < B−V < 3.5，σ = 0.0659
 * 系数：0.06483, 1.575, −0.7815, 0.5707, −0.176, 0.01916
 * 在 [−0.5, 3.5] 上单调递增（导数逐段验证 > 0），可用二分法反解
 */
export function bpRpFromBV(bv: number): number {
  return (
    0.06483 +
    1.575 * bv -
    0.7815 * bv ** 2 +
    0.5707 * bv ** 3 -
    0.176 * bv ** 4 +
    0.01916 * bv ** 5
  );
}

/** 由观测 BP−RP 数值反解 B−V（二分法，收敛阈值 1e-6 mag） */
export function bvFromBpRp(bpRp: number): number {
  let lo = -0.5;
  let hi = 3.5;
  assertBake(
    bpRp >= bpRpFromBV(lo) && bpRp <= bpRpFromBV(hi),
    `BP−RP=${bpRp} 超出 B−V 转换关系适用范围`
  );
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
    if (bpRpFromBV(mid) < bpRp) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// pleiades.json：Gaia DR3 快照 → 簇质心系直角坐标 + B−V + V
// ---------------------------------------------------------------------------

interface GaiaRow {
  sourceId: string;
  ra: number;
  dec: number;
  parallax: number;
  gMag: number;
  bpRp: number;
}

interface SnapshotMeta {
  source: string;
  query: string;
  selectionCriteria: string;
  retrievedAt: string;
  license: string;
}

function parseGaiaCsv(csv: string): GaiaRow[] {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',');
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    assertBake(idx >= 0, `快照 CSV 缺少列 ${name}`);
    return idx;
  };
  const iId = col('source_id');
  const iRa = col('ra');
  const iDec = col('dec');
  const iPlx = col('parallax');
  const iG = col('phot_g_mean_mag');
  const iBpRp = col('bp_rp');
  return lines.slice(1).map((line) => {
    const parts = line.split(',');
    return {
      sourceId: parts[iId],
      ra: Number(parts[iRa]),
      dec: Number(parts[iDec]),
      parallax: Number(parts[iPlx]),
      gMag: Number(parts[iG]),
      bpRp: Number(parts[iBpRp]),
    };
  });
}

interface PleiadesStar {
  id: string;
  x: number;
  y: number;
  z: number;
  bv: number;
  v: number;
}

interface BakedMeta {
  source: string;
  retrievedAt: string;
  license: string;
  count: number;
}

function bakePleiades(rows: GaiaRow[], snapshotMeta: SnapshotMeta): { meta: BakedMeta & { selectionCriteria: string; query: string; photometricTransform: string }; stars: PleiadesStar[] } {
  assertBake(rows.length >= 100 && rows.length <= 600, `昴星团星数 ${rows.length} 超出 [100, 600]`);

  // ICRS ra/dec/parallax → 日心直角坐标（pc）：d = 1000/plx(mas)
  const cart = rows.map((r) => {
    assertBake(
      Number.isFinite(r.ra) && Number.isFinite(r.dec) && Number.isFinite(r.parallax),
      `source_id=${r.sourceId} 天测量含 NaN`
    );
    assertBake(r.parallax >= 7.0 && r.parallax <= 7.7, `source_id=${r.sourceId} 视差 ${r.parallax} 越界`);
    const d = 1000 / r.parallax;
    const cosDec = Math.cos(r.dec * DEG_TO_RAD);
    return {
      row: r,
      x: d * cosDec * Math.cos(r.ra * DEG_TO_RAD),
      y: d * cosDec * Math.sin(r.ra * DEG_TO_RAD),
      z: d * Math.sin(r.dec * DEG_TO_RAD),
    };
  });

  const n = cart.length;
  const cx = cart.reduce((s, c) => s + c.x, 0) / n;
  const cy = cart.reduce((s, c) => s + c.y, 0) / n;
  const cz = cart.reduce((s, c) => s + c.z, 0) / n;
  const centroidDist = Math.sqrt(cx * cx + cy * cy + cz * cz);
  // 昴星团距离约 136 pc（Gaia 视差），质心模长应落在检索的视差窗内
  assertBake(centroidDist > 125 && centroidDist < 145, `质心距离 ${centroidDist.toFixed(1)} pc 异常`);

  const stars: PleiadesStar[] = cart.map((c) => {
    const v = c.row.gMag - gMinusV(c.row.bpRp);
    const bv = bvFromBpRp(c.row.bpRp);
    const star: PleiadesStar = {
      id: c.row.sourceId,
      x: round(c.x - cx, 3),
      y: round(c.y - cy, 3),
      z: round(c.z - cz, 3),
      bv: round(bv, 3),
      v: round(v, 3),
    };
    const rMag = Math.sqrt(star.x ** 2 + star.y ** 2 + star.z ** 2);
    assertBake(
      Number.isFinite(star.x) && Number.isFinite(star.y) && Number.isFinite(star.z),
      `source_id=${star.id} 坐标含 NaN`
    );
    assertBake(rMag <= 30, `source_id=${star.id} 距质心 ${rMag.toFixed(1)} pc 超出 30 pc`);
    assertBake(star.bv >= -0.5 && star.bv <= 3.5, `source_id=${star.id} B−V=${star.bv} 越界`);
    assertBake(star.v >= -2 && star.v <= 20, `source_id=${star.id} V=${star.v} 越界`);
    return star;
  });

  return {
    meta: {
      source: snapshotMeta.source,
      retrievedAt: snapshotMeta.retrievedAt,
      license: snapshotMeta.license,
      count: stars.length,
      selectionCriteria: snapshotMeta.selectionCriteria,
      query: snapshotMeta.query,
      photometricTransform:
        'Gaia DR3 文档 §5.5.1 表 5.9（Johnson-Cousins）：V = G − f(BP−RP)（σ=0.030）；B−V 由 GBP−GRP = f(B−V)（σ=0.066）二分反解。坐标为 ICRS 轴向、原点平移至成员星质心（pc）',
    },
    stars,
  };
}

// ---------------------------------------------------------------------------
// star-params.json：内嵌文献数值表（SIMBAD 光谱型 + 逐星文献登记）
// ---------------------------------------------------------------------------

interface StarPhysicalParams {
  nameZh: string;
  simbadId: string;
  spectralType: string;
  teffK: number;
  radiusRsun: number;
  luminosityLsun: number;
  ref: string;
}

/**
 * 内嵌文献数值表（SIMBAD 检索于 2026-07-28；光谱型为 SIMBAD sp_type 原文）。
 * 造父一/参宿四为变星，取文献均值并在 ref 中注明。
 */
const STAR_PARAMS: Record<string, StarPhysicalParams> = {
  betelgeuse: {
    nameZh: '参宿四',
    simbadId: '* alf Ori',
    spectralType: 'M1-M2Ia-Iab',
    teffK: 3600,
    radiusRsun: 764,
    luminosityLsun: 126000,
    ref: 'Joyce et al. (2020, ApJ 902, 63)：Teff=3600 K、R=764 R☉、L=1.26e5 L☉（变星，取代表值）',
  },
  rigel: {
    nameZh: '参宿七',
    simbadId: '* bet Ori',
    spectralType: 'B8Ia',
    teffK: 12100,
    radiusRsun: 78.9,
    luminosityLsun: 120000,
    ref: 'Przybilla et al. (2010, A&A 517, A38) Teff/R；Moravveji et al. (2012, ApJ 747, 108) L',
  },
  siriusA: {
    nameZh: '天狼星 A',
    simbadId: '* alf CMa',
    spectralType: 'A0mA1Va',
    teffK: 9940,
    radiusRsun: 1.711,
    luminosityLsun: 25.4,
    ref: 'Kervella et al. (2003, A&A 408, 681) R 干涉测量；Adelman (2004) Teff；Liebert et al. (2005, ApJ 630, L69) L',
  },
  siriusB: {
    nameZh: '天狼星 B',
    simbadId: '* alf CMa B',
    spectralType: 'DA1.9',
    teffK: 25200,
    radiusRsun: 0.0084,
    luminosityLsun: 0.056,
    ref: 'Barstow et al. (2005, MNRAS 362, 1134) Teff=25193 K；Holberg et al. (1998, ApJ 497, 935) R/L',
  },
  deltaCephei: {
    nameZh: '造父一',
    simbadId: '* del Cep',
    spectralType: 'F5Iab:+B7-8',
    teffK: 5960,
    radiusRsun: 43.3,
    luminosityLsun: 1955,
    ref: 'Mérand et al. (2005, A&A 438, L9) R=43.3 R☉ 干涉测量；Engle et al. (2014, ApJ 794, 80) <Teff>/L（脉动均值）',
  },
  wr124: {
    nameZh: 'WR 124',
    simbadId: 'Hen 2-427',
    spectralType: 'WN8h',
    teffK: 44700,
    radiusRsun: 11.93,
    luminosityLsun: 562000,
    ref: 'Hamann et al. (2019, A&A 625, A57)：Gaia DR2 距离修订后 T*=44.7 kK、R=11.93 R☉、L=5.62e5 L☉',
  },
};

function bakeStarParams(): { meta: BakedMeta; stars: Record<string, StarPhysicalParams> } {
  const keys = Object.keys(STAR_PARAMS);
  assertBake(keys.length === 6, `star-params 应含 6 颗恒星，实际 ${keys.length}`);
  for (const key of keys) {
    const s = STAR_PARAMS[key];
    assertBake(
      Number.isFinite(s.teffK) && s.teffK >= 1000 && s.teffK <= 250000,
      `${key} Teff=${s.teffK} 越界`
    );
    assertBake(Number.isFinite(s.radiusRsun) && s.radiusRsun > 0, `${key} 半径非正`);
    assertBake(Number.isFinite(s.luminosityLsun) && s.luminosityLsun > 0, `${key} 光度非正`);
    assertBake(s.spectralType.length > 0 && s.ref.length > 0, `${key} 光谱型/文献登记缺失`);
  }
  return {
    meta: {
      source: 'SIMBAD（光谱型，检索于 2026-07-28）+ 文献数值表（逐星 ref 字段登记）',
      retrievedAt: '2026-07-28T00:00:00Z',
      license: 'SIMBAD (CDS, Strasbourg)：学术引用许可；文献数值属公开科学数据',
      count: 6,
    },
    stars: STAR_PARAMS,
  };
}

// ---------------------------------------------------------------------------
// m13-profile.json：Harris 目录 NGC 6205 行（内嵌文献数值表）
// ---------------------------------------------------------------------------

interface M13Profile {
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

function bakeM13Profile(): { meta: BakedMeta & { note: string }; profile: M13Profile } {
  // Harris (1996, 2010 版) mwgc.dat NGC 6205 行原始值
  const coreRadiusArcmin = 0.62;
  const halfLightRadiusArcmin = 1.69;
  const concentration = 1.53;
  const distanceKpc = 7.1;
  const integratedVMag = 5.78;
  const metallicityFeH = -1.53;

  // 导出量：King 模型 r_t = r_c·10^c；角→线用小角度近似 r[pc] = d[pc]·θ[rad]
  const tidalRadiusArcmin = round(coreRadiusArcmin * 10 ** concentration, 2);
  const arcminToRad = Math.PI / (180 * 60);
  const coreRadiusPc = round(distanceKpc * 1000 * coreRadiusArcmin * arcminToRad, 2);
  const tidalRadiusPc = round(distanceKpc * 1000 * tidalRadiusArcmin * arcminToRad, 1);

  const profile: M13Profile = {
    id: 'NGC 6205',
    nameZh: 'M13 武仙座球状星团',
    coreRadiusArcmin,
    halfLightRadiusArcmin,
    tidalRadiusArcmin,
    concentration,
    distanceKpc,
    integratedVMag,
    metallicityFeH,
    coreRadiusPc,
    tidalRadiusPc,
  };

  assertBake(profile.coreRadiusArcmin > 0, '核半径非正');
  assertBake(profile.tidalRadiusArcmin > profile.coreRadiusArcmin, '潮汐半径应大于核半径');
  assertBake(profile.concentration > 0.5 && profile.concentration < 3.5, '浓度 c 越界');
  assertBake(
    Object.values(profile).every((v) => typeof v === 'string' || Number.isFinite(v)),
    'M13 参数含 NaN'
  );

  return {
    meta: {
      source: 'Harris (1996, AJ 112, 1487; 2010 版) 银河系球状星团目录（physics.mcmaster.ca/~harris/mwgc.dat）NGC 6205 行',
      retrievedAt: '2026-07-28T00:00:00Z',
      license: '公开学术目录，引用 Harris (1996, AJ 112, 1487)；2010 版 arXiv:1012.3224',
      count: 1,
      note: '潮汐半径由 r_t = r_c·10^c 导出（King 模型定义）；pc 值由距离 7.1 kpc 小角度近似导出',
    },
    profile,
  };
}

// ---------------------------------------------------------------------------
// 快照拉取（--fetch 模式，可选；默认离线用已提交快照）
// ---------------------------------------------------------------------------

async function refetchSnapshot(): Promise<void> {
  const metaPath = join(SNAPSHOT_DIR, 'pleiades-gaia-dr3.meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as SnapshotMeta;
  console.log('[bake-data] --fetch：从 Gaia TAP 重新拉取昴星团快照…');
  const body = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'csv',
    QUERY: meta.query,
  });
  const res = await fetch(GAIA_TAP_SYNC, { method: 'POST', body });
  if (!res.ok) fail(`Gaia TAP 返回 HTTP ${res.status}（离线时请去掉 --fetch 用内嵌快照）`);
  const csv = await res.text();
  const rows = parseGaiaCsv(csv);
  assertBake(rows.length >= 100 && rows.length <= 600, `TAP 返回 ${rows.length} 行，拒绝覆盖快照`);
  writeFileSync(join(SNAPSHOT_DIR, 'pleiades-gaia-dr3.csv'), csv);
  writeFileSync(
    metaPath,
    `${JSON.stringify({ ...meta, retrievedAt: new Date().toISOString() }, null, 2)}\n`
  );
  console.log(`[bake-data] 快照已更新（${rows.length} 行）`);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function writeProduct(fileName: string, data: unknown, pretty: boolean): number {
  const path = join(OUT_DIR, fileName);
  const json = pretty ? `${JSON.stringify(data, null, 2)}\n` : `${JSON.stringify(data)}\n`;
  writeFileSync(path, json);
  return statSync(path).size;
}

async function main(): Promise<void> {
  if (process.argv.includes('--fetch')) {
    await refetchSnapshot();
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const snapshotMeta = JSON.parse(
    readFileSync(join(SNAPSHOT_DIR, 'pleiades-gaia-dr3.meta.json'), 'utf8')
  ) as SnapshotMeta;
  const rows = parseGaiaCsv(readFileSync(join(SNAPSHOT_DIR, 'pleiades-gaia-dr3.csv'), 'utf8'));

  const sizes: Array<[string, number]> = [
    ['pleiades.json', writeProduct('pleiades.json', bakePleiades(rows, snapshotMeta), false)],
    ['star-params.json', writeProduct('star-params.json', bakeStarParams(), true)],
    ['m13-profile.json', writeProduct('m13-profile.json', bakeM13Profile(), true)],
  ];

  const total = sizes.reduce((s, [, n]) => s + n, 0);
  for (const [name, size] of sizes) {
    console.log(`[bake-data] public/data/${name}  ${(size / 1024).toFixed(1)} KB`);
  }
  console.log(`[bake-data] 总量 ${(total / 1024).toFixed(1)} KB（上限 ${TOTAL_SIZE_LIMIT_BYTES / 1024 / 1024} MB）`);
  assertBake(total <= TOTAL_SIZE_LIMIT_BYTES, `public/data/ 总量 ${total} B 超出 5 MB 上限`);
  console.log('[bake-data] 自校验通过，烘焙完成');
}

main().catch((err: unknown) => {
  console.error('[bake-data] 失败：', err);
  process.exit(1);
});
