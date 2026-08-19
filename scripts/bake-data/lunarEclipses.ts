/**
 * LE 迭代 M1-1 四事件权威星历烘焙：JPL Horizons + NASA GSFC 5MCLE (Espenak & Meeus)
 * → public/data/lunar_eclipses.json（契约 C2）
 *
 * 数据来源登记（IMPROVEMENT_REQUIREMENTS_LUNAR_ECLIPSE §6 / 契约 C2）：
 * - JPL Horizons API（https://ssd.jpl.nasa.gov/api/horizons.api，DE441）：
 *   站心地平序列（OBSERVER：月球 Az/El/视直径 + 太阳 Az/El，AIRLESS）与
 *   地心 J2000(ICRF) 赤道系向量序列（VECTORS，km）；
 * - NASA GSFC Five Millennium Catalog of Lunar Eclipses（Espenak & Meeus，
 *   TP-2009-214173；eclipse.gsfc.nasa.gov/LEcat5/ 世纪目录页）：食甚 TD 时刻、
 *   ΔT、saros、类型、gamma、双食分、三段时长（0.1 分钟精度）。需求原定
 *   EclipseWise.com 校核，抓取返回 406（反爬，日食条目 403 同款），替换为同作者
 *   一手 NASA 页面，来源等级不降（差异登记需求文档 §M1-1）；GSFC OH 年页
 *   （OH2026/OH2027/OH2029）的分钟级接触时刻已人工比对一致（不入快照）。
 * - 快照：scripts/bake-data/snapshots/le-*.gz + lunar-eclipses.meta.json
 *   （source/query/retrievedAt/license），默认离线烘焙；--fetch-lunar-eclipses 重拉。
 *
 * 接触时刻（契约 C2 contacts，权威值）：5MCLE 只刊食甚时刻与各阶段时长，
 * 接触时刻 = 食甚 UT ± 时长/2（各阶段对食甚对称——GSFC OH 年页官方同法，
 * "derived from the phase durations"；0.1 分钟量化 → ±3s）。食甚 UT =
 * 目录 TD − 目录 ΔT（Espenak 口径：2026:75s / 2027:76s / 2029:77s / 1992:59s）。
 *
 * 本影放大修正约定（B7 定稿）：Danjon 法，月球视差项 ×1.01（= 1 + 1/85 − 1/594，
 * 5MCLE shadow.html 式 1-5/1-6，与目录同式）；本文件自校验以该约定从 Horizons
 * 星历重算四事件食分/γ，与目录值互差 < 0.02 断言（实测 ≤ 0.003 / 0.002）。
 *
 * 观测点定稿（🔶 回写需求文档 §0.1；四事件可见区均不含中国——食甚均在北京
 * 白昼/月落后，据实登记；选点判据 = 食全程可见 + 食甚月亮高度角最优）：
 * - l2029：巴西圣保罗 23.5505°S 46.6333°W（食甚天顶点 23S 50W 近旁，月高 87°）；
 * - l2026：巴西玛瑙斯 3.1019°S 60.0250°W（天顶点 9S 63W 近旁，月高 83°）；
 * - l2027：尼日利亚拉各斯 6.5244°N 3.3792°E（天顶点 10N 15E 近旁，月高 78°）；
 * - l1992：西班牙马德里 40.4168°N 3.7038°W（欧洲 L=0 观测报告带，月高 72°）。
 *
 * danjonDefault 依据（🔶 回写）：l1992 = 0（皮纳图博火山后实测评级，观测值）；
 * l2029 = 2（γ≈0.012 中心月食穿本影最深处，取「深红/铁锈」深食典型档，教学预设）；
 * l2026 = 3（偏食本影段典型砖红档）；l2027 = 3（半影食 L 不适用，仅滑杆中性初值）。
 *
 * selenelion 组合评估（🔶 M1 完成，结论供 M5/B9）：l1992 北京存在**真实全食段
 * selenelion**——1992-12-10 晨（UT 23:15–23:35 / 北京时 07:15–07:35）全食血月
 * 西北方沉落（几何高度 +0.7°→−0.9°）与太阳东南方升起（−1.6°→+0.0°）重叠，
 * 计入 ~0.6° 折射抬升双天体同现（Horizons 站心序列核算 2026-08-19）；
 * l2029 里斯本有偏食段组合（U4 前 05:05–05:20 UT，备选）。M5 采用真实组合。
 *
 * 已知近似登记（§1.6）：站心序列 AIRLESS（折射不建模）；geo 时标 TDB→UTC 按
 * TT−UTC = 69.184s（Horizons 冻结末知闰秒口径，2026/2027/2029）与 59.184s
 * （1992 实历闰秒），与目录预测 ΔT（75–77s）差 ≤ 8s，被接触时刻互差 60s 域吸收。
 *
 * 产物 schema（契约 C2）：
 * { events: [{ id, dateUtc, saros, kind, umbralMag, penumbralMag, gamma,
 *   danjonDefault, observer, contacts:{p1,u1,u2,max,u3,u4,p4}（偏食 u2/u3 = null、
 *   半影食仅 p1/max/p4）, topo:{t0,dtSec,rows}, geo:{t0,dtSec,rows} }] }
 * topo 行 = [moonAlt, moonAz, moonSdDeg, sunAlt]（度；P1−30min→P4+30min @60s）；
 * geo 行 = [sunUx,sunUy,sunUz,sunDistKm,moonUx,moonUy,moonUz,moonDistKm]
 * （J2000 赤道系单位方向 + 距离 km；食甚 ±12h @300s）；contacts/t0 = UTC 秒。
 *
 * 自校验（需求 §6）：事件数=4、采样严格单调、接触时刻落窗内、全食事件食甚
 * kind='total'、半影事件全程不触本影、食分/γ vs 目录互差 <0.02、几何反解接触
 * 时刻 vs 权威值互差 <60s、产物 <400 KB；失败 process.exit(1)。
 * 幂等：产物为快照纯函数。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const GSFC_BASE = 'https://eclipse.gsfc.nasa.gov';

/** 产物体积上限（B；契约 C2 目标 <400 KB） */
const PRODUCT_SIZE_LIMIT_BYTES = 400 * 1024;

