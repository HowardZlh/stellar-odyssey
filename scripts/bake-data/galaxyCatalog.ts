/**
 * R5-3 真实巡天目录烘焙（方案 G）：2MRS 快照 → public/data/galaxy-catalog.bin
 *
 * 数据来源登记（IMPROVEMENT_REQUIREMENTS_5 §0.4）：
 * - 2MASS Redshift Survey（2MRS）：Huchra et al. 2012, ApJS 199, 26
 *   （Ks ≤ 11.75 完备极限，~43,500 个 cz > 0 星系）；
 * - 获取方式（R4-5 二选一策略之"公开接口 + 提交快照"）：VizieR TAP
 *   （J/ApJS/199/26/table3）检索列 RAJ2000/DEJ2000/Kcmag/type/cz，
 *   快照 gzip 提交于 snapshots/2mrs-vizier.csv.gz（`--fetch-2mrs` 重新拉取）；
 *   网络受限降级路径（按亮度截断至 ~2 万）本次未启用——快照即全量，登记。
 *
 * 坐标/失真/去重全部委托 src/utils/galaxyCatalogCore.ts 纯函数
 * （运行时与烘焙同源，禁止两套公式；三项失真登记见该文件头）。
 *
 * 产物布局（Float32 小端，~16 B/星系）：
 *   [MAGIC=21175, VERSION=1, N] + N × [sgx, sgy, sgz (Mpc 超星系笛卡尔), w]
 *   w = 形态档·1000 + round(亮度档·999)（整数值浮点，Float32 精确 → 幂等）
 *
 * 自校验（失败退出非零）：条目数域 / 坐标有限与距离域 / w 域 /
 * 室女座团方向 6° 锥计数超密度比 ≥ 3（真实结构在数据中可验证）/
 * 银道遮挡带 |b| < 5° 占比 < 2%（观测限制自洽）/ 实体星系去重后
 * M87 方向近距条目清零 / 产物 ≤ 1 MB。
 * 幂等性：产物为快照的纯函数（排序 + 整数 w），两次运行逐字节一致。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  CATALOG_MAX_DISTANCE_MPC,
  CZ_MIN_KM_S,
  DEDUP_MATCH_RADIUS_DEG,
  H0_KM_S_MPC,
  VIRGO_CONE_RADIUS_DEG,
  VIRGO_DEC_DEG,
  VIRGO_OVERDENSITY_MIN_RATIO,
  VIRGO_RA_DEG,
  VIRGO_SHELL_MAX_MPC,
  VIRGO_SHELL_MIN_MPC,
  brightness01FromKmag,
  coneSolidAngleFraction,
  countInCone,
  countInShell,
  czToDistanceMpc,
  equatorialToSupergalacticUnit,
  galacticLatitudeDeg,
  matchEntityGalaxy,
  morphTierFromType,
  packCatalogW,
} from '../../src/utils/galaxyCatalogCore.ts';

/** 产物魔数/版本（bin 头部；bakedData.validateGalaxyCatalog 同值） */
export const GALAXY_CATALOG_MAGIC = 21175;
export const GALAXY_CATALOG_VERSION = 1;

const VIZIER_TAP_SYNC = 'http://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync';
const SNAPSHOT_CSV_GZ = '2mrs-vizier.csv.gz';
const SNAPSHOT_META = '2mrs-vizier.meta.json';

/** 产物体积上限（§R5-3 验收：≤ 1 MB） */
const CATALOG_SIZE_LIMIT_BYTES = 1024 * 1024;

function fail(message: string): never {
  console.error(`[bake-data] galaxy-catalog 自校验失败：${message}`);
  process.exit(1);
}

