/**
 * 实验室地面视角「天体跟随」相机纯函数层（LE-M6 补丁 P5）
 *
 * 病灶：日月食地面视角的相机只在挂载/切页签时对准一次，此后天体靠周日
 * 运动自己走出画面——l2029（圣保罗，食甚月高 87°）全程 5.5 h 时角走 ~82°，
 * ×243 加速回放下几秒钟就出框；望远档（3° FOV）上线后 1 分钟真实时间的
 * 0.25° 漂移就占去画面的 8%。
 *
 * 跟随语义 = **等效赤道仪跟踪的差量旋转**（不是「硬锁定居中」）：
 * 逐帧取天体方向 d(t)，用把 d(t−1) 转到 d(t) 的**最小旋转**去转相机位置
 * （绕原点刚体旋转、半径不变）。于是
 * - 用户手动拖开多少度，就一直保持多少度（想盯着看就盯着，想看地平线就
 *   看地平线，天体都不会甩掉）——这是硬居中做不到的；
 * - 代价是跟踪期间星空与地平线相应移动（跟踪的必然，UI 侧注明）。
 *
 * 相机 up 恒为世界 +Y（消费侧 `lookAt` 约定），画面**不做场旋**——地平线
 * 始终水平，即地平式机架观感。
 *
 * 纪律（§7）：不 import React/three；全部为 out 参复用的零 GC 向量运算；
 * 单测覆盖率 gate ≥90%。
 */

import type { MutableVec3 } from "@/utils/solarEclipseSpace";

/**
 * 复位收敛时间常数（秒）：残余角按 `1 − exp(−dt/τ)` 逐帧吃掉，
 * τ = 0.15s → 0.5s 后残余 ~3.6%（观感上即「0.5 秒平滑归中」）。
 */
export const LAB_FOLLOW_RECENTER_TAU_SEC = 0.15;

/** 复位判定完成的残余角阈值（弧度；约 0.06°，望远档下亚像素） */
export const LAB_FOLLOW_RECENTER_DONE_RAD = 1e-3;

/** 方向近似平行/反向的判据（|sin θ| 阈值；低于此视为退化） */
const DEGENERATE_SIN = 1e-9;

/** 向量模长（内部用） */
function norm3(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

/** 三分量是否全为有限数 */
function finite3(v: readonly number[]): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}

/**
 * 把向量 `v` 施加「fromDir → toDir 的最小旋转」（Rodrigues 公式），写入 out。
 *
 * - `fromDir` / `toDir` 无需预先归一（内部归一）；
 * - 两向量同向（旋转角 ~0）时输出 = v（恒等，逐帧常态走这条快路）；
 * - 两向量近**反向**（旋转轴不唯一，几何上无「最小旋转」可言）时**保持
 *   恒等**——该情形只可能来自天体方向的非物理跳变，宁可不转也不乱转；
 * - 任一入参非有限或退化为零向量时输出 = v（安全降级，相机不被写坏）。
 *
 * @returns out（同一引用，便于链式与零 GC 复用）
 */
export function rotateVectorBetweenDirs(
  fromDir: readonly number[],
  toDir: readonly number[],
  v: readonly number[],
  out: MutableVec3,
): MutableVec3 {
  out[0] = v[0];
  out[1] = v[1];
  out[2] = v[2];
  if (!finite3(fromDir) || !finite3(toDir) || !finite3(v)) return out;

  const fl = norm3(fromDir[0], fromDir[1], fromDir[2]);
  const tl = norm3(toDir[0], toDir[1], toDir[2]);
  if (fl <= 0 || tl <= 0) return out;
  const fx = fromDir[0] / fl;
  const fy = fromDir[1] / fl;
  const fz = fromDir[2] / fl;
  const tx = toDir[0] / tl;
  const ty = toDir[1] / tl;
  const tz = toDir[2] / tl;

  // 旋转轴 = from × to，sinθ = |轴|，cosθ = from · to
  const ax = fy * tz - fz * ty;
  const ay = fz * tx - fx * tz;
  const az = fx * ty - fy * tx;
  const s = norm3(ax, ay, az);
  const c = fx * tx + fy * ty + fz * tz;
  if (s < DEGENERATE_SIN) return out; // 同向（恒等）或反向（不唯一，拒转）

  const kx = ax / s;
  const ky = ay / s;
  const kz = az / s;
  // Rodrigues：v·cosθ + (k×v)·sinθ + k·(k·v)(1−cosθ)
  const kdv = kx * v[0] + ky * v[1] + kz * v[2];
  const cx = ky * v[2] - kz * v[1];
  const cy = kz * v[0] - kx * v[2];
  const cz = kx * v[1] - ky * v[0];
  out[0] = v[0] * c + cx * s + kx * kdv * (1 - c);
  out[1] = v[1] * c + cy * s + ky * kdv * (1 - c);
  out[2] = v[2] * c + cz * s + kz * kdv * (1 - c);
  return out;
}

