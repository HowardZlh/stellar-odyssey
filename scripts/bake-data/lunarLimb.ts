/**
 * E 迭代 M1-2 月缘高程剖面烘焙：LRO LOLA LDEM_4 → public/data/lunar_limb_profile.json
 * （契约 C3：{ source, meanRadiusKm, samples }，samples = 720 点 @0.5° 极角步长，
 * 月缘高程相对平均半径 1737.4 km 的偏差，单位 km）
 *
 * 数据来源登记：
 * - LRO LOLA GDR LDEM_4（NASA PDS，公有领域；Smith et al. 2010, GRL 37, L18204）：
 *   720×1440 int16 LSB 高程网格，0.5 m/count，基准半径 1737.4 km，
 *   simple cylindrical（lat +90→−90 / lon 0→360°E，pixel registered），
 *   MEAN EARTH/POLAR AXIS (DE421) 坐标系，分辨率 7.58 km/px。
 * - 快照：snapshots/ldem_4.img.gz + ldem_4.lbl + lunar-limb.meta.json；
 *   --fetch-lola 重拉（需网络）。
 *
 * 选型定稿（契约 C3 🔶 + 需求 §1.5 🔶，回写需求文档）：
 * - GDR 网格自行沿缘取样（现成 limb profile 产品——Watts charts / NASA SVS
 *   逐事件剖面——无通用可编程获取渠道）；LDEM_4 为完整原始产品可整体提交快照；
 * - 天平动口径 = 静态平均姿态（不纳入逐时刻天平动修正，登记已知近似）：
 *   ME 坐标系定义下平均指地点即 (0°N, 0°E)，月缘即 lon ±90° 子午线大圆；
 * - 「沿月缘带取极值」（契约 C3）：每极角沿视线方向 ±0.5° 带内取高程最大值
 *   （兼顾天平动扫带内的遮光主导地形与网格采样鲁棒性）；
 * - 分辨率登记：7.58 km/px 对 0.5° 步长（缘弧 ~15 km 间距）满足奈奎斯特，
 *   но更细的珠谷结构被网格平滑，登记为已知近似。
 *
 * 极角约定：samples[k] ↔ 月面地心极角 ψ = k×0.5°，ψ=0 为月球北极方向缘点，
 * 沿东经 +90° 子午线方向递增（ψ=90° 为东缘）。天球位置角对齐（轴倾/镜像）
 * 由消费方（M3 shader 的 posAngle uniform）处理。
 *
 * 自校验：点数 = 720、偏差 ∈ [−9, +9] km、非全零、平均值量级合理；
 * 失败 process.exit(1)。幂等：产物为快照纯函数。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const LDEM_URL =
  'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_4.img';
const LDEM_LBL_URL =
  'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_4.lbl';
const SNAPSHOT_IMG = 'ldem_4.img.gz';
const SNAPSHOT_LBL = 'ldem_4.lbl';

/** LDEM_4 网格尺寸（行 = 纬度 +90→−90，列 = 东经 0→360，pixel registered） */
const LDEM_LINES = 720;
const LDEM_SAMPLES = 1440;

/** 高程换算：0.5 m/count → km */
const LDEM_SCALE_KM = 0.0005;

/** 月球平均半径（km，LDEM 基准半径，契约 C3 meanRadiusKm） */
const MOON_MEAN_RADIUS_KM = 1737.4;

/** 剖面点数 / 步长（契约 C3） */
const SAMPLE_COUNT = 720;
const STEP_DEG = 0.5;

/** 沿视线方向取极值的带半宽（度；选型登记见文件头） */
const BAND_HALF_WIDTH_DEG = 0.5;

/** 带内采样点数（含两端） */
const BAND_SAMPLES = 5;

/** 偏差合理域（km；契约 C3「[−9, +9] km 量级」） */
const DEVIATION_MIN_KM = -9;
const DEVIATION_MAX_KM = 9;

const DEG = Math.PI / 180;

function failLimb(message: string): never {
  console.error(`[bake-data] lunar_limb_profile 自校验失败：${message}`);
  process.exit(1);
}

function assertLimb(condition: boolean, message: string): void {
  if (!condition) failLimb(message);
}

/** 四舍五入到 digits 位小数，-0 归一为 0（输出字节级幂等） */
function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  const r = Math.round(value * factor) / factor;
  return r === 0 ? 0 : r;
}

/** 双线性采样 LDEM 高程（km；lat 度 [-90,90]、lon 度东经任意值自动回绕） */
export function sampleLdemKm(grid: Int16Array, latDeg: number, lonDeg: number): number {
  // pixel registered：行 0 中心 lat = 90 − 0.125，列 0 中心 lon = 0.125（0.25°/px）
  const lon = ((lonDeg % 360) + 360) % 360;
  const row = (90 - latDeg) * 4 - 0.5;
  const col = lon * 4 - 0.5;
  const r0 = Math.max(0, Math.min(LDEM_LINES - 1, Math.floor(row)));
  const r1 = Math.max(0, Math.min(LDEM_LINES - 1, r0 + 1));
  const c0 = ((Math.floor(col) % LDEM_SAMPLES) + LDEM_SAMPLES) % LDEM_SAMPLES;
  const c1 = (c0 + 1) % LDEM_SAMPLES;
  const fr = Math.max(0, Math.min(1, row - Math.floor(row)));
  const fc = col - Math.floor(col);
  const v00 = grid[r0 * LDEM_SAMPLES + c0];
  const v01 = grid[r0 * LDEM_SAMPLES + c1];
  const v10 = grid[r1 * LDEM_SAMPLES + c0];
  const v11 = grid[r1 * LDEM_SAMPLES + c1];
  const top = v00 + (v01 - v00) * fc;
  const bottom = v10 + (v11 - v10) * fc;
  return (top + (bottom - top) * fr) * LDEM_SCALE_KM;
}