function assertBake(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

interface SnapshotMeta {
  source: string;
  query: string;
  selectionCriteria: string;
  retrievedAt: string;
  license: string;
}

interface CatalogRow {
  raDeg: number;
  decDeg: number;
  kMag: number;
  type: string;
  czKmS: number;
}

/** 解析快照 CSV（type 列可能带引号与空格；无嵌套逗号） */
export function parse2mrsCsv(csv: string): CatalogRow[] {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',');
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    assertBake(idx >= 0, `快照 CSV 缺少列 ${name}`);
    return idx;
  };
  const iRa = col('RAJ2000');
  const iDec = col('DEJ2000');
  const iK = col('Kcmag');
  const iType = col('type');
  const iCz = col('cz');
  return lines.slice(1).map((line) => {
    const parts = line.split(',');
    return {
      raDeg: Number(parts[iRa]),
      decDeg: Number(parts[iDec]),
      kMag: Number(parts[iK]),
      type: parts[iType].replace(/^"|"$/g, ''),
      czKmS: Number(parts[iCz]),
    };
  });
}

export interface GalaxyCatalogBakeResult {
  buffer: Buffer;
  count: number;
  metaProduct: Record<string, unknown>;
}

/**
 * 快照行 → 产物缓冲（纯函数：同一快照两次运行逐字节一致）
 */
