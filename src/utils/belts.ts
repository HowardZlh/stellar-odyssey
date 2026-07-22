/**
 * 粒子带（小行星带 / 柯伊伯带）生成与运动（需求 3.1.1）
 *
 * 运动规则（防静态化）：每个粒子沿各自开普勒轨道公转，
 * 平均运动 n = 2π/T，T²=a³（太阳中心），内圈角速度大于外圈（开普勒剪切）。
 * 禁止静态环或整体刚性旋转。
 *
 * 实现方式：为每个粒子预计算轨道基矢 P（近日点方向）、Q（轨道面内垂直方向），
 * 渲染端顶点着色器由 (a, e, M₀, n) 每帧推进：
 *   M = M₀ + n·t
 *   E ≈ M + e·sinM·(1 + e·cosM)   —— 低离心率二阶近似（e ≤ 0.2，误差 O(e³)，
 *                                     已登记：粒子带允许近似，行星/彗星仍用精确解）
 *   pos = P·a(cosE − e) + Q·a√(1−e²)·sinE
 *
 * 本文件提供与着色器一致的 CPU 参考实现，保证可测试性。
 */

import type { BeltConfig, Vec3 } from '@/types';
import { DEG_TO_RAD, meanMotionRadPerDay } from '@/utils/physics';
import { createSeededRandom } from '@/utils/random';

export interface BeltParticleArrays {
  count: number;
  /** 半长轴（AU） */
  semiMajorAu: Float32Array;
  /** 离心率 */
  eccentricity: Float32Array;
  /** J2000 平近点角（弧度） */
  meanAnomaly0: Float32Array;
  /** 平均运动（弧度/天，开普勒第三定律） */
  meanMotionRadPerDay: Float32Array;
  /** 轨道基矢 P（黄道坐标，指向近日点，count*3） */
  basisP: Float32Array;
  /** 轨道基矢 Q（黄道坐标，轨道面内垂直于 P，count*3） */
  basisQ: Float32Array;
  /** 粒子颜色（RGB，count*3） */
  colors: Float32Array;
}

/**
 * 确定性生成粒子带轨道要素（同一 config.seed 结果稳定，需求 4.5）
 */
export function generateBeltParticles(config: BeltConfig): BeltParticleArrays {
  if (config.count <= 0 || !Number.isInteger(config.count)) {
    throw new RangeError(`粒子数必须为正整数，收到 ${config.count}`);
  }
  if (config.outerAu <= config.innerAu) {
    throw new RangeError('粒子带外缘必须大于内缘');
  }
  const rand = createSeededRandom(config.seed);
  const n = config.count;
  const arrays: BeltParticleArrays = {
    count: n,
    semiMajorAu: new Float32Array(n),
    eccentricity: new Float32Array(n),
    meanAnomaly0: new Float32Array(n),
    meanMotionRadPerDay: new Float32Array(n),
    basisP: new Float32Array(n * 3),
    basisQ: new Float32Array(n * 3),
    colors: new Float32Array(n * 3),
  };

  const baseColor = hexToRgb(config.color);

  for (let i = 0; i < n; i += 1) {
    const a = config.innerAu + (config.outerAu - config.innerAu) * rand();
    const e = config.maxEccentricity * rand();
    const inc = config.maxInclinationDeg * DEG_TO_RAD * (rand() * 2 - 1);
    const node = Math.PI * 2 * rand();
    const peri = Math.PI * 2 * rand();
    const m0 = Math.PI * 2 * rand();

    arrays.semiMajorAu[i] = a;
    arrays.eccentricity[i] = e;
    arrays.meanAnomaly0[i] = m0;
    arrays.meanMotionRadPerDay[i] = meanMotionRadPerDay(a);

    const cosO = Math.cos(node);
    const sinO = Math.sin(node);
    const cosI = Math.cos(inc);
    const sinI = Math.sin(inc);
    const cosW = Math.cos(peri);
    const sinW = Math.sin(peri);

    // 标准轨道基矢（黄道坐标系）
    arrays.basisP[i * 3] = cosO * cosW - sinO * sinW * cosI;
    arrays.basisP[i * 3 + 1] = sinO * cosW + cosO * sinW * cosI;
    arrays.basisP[i * 3 + 2] = sinI * sinW;
    arrays.basisQ[i * 3] = -cosO * sinW - sinO * cosW * cosI;
    arrays.basisQ[i * 3 + 1] = -sinO * sinW + cosO * cosW * cosI;
    arrays.basisQ[i * 3 + 2] = sinI * cosW;

    // 颜色抖动（冰质柯伊伯带偏冷色由基准色决定）
    const jitter = 1 - config.colorVariation * rand();
    arrays.colors[i * 3] = baseColor.r * jitter;
    arrays.colors[i * 3 + 1] = baseColor.g * jitter;
    arrays.colors[i * 3 + 2] = baseColor.b * jitter;
  }
  return arrays;
}

/**
 * 粒子位置 CPU 参考实现（黄道坐标 AU，与着色器公式一致）
 */
export function beltParticlePositionAu(
  arrays: BeltParticleArrays,
  index: number,
  simDays: number,
): Vec3 {
  if (index < 0 || index >= arrays.count) {
    throw new RangeError(`粒子索引越界：${index}`);
  }
  const a = arrays.semiMajorAu[index];
  const e = arrays.eccentricity[index];
  const M = arrays.meanAnomaly0[index] + arrays.meanMotionRadPerDay[index] * simDays;
  // 低离心率二阶近似（与顶点着色器一致）
  const E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  const xOrb = a * (Math.cos(E) - e);
  const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const px = arrays.basisP[index * 3];
  const py = arrays.basisP[index * 3 + 1];
  const pz = arrays.basisP[index * 3 + 2];
  const qx = arrays.basisQ[index * 3];
  const qy = arrays.basisQ[index * 3 + 1];
  const qz = arrays.basisQ[index * 3 + 2];
  return {
    x: px * xOrb + qx * yOrb,
    y: py * xOrb + qy * yOrb,
    z: pz * xOrb + qz * yOrb,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new RangeError(`颜色必须为 #RRGGBB 格式，收到 ${hex}`);
  }
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
}
