/**
 * 伽马射线暴 GRB 221009A 近观细节层纯逻辑（R5-5 B，IMPROVEMENT_REQUIREMENTS_5 §R5-5）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行）：为 `Scene/GrbNearView.tsx` 提供
 * detailLayer 规格、喷流开角参数化与余辉膨胀/减暗曲线；组件只消费本
 * 模块输出。
 *
 * ── 现状核对结论登记（§R5-5 B 第 2 条）───────────────────────────────────
 * GRB 是**常驻演示物**（非事件触发物）：`ExtragalacticObjects.GammaRayBurst`
 * 由 Universe.tsx 无条件挂载，`utils/specialBodies.grbFlashState` 以
 * GRB_CYCLE_SEC=45s 周期重放 FRED 闪光（快升指数衰减，3s；真实为一次性
 * 事件、循环重放为演示示意已登记）。近观细节层随该周期时钟出现/衰减：
 * 喷流随爆发增亮后衰减（保留低亮度地板 0.15 档——喷流为持续结构、
 * 演示可见性登记）；余辉壳自爆发起膨胀减暗、周期末淡出归零（下一循环
 * 重新起燃，无跳变）。
 *
 * ── 相对论火球模型图景登记（Piran 2004, Rev. Mod. Phys. 76, 1143 综述）──
 * - 双喷流：长暴核坍缩相对论喷流典型半开角 ~2°–10°，取全开角 5° 档
 *   （`RelativisticJet` 锥体半径系数 = tan(全开角/2)，现状默认 0.035 ≈
 *   4° 全开角零回退；GRB 近观档 ~5° 且蓝白更亮）；
 * - 余辉膨胀壳：绝热火球减速段观测系半径近似 R ∝ t^(1/4)
 *   （`grbAfterglowState.radius01 = (t/周期)^0.25`，周期末达最大可视化
 *   半径）；余辉光度幂律衰减 F ∝ t^(−α)，取 α = 1.2（X 射线/光学典型
 *   衰减指数档）；颜色随龄由蓝白（早期高能）向暗橙（晚期低能）过渡为
 *   艺术化呈现登记（真实为 X 射线→光学→射电的频段演化，不可见光直译）。
 * - 时标压缩登记：真实余辉演化数天–数月，压缩至 45s 演示周期内呈现。
 *
 * ── 预算登记（附录 A §1）─────────────────────────────────────────────────
 * particles 池（容量 1，与 R2-8 星系近观/R4-21 类星体共池 LRU、
 * 'lru-retain' L4 语义）：喷流锥 mesh ×2 + 流动节点 sprite ×10 +
 * 余辉壳 mesh ×1 = 13（points/sprites/mesh 合并计数口径）≤ 单目标
 * 12,000；共池容量 1 → 全局粒子峰值不变。
 */

