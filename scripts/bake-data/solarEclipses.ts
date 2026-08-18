/**
 * E 迭代 M1-1 三事件权威星历烘焙：JPL Horizons + NASA Eclipse Web Site (Espenak)
 * → public/data/solar_eclipses.json（契约 C2）
 *
 * 数据来源登记（IMPROVEMENT_REQUIREMENTS_SOLAR_ECLIPSE §6 / 契约 C2）：
 * - JPL Horizons API（https://ssd.jpl.nasa.gov/api/horizons.api，DE441）：
 *   站心视位置序列（OBSERVER：RA/Dec 视位置 + Az/El AIRLESS + 视直径）与
 *   地心 J2000(ICRF) 赤道系向量序列（VECTORS，km）；
 * - NASA Eclipse Web Site（Fred Espenak, GSFC）：贝塞尔要素（google 页内嵌
 *   `var elements` 段）、全食带路径表（path 页中心线折线 + 时长）、事件元数据
 *   （saros/类型）。需求原定 EclipseWise.com 校核，抓取时返回 403（反爬），
 *   替换为同作者一手 NASA 页面，来源等级不降（差异登记需求文档 §M1-1）。
 * - 快照：scripts/bake-data/snapshots/se-*.gz + solar-eclipses.meta.json
 *   （source/query/retrievedAt/license），默认离线烘焙；--fetch-eclipses 重拉。
 *
 * 接触时刻（契约 C2 contacts，权威值）：由 Espenak 贝塞尔要素 + 观测点按
 * NASA SEgoogle/SEcirc.js（Espenak/Jubier）本地事件圈算法逐式移植计算——
 * 与 NASA 官方交互地图弹窗数值同源同式。ΔT 取要素内嵌值（2027:71.7s /
 * 2035:80.6s / 1919:21.0s，Espenak 口径）。
 *
 * 观测点定稿（🔶 回写需求文档 §0.1）：
 * - e2027：Espenak GD（最长全食持续点）26.81642°N 31.13257°E（埃及新河谷省），
 *   全食 6m23.1s（本算法）；
 * - e2035：Espenak 路径表 00:34 UT 中心线点 40.105°N 116.85833°E（北京市郊
 *   怀柔—密云一带），全食 1m50.7s——中文受众代入感最强的中心线陆地点；
 * - e1919：巴西 Sobral 3.6883°S 40.3497°W（1919 Eddington 实验决定性数据站，
 *   距中心线 ~18 km），全食 5m13.7s；Príncipe 偏离中心线 ~0.33°、当日多云，
 *   数据完备性取 Sobral。事件最长全食 6m50.7s（大西洋 GE 点，Espenak 路径表）。
 *
 * 已知近似登记（§1.5）：
 * - 观测点海拔取整近似（300/60/70 m，对接触时刻影响 <1s）；
 * - geo 序列时标由 TDB 换算 UTC：2027/2035 按 TT−UTC=69.184s（Horizons 冻结
 *   末知闰秒口径）、1919 按 ΔT=21.0s（Espenak）视 UT1 为 UTC；
 * - 1919 无 UTC 定义，全部时刻为 UT1 视作 UTC。
 *
 * 产物 schema（契约 C2；fineC2/fineC3 为 1s 细采样段的结构化落点，
 * 差异登记需求文档 §0.3 C2）：
 * { events: [{ id, dateUtc, saros, kind, magnitude, gammaAbs, observer,
 *   contacts:{c1,c2,max,c3,c4}, topo:{t0,dtSec,rows}, fineC2, fineC3,
 *   geo:{t0,dtSec,rows}, path:[[lat,lon,durSec],…] }] }
 * topo 行 = [sunAlt,sunAz,sunSdDeg,moonAlt,moonAz,moonSdDeg,posAngleDeg]（度）；
 * geo 行 = [sunUx,sunUy,sunUz,sunDistKm,moonUx,moonUy,moonUz,moonDistKm]
 * （J2000 赤道系单位方向 + 距离 km）；contacts/t0 为 UTC 秒（Unix 纪元）。
 *
 * 自校验（需求 §6）：事件数=3、采样严格单调、接触时刻落在采样窗内、
 * 全食事件食甚遮挡率≈1、贝塞尔接触时刻 vs Horizons 序列几何反解互差 <30s、
 * 产物合计 <500 KB；失败 process.exit(1)。幂等：产物为快照纯函数。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const GSFC_BASE = 'https://eclipse.gsfc.nasa.gov';

const DEG = Math.PI / 180;

/** 产物合计体积上限（B；契约 C2 目标 <500 KB） */
const PRODUCT_SIZE_LIMIT_BYTES = 500 * 1024;

/** 贝塞尔 vs 星历几何反解接触时刻互差上限（秒，§1.3） */
const CONTACT_CROSS_CHECK_MAX_SEC = 30;

// ---------------------------------------------------------------------------
// 事件登记表（快照文件名 / 观测点 / TDB→UTC 换算常量）
// ---------------------------------------------------------------------------

interface EventSpec {
  id: 'e2027' | 'e2035' | 'e1919';
  /** GSFC google/path 页快照名（含贝塞尔要素与路径表） */
  googleSnapshot: string;
  pathSnapshot: string;
  /** GSFC 原始 URL（--fetch-eclipses 重拉用） */
  googleUrl: string;
  pathUrl: string;
  /** 观测点（定稿登记见文件头） */
  observer: { latDeg: number; lonDeg: number; altM: number; label: string };
  /** geo 序列 TDB→UTC 差值（秒；登记近似见文件头） */
  tdbMinusUtcSec: number;
  /** Horizons 抓取窗口（--fetch-eclipses 用；[start, stop, stepArg]） */
  fetchTopo: [string, string, string];
  fetchFine: [string, string, string];
  fetchGeo: [string, string, string];
}

