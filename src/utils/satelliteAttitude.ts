/**
 * 人造卫星姿态计算（P7 §3.1 姿态，纯逻辑供单元测试）
 *
 * 模型轴约定（与 satelliteGeometry / glTF 接入统一）：
 * - +X：飞行方向（速度方向，ISS 对地定向飞行的前向）
 * - −Y：指向地心（nadir，对地定向），+Y 背离地心
 * - +Z：右手系补全（轨道面法向一侧）
 *
 * 真实性说明：
 * - ISS / 天宫为对地定向飞行姿态（同一面始终朝向地心），沿轨道运动时
 *   姿态随之旋转——本模块按位置/速度构造正交基精确实现；
 * - 帆板对日跟踪简化为"绕单轴（模型 X 桁架轴）旋转对准太阳投影"
 *   （真实 ISS 帆板有双自由度 alpha/beta 万向节，登记近似）；
 * - 哈勃镜筒指向惯性空间（观测目标方向），保持恒定姿态即可（组件侧处理）。
 */

/** 三维向量（纯数据，避免引入 three 依赖以便单元测试） */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 四元数（与 THREE.Quaternion 分量约定一致） */
export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

function dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3Like, b: Vec3Like): Vec3Like {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(a: Vec3Like): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3Like): Vec3Like | null {
  const len = length(a);
  if (len < 1e-9) return null;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

/**
 * 对地定向姿态基（ISS / 天宫）：
 * 由卫星在行星参考平面组内的位置与速度构造模型轴正交基。
 *
 * @param position 卫星相对行星中心的位置（局部坐标）
 * @param velocity 卫星速度方向（局部坐标，可未归一化）
 * @returns 模型 X/Y/Z 轴在局部坐标系中的方向；退化（零向量/共线）返回 null
 */
export function nadirAttitudeBasis(
  position: Vec3Like,
  velocity: Vec3Like,
): { xAxis: Vec3Like; yAxis: Vec3Like; zAxis: Vec3Like } | null {
  // +Y 背离地心（-Y 指向地心 = 对地定向）
  const up = normalize(position);
  if (!up) return null;
  // +X 沿飞行方向（去除径向分量，保证与 +Y 正交）
  const radial = dot(velocity, up);
  const tangential = {
    x: velocity.x - radial * up.x,
    y: velocity.y - radial * up.y,
    z: velocity.z - radial * up.z,
  };
  const forward = normalize(tangential);
  if (!forward) return null;
  // +Z 右手系补全
  const zAxis = cross(forward, up);
  return { xAxis: forward, yAxis: up, zAxis };
}

/**
 * 正交基 → 四元数（旋转矩阵列向量为模型轴方向，Shepperd 方法）
 */
export function basisToQuaternion(
  xAxis: Vec3Like,
  yAxis: Vec3Like,
  zAxis: Vec3Like,
): QuatLike {
  // 旋转矩阵（列主序：模型 X/Y/Z 轴）
  const m00 = xAxis.x;
  const m10 = xAxis.y;
  const m20 = xAxis.z;
  const m01 = yAxis.x;
  const m11 = yAxis.y;
  const m21 = yAxis.z;
  const m02 = zAxis.x;
  const m12 = zAxis.y;
  const m22 = zAxis.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return {
      w: 0.25 / s,
      x: (m21 - m12) * s,
      y: (m02 - m20) * s,
      z: (m10 - m01) * s,
    };
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return {
      w: (m21 - m12) / s,
      x: 0.25 * s,
      y: (m01 + m10) / s,
      z: (m02 + m20) / s,
    };
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return {
      w: (m02 - m20) / s,
      x: (m01 + m10) / s,
      y: 0.25 * s,
      z: (m12 + m21) / s,
    };
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return {
    w: (m10 - m01) / s,
    x: (m02 + m20) / s,
    y: (m12 + m21) / s,
    z: 0.25 * s,
  };
}

/**
 * 对地定向姿态四元数（ISS / 天宫，需求 P7 §3.1）：
 * 使模型 −Y 始终指向地心、+X 沿飞行方向。退化输入返回 null（保持上帧姿态）。
 */
export function nadirAttitudeQuaternion(
  position: Vec3Like,
  velocity: Vec3Like,
): QuatLike | null {
  const basis = nadirAttitudeBasis(position, velocity);
  if (!basis) return null;
  return basisToQuaternion(basis.xAxis, basis.yAxis, basis.zAxis);
}

/**
 * 帆板对日跟踪角（弧度，P7 §3.1 帆板朝阳示意）：
 * 帆板绕模型 X（桁架）轴旋转，法线 n(θ) = (0, cosθ, sinθ)。
 * 取 θ 使 n·sunDir 最大（对准太阳在 Y-Z 平面的投影）。
 *
 * @param sunDirModel 太阳方向在模型坐标系中的单位向量（近似即可）
 * @returns 旋转角 θ；太阳方向与桁架轴平行（投影过小）时返回 0
 */
export function panelSunTrackAngleRad(sunDirModel: Vec3Like): number {
  const proj = Math.hypot(sunDirModel.y, sunDirModel.z);
  if (proj < 1e-6) return 0;
  return Math.atan2(sunDirModel.z, sunDirModel.y);
}

/**
 * 帆板对日跟踪角（绕模型 Z 轴，天宫实验舱太阳翼 / TDRS 帆板）：
 * 帆板法线 n(θ) = (−sinθ, cosθ, 0)，取 θ 使 n·sunDir 最大。
 *
 * @param sunDirModel 太阳方向在模型坐标系中的单位向量
 * @returns 旋转角 θ；太阳方向与 Z 轴平行（投影过小）时返回 0
 */
export function panelSunTrackAngleAboutZRad(sunDirModel: Vec3Like): number {
  const proj = Math.hypot(sunDirModel.x, sunDirModel.y);
  if (proj < 1e-6) return 0;
  return Math.atan2(-sunDirModel.x, sunDirModel.y);
}

/**
 * 四元数旋转向量（测试/组件共用的轻量实现，等价 THREE.Vector3.applyQuaternion）
 */
export function rotateVectorByQuaternion(v: Vec3Like, q: QuatLike): Vec3Like {
  // t = 2 q_vec × v；v' = v + w t + q_vec × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}