import {
  EXTRAGALACTIC_VIEW_RADIUS_UNITS,
  viewDistanceForRadius,
} from '@/utils/cameraFocus';
import { NEAR_VIEW_ENTER_RATIO, NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import { estimateGpuBytes, type DetailLayerSpec } from '@/utils/detailLayer';
import { GRB_CYCLE_SEC, GRB_FLASH_DURATION_SEC } from '@/utils/specialBodies';

// ---------------------------------------------------------------------------
// 常量（几何因子为"基准半径倍数"——主场景基准 = EXTRAGALACTIC_VIEW_RADIUS_UNITS）
// ---------------------------------------------------------------------------

/** 天体 id（store.followBodyId/flyToBodyId 判据对齐） */
export const GRB_BODY_ID = 'grb-221009a';

/** 近观喷流全开角（度；Piran 2004 长暴典型半开角档，登记见文件头） */
export const GRB_NEAR_JET_FULL_ANGLE_DEG = 5;

/** 近观喷流长度（基准半径倍数；静态锥 1800/300=6 之上略长呈近观细节） */
export const GRB_NEAR_JET_LENGTH_FACTOR = 7;

/** 近观喷流颜色（蓝白更亮档，静态锥 #cfe8ff 之上提亮） */
export const GRB_NEAR_JET_COLOR = '#e8f4ff';

/** 近观喷流基础不透明度（既有喷流 0.7–0.8 档之上"更亮"登记） */
export const GRB_NEAR_JET_BASE_OPACITY = 1.0;

/** 余辉壳最大可视化半径（基准半径倍数；周期末尺度） */
export const GRB_AFTERGLOW_MAX_RADIUS_FACTOR = 1.6;

/** 余辉光度幂律衰减指数 α（F ∝ t^−α，Piran 2004 典型档登记） */
export const GRB_AFTERGLOW_DECAY_ALPHA = 1.2;

/** 余辉幂律衰减时间尺度 τ（秒；(t+τ)/τ 形式防 t→0 发散） */
export const GRB_AFTERGLOW_TAU_SEC = 6;

/** 喷流爆发后指数衰减时间尺度（秒） */
export const GRB_NEAR_JET_DECAY_TAU_SEC = 6;

/** 喷流爆发间低亮度地板（喷流为持续结构、演示可见性登记见文件头） */
export const GRB_NEAR_JET_FLOOR = 0.15;

/** 周期末淡出窗（秒；[cycle−start, cycle−end] 平滑归零防重放跳变） */
export const GRB_CYCLE_FADE_OUT_START_SEC = 4;
export const GRB_CYCLE_FADE_OUT_END_SEC = 1;

/** 近观时静态双锥喷流减淡幅度（细节喷流接管，ANTENNAE 同范式登记） */
export const GRB_STATIC_NEAR_DIM = 0.6;

/** 近观层"粒子"计数（锥 mesh 2 + 流动节点 sprite 10 + 余辉壳 mesh 1） */
export const GRB_NEAR_PARTICLE_COUNT = 13;

/** 余辉壳早期色（蓝白，高能段艺术化档） */
export const GRB_AFTERGLOW_COLOR_HOT = '#cfe4ff';

/** 余辉壳晚期色（暗橙，低能段艺术化档） */
export const GRB_AFTERGLOW_COLOR_COOL = '#ff9a66';

// ---------------------------------------------------------------------------
// 喷流开角参数化（RelativisticJet 锥体半径系数）
// ---------------------------------------------------------------------------

/**
 * 喷流全开角（度）→ 锥体半径系数（锥底半径 = 长度 × 系数 = tan(半开角)）
 *
 * @throws RangeError 当开角不在 (0, 90) 内
 */
export function jetConeRadiusFactor(fullAngleDeg: number): number {
  if (!Number.isFinite(fullAngleDeg) || fullAngleDeg <= 0 || fullAngleDeg >= 90) {
    throw new RangeError(`喷流全开角必须在 (0, 90)° 内，收到 ${fullAngleDeg}`);
  }
  return Math.tan(((fullAngleDeg / 2) * Math.PI) / 180);
}

// ---------------------------------------------------------------------------
// detailLayer 规格（R4-2 统一门控；阈值与 resolveFocusTarget 同源）
// ---------------------------------------------------------------------------

/**
 * GRB 近观进入阈值（场景单位）= 河外特殊天体飞往观察距离 ×
 * NEAR_VIEW_ENTER_RATIO（cameraFocus/nearView 同源，R4-21 类星体同式）
 */
export function grbNearViewEnterDistanceUnits(): number {
  return viewDistanceForRadius(EXTRAGALACTIC_VIEW_RADIUS_UNITS) * NEAR_VIEW_ENTER_RATIO;
}

/**
 * GRB 细节层规格（particles 池，容量 1 与星系近观/类星体共池；
 * 组件以 'lru-retain' 语义挂载——L4 巡游快速切回免重建）
 */
export function grbDetailLayerSpec(): DetailLayerSpec {
  const enter = grbNearViewEnterDistanceUnits();
  const particles = GRB_NEAR_PARTICLE_COUNT;
  return {
    bodyId: GRB_BODY_ID,
    kind: 'particles',
    enterDistanceUnits: enter,
    exitDistanceUnits: enter * NEAR_VIEW_EXIT_RATIO,
    budget: {
      particles,
      gpuBytesEstimate: estimateGpuBytes({ particles }),
    },
  };
}

// ---------------------------------------------------------------------------
// 周期时钟驱动的演化曲线（纯函数，组件每帧消费）
// ---------------------------------------------------------------------------

/** smoothstep（GLSL 同式） */
function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 周期内时刻（秒，∈[0, cycleSec)；负时间回卷） */
function timeInCycle(tSec: number, cycleSec: number): number {
  let inCycle = tSec % cycleSec;
  if (inCycle < 0) inCycle += cycleSec;
  return inCycle;
}

/** 周期末淡出因子（∈[0,1]；重放前平滑归零防跳变） */
function cycleEndFade(inCycle: number, cycleSec: number): number {
  return (
    1 -
    smoothstep01(
      cycleSec - GRB_CYCLE_FADE_OUT_START_SEC,
      cycleSec - GRB_CYCLE_FADE_OUT_END_SEC,
      inCycle,
    )
  );
}

/** 余辉膨胀壳状态（组件每帧消费） */
export interface GrbAfterglowState {
  /** 膨胀半径（∈[0,1]，×最大可视化半径；R ∝ t^(1/4) 登记） */
  radius01: number;
  /** 可见强度（∈[0,1]；起燃 × 幂律衰减 × 周期末淡出） */
  opacity01: number;
  /** 周期内龄（∈[0,1)；颜色蓝白→暗橙过渡驱动） */
  age01: number;
}

/**
 * 余辉膨胀壳状态（Piran 2004 图景近似，登记见文件头）：
 * 半径 = (t/周期)^(1/4) 观测系减速膨胀近似；强度 = 起燃平滑
 * （闪光半程内升起）× 幂律衰减 ((t+τ)/τ)^(−α) × 周期末淡出。
 *
 * @throws RangeError 当周期/闪光时长非正
 */
export function grbAfterglowState(
  tSec: number,
  cycleSec: number = GRB_CYCLE_SEC,
  flashSec: number = GRB_FLASH_DURATION_SEC,
): GrbAfterglowState {
  if (!(cycleSec > 0) || !(flashSec > 0)) {
    throw new RangeError(`GRB 周期与时长必须为正数，收到 ${cycleSec}, ${flashSec}`);
  }
  const inCycle = timeInCycle(Number.isFinite(tSec) ? tSec : 0, cycleSec);
  const radius01 = Math.pow(inCycle / cycleSec, 0.25);
  const rise = smoothstep01(0, flashSec * 0.5, inCycle);
  const decay = Math.pow(
    (inCycle + GRB_AFTERGLOW_TAU_SEC) / GRB_AFTERGLOW_TAU_SEC,
    -GRB_AFTERGLOW_DECAY_ALPHA,
  );
  const opacity01 = rise * decay * cycleEndFade(inCycle, cycleSec);
  return { radius01, opacity01, age01: inCycle / cycleSec };
}

/**
 * 近观喷流可见权重（∈[0,1]）：爆发同步快速升起（与 FRED 上升段同窗）→
 * 指数衰减至低亮度地板 → 周期末淡出（下一循环重新起燃，连续无跳变）。
 */
export function grbNearJetWeight01(
  tSec: number,
  cycleSec: number = GRB_CYCLE_SEC,
  flashSec: number = GRB_FLASH_DURATION_SEC,
): number {
  if (!(cycleSec > 0) || !(flashSec > 0)) {
    throw new RangeError(`GRB 周期与时长必须为正数，收到 ${cycleSec}, ${flashSec}`);
  }
  const inCycle = timeInCycle(Number.isFinite(tSec) ? tSec : 0, cycleSec);
  const rise = smoothstep01(0, flashSec * 0.08, inCycle);
  const decay = Math.exp(-inCycle / GRB_NEAR_JET_DECAY_TAU_SEC);
  return (
    rise *
    (GRB_NEAR_JET_FLOOR + (1 - GRB_NEAR_JET_FLOOR) * decay) *
    cycleEndFade(inCycle, cycleSec)
  );
}

// ---------------------------------------------------------------------------
// 来源登记（预览页 dataSource / 信息面板追加段）
// ---------------------------------------------------------------------------

/** GRB 近观近似来源登记（附录 A §4；§0.4 数据源表"GRB 喷流/余辉"行） */
export const GRB_NEAR_SOURCE_ZH =
  '相对论火球模型图景（Piran 2004, Rev. Mod. Phys. 76, 1143 综述，近似登记）：双喷流全开角 ~5°（长暴典型半开角 2°–10° 档）；余辉壳观测系半径 R ∝ t^(1/4)（绝热减速段近似）、光度幂律衰减 α=1.2；真实余辉演化数天–数月压缩至 45s 演示周期、颜色蓝白→暗橙为频段演化的艺术化呈现（登记 utils/grbNearView）；GRB 为常驻演示物（周期重放已登记），近观层随周期时钟出现/衰减';