const EVENTS: readonly EventSpec[] = [
  {
    id: 'e2027',
    googleSnapshot: 'se-e2027-gsfc-google.html.gz',
    pathSnapshot: 'se-e2027-gsfc-path.html.gz',
    googleUrl: `${GSFC_BASE}/SEgoogle/SEgoogle2001/SE2027Aug02Tgoogle.html`,
    pathUrl: `${GSFC_BASE}/SEpath/SEpath2001/SE2027Aug02Tpath.html`,
    observer: {
      latDeg: 26.81642,
      lonDeg: 31.13257,
      altM: 300,
      label: 'Egypt, New Valley (greatest duration point)',
    },
    tdbMinusUtcSec: 69.184,
    fetchTopo: ['2027-08-02 08:15', '2027-08-02 11:45', '1m'],
    fetchFine: ['2027-08-02 09:52', '2027-08-02 10:09', '1020'],
    fetchGeo: ['2027-08-02 04:00', '2027-08-02 16:00', '2m'],
  },
  {
    id: 'e2035',
    googleSnapshot: 'se-e2035-gsfc-google.html.gz',
    pathSnapshot: 'se-e2035-gsfc-path.html.gz',
    googleUrl: `${GSFC_BASE}/SEgoogle/SEgoogle2001/SE2035Sep02Tgoogle.html`,
    pathUrl: `${GSFC_BASE}/SEpath/SEpath2001/SE2035Sep02Tpath.html`,
    observer: {
      latDeg: 40.105,
      lonDeg: 116.858333,
      altM: 60,
      label: 'Beijing outskirts, China (central line)',
    },
    tdbMinusUtcSec: 69.184,
    fetchTopo: ['2035-09-01 22:15', '2035-09-02 02:15', '1m'],
    fetchFine: ['2035-09-02 00:28', '2035-09-02 00:41', '780'],
    fetchGeo: ['2035-09-01 18:30', '2035-09-02 06:30', '2m'],
  },
  {
    id: 'e1919',
    googleSnapshot: 'se-e1919-gsfc-google.html.gz',
    pathSnapshot: 'se-e1919-gsfc-path.html.gz',
    googleUrl: `${GSFC_BASE}/SEgoogle/SEgoogle1901/SE1919May29Tgoogle.html`,
    pathUrl: `${GSFC_BASE}/SEpath/SEpath1901/SE1919May29Tpath.html`,
    observer: {
      latDeg: -3.6883,
      lonDeg: -40.3497,
      altM: 70,
      label: 'Sobral, Brazil (1919 Eddington expedition site)',
    },
    tdbMinusUtcSec: 21.0,
    fetchTopo: ['1919-05-29 10:25', '1919-05-29 13:50', '1m'],
    fetchFine: ['1919-05-29 11:53', '1919-05-29 12:09', '960'],
    fetchGeo: ['1919-05-29 06:00', '1919-05-29 18:00', '2m'],
  },
];

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function failEclipse(message: string): never {
  console.error(`[bake-data] solar_eclipses 自校验失败：${message}`);
  process.exit(1);
}