/**
 * 两个方向之间按比例 t 插值并归一（复位收敛用；t 钳制 [0,1]）。
 *
 * 采用「归一化线性插值」而非严格 slerp：逐帧 t 很小（τ 收敛），两者差异
 * 远在亚像素以下，且在近反向时不会出现 slerp 的除零奇异（此处退化为
 * 保持 a——与 rotateVectorBetweenDirs 的拒转口径一致）。
 *
 * @returns out（单位向量；退化时 = 归一化后的 a）
 */
export function slerpDirections(
  a: readonly number[],
  b: readonly number[],
  t: number,
  out: MutableVec3,
): MutableVec3 {
  const al = finite3(a) ? norm3(a[0], a[1], a[2]) : 0;
  const bl = finite3(b) ? norm3(b[0], b[1], b[2]) : 0;
  if (al <= 0) {
    if (bl <= 0) {
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
      return out;
    }
    out[0] = b[0] / bl;
    out[1] = b[1] / bl;
    out[2] = b[2] / bl;
    return out;
  }
  const ax = a[0] / al;
  const ay = a[1] / al;
  const az = a[2] / al;
  if (bl <= 0 || !Number.isFinite(t)) {
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
    return out;
  }
  const k = Math.min(1, Math.max(0, t));
  const bx = b[0] / bl;
  const by = b[1] / bl;
  const bz = b[2] / bl;
  const mx = ax + (bx - ax) * k;
  const my = ay + (by - ay) * k;
  const mz = az + (bz - az) * k;
  const ml = norm3(mx, my, mz);
  if (ml < DEGENERATE_SIN) {
    // 近反向且 t≈0.5 的退化（插值落到原点）——保持 a
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
    return out;
  }
  out[0] = mx / ml;
  out[1] = my / ml;
  out[2] = mz / ml;
  return out;
}

/**
 * 复位收敛比例（帧率无关）：`1 − exp(−dt/τ)`，钳制 [0,1]。
 * 非有限/非正入参安全降级（dt 异常 → 0 不动；τ 异常 → 用默认 τ）。
 */
export function followRecenterFraction(
  dtSec: number,
  tauSec: number = LAB_FOLLOW_RECENTER_TAU_SEC,
): number {
  if (!Number.isFinite(dtSec) || dtSec <= 0) return 0;
  const tau =
    Number.isFinite(tauSec) && tauSec > 0
      ? tauSec
      : LAB_FOLLOW_RECENTER_TAU_SEC;
  return Math.min(1, Math.max(0, 1 - Math.exp(-dtSec / tau)));
}

/** 两个方向的夹角（弧度；非有限/零向量返回 0）——测试与复位判定共用 */
export function angleBetweenDirs(
  a: readonly number[],
  b: readonly number[],
): number {
  if (!finite3(a) || !finite3(b)) return 0;
  const al = norm3(a[0], a[1], a[2]);
  const bl = norm3(b[0], b[1], b[2]);
  if (al <= 0 || bl <= 0) return 0;
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (al * bl);
  return Math.acos(Math.min(1, Math.max(-1, c)));
}