/** 几何反解 vs 权威接触时刻互差上限（秒，需求 §1.2——月食演变慢，较日食放宽一档） */
const CONTACT_CROSS_CHECK_MAX_SEC = 60;

/** 食分/γ vs 5MCLE 目录互差上限（Danjon 约定对齐的机器证据，实测 ≤0.003/0.002） */
const MAGNITUDE_CROSS_CHECK_MAX = 0.02;

// ---------------------------------------------------------------------------
// 影锥几何镜像（src/utils/lunarEclipse.ts 同式——bake 走裸 node 无 @ 别名；
// Danjon 1.01 约定与常数登记见该模块文件头，此处照式镜像不得变形）
// ---------------------------------------------------------------------------

const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const SUN_RADIUS_KM = 695700;
const MOON_MEAN_RADIUS_KM = 1737.4;
const DANJON_SHADOW_ENLARGEMENT = 0.01;

function umbraRadiusKmAtMirror(distKm: number, sunDistKm: number): number {
  const angle =
    (1 + DANJON_SHADOW_ENLARGEMENT) * Math.asin(EARTH_EQUATORIAL_RADIUS_KM / distKm) -
    Math.asin(SUN_RADIUS_KM / sunDistKm) +
    Math.asin(EARTH_EQUATORIAL_RADIUS_KM / sunDistKm);
  return angle <= 0 ? 0 : distKm * Math.tan(angle);
}

function penumbraRadiusKmAtMirror(distKm: number, sunDistKm: number): number {
  const angle =
    (1 + DANJON_SHADOW_ENLARGEMENT) * Math.asin(EARTH_EQUATORIAL_RADIUS_KM / distKm) +
    Math.asin(SUN_RADIUS_KM / sunDistKm) +
    Math.asin(EARTH_EQUATORIAL_RADIUS_KM / sunDistKm);
  return distKm * Math.tan(angle);
}

/** geo 行 → 影轴几何 + 双食分（行布局见文件头 schema） */
function magnitudesFromGeoRow(row: readonly number[]): {
  umbral: number;
  penumbral: number;
  perpKm: number;
} {
  const sunDist = row[3];
  const sx = row[0] * sunDist;
  const sy = row[1] * sunDist;
  const sz = row[2] * sunDist;
  const moonDist = row[7];
  const mx = row[4] * moonDist;
  const my = row[5] * moonDist;
  const mz = row[6] * moonDist;
  const ax = -sx / sunDist;
  const ay = -sy / sunDist;
  const az = -sz / sunDist;
  const axial = mx * ax + my * ay + mz * az;
  const perp = Math.hypot(mx - axial * ax, my - axial * ay, mz - axial * az);
  const rU = umbraRadiusKmAtMirror(axial, sunDist);
  const rP = penumbraRadiusKmAtMirror(axial, sunDist);
  return {
    umbral: (rU + MOON_MEAN_RADIUS_KM - perp) / (2 * MOON_MEAN_RADIUS_KM),
    penumbral: (rP + MOON_MEAN_RADIUS_KM - perp) / (2 * MOON_MEAN_RADIUS_KM),
    perpKm: perp,
  };
}

// ---------------------------------------------------------------------------
// 事件登记表
// ---------------------------------------------------------------------------

type LunarKind = 'total' | 'partial' | 'penumbral';

interface EventSpec {
  id: 'l2029' | 'l2026' | 'l2027' | 'l1992';
  /** 5MCLE 世纪目录页快照名 + 原始 URL（--fetch-lunar-eclipses 重拉用） */
  catalogSnapshot: string;
  catalogUrl: string;
  /** 目录行日期键（"2029 Jun 26"） */
  catalogDateKey: string;
  /** 观测点（定稿登记见文件头） */
  observer: { latDeg: number; lonDeg: number; altM: number; label: string };
  /** 丹戎滑杆初值（依据登记见文件头） */
  danjonDefault: number;
  /** geo 序列 TDB→UTC 差值（秒；登记近似见文件头） */
  tdbMinusUtcSec: number;
  /** Horizons 抓取窗口（[start, stop, step]；topo=UT，geo=TDB 默认口径同日食） */
  fetchTopo: [string, string, string];
  fetchGeo: [string, string, string];
}

