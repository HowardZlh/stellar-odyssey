/**
 * M1-1 耶鲁亮星目录烘焙：Yale Bright Star Catalogue → public/data/yale_bright_stars.json
 *
 * 数据来源登记（IMPROVEMENT_REQUIREMENTS_METEOR_SHOWERS §6，契约 C3）：
 * - Yale Bright Star Catalogue, 5th Revised Edition（Hoffleit & Warren 1991），公开天文目录。
 * - 获取 URL：http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz（Harvard TDC 镜像，
 *   bsc5.dat 定长文本，2006-03 版；快照 snapshots/bsc5.dat.gz 随仓库提交，默认离线烘焙）。
 * - 重拉快照：npm run bake:data -- --fetch-bsc（需网络）。
 *
 * 列位（1 起字节序号，依 ADC ReadMe，已逐字节核对）：
 * - J2000 坐标：RAh 76-77 / RAm 78-79 / RAs 80-83 / Dec 符号 84 / DEd 85-86 / DEm 87-88 / DEs 89-90
 * - Vmag 103-107；B-V 110-114
 *
 * 防御式解析（需求 §6）：
 * - 缺坐标/缺 mag 的条目（新星遗留空位等，共 14 条）直接剔除；
 * - 缺 B-V 的按 0.5 兜底（登记为已知近似，太阳色附近的中性取值）；
 * - 筛选视星等 ≤ 6.5（契约口径）；产物条数断言 ∈ [8300, 9200]。
 *   实测：全表 9110 行 → 有效 9096 条 → mag ≤ 6.5 共 8404 条（>6.5 的 692 条
 *   为目录超完备限样本）。需求原断言下限 8500 与真实数据冲突，按契约
 *   "mag ≤ 6.5" 优先下调下限，差异已回写需求文档登记。
 *
 * 产物 schema（契约 C3，纯数组无 meta 包装）：{ ra, dec, mag, bv }[]（ra/dec 单位：度）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const BSC5_URL = 'http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz';
const SNAPSHOT_FILE = 'bsc5.dat.gz';

/** 契约口径：视星等 ≤ 6.5（勿写 <6.0——会砍掉近半样本） */
const MAG_LIMIT = 6.5;

/** 缺 B-V 条目的兜底色指数（登记近似） */
const BV_FALLBACK = 0.5;

export interface BrightStar {
  /** 赤经（度，J2000） */
  ra: number;
  /** 赤纬（度，J2000） */
  dec: number;
  /** V 视星等 */
  mag: number;
  /** B−V 色指数（缺测按 0.5 兜底） */
  bv: number;
}

function failBright(message: string): never {
  console.error(`[bake-data] yale_bright_stars 自校验失败：${message}`);
  process.exit(1);
}

function assertBright(condition: boolean, message: string): void {
  if (!condition) failBright(message);
}

/** 四舍五入到 digits 位小数，-0 归一为 0（输出字节级幂等） */
function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  const r = Math.round(value * factor) / factor;
  return r === 0 ? 0 : r;
}

/** 解析 bsc5.dat 单行；缺坐标/缺 mag 返回 null（防御式剔除） */
export function parseBsc5Line(line: string): BrightStar | null {
  const raHStr = line.slice(75, 77).trim();
  const magStr = line.slice(102, 107).trim();
  if (raHStr === '' || magStr === '') return null;

  const raH = Number(raHStr);
  const raM = Number(line.slice(77, 79));
  const raS = Number(line.slice(79, 83));
  const decSign = line.slice(83, 84) === '-' ? -1 : 1;
  const decD = Number(line.slice(84, 86));
  const decM = Number(line.slice(86, 88));
  const decS = Number(line.slice(88, 90));
  const mag = Number(magStr);
  if (![raH, raM, raS, decD, decM, decS, mag].every(Number.isFinite)) return null;

  const bvStr = line.slice(109, 114).trim();
  const bv = bvStr === '' ? BV_FALLBACK : Number(bvStr);
  if (!Number.isFinite(bv)) return null;

  const ra = (raH + raM / 60 + raS / 3600) * 15;
  const dec = decSign * (decD + decM / 60 + decS / 3600);
  return { ra, dec, mag, bv };
}

/**
 * 烘焙主入口：读快照 → 解析 → 筛 mag ≤ 6.5 → 自校验 → 返回产物数组
 */
export function bakeBrightStars(snapshotDir: string): BrightStar[] {
  const raw = gunzipSync(readFileSync(join(snapshotDir, SNAPSHOT_FILE))).toString('utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  assertBright(lines.length >= 9000, `bsc5.dat 行数 ${lines.length} 异常（应约 9110）`);

  const stars: BrightStar[] = [];
  let droppedCount = 0;
  for (const line of lines) {
    const star = parseBsc5Line(line);
    if (star === null) {
      droppedCount++;
      continue;
    }
    if (star.mag > MAG_LIMIT) continue;
    stars.push({
      ra: roundTo(star.ra, 4),
      dec: roundTo(star.dec, 4),
      mag: roundTo(star.mag, 2),
      bv: roundTo(star.bv, 2),
    });
  }

  // 自校验（验收标准：条数/域/无 null）
  assertBright(droppedCount <= 30, `剔除条目 ${droppedCount} 条异常偏多（应约 14）`);
  assertBright(
    stars.length >= 8300 && stars.length <= 9200,
    `亮星条数 ${stars.length} 超出 [8300, 9200]`
  );
  for (const s of stars) {
    assertBright(s.ra >= 0 && s.ra < 360, `ra=${s.ra} 越界 [0, 360)`);
    assertBright(s.dec >= -90 && s.dec <= 90, `dec=${s.dec} 越界 [-90, 90]`);
    assertBright(s.mag <= MAG_LIMIT, `mag=${s.mag} 超出 ${MAG_LIMIT}`);
    assertBright(Number.isFinite(s.bv), `bv 含非数值`);
    // 上界 6：极红碳星（如 HR 8062 附近 B-V≈3.9）真实存在，域断言只防解析错位
    assertBright(s.bv >= -1 && s.bv <= 6, `bv=${s.bv} 越界 [-1, 6]`);
  }
  return stars;
}

/** --fetch-bsc：从 Harvard TDC 重新拉取 bsc5.dat.gz 快照（需网络） */
export async function refetchBsc5Snapshot(snapshotDir: string): Promise<void> {
  console.log(`[bake-data] --fetch-bsc：从 ${BSC5_URL} 重新拉取 BSC5 快照…`);
  const res = await fetch(BSC5_URL);
  if (!res.ok) failBright(`Harvard TDC 返回 HTTP ${res.status}（离线时去掉 --fetch-bsc 用内嵌快照）`);
  const buf = Buffer.from(await res.arrayBuffer());
  // 镜像返回的即 gzip 字节流；防御式验证可解压且行数合理后原样落盘
  const text = gunzipSync(buf).toString('utf8');
  const lineCount = text.split('\n').filter((l) => l.length > 0).length;
  assertBright(lineCount >= 9000, `拉取的 bsc5.dat 行数 ${lineCount} 异常，拒绝覆盖快照`);
  writeFileSync(join(snapshotDir, SNAPSHOT_FILE), gzipSync(text, { level: 9 }));
  console.log(`[bake-data] BSC5 快照已更新（${lineCount} 行）`);
}