export function bakeGalaxyCatalogFromRows(
  rows: CatalogRow[],
  snapshotMeta: SnapshotMeta,
): GalaxyCatalogBakeResult {
  assertBake(rows.length >= 20000, `2MRS 快照仅 ${rows.length} 行，低于 20,000 判据`);

  // ---- 筛选 + 去重 + 坐标换算 ----
  const dedupRemoved = new Map<string, number>();
  let droppedNearCz = 0;
  let droppedInvalid = 0;
  const entries: Array<{ x: number; y: number; z: number; d: number; w: number }> = [];
  for (const row of rows) {
    if (
      !Number.isFinite(row.raDeg) ||
      !Number.isFinite(row.decDeg) ||
      !Number.isFinite(row.kMag) ||
      !Number.isFinite(row.czKmS)
    ) {
      droppedInvalid += 1;
      continue;
    }
    if (row.czKmS < CZ_MIN_KM_S) {
      droppedNearCz += 1;
      continue;
    }
    const hit = matchEntityGalaxy(row.raDeg, row.decDeg);
    if (hit !== null) {
      dedupRemoved.set(hit, (dedupRemoved.get(hit) ?? 0) + 1);
      continue;
    }
    const d = czToDistanceMpc(row.czKmS);
    const u = equatorialToSupergalacticUnit(row.raDeg, row.decDeg);
    entries.push({
      x: Math.fround(u.x * d),
      y: Math.fround(u.y * d),
      z: Math.fround(u.z * d),
      d,
      w: packCatalogW(morphTierFromType(row.type), brightness01FromKmag(row.kMag)),
    });
  }

  // 确定性排序（距离 → x → y → z），保证幂等与与快照行序无关
  entries.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y || a.z - b.z);

  const n = entries.length;
  assertBake(n >= 20000 && n <= 60000, `目录条目数 ${n} 超出 [20,000, 60,000]`);

  // ---- 写缓冲 ----
  const data = new Float32Array(3 + n * 4);
  data[0] = GALAXY_CATALOG_MAGIC;
  data[1] = GALAXY_CATALOG_VERSION;
  data[2] = n;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const e = entries[i];
    const r = Math.hypot(e.x, e.y, e.z);
    assertBake(
      Number.isFinite(r) && r > 0 && r <= CATALOG_MAX_DISTANCE_MPC,
      `条目 ${i} 距离 ${r.toFixed(1)} Mpc 越界`,
    );
    data[3 + i * 4] = e.x;
    data[3 + i * 4 + 1] = e.y;
    data[3 + i * 4 + 2] = e.z;
    data[3 + i * 4 + 3] = e.w;
    positions[i * 3] = e.x;
    positions[i * 3 + 1] = e.y;
    positions[i * 3 + 2] = e.z;
  }

  // ---- 自校验：室女座团方向超密度（真实结构可验证断言，§R5-3；
  // 5–30 Mpc 壳内对比——全距离积分被前/背景稀释，判据登记于 core） ----
  const virgoDir = equatorialToSupergalacticUnit(VIRGO_RA_DEG, VIRGO_DEC_DEG);
  const inCone = countInCone(
    positions,
    virgoDir,
    VIRGO_CONE_RADIUS_DEG,
    VIRGO_SHELL_MIN_MPC,
    VIRGO_SHELL_MAX_MPC,
  );
  const inShell = countInShell(positions, VIRGO_SHELL_MIN_MPC, VIRGO_SHELL_MAX_MPC);
  const overdensity = inCone / inShell / coneSolidAngleFraction(VIRGO_CONE_RADIUS_DEG);
  assertBake(inCone >= 100, `室女座锥内计数 ${inCone} < 100`);
  assertBake(
    overdensity >= VIRGO_OVERDENSITY_MIN_RATIO,
    `室女座方向超密度比 ${overdensity.toFixed(2)} < ${VIRGO_OVERDENSITY_MIN_RATIO}`,
  );

  // ---- 自校验：银道遮挡带（|b| < 5° 占比应近零——2MRS 观测限制自洽） ----
  let lowLat = 0;
  for (const row of rows) {
    if (Number.isFinite(row.raDeg) && Number.isFinite(row.decDeg)) {
      if (Math.abs(galacticLatitudeDeg(row.raDeg, row.decDeg)) < 5) lowLat += 1;
    }
  }
  const lowLatFrac = lowLat / rows.length;
  assertBake(lowLatFrac < 0.02, `银道遮挡带 |b|<5° 占比 ${(lowLatFrac * 100).toFixed(2)}% ≥ 2%`);

  // ---- 自校验：M87 去重生效（其方向 0.3° 内 10–25 Mpc 条目清零，防重影） ----
  let m87Residual = 0;
  for (const e of entries) {
    if (e.d < 10 || e.d > 25) continue;
    const r = Math.hypot(e.x, e.y, e.z);
    const dot = (e.x * virgoDir.x + e.y * virgoDir.y + e.z * virgoDir.z) / r;
    if (dot >= Math.cos((0.3 * Math.PI) / 180)) m87Residual += 1;
  }
  assertBake(m87Residual === 0, `M87 方向仍残留 ${m87Residual} 条近距条目（去重失效）`);

  const buffer = Buffer.from(data.buffer);
  assertBake(
    buffer.byteLength <= CATALOG_SIZE_LIMIT_BYTES,
    `galaxy-catalog.bin ${buffer.byteLength} B 超出 1 MB 上限`,
  );

  const dedupTotal = [...dedupRemoved.values()].reduce((s, v) => s + v, 0);
  console.log(
    `[bake-data] galaxy-catalog：${n} 星系（近距剔除 ${droppedNearCz}、无效 ${droppedInvalid}、` +
      `实体去重 ${dedupTotal}：${[...dedupRemoved.entries()].map(([k, v]) => `${k}×${v}`).join(' ') || '无'}）；` +
      `室女座 ${VIRGO_CONE_RADIUS_DEG}° 锥 ${inCone} 条，超密度比 ${overdensity.toFixed(1)}×`,
  );

  const metaProduct = {
    meta: {
      source: snapshotMeta.source,
      retrievedAt: snapshotMeta.retrievedAt,
      license: snapshotMeta.license,
      count: n,
    },
    h0KmSMpc: H0_KM_S_MPC,
    czMinKmS: CZ_MIN_KM_S,
    dedup: {
      matchRadiusDeg: DEDUP_MATCH_RADIUS_DEG,
      removedTotal: dedupTotal,
      removedByEntity: Object.fromEntries([...dedupRemoved.entries()].sort()),
    },
    virgoSelfCheck: {
      coneRadiusDeg: VIRGO_CONE_RADIUS_DEG,
      shellMpc: [VIRGO_SHELL_MIN_MPC, VIRGO_SHELL_MAX_MPC],
      countInCone: inCone,
      countInShell: inShell,
      overdensityRatio: Math.round(overdensity * 100) / 100,
    },
    distortions: [
      '红移距离为 cz/H₀ 哈勃流近似（H₀=70 km/s/Mpc）：本动速度污染视向速度，星系团沿视线拉长（指状效应）',
      `近距（cz < ${CZ_MIN_KM_S} km/s 剔除；cz ≲ 1,000 km/s）哈勃流距离分数误差可达数十%`,
      '银道遮挡带（|b| < 5°，银心方向 8°）为 2MRS 尘埃消光观测限制，非真实空洞',
    ],
  };

  return { buffer, count: n, metaProduct };
}