const EVENTS: readonly EventSpec[] = [
  {
    id: 'l2029',
    catalogSnapshot: 'le-lecat5-2001-2100.html.gz',
    catalogUrl: `${GSFC_BASE}/LEcat5/LE2001-2100.html`,
    catalogDateKey: '2029 Jun 26',
    observer: {
      latDeg: -23.5505,
      lonDeg: -46.6333,
      altM: 760,
      label: 'São Paulo, Brazil (near zenith point of greatest eclipse)',
    },
    danjonDefault: 2,
    tdbMinusUtcSec: 69.184,
    fetchTopo: ['2029-06-26 00:04', '2029-06-26 06:40', '1m'],
    fetchGeo: ['2029-06-25 15:20', '2029-06-26 15:25', '5m'],
  },
  {
    id: 'l2026',
    catalogSnapshot: 'le-lecat5-2001-2100.html.gz',
    catalogUrl: `${GSFC_BASE}/LEcat5/LE2001-2100.html`,
    catalogDateKey: '2026 Aug 28',
    observer: {
      latDeg: -3.1019,
      lonDeg: -60.025,
      altM: 92,
      label: 'Manaus, Brazil (near zenith point of greatest eclipse)',
    },
    danjonDefault: 3,
    tdbMinusUtcSec: 69.184,
    fetchTopo: ['2026-08-28 00:53', '2026-08-28 07:32', '1m'],
    fetchGeo: ['2026-08-27 16:10', '2026-08-28 16:15', '5m'],
  },
  {
    id: 'l2027',
    catalogSnapshot: 'le-lecat5-2001-2100.html.gz',
    catalogUrl: `${GSFC_BASE}/LEcat5/LE2001-2100.html`,
    catalogDateKey: '2027 Feb 20',
    observer: {
      latDeg: 6.5244,
      lonDeg: 3.3792,
      altM: 40,
      label: 'Lagos, Nigeria (near zenith point of greatest eclipse)',
    },
    danjonDefault: 3,
    tdbMinusUtcSec: 69.184,
    fetchTopo: ['2027-02-20 20:42', '2027-02-21 01:44', '1m'],
    fetchGeo: ['2027-02-20 11:10', '2027-02-21 11:15', '5m'],
  },
  {
    id: 'l1992',
    catalogSnapshot: 'le-lecat5-1901-2000.html.gz',
    catalogUrl: `${GSFC_BASE}/LEcat5/LE1901-2000.html`,
    catalogDateKey: '1992 Dec 09',
    observer: {
      latDeg: 40.4168,
      lonDeg: -3.7038,
      altM: 650,
      label: 'Madrid, Spain (European L=0 observation belt)',
    },
    danjonDefault: 0,
    tdbMinusUtcSec: 59.184,
    fetchTopo: ['1992-12-09 20:27', '1992-12-10 03:02', '1m'],
    // 终点须 ≥ 食甚+12h 的 TDB 时刻（TDB−59.184s=UTC，11:45 差 5s，取 11:50）
    fetchGeo: ['1992-12-09 11:40', '1992-12-10 11:50', '5m'],
  },
];

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function failLunar(message: string): never {
  console.error(`[bake-data] lunar_eclipses 自校验失败：${message}`);
  process.exit(1);
}

function assertLunar(condition: boolean, message: string): void {
  if (!condition) failLunar(message);
}

/** 四舍五入到 digits 位小数，-0 归一为 0（输出字节级幂等） */
function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  const r = Math.round(value * factor) / factor;
  return r === 0 ? 0 : r;
}