export interface LunarLimbProfileProduct {
  source: string;
  meanRadiusKm: number;
  samples: number[];
}

/**
 * 烘焙主入口：读 LDEM 快照 → 沿平均天平动月缘（lon ±90° 大圆）逐 0.5° 极角
 * 取带内高程极大值 → 自校验 → 返回产物。
 *
 * 缘点几何：子地点 (0,0) 视角下月缘大圆 p(ψ) = cosψ·北极 + sinψ·东向：
 * lat = asin(cosψ)，lon = ψ ∈ (0,180°) 时 +90°、否则 −90°（极点处任意）。
 * 带内极值：以缘点为中心沿「视线（子地点—对跖点）方向」偏移 ±0.5°
 * （经缘点的 lat/lon 小圆近似）取 BAND_SAMPLES 点高程最大值。
 */
export function bakeLunarLimbProfile(snapshotDir: string): LunarLimbProfileProduct {
  const raw = gunzipSync(readFileSync(join(snapshotDir, SNAPSHOT_IMG)));
  assertLimb(
    raw.byteLength === LDEM_LINES * LDEM_SAMPLES * 2,
    `LDEM_4 字节数 ${raw.byteLength} ≠ ${LDEM_LINES * LDEM_SAMPLES * 2}`
  );
  const grid = new Int16Array(raw.buffer, raw.byteOffset, LDEM_LINES * LDEM_SAMPLES);

  const samples = new Array<number>(SAMPLE_COUNT);
  for (let k = 0; k < SAMPLE_COUNT; k += 1) {
    const psi = k * STEP_DEG * DEG;
    // 月缘大圆上的缘点（ME 坐标系；子地点 = (0°N, 0°E)）
    const z = Math.cos(psi); // sin(lat)
    const latDeg = Math.asin(Math.max(-1, Math.min(1, z))) / DEG;
    const lonDeg = Math.sin(psi) >= 0 ? 90 : -90;
    // 视线方向 = 缘点处经度向子地点（lon → 0）/背子地点（lon → 180）偏移；
    // 在 lat/lon 网格上以经度偏移近似（极点邻域 cos(lat)→0 时经度偏移退化，
    // 由带内多点取极值兜底）
    let best = -Infinity;
    for (let b = 0; b < BAND_SAMPLES; b += 1) {
      const offsetDeg = -BAND_HALF_WIDTH_DEG + (2 * BAND_HALF_WIDTH_DEG * b) / (BAND_SAMPLES - 1);
      const cosLat = Math.max(Math.cos(latDeg * DEG), 0.05);
      const lonOffset = offsetDeg / cosLat;
      best = Math.max(best, sampleLdemKm(grid, latDeg, lonDeg + lonOffset));
    }
    samples[k] = roundTo(best, 3);
  }

  // 自校验（契约 C3）
  assertLimb(samples.length === SAMPLE_COUNT, `剖面点数 ${samples.length} ≠ ${SAMPLE_COUNT}`);
  let sum = 0;
  let nonZero = 0;
  for (const v of samples) {
    assertLimb(Number.isFinite(v), '剖面含非数值');
    assertLimb(v >= DEVIATION_MIN_KM && v <= DEVIATION_MAX_KM, `偏差 ${v} km 越界 [−9, +9]`);
    sum += v;
    if (v !== 0) nonZero += 1;
  }
  assertLimb(nonZero > SAMPLE_COUNT / 2, '剖面过半为零——采样疑似错位');
  const mean = sum / SAMPLE_COUNT;
  assertLimb(Math.abs(mean) < 3, `剖面均值 ${mean.toFixed(2)} km 量级异常`);

  return {
    source:
      'LRO LOLA GDR LDEM_4 (NASA PDS, public domain; Smith et al. 2010, GRL 37, L18204); mean-libration limb (ME frame lon ±90° meridian), max over ±0.5° line-of-sight band',
    meanRadiusKm: MOON_MEAN_RADIUS_KM,
    samples,
  };
}

/** --fetch-lola：从 NASA PDS 重拉 LDEM_4 快照（需网络，~2 MB） */
export async function refetchLolaSnapshot(snapshotDir: string): Promise<void> {
  console.log(`[bake-data] --fetch-lola：从 ${LDEM_URL} 重拉 LDEM_4…`);
  const imgRes = await fetch(LDEM_URL);
  if (!imgRes.ok) failLimb(`PDS 返回 HTTP ${imgRes.status}（离线时去掉 --fetch-lola）`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  assertLimb(
    buf.byteLength === LDEM_LINES * LDEM_SAMPLES * 2,
    `拉取的 LDEM_4 字节数 ${buf.byteLength} 异常，拒绝覆盖快照`
  );
  writeFileSync(join(snapshotDir, SNAPSHOT_IMG), gzipSync(buf, { level: 9 }));
  const lblRes = await fetch(LDEM_LBL_URL);
  if (!lblRes.ok) failLimb(`PDS 标签返回 HTTP ${lblRes.status}`);
  writeFileSync(join(snapshotDir, SNAPSHOT_LBL), await lblRes.text());
  console.log('[bake-data] LDEM_4 快照已更新');
}