/**
 * 从提交快照烘焙（离线幂等路径；index.ts 主流程调用）
 */
export function bakeGalaxyCatalog(snapshotDir: string): GalaxyCatalogBakeResult {
  const meta = JSON.parse(
    readFileSync(join(snapshotDir, SNAPSHOT_META), 'utf8'),
  ) as SnapshotMeta;
  const csv = gunzipSync(readFileSync(join(snapshotDir, SNAPSHOT_CSV_GZ))).toString('utf8');
  return bakeGalaxyCatalogFromRows(parse2mrsCsv(csv), meta);
}

/**
 * `--fetch-2mrs`：从 VizieR TAP 重新拉取 2MRS 快照（需网络；
 * 行序经确定性排序后写入，快照本身可复现）
 */
export async function refetch2mrsSnapshot(snapshotDir: string): Promise<void> {
  const query =
    'SELECT RAJ2000, DEJ2000, Kcmag, type, cz FROM "J/ApJS/199/26/table3" ' +
    'WHERE cz > 0 AND Kcmag IS NOT NULL';
  console.log('[bake-data] --fetch-2mrs：从 VizieR TAP 拉取 2MRS 目录…');
  const body = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'csv',
    QUERY: query,
  });
  const res = await fetch(VIZIER_TAP_SYNC, { method: 'POST', body });
  if (!res.ok) fail(`VizieR TAP 返回 HTTP ${res.status}（离线时请去掉 --fetch-2mrs 用内嵌快照）`);
  const csv = await res.text();
  const rows = parse2mrsCsv(csv);
  assertBake(rows.length >= 40000 && rows.length <= 60000, `TAP 返回 ${rows.length} 行，拒绝覆盖快照`);
  // 确定性重排 + 重新序列化（最小列快照，字段原样保留数值精度）
  rows.sort((a, b) => a.raDeg - b.raDeg || a.decDeg - b.decDeg || a.czKmS - b.czKmS);
  const lines = ['RAJ2000,DEJ2000,Kcmag,type,cz'];
  for (const r of rows) {
    lines.push(`${r.raDeg},${r.decDeg},${r.kMag},"${r.type}",${r.czKmS}`);
  }
  writeFileSync(
    join(snapshotDir, SNAPSHOT_CSV_GZ),
    gzipSync(Buffer.from(`${lines.join('\n')}\n`, 'utf8'), { level: 9 }),
  );
  const meta: SnapshotMeta = {
    source:
      '2MASS Redshift Survey (2MRS)，Huchra et al. 2012, ApJS 199, 26；VizieR J/ApJS/199/26/table3（CDS）',
    query,
    selectionCriteria:
      'cz > 0 且 Kcmag 非空（Ks ≤ 11.75 完备极限全量；蓝移条目无哈勃流距离剔除）',
    retrievedAt: new Date().toISOString(),
    license:
      '公开科学数据：引用 Huchra et al. (2012, ApJS 199, 26)；VizieR/CDS 数据使用规范',
  };
  writeFileSync(join(snapshotDir, SNAPSHOT_META), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`[bake-data] 2MRS 快照已更新（${rows.length} 行）`);
}
