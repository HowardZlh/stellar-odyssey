/**
 * 彗核不规则外形（P4，需求 §4.7 彗核岩石质感 + 不规则外形）
 *
 * 数据来源登记：哈雷彗核实测约 15×8×8 km 的"花生形"不规则体
 * （ESA Giotto 任务，1986 年飞掠成像）。恩克彗核约 4.8 km 直径，
 * 形状不规则（雷达观测）。
 *
 * 实现：单位球顶点沿径向做确定性噪声位移（多频正弦叠加，无随机数，
 * 同一 seed 结果可复现）+ 中腰收缩（花生形）；本模块为纯逻辑，
 * 几何构建在 Comet.tsx。
 */

/** 花生形中腰收缩强度（哈雷 15×8 双瓣形态的腰部凹陷） */
export const WAIST_PINCH = 0.22;

/** 噪声位移幅度（相对半径比例） */
export const NOISE_AMPLITUDE = 0.14;

/** 长轴伸长比（15 km / 8 km ≈ 1.875，沿局部 X 轴） */
export const ELONGATION_RATIO = 1.875;

/**
 * 确定性径向噪声（多频正弦叠加，值域约 [-1, 1]）
 */
function radialNoise(x: number, y: number, z: number, seed: number): number {
  const s = seed * 0.7;
  return (
    (Math.sin(3.1 * x + 1.3 * s) * Math.sin(2.7 * y - 0.8 * s) +
      Math.sin(4.3 * y + 2.1 * s) * Math.sin(3.7 * z + 1.7 * s) +
      0.5 * Math.sin(7.9 * x + 5.3 * z + s) * Math.sin(6.1 * y - 2.9 * s)) /
    2.5
  );
}

/**
 * 彗核径向缩放系数：单位方向向量 → 该方向的半径乘数
 *
 * = (1 − 腰部收缩·exp(−(x/0.35)²)) · (1 + 噪声幅度·noise)
 * （腰部收缩沿长轴 X 的中部，形成双瓣花生形）
 *
 * @param dir 单位方向向量（局部坐标，长轴为 X）
 * @param seed 形状种子（不同彗星形状不同，确定性可复现）
 */
export function cometNucleusRadialScale(
  dir: { x: number; y: number; z: number },
  seed: number,
): number {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-9) {
    throw new RangeError('方向向量不能为零向量');
  }
  const x = dir.x / len;
  const y = dir.y / len;
  const z = dir.z / len;
  const pinch = 1 - WAIST_PINCH * Math.exp(-((x / 0.35) ** 2));
  const noise = 1 + NOISE_AMPLITUDE * radialNoise(x, y, z, seed);
  return pinch * noise;
}