function assertEclipse(condition: boolean, message: string): void {
  if (!condition) failEclipse(message);
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

/** Horizons 日期串（"2027-Aug-02 09:58[:01.000]"）→ UTC 秒 */
function unixSecFromHorizonsDate(text: string): number {
  const m = /^(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(
    text.trim()
  );
  if (!m) failEclipse(`无法解析 Horizons 时间：${text}`);
  const month = MONTHS[m[2]];
  if (month === undefined) failEclipse(`未知月份缩写：${m[2]}`);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  return (
    Date.UTC(Number(m[1]), month, Number(m[3]), Number(m[4]), Number(m[5])) / 1000 + sec
  );
}

// ---------------------------------------------------------------------------
// GSFC 页面解析：贝塞尔要素 / saros / 类型 / 路径表
// ---------------------------------------------------------------------------

/** google 页 → 贝塞尔要素数组（27 项，Espenak 官方数值） */
function parseBesselianElements(html: string): number[] {
  const m = /var elements = new Array\(([\s\S]*?)\);/.exec(html);
  if (!m) failEclipse('google 页缺少贝塞尔要素段');
  const values = m[1]
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join(' ')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
  assertEclipse(values.length === 27 && values.every(Number.isFinite), '贝塞尔要素应为 27 个有限数');
  return values;
}

function parseSaros(html: string): number {
  const m = /Saros\s+(\d+)\s+Table/.exec(html);
  if (!m) failEclipse('google 页缺少 Saros 编号');
  return Number(m[1]);
}

function parseKindAndDate(html: string): { kind: string; dateUtc: string } {
  const m = /(Total|Annular|Hybrid|Partial) Solar Eclipse of\s+(\d{4}) ([A-Z][a-z]{2}) (\d{2})/.exec(
    html
  );
  if (!m) failEclipse('页面标题缺少事件类型/日期');
  const month = MONTHS[m[3]];
  if (month === undefined) failEclipse(`未知月份缩写：${m[3]}`);
  return {
    kind: m[1].toLowerCase(),
    dateUtc: `${m[2]}-${String(month + 1).padStart(2, '0')}-${m[4]}`,
  };
}

/** 路径表 → 中心线折线 [[latDeg, lonDeg, durationSec], …] + 最大直径比（事件食分） */
function parsePathTable(html: string): { path: number[][]; maxRatio: number } {
  const pre = /<pre>([\s\S]*?)<\/pre>/.exec(html);
  if (!pre) failEclipse('路径页缺少 <pre> 表');
  const coordRe = /(\d{1,2}) (\d{2}\.\d)([NS]) (\d{3}) (\d{2}\.\d)([EW])/g;
  const path: number[][] = [];
  let maxRatio = 0;
  for (const line of pre[1].split('\n')) {
    if (!/^\s{1,2}(\d{2}:\d{2}|Limits)/.test(line)) continue;
    const coords = [...line.matchAll(coordRe)];
    if (coords.length === 0) continue;
    const central = coords[coords.length - 1];
    const lat = (Number(central[1]) + Number(central[2]) / 60) * (central[3] === 'S' ? -1 : 1);
    const lon = (Number(central[4]) + Number(central[5]) / 60) * (central[6] === 'W' ? -1 : 1);
    const dur = /(\d{2})m(\d{2}\.\d)s\s*$/.exec(line);
    if (!dur) continue;
    const ratio = /\s(\d\.\d{3})\s/.exec(line);
    if (ratio) maxRatio = Math.max(maxRatio, Number(ratio[1]));
    path.push([roundTo(lat, 4), roundTo(lon, 4), roundTo(Number(dur[1]) * 60 + Number(dur[2]), 1)]);
  }
  assertEclipse(path.length >= 30, `路径表中心线行数 ${path.length} 异常偏少`);
  assertEclipse(maxRatio > 1 && maxRatio < 1.1, `直径比 ${maxRatio} 越界 (1, 1.1)`);
  return { path, maxRatio };
}

// ---------------------------------------------------------------------------
// 贝塞尔要素本地事件圈（NASA SEgoogle/SEcirc.js 移植，Espenak/Jubier 算法）
// ---------------------------------------------------------------------------

interface BesselianContacts {
  c1: number;
  c2: number;
  max: number;
  c3: number;
  c4: number;
  /** 食甚时刻月/日视直径比（>1 = 全食） */
  ratio: number;
  isTotal: boolean;
}

/**
 * 本地事件圈求解（SEcirc.js timedependent/timelocdependent/getmid/getc1c4/
 * getc2c3 逐式移植；时间基准：要素 t0 小时 TDT，输出 UT = t0 + t − ΔT/3600）。
 * 返回各接触时刻的 UTC 秒（由事件日期 + UT 小时合成）。
 */
function solveBesselianContacts(
  el: readonly number[],
  observer: EventSpec['observer'],
  dateUtc: string
): BesselianContacts {
  const lat = observer.latDeg * DEG;
  const lonWest = -observer.lonDeg * DEG;
  // 观测点地心量（SEcirc.js readdata 同式，含海拔项）
  const u = Math.atan(0.99664719 * Math.tan(lat));
  const rhoSin = 0.99664719 * Math.sin(u) + (observer.altM / 6378140) * Math.sin(lat);
  const rhoCos = Math.cos(u) + (observer.altM / 6378140) * Math.cos(lat);

  /** c 数组下标语义与 SEcirc.js 一致（0=事件型，1=t 小时，2..30 中间量） */
  const timeLocDependent = (c: number[]): void => {
    const t = c[1];
    c[2] = ((el[8] * t + el[7]) * t + el[6]) * t + el[5];
    c[10] = (3 * el[8] * t + 2 * el[7]) * t + el[6];
    c[3] = ((el[12] * t + el[11]) * t + el[10]) * t + el[9];
    c[11] = (3 * el[12] * t + 2 * el[11]) * t + el[10];
    const d = ((el[15] * t + el[14]) * t + el[13]) * DEG;
    c[4] = d;
    c[5] = Math.sin(d);
    c[6] = Math.cos(d);
    c[12] = (2 * el[15] * t + el[14]) * DEG;
    let mu = (el[18] * t + el[17]) * t + el[16];
    if (mu >= 360) mu -= 360;
    c[7] = mu * DEG;
    c[13] = (2 * el[18] * t + el[17]) * DEG;
    c[8] = (el[21] * t + el[20]) * t + el[19];
    c[14] = 2 * el[21] * t + el[20];
    c[9] = (el[24] * t + el[23]) * t + el[22];
    c[15] = 2 * el[24] * t + el[23];
    c[16] = c[7] - lonWest - el[4] / 13713.44;
    c[17] = Math.sin(c[16]);
    c[18] = Math.cos(c[16]);
    c[19] = rhoCos * c[17];
    c[20] = rhoSin * c[6] - rhoCos * c[18] * c[5];
    c[21] = rhoSin * c[5] + rhoCos * c[18] * c[6];
    c[22] = c[13] * rhoCos * c[18];
    c[23] = c[13] * c[19] * c[5] - c[21] * c[12];
    c[24] = c[2] - c[19];
    c[25] = c[3] - c[20];
    c[26] = c[10] - c[22];
    c[27] = c[11] - c[23];
    c[28] = c[8] - c[21] * el[25];
    c[29] = c[9] - c[21] * el[26];
    c[30] = c[26] * c[26] + c[27] * c[27];
  };

  const mid = new Array<number>(31).fill(0);
  mid[0] = 0;
  timeLocDependent(mid);
  for (let iter = 0, tmp = 1; Math.abs(tmp) > 1e-6 && iter < 50; iter += 1) {
    tmp = (mid[24] * mid[26] + mid[25] * mid[27]) / mid[30];
    mid[1] -= tmp;
    timeLocDependent(mid);
  }
  const m = Math.hypot(mid[24], mid[25]);
  const magnitude = (mid[28] - m) / (mid[28] + mid[29]);
  assertEclipse(magnitude > 0, '观测点无食（贝塞尔求解食分 ≤ 0）');
  const isTotal = mid[29] < 0 && (m < mid[29] || m < -mid[29]);
  assertEclipse(isTotal, '观测点非全食（选点应在全食带内）');

  const iterate = (c: number[], lRef: 28 | 29): void => {
    timeLocDependent(c);
    let sign = c[0] < 0 ? -1 : 1;
    if (lRef === 29 && mid[29] < 0) sign = -sign;
    for (let iter = 0, tmp = 1; Math.abs(tmp) > 1e-6 && iter < 50; iter += 1) {
      const n = Math.sqrt(c[30]);
      let x = (c[26] * c[25] - c[24] * c[27]) / n / c[lRef];
      x = sign * Math.sqrt(Math.max(0, 1 - x * x)) * (c[lRef] / n);
      tmp = (c[24] * c[26] + c[25] * c[27]) / c[30] - x;
      c[1] -= tmp;
      timeLocDependent(c);
    }
  };
  const seed = (eventType: number, lRef: 28 | 29): number[] => {
    const n = Math.sqrt(mid[30]);
    let x = (mid[26] * mid[25] - mid[24] * mid[27]) / n / mid[lRef];
    x = Math.sqrt(Math.max(0, 1 - x * x)) * (mid[lRef] / n);
    const c = new Array<number>(31).fill(0);
    c[0] = eventType;
    const before = lRef === 29 && mid[29] < 0 ? eventType > 0 : eventType < 0;
    c[1] = mid[1] + (before ? -x : x);
    iterate(c, lRef);
    return c;
  };
  const cC1 = seed(-2, 28);
  const cC4 = seed(2, 28);
  const cC2 = seed(-1, 29);
  const cC3 = seed(1, 29);

  // t（TDT 小时，相对 el[1]）→ UTC 秒：UT 小时 = el[1] + t − ΔT/3600
  const dayUnix = Date.UTC(
    Number(dateUtc.slice(0, 4)),
    Number(dateUtc.slice(5, 7)) - 1,
    Number(dateUtc.slice(8, 10))
  ) / 1000;
  const toUnix = (c: readonly number[]): number =>
    dayUnix + (el[1] + c[1] - el[4] / 3600) * 3600;

  return {
    c1: toUnix(cC1),
    c2: toUnix(cC2),
    max: toUnix(mid),
    c3: toUnix(cC3),
    c4: toUnix(cC4),
    ratio: (mid[28] - mid[29]) / (mid[28] + mid[29]),
    isTotal,
  };
}

/** |γ| = 贝塞尔要素域内影轴离地心最小距离（地球赤道半径单位；1s 步扫描） */
function gammaAbsFromElements(el: readonly number[]): number {
  let min = Infinity;
  for (let t = el[2]; t <= el[3]; t += 1 / 3600) {
    const x = ((el[8] * t + el[7]) * t + el[6]) * t + el[5];
    const y = ((el[12] * t + el[11]) * t + el[10]) * t + el[9];
    min = Math.min(min, Math.hypot(x, y));
  }
  return min;
}

// ---------------------------------------------------------------------------
// Horizons 快照解析
// ---------------------------------------------------------------------------

interface TopoSample {
  tSec: number;
  raDeg: number;
  decDeg: number;
  azDeg: number;
  elDeg: number;
  /** 视半径（度，= 角直径/2/3600） */
  sdDeg: number;
}

/** OBSERVER CSV（QUANTITIES=2,4,13）→ 采样数组（时刻升序） */
function parseTopoSnapshot(text: string): TopoSample[] {
  const block = /\$\$SOE\n([\s\S]*?)\$\$EOE/.exec(text);
  if (!block) failEclipse('Horizons OBSERVER 快照缺少 $$SOE/$$EOE 段');
  const out: TopoSample[] = [];
  for (const line of block[1].split('\n')) {
    if (line.trim().length === 0) continue;
    const parts = line.split(',').map((s) => s.trim());
    // [日期, 太阳标记, 月亮/事件标记, RA, Dec, Az, El, 角直径, '']
    assertEclipse(parts.length >= 8, `OBSERVER 行列数异常：${line}`);
    const nums = parts.slice(3, 8).map(Number);
    assertEclipse(nums.every(Number.isFinite), `OBSERVER 行含非数值：${line}`);
    out.push({
      tSec: unixSecFromHorizonsDate(parts[0]),
      raDeg: nums[0],
      decDeg: nums[1],
      azDeg: nums[2],
      elDeg: nums[3],
      sdDeg: nums[4] / 2 / 3600,
    });
  }
  assertEclipse(out.length >= 100, `OBSERVER 快照行数 ${out.length} 异常偏少`);
  for (let i = 1; i < out.length; i += 1) {
    assertEclipse(out[i].tSec > out[i - 1].tSec, 'OBSERVER 快照时间未严格单调');
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
  if (!block) failEclipse('Horizons VECTORS 快照缺少 $$SOE/$$EOE 段');
  const out: GeoSampleRaw[] = [];
  for (const line of block[1].split('\n')) {
    if (line.trim().length === 0) continue;
    const parts = line.split(',').map((s) => s.trim());
    // [JDTDB, 日期(TDB), X, Y, Z, '']
    assertEclipse(parts.length >= 5, `VECTORS 行列数异常：${line}`);
    const date = parts[1].replace(/^A\.D\.\s+/, '').replace(/\.\d+$/, '');
    const nums = parts.slice(2, 5).map(Number);
    assertEclipse(nums.every(Number.isFinite), `VECTORS 行含非数值：${line}`);
    out.push({ tdbSec: unixSecFromHorizonsDate(date), xKm: nums[0], yKm: nums[1], zKm: nums[2] });
  }
  assertEclipse(out.length >= 100, `VECTORS 快照行数 ${out.length} 异常偏少`);
  for (let i = 1; i < out.length; i += 1) {
    assertEclipse(out[i].tdbSec > out[i - 1].tdbSec, 'VECTORS 快照时间未严格单调');
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

/** 位置角（月相对日，天球北起经东；站心视 RA/Dec） */
function positionAngleDeg(sun: TopoSample, moon: TopoSample): number {
  const dRa = (moon.raDeg - sun.raDeg) * DEG;
  const sDec = sun.decDeg * DEG;
  const mDec = moon.decDeg * DEG;
  const pa = Math.atan2(
    Math.cos(mDec) * Math.sin(dRa),
    Math.cos(sDec) * Math.sin(mDec) - Math.sin(sDec) * Math.cos(mDec) * Math.cos(dRa)
  );
  return ((pa / DEG) % 360 + 360) % 360;
}

/** 日月角距（度，站心视 RA/Dec 球面公式） */
function separationDeg(sun: TopoSample, moon: TopoSample): number {
  const s1 = sun.decDeg * DEG;
  const s2 = moon.decDeg * DEG;
  const dRa = (moon.raDeg - sun.raDeg) * DEG;
  const cosSep = Math.sin(s1) * Math.sin(s2) + Math.cos(s1) * Math.cos(s2) * Math.cos(dRa);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) / DEG;
}

/** 双圆遮挡率（solarEclipse.eclipseObscuration 同式镜像——bake 走裸 node 无 @ 别名） */
function obscurationOf(sunR: number, moonR: number, sep: number): number {
  if (sep >= sunR + moonR) return 0;
  if (sep <= moonR - sunR) return 1;
  if (sep <= sunR - moonR) return (moonR / sunR) ** 2;
  const alpha = Math.acos((sep * sep + sunR * sunR - moonR * moonR) / (2 * sep * sunR));
  const beta = Math.acos((sep * sep + moonR * moonR - sunR * sunR) / (2 * sep * moonR));
  const lens =
    sunR * sunR * (alpha - Math.sin(alpha) * Math.cos(alpha)) +
    moonR * moonR * (beta - Math.sin(beta) * Math.cos(beta));
  return lens / (Math.PI * sunR * sunR);
}

/** 从对齐的日/月采样窗口切片组装 topo 行序列 */
function buildTopoSeries(
  sun: TopoSample[],
  moon: TopoSample[],
  windowStartSec: number,
  windowEndSec: number,
  dtSec: number
): SeriesProduct {
  assertEclipse(sun.length === moon.length, 'topo 日/月快照行数不一致');
  const t0Snapshot = sun[0].tSec;
  const startIdx = Math.floor((windowStartSec - t0Snapshot) / dtSec);
  const endIdx = Math.ceil((windowEndSec - t0Snapshot) / dtSec);
  assertEclipse(startIdx >= 0 && endIdx < sun.length, 'topo 采样窗越出快照范围');
  const rows: number[][] = [];
  for (let i = startIdx; i <= endIdx; i += 1) {
    const s = sun[i];
    const m = moon[i];
    assertEclipse(s.tSec === m.tSec, `topo 日/月时间戳错位 @${s.tSec}`);
    assertEclipse(
      s.tSec === t0Snapshot + i * dtSec,
      `topo 快照采样间隔非 ${dtSec}s @${s.tSec}`
    );
    rows.push([
      roundTo(s.elDeg, 5),
      roundTo(s.azDeg, 5),
      roundTo(s.sdDeg, 6),
      roundTo(m.elDeg, 5),
      roundTo(m.azDeg, 5),
      roundTo(m.sdDeg, 6),
      roundTo(positionAngleDeg(s, m), 4),
    ]);
  }
  return { t0: t0Snapshot + startIdx * dtSec, dtSec, rows };
}

/** geo 序列（TDB→UTC；单位方向 + 距离） */
function buildGeoSeries(
  sun: GeoSampleRaw[],
  moon: GeoSampleRaw[],
  tdbMinusUtcSec: number,
  dtSec: number
): SeriesProduct {
  assertEclipse(sun.length === moon.length, 'geo 日/月快照行数不一致');
  const rows: number[][] = [];
  for (let i = 0; i < sun.length; i += 1) {
    const s = sun[i];
    const m = moon[i];
    assertEclipse(s.tdbSec === m.tdbSec, `geo 日/月时间戳错位 @${s.tdbSec}`);
    const sd = Math.hypot(s.xKm, s.yKm, s.zKm);
    const md = Math.hypot(m.xKm, m.yKm, m.zKm);
    assertEclipse(sd > 1.4e8 && sd < 1.6e8, `太阳地心距 ${sd} km 越界`);
    assertEclipse(md > 3.5e5 && md < 4.1e5, `月球地心距 ${md} km 越界`);
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

/** 星历几何反解接触时刻（solarEclipse.deriveContactTimes 同式镜像，校验用） */
function deriveContactsFromRows(series: SeriesProduct): {
  c1: number;
  c2: number | null;
  max: number;
  c3: number | null;
  c4: number;
} {
  const sepOf = (row: number[]): number => {
    const a1 = row[0] * DEG;
    const a2 = row[3] * DEG;
    const dAz = (row[4] - row[1]) * DEG;
    const cosSep = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dAz);
    return Math.acos(Math.min(1, Math.max(-1, cosSep))) / DEG;
  };
  const outer: number[] = [];
  const inner: number[] = [];
  let minSep = Infinity;
  let maxT = series.t0;
  for (let i = 0; i < series.rows.length; i += 1) {
    const t = series.t0 + i * series.dtSec;
    const sep = sepOf(series.rows[i]);
    if (sep < minSep) {
      minSep = sep;
      maxT = t;
    }
    if (i === 0) continue;
    const g0 = sepOf(series.rows[i - 1]) - (series.rows[i - 1][2] + series.rows[i - 1][5]);
    const g1 = sep - (series.rows[i][2] + series.rows[i][5]);
    if (g0 === 0 || g0 * g1 < 0) outer.push(t - series.dtSec + (g0 / (g0 - g1)) * series.dtSec);
    const h0 = sepOf(series.rows[i - 1]) - Math.abs(series.rows[i - 1][5] - series.rows[i - 1][2]);
    const h1 = sep - Math.abs(series.rows[i][5] - series.rows[i][2]);
    if (h0 === 0 || h0 * h1 < 0) inner.push(t - series.dtSec + (h0 / (h0 - h1)) * series.dtSec);
  }
  assertEclipse(outer.length >= 2, '几何反解未找到 C1/C4（采样窗未覆盖偏食全程？）');
  return {
    c1: outer[0],
    c2: inner.length >= 2 ? inner[0] : null,
    max: maxT,
    c3: inner.length >= 2 ? inner[inner.length - 1] : null,
    c4: outer[outer.length - 1],
  };
}

export interface SolarEclipseEventProduct {
  id: string;
  dateUtc: string;
  saros: number;
  kind: string;
  magnitude: number;
  gammaAbs: number;
  observer: { latDeg: number; lonDeg: number; altM: number; label: string };
  contacts: { c1: number; c2: number; max: number; c3: number; c4: number };
  topo: SeriesProduct;
  fineC2: SeriesProduct;
  fineC3: SeriesProduct;
  geo: SeriesProduct;
  path: number[][];
}

export interface SolarEclipsesProduct {
  events: SolarEclipseEventProduct[];
}

/**
 * 烘焙主入口：读快照 → 贝塞尔接触时刻 → 切片组装序列 → 自校验 → 返回产物。
 */
export function bakeSolarEclipses(snapshotDir: string): SolarEclipsesProduct {
  const events: SolarEclipseEventProduct[] = [];
  for (const spec of EVENTS) {
    const googleHtml = readSnapshotText(snapshotDir, spec.googleSnapshot);
    const pathHtml = readSnapshotText(snapshotDir, spec.pathSnapshot);
    const elements = parseBesselianElements(googleHtml);
    const saros = parseSaros(googleHtml);
    const { kind, dateUtc } = parseKindAndDate(googleHtml);
    assertEclipse(kind === 'total', `${spec.id} 事件类型 ${kind} ≠ total`);
    const { path, maxRatio } = parsePathTable(pathHtml);
    const contacts = solveBesselianContacts(elements, spec.observer, dateUtc);
    const gammaAbs = gammaAbsFromElements(elements);

    const topoSun = parseTopoSnapshot(readSnapshotText(snapshotDir, `se-${spec.id}-topo-sun.txt.gz`));
    const topoMoon = parseTopoSnapshot(
      readSnapshotText(snapshotDir, `se-${spec.id}-topo-moon.txt.gz`)
    );
    const fineSun = parseTopoSnapshot(readSnapshotText(snapshotDir, `se-${spec.id}-fine-sun.txt.gz`));
    const fineMoon = parseTopoSnapshot(
      readSnapshotText(snapshotDir, `se-${spec.id}-fine-moon.txt.gz`)
    );
    const geoSun = parseGeoSnapshot(readSnapshotText(snapshotDir, `se-${spec.id}-geo-sun.txt.gz`));
    const geoMoon = parseGeoSnapshot(readSnapshotText(snapshotDir, `se-${spec.id}-geo-moon.txt.gz`));

    // 契约 C2 窗口：topo = C1−15min → C4+15min @60s（对齐快照分钟栅格）；
    // fineC2/fineC3 = C2±3min / C3±3min @1s
    const topo = buildTopoSeries(
      topoSun,
      topoMoon,
      Math.floor((contacts.c1 - 900) / 60) * 60,
      Math.ceil((contacts.c4 + 900) / 60) * 60,
      60
    );
    const fineC2 = buildTopoSeries(
      fineSun,
      fineMoon,
      Math.floor(contacts.c2 - 180),
      Math.ceil(contacts.c2 + 180),
      1
    );
    const fineC3 = buildTopoSeries(
      fineSun,
      fineMoon,
      Math.floor(contacts.c3 - 180),
      Math.ceil(contacts.c3 + 180),
      1
    );
    const geo = buildGeoSeries(geoSun, geoMoon, spec.tdbMinusUtcSec, 120);

    events.push({
      id: spec.id,
      dateUtc,
      saros,
      kind,
      magnitude: maxRatio,
      gammaAbs: roundTo(gammaAbs, 4),
      observer: spec.observer,
      contacts: {
        c1: roundTo(contacts.c1, 1),
        c2: roundTo(contacts.c2, 1),
        max: roundTo(contacts.max, 1),
        c3: roundTo(contacts.c3, 1),
        c4: roundTo(contacts.c4, 1),
      },
      topo,
      fineC2,
      fineC3,
      geo,
      path,
    });
  }

  validateProduct({ events });
  return { events };
}

/** 自校验（需求 §6 + §1.3 星历自洽性） */
function validateProduct(product: SolarEclipsesProduct): void {
  assertEclipse(product.events.length === 3, `事件数 ${product.events.length} ≠ 3`);
  assertEclipse(
    product.events.map((e) => e.id).join(',') === 'e2027,e2035,e1919',
    '事件 id 集应为 e2027,e2035,e1919'
  );
  for (const ev of product.events) {
    const { contacts: c } = ev;
    assertEclipse(
      c.c1 < c.c2 && c.c2 < c.max && c.max < c.c3 && c.c3 < c.c4,
      `${ev.id} 接触时刻未按 C1<C2<max<C3<C4 排序`
    );
    assertEclipse(ev.magnitude > 1 && ev.magnitude < 1.1, `${ev.id} 食分 ${ev.magnitude} 越界`);
    assertEclipse(ev.gammaAbs >= 0 && ev.gammaAbs < 1, `${ev.id} |γ|=${ev.gammaAbs} 越界`);
    assertEclipse(ev.saros > 0 && Number.isInteger(ev.saros), `${ev.id} saros 非法`);

    // 采样窗覆盖接触时刻（契约 C2）
    const topoEnd = ev.topo.t0 + (ev.topo.rows.length - 1) * ev.topo.dtSec;
    assertEclipse(
      ev.topo.t0 <= c.c1 - 900 + 60 && topoEnd >= c.c4 + 900 - 60,
      `${ev.id} topo 窗未覆盖 C1−15min → C4+15min`
    );
    const f2End = ev.fineC2.t0 + (ev.fineC2.rows.length - 1) * ev.fineC2.dtSec;
    const f3End = ev.fineC3.t0 + (ev.fineC3.rows.length - 1) * ev.fineC3.dtSec;
    assertEclipse(
      ev.fineC2.t0 <= c.c2 - 180 && f2End >= c.c2 + 180,
      `${ev.id} fineC2 窗未覆盖 C2±3min`
    );
    assertEclipse(
      ev.fineC3.t0 <= c.c3 - 180 && f3End >= c.c3 + 180,
      `${ev.id} fineC3 窗未覆盖 C3±3min`
    );
    const geoEnd = ev.geo.t0 + (ev.geo.rows.length - 1) * ev.geo.dtSec;
    assertEclipse(ev.geo.t0 <= c.c1 && geoEnd >= c.c4, `${ev.id} geo 窗未覆盖 C1→C4`);

    // 行域校验
    for (const series of [ev.topo, ev.fineC2, ev.fineC3]) {
      assertEclipse(series.dtSec > 0 && series.rows.length >= 2, `${ev.id} 序列过短`);
      for (const row of series.rows) {
        assertEclipse(row.length === 7 && row.every(Number.isFinite), `${ev.id} topo 行非法`);
        assertEclipse(row[0] > -90 && row[0] < 90 && row[3] > -90 && row[3] < 90, `${ev.id} 高度角越界`);
        assertEclipse(row[1] >= 0 && row[1] < 360 && row[4] >= 0 && row[4] < 360, `${ev.id} 方位角越界`);
        assertEclipse(row[2] > 0.2 && row[2] < 0.35 && row[5] > 0.2 && row[5] < 0.35, `${ev.id} 视半径越界`);
        assertEclipse(row[6] >= 0 && row[6] < 360, `${ev.id} 位置角越界`);
      }
    }
    for (const row of ev.geo.rows) {
      assertEclipse(row.length === 8 && row.every(Number.isFinite), `${ev.id} geo 行非法`);
      const sn = Math.hypot(row[0], row[1], row[2]);
      const mn = Math.hypot(row[4], row[5], row[6]);
      assertEclipse(Math.abs(sn - 1) < 1e-5 && Math.abs(mn - 1) < 1e-5, `${ev.id} geo 方向未归一`);
    }

    // 食甚遮挡率 ≈ 1（全食事件；食甚行由 max 时刻最近细采样行取得）
    const fineAtMax = ev.fineC2.t0 <= c.max && c.max <= f2End ? ev.fineC2 : ev.fineC3;
    const idx = Math.min(
      Math.max(Math.round((c.max - fineAtMax.t0) / fineAtMax.dtSec), 0),
      fineAtMax.rows.length - 1
    );
    const maxRow = fineAtMax.rows[idx];
    const sepAtMax = (() => {
      const a1 = maxRow[0] * DEG;
      const a2 = maxRow[3] * DEG;
      const dAz = (maxRow[4] - maxRow[1]) * DEG;
      return (
        Math.acos(
          Math.min(1, Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dAz))
        ) / DEG
      );
    })();
    const obs = obscurationOf(maxRow[2], maxRow[5], sepAtMax);
    assertEclipse(obs >= 0.999, `${ev.id} 食甚遮挡率 ${obs} 未≈1`);

    // 星历几何反解 vs 贝塞尔权威接触时刻互差 <30s（§1.3 自洽性）
    const derived = deriveContactsFromRows(ev.topo);
    const checks: Array<[string, number, number | null]> = [
      ['C1', c.c1, derived.c1],
      ['C2', c.c2, derived.c2],
      ['C3', c.c3, derived.c3],
      ['C4', c.c4, derived.c4],
    ];
    for (const [name, authoritative, derivedT] of checks) {
      assertEclipse(derivedT !== null, `${ev.id} 几何反解缺 ${name}`);
      const diff = Math.abs((derivedT as number) - authoritative);
      assertEclipse(
        diff < CONTACT_CROSS_CHECK_MAX_SEC,
        `${ev.id} ${name} 贝塞尔 vs 星历反解互差 ${diff.toFixed(1)}s ≥ ${CONTACT_CROSS_CHECK_MAX_SEC}s`
      );
    }

    // 路径折线域
    for (const [lat, lon, dur] of ev.path) {
      assertEclipse(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180, `${ev.id} 路径坐标越界`);
      assertEclipse(dur > 30 && dur < 500, `${ev.id} 路径时长 ${dur}s 越界`);
    }
  }

  const size = Buffer.byteLength(JSON.stringify(product));
  assertEclipse(
    size < PRODUCT_SIZE_LIMIT_BYTES,
    `产物 ${size} B 超出 ${PRODUCT_SIZE_LIMIT_BYTES} B 上限`
  );
}

// ---------------------------------------------------------------------------
// --fetch-eclipses：重拉 Horizons + GSFC 快照（需网络）
// ---------------------------------------------------------------------------

async function fetchText(url: string, params?: Record<string, string>): Promise<string> {
  const full = params
    ? `${url}?${new URLSearchParams(
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, `'${v}'`]))
      ).toString()}`
    : url;
  const res = await fetch(full, { headers: { 'User-Agent': 'Mozilla/5.0 (bake-data)' } });
  if (!res.ok) failEclipse(`${url} 返回 HTTP ${res.status}（离线时去掉 --fetch-eclipses）`);
  return res.text();
}

function horizonsTopoParams(
  body: string,
  site: string,
  window: [string, string, string]
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
    QUANTITIES: '2,4,13',
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

/** --fetch-eclipses：重拉全部星历/GSFC 快照（18 份 Horizons + 6 份 GSFC 页面） */
export async function refetchSolarEclipseSnapshots(snapshotDir: string): Promise<void> {
  console.log('[bake-data] --fetch-eclipses：重拉 JPL Horizons 与 NASA GSFC 快照…');
  for (const spec of EVENTS) {
    const site = `${spec.observer.lonDeg},${spec.observer.latDeg},${spec.observer.altM / 1000}`;
    const jobs: Array<[string, Promise<string>]> = [
      [`se-${spec.id}-gsfc-google.html.gz`, fetchText(spec.googleUrl)],
      [`se-${spec.id}-gsfc-path.html.gz`, fetchText(spec.pathUrl)],
      [
        `se-${spec.id}-topo-sun.txt.gz`,
        fetchText(HORIZONS_API, { format: 'text', ...horizonsTopoParams('10', site, spec.fetchTopo) }),
      ],
      [
        `se-${spec.id}-topo-moon.txt.gz`,
        fetchText(HORIZONS_API, { format: 'text', ...horizonsTopoParams('301', site, spec.fetchTopo) }),
      ],
      [
        `se-${spec.id}-fine-sun.txt.gz`,
        fetchText(HORIZONS_API, { format: 'text', ...horizonsTopoParams('10', site, spec.fetchFine) }),
      ],
      [
        `se-${spec.id}-fine-moon.txt.gz`,
        fetchText(HORIZONS_API, { format: 'text', ...horizonsTopoParams('301', site, spec.fetchFine) }),
      ],
      [
        `se-${spec.id}-geo-sun.txt.gz`,
        fetchText(HORIZONS_API, { format: 'text', ...horizonsGeoParams('10', spec.fetchGeo) }),
      ],
      [
        `se-${spec.id}-geo-moon.txt.gz`,
        fetchText(HORIZONS_API, { format: 'text', ...horizonsGeoParams('301', spec.fetchGeo) }),
      ],
    ];
    for (const [file, promise] of jobs) {
      const text = await promise;
      assertEclipse(text.length > 5000, `${file} 响应过短（${text.length} B），拒绝覆盖快照`);
      writeFileSync(join(snapshotDir, file), gzipSync(text, { level: 9 }));
      console.log(`[bake-data] 快照已更新：${file}`);
    }
  }
  // meta retrievedAt 刷新
  const metaPath = join(snapshotDir, 'solar-eclipses.meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(
    metaPath,
    `${JSON.stringify({ ...meta, retrievedAt: new Date().toISOString() }, null, 2)}\n`
  );
}
