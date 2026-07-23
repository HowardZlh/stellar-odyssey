/**
 * 木星云层差速流动（P4，需求 §4.7 气态行星动态细节）
 *
 * 科学背景（数据来源：NASA Juno / Voyager 大气观测）：
 * 木星大气按纬度分为交替的"带"（belts，暗）与"区"（zones，亮），
 * 赤道急流（System I，周期 9h50m）比中高纬（System II，9h55m）
 * 快约 0.8%——赤道带相对内部自转（System III，9.925h）东向漂移
 * ~100 m/s，温带出现交替的东西向急流。
 *
 * 实现：表面 shader 按纬度对纹理 U 坐标附加随时间累计的漂移相位，
 * 本模块为漂移速率剖面的纯逻辑（可单元测试）；漂移相位与行星自转
 * 共用同一模拟时间轴（暂停/加速全局生效）。
 *
 * 艺术化登记：真实纬向风剖面含 10+ 条急流，此处简化为
 * "赤道急流 + 两组温带反向急流"的高斯叠加，速率量级与真实一致
 * （相对自转 ≤1.2%），流动结构方向正确。
 */

/** 赤道急流峰值漂移速率（相对基础自转的比例，System I vs III ≈ +0.8%） */
export const EQUATORIAL_JET_RATE = 0.008;

/** 温带反向急流峰值速率（交替带结构，幅度较赤道弱） */
export const TEMPERATE_JET_RATE = 0.0035;

/**
 * 流动视觉增益（视觉夸大登记，需求 4.1）：真实差速仅 ~1%/自转，
 * 常规模拟速度下数分钟内不可辨识；漂移相位放大 6 倍便于观察，
 * 剖面结构（急流纬度分布与方向）保持真实。
 */
export const FLOW_VISUAL_GAIN = 6;

/**
 * 纬向漂移速率剖面（相对基础自转角速度的比例，正 = 东向超前）
 *
 * @param latRad 纬度（弧度，赤道 0，北极 +π/2）
 * @returns 漂移速率比例（|值| ≤ EQUATORIAL_JET_RATE）
 */
export function jovianDriftRate(latRad: number): number {
  if (!Number.isFinite(latRad)) {
    throw new RangeError(`纬度必须为有限数，收到 ${latRad}`);
  }
  const lat = latRad;
  // 赤道急流：±12° 内的东向高斯峰
  const equatorial = EQUATORIAL_JET_RATE * Math.exp(-((lat / 0.21) ** 2));
  // 温带急流：±24° 附近西向、±42° 附近东向（交替带结构）
  const t1 = -TEMPERATE_JET_RATE * Math.exp(-(((Math.abs(lat) - 0.42) / 0.13) ** 2));
  const t2 = TEMPERATE_JET_RATE * 0.7 * Math.exp(-(((Math.abs(lat) - 0.73) / 0.15) ** 2));
  return equatorial + t1 + t2;
}

/**
 * 纹理 U 坐标漂移量（shader 镜像）：
 * ΔU = −driftRate(lat) · rotationAngle / 2π
 * （自转角随模拟时间累计；East 向漂移对应 U 减小——纹理向东移动）
 */
export function jovianFlowUvOffset(latRad: number, rotationAngleRad: number): number {
  return (-jovianDriftRate(latRad) * rotationAngleRad) / (Math.PI * 2);
}

/**
 * 流动相位回卷窗口（弧度）：4096 × 2π。
 *
 * 背景（与 utils/belts.ts BELT_TIME_WRAP_DAYS 同类的 bug 防护）：
 * uFlowPhase 是 float32 uniform，而自转角随模拟时间无界累计——银河系/
 * 宇宙视角的时间压缩可使 simDays 达 10⁹⁺ 天，木星累计自转角 ~10¹⁰ 弧度，
 * ×视觉增益后 float32 绝对误差达 10⁴ 弧度量级，行星视角近观木星时
 * 云层流动完全错乱（帧间跳变）。
 *
 * 处理（已登记的统计近似）：相位按本窗口（2π 的整数倍）取模——基础自转
 * 对齐不受影响；各纬度带的 U 偏移在窗口跨越时按 drift·W/2π 的小数部分
 * 一次性重排（云带条纹为统计性表面纹理，重排不可感知）。
 *
 * 窗口取 1536×2π ≈ 9650 弧度：远低于 float32 精度上限，且连续差速剖面
 * 固有的逐纬度剪切条纹（striae，物理上真实存在的剪切现象）不超过
 * 当前日期基线观感对应的相位量级——任意模拟时刻观感一致。
 */
export const FLOW_PHASE_WRAP_RAD = 1536 * Math.PI * 2;

/**
 * 木星流动 shader 相位：按 FLOW_PHASE_WRAP_RAD 回卷到 [0, W)
 *
 * 相位 < W（约 1536 个自转周期内）时恒等返回，行为与未回卷完全一致。
 */
export function flowShaderPhase(flowPhaseRad: number): number {
  if (!Number.isFinite(flowPhaseRad)) {
    throw new RangeError(`流动相位必须为有限数，收到 ${flowPhaseRad}`);
  }
  const wrapped = flowPhaseRad % FLOW_PHASE_WRAP_RAD;
  return wrapped < 0 ? wrapped + FLOW_PHASE_WRAP_RAD : wrapped;
}

/** UV.y（0-1，南极→北极）→ 纬度（弧度） */
export function latitudeFromV(v01: number): number {
  const v = Math.min(1, Math.max(0, v01));
  return (v - 0.5) * Math.PI;
}