function readSnapshotText(snapshotDir: string, file: string): string {
  return gunzipSync(readFileSync(join(snapshotDir, file))).toString('utf8');
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** Horizons 日期串（"2029-Jun-26 03:22[:01.000]"）→ UTC 秒 */
function unixSecFromHorizonsDate(text: string): number {
  const m = /^(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(
    text.trim()
  );
  if (!m) failLunar(`无法解析 Horizons 时间：${text}`);
  const month = MONTHS[m[2]];
  if (month === undefined) failLunar(`未知月份缩写：${m[2]}`);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  return (
    Date.UTC(Number(m[1]), month, Number(m[3]), Number(m[4]), Number(m[5])) / 1000 + sec
  );
}

// ---------------------------------------------------------------------------
// 5MCLE 世纪目录页解析（Espenak & Meeus 权威元数据）
// ---------------------------------------------------------------------------

interface CatalogRow {
  dateUtc: string;
  /** 食甚 TD（UTC 秒计的 TD 时刻，未减 ΔT） */
  greatestTdSec: number;
  deltaTSec: number;
  saros: number;
  kind: LunarKind;
  gamma: number;
  penumbralMag: number;
  umbralMag: number;
  /** 三段时长（分钟；缺段为 null） */
  penDurMin: number;
  parDurMin: number | null;
  totDurMin: number | null;
}

/**
 * 目录行解析：剥 HTML 标签后按列位正则取值。行样例（剥标签后）：
 * "09716  2029 Jun 26  03:23:22     77    364  130   T+  pp   0.0124  2.8266  1.8436  335.1  219.5  101.9   23S   50W"
 */
function parseCatalogRow(html: string, dateKey: string): CatalogRow {
  const lines = html.split('\n').filter((line) => line.includes(dateKey));
  const stripped = lines
    .map((line) => line.replace(/<[^>]*>/g, ''))
    .find((line) => /^\d{5}\s/.test(line.trim()));
  if (!stripped) failLunar(`5MCLE 目录页缺少 ${dateKey} 行`);
  const m =
    /^\s*\d{5}\s+(\d{4}) ([A-Z][a-z]{2}) (\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(-?\d+)\s+-?\d+\s+(\d+)\s+([TPN])[+*-]?\s+\S+\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(\d+\.\d+|-)\s+(\d+\.\d+|-)\s+(\d+\.\d+|-)\s/.exec(
      `${stripped} `
    );
  if (!m) failLunar(`5MCLE 目录行无法解析：${stripped}`);
  const month = MONTHS[m[2]];
  if (month === undefined) failLunar(`未知月份缩写：${m[2]}`);
  const kindMap: Record<string, LunarKind> = { T: 'total', P: 'partial', N: 'penumbral' };
  const durOf = (s: string): number | null => (s === '-' ? null : Number(s));
  const penDur = durOf(m[13]);
  if (penDur === null) failLunar(`${dateKey} 半影段时长缺失`);
  return {
    dateUtc: `${m[1]}-${String(month + 1).padStart(2, '0')}-${m[3]}`,
    greatestTdSec:
      Date.UTC(Number(m[1]), month, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) / 1000,
    deltaTSec: Number(m[7]),
    saros: Number(m[8]),
    kind: kindMap[m[9]],
    gamma: Number(m[10]),
    penumbralMag: Number(m[11]),
    umbralMag: Number(m[12]),
    penDurMin: penDur,
    parDurMin: durOf(m[14]),
    totDurMin: durOf(m[15]),
  };
}

// ---------------------------------------------------------------------------
// Horizons 快照解析
// ---------------------------------------------------------------------------

interface TopoSample {
  tSec: number;
  azDeg: number;
  elDeg: number;
  /** 视半径（度；仅月球快照有，太阳快照为 null） */
  sdDeg: number | null;
}

/** OBSERVER CSV（月 QUANTITIES=4,13 / 日 QUANTITIES=4）→ 采样数组（时刻升序） */
function parseTopoSnapshot(text: string, withAngDiam: boolean): TopoSample[] {
  const block = /\$\$SOE\n([\s\S]*?)\$\$EOE/.exec(text);
  if (!block) failLunar('Horizons OBSERVER 快照缺少 $$SOE/$$EOE 段');
  const out: TopoSample[] = [];
  const expected = withAngDiam ? 6 : 5;
  for (const line of block[1].split('\n')) {
    if (line.trim().length === 0) continue;
    const parts = line.split(',').map((s) => s.trim());
    // [日期, 太阳标记, 月下标记, Az, El(, 角直径), '']
    assertLunar(parts.length >= expected, `OBSERVER 行列数异常：${line}`);
    const nums = parts.slice(3, expected).map(Number);
    assertLunar(nums.every(Number.isFinite), `OBSERVER 行含非数值：${line}`);
    out.push({
      tSec: unixSecFromHorizonsDate(parts[0]),
      azDeg: nums[0],
      elDeg: nums[1],
      sdDeg: withAngDiam ? nums[2] / 2 / 3600 : null,
    });
  }
  assertLunar(out.length >= 100, `OBSERVER 快照行数 ${out.length} 异常偏少`);
  for (let i = 1; i < out.length; i += 1) {
    assertLunar(out[i].tSec > out[i - 1].tSec, 'OBSERVER 快照时间未严格单调');
  }
  return out;
}

interface GeoSampleRaw {
  tdbSec: number;
  xKm: number;
  yKm: number;
  zKm: number;
}

/** VECTORS CSV（VEC_TABLE=1）→ 采样数组（TDB 秒） */
function parseGeoSnapshot(text: string): GeoSampleRaw[] {
  const block = /\$\$SOE\n([\s\S]*?)\$\$EOE/.exec(text);
  if (!block) failLunar('Horizons VECTORS 快照缺少 $$SOE/$$EOE 段');
  const out: GeoSampleRaw[] = [];
  for (const line of block[1].split('\n')) {
    if (line.trim().length === 0) continue;
    const parts = line.split(',').map((s) => s.trim());
    // [JDTDB, 日期(TDB), X, Y, Z, '']
    assertLunar(parts.length >= 5, `VECTORS 行列数异常：${line}`);
    const date = parts[1].replace(/^A\.D\.\s+/, '').replace(/\.\d+$/, '');
    const nums = parts.slice(2, 5).map(Number);
    assertLunar(nums.every(Number.isFinite), `VECTORS 行含非数值：${line}`);
    out.push({ tdbSec: unixSecFromHorizonsDate(date), xKm: nums[0], yKm: nums[1], zKm: nums[2] });
  }
  assertLunar(out.length >= 100, `VECTORS 快照行数 ${out.length} 异常偏少`);
  for (let i = 1; i < out.length; i += 1) {
    assertLunar(out[i].tdbSec > out[i - 1].tdbSec, 'VECTORS 快照时间未严格单调');
  }
  return out;
}

// ---------------------------------------------------------------------------
// 产物组装
// ---------------------------------------------------------------------------

interface SeriesProduct {
  t0: number;
  dtSec: number;
  rows: number[][];
}

interface LunarContacts {
  p1: number;
  u1: number | null;
  u2: number | null;
  max: number;
  u3: number | null;
  u4: number | null;
  p4: number;
}

/** 目录行 → 接触时刻（UTC 秒；食甚 ± 时长/2，文件头登记的官方同法） */
function contactsFromCatalog(row: CatalogRow): LunarContacts {
  const greatest = row.greatestTdSec - row.deltaTSec;
  const half = (min: number | null): number | null => (min === null ? null : (min * 60) / 2);
  const pen = half(row.penDurMin) as number;
  const par = half(row.parDurMin);
  const tot = half(row.totDurMin);
  return {
    p1: greatest - pen,
    u1: par === null ? null : greatest - par,
    u2: tot === null ? null : greatest - tot,
    max: greatest,
    u3: tot === null ? null : greatest + tot,
    u4: par === null ? null : greatest + par,
    p4: greatest + pen,
  };
}

/** 从对齐的月/日站心采样窗口切片组装 topo 行序列 */
function buildTopoSeries(
  moon: TopoSample[],
  sun: TopoSample[],
  windowStartSec: number,
  windowEndSec: number,
  dtSec: number
): SeriesProduct {
  assertLunar(moon.length === sun.length, 'topo 月/日快照行数不一致');
  const t0Snapshot = moon[0].tSec;
  const startIdx = Math.floor((windowStartSec - t0Snapshot) / dtSec);
  const endIdx = Math.ceil((windowEndSec - t0Snapshot) / dtSec);
  assertLunar(startIdx >= 0 && endIdx < moon.length, 'topo 采样窗越出快照范围');
  const rows: number[][] = [];
  for (let i = startIdx; i <= endIdx; i += 1) {
    const m = moon[i];
    const s = sun[i];
    assertLunar(m.tSec === s.tSec, `topo 月/日时间戳错位 @${m.tSec}`);
    assertLunar(m.tSec === t0Snapshot + i * dtSec, `topo 快照采样间隔非 ${dtSec}s @${m.tSec}`);
    assertLunar(m.sdDeg !== null, 'topo 月球快照缺视直径列');
    rows.push([
      roundTo(m.elDeg, 5),
      roundTo(m.azDeg, 5),
      roundTo(m.sdDeg as number, 6),
      roundTo(s.elDeg, 5),
    ]);
  }
  return { t0: t0Snapshot + startIdx * dtSec, dtSec, rows };
}

/** geo 序列（TDB→UTC；单位方向 + 距离；solarEclipses.ts buildGeoSeries 同式） */
function buildGeoSeries(
  sun: GeoSampleRaw[],
  moon: GeoSampleRaw[],
  tdbMinusUtcSec: number,
  dtSec: number
): SeriesProduct {
  assertLunar(sun.length === moon.length, 'geo 日/月快照行数不一致');
  const rows: number[][] = [];
  for (let i = 0; i < sun.length; i += 1) {
    const s = sun[i];
    const m = moon[i];
    assertLunar(s.tdbSec === m.tdbSec, `geo 日/月时间戳错位 @${s.tdbSec}`);
    const sd = Math.hypot(s.xKm, s.yKm, s.zKm);
    const md = Math.hypot(m.xKm, m.yKm, m.zKm);
    assertLunar(sd > 1.4e8 && sd < 1.6e8, `太阳地心距 ${sd} km 越界`);
    assertLunar(md > 3.5e5 && md < 4.1e5, `月球地心距 ${md} km 越界`);
    rows.push([
      roundTo(s.xKm / sd, 7),
      roundTo(s.yKm / sd, 7),
      roundTo(s.zKm / sd, 7),
      roundTo(sd, 1),
      roundTo(m.xKm / md, 7),
      roundTo(m.yKm / md, 7),
      roundTo(m.zKm / md, 7),
      roundTo(md, 1),
    ]);
  }
  return { t0: Math.round(sun[0].tdbSec - tdbMinusUtcSec), dtSec, rows };
}

/** 星历几何反解接触时刻（食分过零线性求根 + 食甚三点抛物线顶点，校验用） */
function deriveContactsFromGeo(series: SeriesProduct): {
  p1: number | null;
  u1: number | null;
  u2: number | null;
  max: number;
  u3: number | null;
  u4: number | null;
  p4: number | null;
} {
  const mags = series.rows.map((row) => magnitudesFromGeoRow(row));
  const crossings = (f: (i: number) => number): number[] => {
    const out: number[] = [];
    for (let i = 1; i < series.rows.length; i += 1) {
      const g0 = f(i - 1);
      const g1 = f(i);
      if (g0 === 0 || g0 * g1 < 0) {
        out.push(series.t0 + (i - 1) * series.dtSec + (g0 / (g0 - g1)) * series.dtSec);
      }
    }
    return out;
  };
  const pen = crossings((i) => mags[i].penumbral);
  const umb = crossings((i) => mags[i].umbral);
  const tot = crossings((i) => mags[i].umbral - 1);
  // 食甚 = 垂距最小：离散最小值 + 三点抛物线顶点细化。用 perp²（匀速线性
  // 相对运动下严格二次；perp 本身在近中心食时呈 V 形，顶点拟合有偏）
  let minIdx = 0;
  for (let i = 1; i < mags.length; i += 1) {
    if (mags[i].perpKm < mags[minIdx].perpKm) minIdx = i;
  }
  let maxT = series.t0 + minIdx * series.dtSec;
  if (minIdx > 0 && minIdx < mags.length - 1) {
    const y0 = mags[minIdx - 1].perpKm ** 2;
    const y1 = mags[minIdx].perpKm ** 2;
    const y2 = mags[minIdx + 1].perpKm ** 2;
    const denom = y0 - 2 * y1 + y2;
    if (denom > 0) maxT += ((y0 - y2) / (2 * denom)) * series.dtSec;
  }
  return {
    p1: pen.length >= 2 ? pen[0] : null,
    u1: umb.length >= 2 ? umb[0] : null,
    u2: tot.length >= 2 ? tot[0] : null,
    max: maxT,
    u3: tot.length >= 2 ? tot[tot.length - 1] : null,
    u4: umb.length >= 2 ? umb[umb.length - 1] : null,
    p4: pen.length >= 2 ? pen[pen.length - 1] : null,
  };
}

export interface LunarEclipseEventProduct {
  id: string;
  dateUtc: string;
  saros: number;
  kind: LunarKind;
  umbralMag: number;
  penumbralMag: number;
  gamma: number;
  danjonDefault: number;
  observer: { latDeg: number; lonDeg: number; altM: number; label: string };
  contacts: LunarContacts;
  topo: SeriesProduct;
  geo: SeriesProduct;
}

export interface LunarEclipsesProduct {
  events: LunarEclipseEventProduct[];
}

/**
 * 烘焙主入口：读快照 → 目录权威元数据/接触时刻 → 切片组装序列 → 自校验 → 返回产物。
 */
export function bakeLunarEclipses(snapshotDir: string): LunarEclipsesProduct {
  const events: LunarEclipseEventProduct[] = [];
  for (const spec of EVENTS) {
    const catalogHtml = readSnapshotText(snapshotDir, spec.catalogSnapshot);
    const row = parseCatalogRow(catalogHtml, spec.catalogDateKey);
    const contacts = contactsFromCatalog(row);

    const topoMoon = parseTopoSnapshot(
      readSnapshotText(snapshotDir, `le-${spec.id}-topo-moon.txt.gz`),
      true
    );
    const topoSun = parseTopoSnapshot(
      readSnapshotText(snapshotDir, `le-${spec.id}-topo-sun.txt.gz`),
      false
    );
    const geoSun = parseGeoSnapshot(readSnapshotText(snapshotDir, `le-${spec.id}-geo-sun.txt.gz`));
    const geoMoon = parseGeoSnapshot(readSnapshotText(snapshotDir, `le-${spec.id}-geo-moon.txt.gz`));

    // 契约 C2 窗口：topo = P1−30min → P4+30min @60s（对齐快照分钟栅格）
    const topo = buildTopoSeries(
      topoMoon,
      topoSun,
      Math.floor((contacts.p1 - 1800) / 60) * 60,
      Math.ceil((contacts.p4 + 1800) / 60) * 60,
      60
    );
    const geo = buildGeoSeries(geoSun, geoMoon, spec.tdbMinusUtcSec, 300);

    const round1 = (v: number | null): number | null => (v === null ? null : roundTo(v, 1));
    events.push({
      id: spec.id,
      dateUtc: row.dateUtc,
      saros: row.saros,
      kind: row.kind,
      umbralMag: row.umbralMag,
      penumbralMag: row.penumbralMag,
      gamma: row.gamma,
      danjonDefault: spec.danjonDefault,
      observer: spec.observer,
      contacts: {
        p1: roundTo(contacts.p1, 1),
        u1: round1(contacts.u1),
        u2: round1(contacts.u2),
        max: roundTo(contacts.max, 1),
        u3: round1(contacts.u3),
        u4: round1(contacts.u4),
        p4: roundTo(contacts.p4, 1),
      },
      topo,
      geo,
    });
  }

  validateProduct({ events });
  return { events };
}

/** 自校验（需求 §6 + §1.2 星历自洽性） */
function validateProduct(product: LunarEclipsesProduct): void {
  assertLunar(product.events.length === 4, `事件数 ${product.events.length} ≠ 4`);
  assertLunar(
    product.events.map((e) => e.id).join(',') === 'l2029,l2026,l2027,l1992',
    '事件 id 集应为 l2029,l2026,l2027,l1992'
  );
  const expectedKinds: Record<string, LunarKind> = {
    l2029: 'total',
    l2026: 'partial',
    l2027: 'penumbral',
    l1992: 'total',
  };
  for (const ev of product.events) {
    const c = ev.contacts;
    assertLunar(ev.kind === expectedKinds[ev.id], `${ev.id} 类型 ${ev.kind} ≠ ${expectedKinds[ev.id]}`);
    assertLunar(ev.saros > 0 && Number.isInteger(ev.saros), `${ev.id} saros 非法`);
    assertLunar(Math.abs(ev.gamma) < 1.6, `${ev.id} γ=${ev.gamma} 越界`);
    assertLunar(ev.penumbralMag > 0 && ev.penumbralMag < 3.2, `${ev.id} 半影食分越界`);
    assertLunar(
      ev.danjonDefault >= 0 && ev.danjonDefault <= 4,
      `${ev.id} danjonDefault 越界`
    );

    // 类型 ↔ 食分/接触时刻缺省一致性（契约 C2）
    if (ev.kind === 'total') {
      assertLunar(ev.umbralMag > 1, `${ev.id} 全食本影食分 ${ev.umbralMag} 未 >1`);
      assertLunar(
        c.u1 !== null && c.u2 !== null && c.u3 !== null && c.u4 !== null,
        `${ev.id} 全食接触时刻不齐`
      );
    } else if (ev.kind === 'partial') {
      assertLunar(ev.umbralMag > 0 && ev.umbralMag < 1, `${ev.id} 偏食本影食分越界`);
      assertLunar(c.u1 !== null && c.u4 !== null, `${ev.id} 偏食缺 U1/U4`);
      assertLunar(c.u2 === null && c.u3 === null, `${ev.id} 偏食不应有 U2/U3`);
    } else {
      assertLunar(ev.umbralMag < 0, `${ev.id} 半影食本影食分应 <0`);
      assertLunar(
        c.u1 === null && c.u2 === null && c.u3 === null && c.u4 === null,
        `${ev.id} 半影食不应有 U 接触时刻`
      );
    }
    const ordered = [c.p1, c.u1, c.u2, c.max, c.u3, c.u4, c.p4].filter(
      (v): v is number => v !== null
    );
    for (let i = 1; i < ordered.length; i += 1) {
      assertLunar(ordered[i] > ordered[i - 1], `${ev.id} 接触时刻未按 P1<…<P4 排序`);
    }

    // 采样窗覆盖（契约 C2）
    const topoEnd = ev.topo.t0 + (ev.topo.rows.length - 1) * ev.topo.dtSec;
    assertLunar(
      ev.topo.t0 <= c.p1 - 1800 + 60 && topoEnd >= c.p4 + 1800 - 60,
      `${ev.id} topo 窗未覆盖 P1−30min → P4+30min`
    );
    assertLunar(ev.topo.dtSec === 60 && ev.geo.dtSec === 300, `${ev.id} 采样间隔不符契约`);
    const geoEnd = ev.geo.t0 + (ev.geo.rows.length - 1) * ev.geo.dtSec;
    assertLunar(
      ev.geo.t0 <= c.max - 12 * 3600 && geoEnd >= c.max + 12 * 3600,
      `${ev.id} geo 窗未覆盖食甚 ±12h`
    );

    // 行域校验
    for (const row of ev.topo.rows) {
      assertLunar(row.length === 4 && row.every(Number.isFinite), `${ev.id} topo 行非法`);
      assertLunar(row[0] > -90 && row[0] < 90 && row[3] > -90 && row[3] < 90, `${ev.id} 高度角越界`);
      assertLunar(row[1] >= 0 && row[1] < 360, `${ev.id} 方位角越界`);
      assertLunar(row[2] > 0.24 && row[2] < 0.3, `${ev.id} 月球视半径越界`);
    }
    for (const row of ev.geo.rows) {
      assertLunar(row.length === 8 && row.every(Number.isFinite), `${ev.id} geo 行非法`);
      const sn = Math.hypot(row[0], row[1], row[2]);
      const mn = Math.hypot(row[4], row[5], row[6]);
      assertLunar(Math.abs(sn - 1) < 1e-5 && Math.abs(mn - 1) < 1e-5, `${ev.id} geo 方向未归一`);
    }

    // 食甚月亮在观测点地平之上（选点判据「食全程可见」的窗内证据：全窗月高 > 0）
    for (const row of ev.topo.rows) {
      assertLunar(row[0] > 0, `${ev.id} topo 窗内月亮高度角 ${row[0]} ≤ 0（食程不可见）`);
    }

    // 食分/γ vs 目录互差（Danjon 约定对齐证据）：食甚行几何重算
    const maxIdx = Math.min(
      Math.max(Math.round((c.max - ev.geo.t0) / ev.geo.dtSec), 0),
      ev.geo.rows.length - 1
    );
    const atMax = magnitudesFromGeoRow(ev.geo.rows[maxIdx]);
    assertLunar(
      Math.abs(atMax.umbral - ev.umbralMag) < MAGNITUDE_CROSS_CHECK_MAX,
      `${ev.id} 本影食分重算 ${atMax.umbral.toFixed(4)} vs 目录 ${ev.umbralMag} 互差超限`
    );
    assertLunar(
      Math.abs(atMax.penumbral - ev.penumbralMag) < MAGNITUDE_CROSS_CHECK_MAX,
      `${ev.id} 半影食分重算 ${atMax.penumbral.toFixed(4)} vs 目录 ${ev.penumbralMag} 互差超限`
    );
    assertLunar(
      Math.abs(atMax.perpKm / EARTH_EQUATORIAL_RADIUS_KM - Math.abs(ev.gamma)) <
        MAGNITUDE_CROSS_CHECK_MAX,
      `${ev.id} γ 重算互差超限`
    );

    // 半影事件全程不触本影（需求 §6）
    if (ev.kind === 'penumbral') {
      for (const row of ev.geo.rows) {
        assertLunar(
          magnitudesFromGeoRow(row).umbral < 0,
          `${ev.id} 半影事件出现本影接触（umbralMag ≥ 0）`
        );
      }
    }

    // 几何反解接触时刻 vs 权威值互差 <60s（§1.2 自洽性）
    const derived = deriveContactsFromGeo(ev.geo);
    const checks: Array<[string, number | null, number | null]> = [
      ['P1', c.p1, derived.p1],
      ['U1', c.u1, derived.u1],
      ['U2', c.u2, derived.u2],
      ['MAX', c.max, derived.max],
      ['U3', c.u3, derived.u3],
      ['U4', c.u4, derived.u4],
      ['P4', c.p4, derived.p4],
    ];
    for (const [name, authoritative, derivedT] of checks) {
      if (authoritative === null) continue; // 缺省锚点跳过（偏食/半影食）
      assertLunar(derivedT !== null, `${ev.id} 几何反解缺 ${name}`);
      const diff = Math.abs((derivedT as number) - authoritative);
      assertLunar(
        diff < CONTACT_CROSS_CHECK_MAX_SEC,
        `${ev.id} ${name} 目录 vs 星历反解互差 ${diff.toFixed(1)}s ≥ ${CONTACT_CROSS_CHECK_MAX_SEC}s`
      );
    }
  }

  const size = Buffer.byteLength(JSON.stringify(product));
  assertLunar(
    size < PRODUCT_SIZE_LIMIT_BYTES,
    `产物 ${size} B 超出 ${PRODUCT_SIZE_LIMIT_BYTES} B 上限`
  );
}

// ---------------------------------------------------------------------------
// --fetch-lunar-eclipses：重拉 Horizons + GSFC 快照（需网络）
// ---------------------------------------------------------------------------

async function fetchText(url: string, params?: Record<string, string>): Promise<string> {
  // format 参数须裸值，其余按 Horizons 惯例加单引号（2026-08 起服务端严检 format）
  const full = params
    ? `${url}?${new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).map(([k, v]) => [k, k === 'format' ? v : `'${v}'`])
        )
      ).toString()}`
    : url;
  // Horizons 偶发 503 限流：指数退避重试（仅 fetch 模式，离线烘焙不走此路径）
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(full, { headers: { 'User-Agent': 'Mozilla/5.0 (bake-data)' } });
    if (res.ok) return res.text();
    if (res.status === 503 && attempt < 4) {
      const waitMs = 15000 * (attempt + 1);
      console.log(`[bake-data] HTTP 503（限流），${waitMs / 1000}s 后重试…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    failLunar(`${url} 返回 HTTP ${res.status}（离线时去掉 --fetch-lunar-eclipses）`);
  }
}

function horizonsTopoParams(
  body: string,
  site: string,
  window: [string, string, string],
  quantities: string
): Record<string, string> {
  return {
    COMMAND: body,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@399',
    COORD_TYPE: 'GEODETIC',
    SITE_COORD: site,
    START_TIME: window[0],
    STOP_TIME: window[1],
    STEP_SIZE: window[2],
    QUANTITIES: quantities,
    ANG_FORMAT: 'DEG',
    APPARENT: 'AIRLESS',
    EXTRA_PREC: 'YES',
    CSV_FORMAT: 'YES',
  };
}

function horizonsGeoParams(body: string, window: [string, string, string]): Record<string, string> {
  return {
    COMMAND: body,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: '500@399',
    REF_PLANE: 'FRAME',
    VEC_TABLE: '1',
    OUT_UNITS: 'KM-S',
    CSV_FORMAT: 'YES',
    VEC_LABELS: 'NO',
    START_TIME: window[0],
    STOP_TIME: window[1],
    STEP_SIZE: window[2],
  };
}

/** --fetch-lunar-eclipses：重拉全部快照（16 份 Horizons + 2 份 GSFC 目录页） */
export async function refetchLunarEclipseSnapshots(snapshotDir: string): Promise<void> {
  console.log('[bake-data] --fetch-lunar-eclipses：重拉 JPL Horizons 与 NASA GSFC 快照…');
  const catalogs = new Map<string, string>();
  for (const spec of EVENTS) catalogs.set(spec.catalogSnapshot, spec.catalogUrl);
  for (const [file, url] of catalogs) {
    const text = await fetchText(url);
    assertLunar(text.length > 5000, `${file} 响应过短（${text.length} B），拒绝覆盖快照`);
    writeFileSync(join(snapshotDir, file), gzipSync(text, { level: 9 }));
    console.log(`[bake-data] 快照已更新：${file}`);
  }
  for (const spec of EVENTS) {
    const site = `${spec.observer.lonDeg},${spec.observer.latDeg},${spec.observer.altM / 1000}`;
    const jobs: Array<[string, Promise<string>]> = [
      [
        `le-${spec.id}-topo-moon.txt.gz`,
        fetchText(HORIZONS_API, {
          format: 'text',
          ...horizonsTopoParams('301', site, spec.fetchTopo, '4,13'),
        }),
      ],
      [
        `le-${spec.id}-topo-sun.txt.gz`,
        fetchText(HORIZONS_API, {
          format: 'text',
          ...horizonsTopoParams('10', site, spec.fetchTopo, '4'),
        }),
      ],
      [
        `le-${spec.id}-geo-sun.txt.gz`,
        fetchText(HORIZONS_API, { format: 'text', ...horizonsGeoParams('10', spec.fetchGeo) }),
      ],
      [
        `le-${spec.id}-geo-moon.txt.gz`,
        fetchText(HORIZONS_API, { format: 'text', ...horizonsGeoParams('301', spec.fetchGeo) }),
      ],
    ];
    for (const [file, promise] of jobs) {
      const text = await promise;
      assertLunar(text.length > 5000, `${file} 响应过短（${text.length} B），拒绝覆盖快照`);
      writeFileSync(join(snapshotDir, file), gzipSync(text, { level: 9 }));
      console.log(`[bake-data] 快照已更新：${file}`);
    }
  }
  const metaPath = join(snapshotDir, 'lunar-eclipses.meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(
    metaPath,
    `${JSON.stringify({ ...meta, retrievedAt: new Date().toISOString() }, null, 2)}\n`
  );
}
