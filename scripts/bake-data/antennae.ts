/**
 * R4-22 触须星系（NGC 4038/4039）潮汐尾离线烘焙：受限三体/测试粒子模拟
 *
 * 图景：Toomre & Toomre (1972, ApJ 178, 623) 潮汐相互作用——两质心
 * （Plummer 软化点质量）抛物线交会 + 各自盘面测试粒子（无自引力），
 * RK4 定步长积分，烘焙 10 个时间快照的粒子位置 → public/data/antennae.bin。
 *
 * ── 模拟参数登记（§0.4 数据源 / 附录 A §4）─────────────────────────────
 * - 单位制：G=1，M1=M2=1，近心距 r_p=1（长度单位）；μ=G(M1+M2)=2
 * - 轨道：抛物线相对轨道（e=1，能量≈0；T&T 原文 Antennae 用 e≈0.5 椭圆，
 *   本实现按需求取抛物线并登记——尾形态图景一致，仅两核末段分离更快）
 * - 盘：每星系 12 个同心环（半径 0.20–0.75 r_p，粒子数 ∝ 半径），
 *   共 2,772 粒/盘 ≤3,000；圆速度取 Plummer 软化 v_c=√(GMr²/(r²+ε²)^1.5)
 * - 盘姿态：双盘顺行（prograde，强潮汐尾条件），倾角 i=60°（T&T 图 23
 *   Antennae 模型 i₁=i₂=60° 近似档），节点角相差 π 使两尾反对称展开
 * - 软化：Plummer ε=0.15 r_p（防近心散射发散）
 * - 积分：RK4 定步长 dt=0.01，从 t=−12（r≈10 r_p 入轨，Barker 方程反解）
 *   积到 t=+7；快照 10 帧均布于 t∈[−2, +7]（近心点 t=0 前后尾发育全程）
 * - 确定性：mulberry32（seed=40384039）驱动环内抖动，两次运行逐字节一致
 *
 * ── 产物格式（Float32 小端，utils/bakedData.validateAntennae 同源）──────
 * [0] magic=fround(4038.4039)  [1] version=1  [2] snapshotCount S
 * [3] particleCount N（两盘合计） [4] diskACount nA（前 nA 粒属盘 A）
 * 随后 S 个快照，每快照：核 A xyz + 核 B xyz + N×xyz（模拟单位）
 *
 * ── 自校验（§R4-22 需求 3）────────────────────────────────────────────
 * 粒子数/无 NaN/坐标界（|r|<48）/两核两体能量宽松守恒（RK4 漂移 <2%·μ/r_p）
 * /两核间距近心点前单调减、后单调增。
 */

// ---------------------------------------------------------------------------
// 常量（登记值）
// ---------------------------------------------------------------------------

/** 文件魔数（NGC 4038.4039；运行时以 Math.fround 比较） */
export const ANTENNAE_MAGIC = 4038.4039;

export const ANTENNAE_VERSION = 1;

/** 快照数（需求域 8–12） */
export const SNAPSHOT_COUNT = 10;

/** 每盘环数与半径域（r_p 倍数） */
const RING_COUNT = 12;
const RING_R_MIN = 0.2;
const RING_R_MAX = 0.75;

/** 环粒子数系数：n_k = round(RING_DENSITY × r_k)（∝ 半径，均匀面密度近似） */
const RING_DENSITY = 490;

/** Plummer 软化长度（r_p 倍数） */
const SOFTENING = 0.15;

/** 抛物线入轨半径（r_p 倍数）与积分参数 */
const START_RADIUS = 10;
const DT = 0.01;

/** 快照时间窗（近心点 t=0；Barker 时间单位 √(2r_p³/μ)=1） */
const SNAP_T_START = -2;
const SNAP_T_END = 7;

/** 盘倾角（rad；T&T Antennae 模型 60° 档） */
const DISK_INCLINATION = (60 * Math.PI) / 180;

/** 确定性种子（mulberry32） */
const SEED = 40384039;

/** 引力参数：G=1，M1=M2=1 */
const MU = 2;

// ---------------------------------------------------------------------------
// 确定性随机（utils/random.ts mulberry32 同式；脚本域内复制登记）
// ---------------------------------------------------------------------------

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 模拟
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`[bake-data] antennae 自校验失败：${message}`);
  process.exit(1);
}

function assertBake(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

/** Plummer 软化加速度：a = −G·M·d / (|d|²+ε²)^{3/2}（d = 场点 − 源点） */
function accumAccel(
  out: { x: number; y: number; z: number },
  px: number,
  py: number,
  pz: number,
  sx: number,
  sy: number,
  sz: number,
  gm: number,
): void {
  const dx = px - sx;
  const dy = py - sy;
  const dz = pz - sz;
  const r2 = dx * dx + dy * dy + dz * dz + SOFTENING * SOFTENING;
  const inv = gm / (r2 * Math.sqrt(r2));
  out.x -= dx * inv;
  out.y -= dy * inv;
  out.z -= dz * inv;
}

interface SimState {
  /** [coreA(6), coreB(6), particles N×6]：每体 x,y,z,vx,vy,vz */
  y: Float64Array;
  n: number; // 测试粒子数
}

/** 导数：两核互相吸引（各 M=1），测试粒子受两核合力（无自引力） */
function derivative(state: Float64Array, n: number, out: Float64Array): void {
  const acc = { x: 0, y: 0, z: 0 };
  // 核 A（索引 0）受核 B 吸引
  acc.x = 0;
  acc.y = 0;
  acc.z = 0;
  accumAccel(acc, state[0], state[1], state[2], state[6], state[7], state[8], 1);
  out[0] = state[3];
  out[1] = state[4];
  out[2] = state[5];
  out[3] = acc.x;
  out[4] = acc.y;
  out[5] = acc.z;
  // 核 B
  acc.x = 0;
  acc.y = 0;
  acc.z = 0;
  accumAccel(acc, state[6], state[7], state[8], state[0], state[1], state[2], 1);
  out[6] = state[9];
  out[7] = state[10];
  out[8] = state[11];
  out[9] = acc.x;
  out[10] = acc.y;
  out[11] = acc.z;
  // 测试粒子
  for (let i = 0; i < n; i += 1) {
    const o = 12 + i * 6;
    acc.x = 0;
    acc.y = 0;
    acc.z = 0;
    accumAccel(acc, state[o], state[o + 1], state[o + 2], state[0], state[1], state[2], 1);
    accumAccel(acc, state[o], state[o + 1], state[o + 2], state[6], state[7], state[8], 1);
    out[o] = state[o + 3];
    out[o + 1] = state[o + 4];
    out[o + 2] = state[o + 5];
    out[o + 3] = acc.x;
    out[o + 4] = acc.y;
    out[o + 5] = acc.z;
  }
}

/** RK4 单步（就地推进；k 缓冲复用避免每步分配） */
function rk4Step(
  sim: SimState,
  dt: number,
  k1: Float64Array,
  k2: Float64Array,
  k3: Float64Array,
  k4: Float64Array,
  tmp: Float64Array,
): void {
  const { y, n } = sim;
  const len = y.length;
  derivative(y, n, k1);
  for (let i = 0; i < len; i += 1) tmp[i] = y[i] + k1[i] * (dt / 2);
  derivative(tmp, n, k2);
  for (let i = 0; i < len; i += 1) tmp[i] = y[i] + k2[i] * (dt / 2);
  derivative(tmp, n, k3);
  for (let i = 0; i < len; i += 1) tmp[i] = y[i] + k3[i] * dt;
  derivative(tmp, n, k4);
  for (let i = 0; i < len; i += 1) {
    y[i] += ((k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * dt) / 6;
  }
}

/** 两核两体比能量（软化势；宽松守恒断言用） */
function coreOrbitalEnergy(y: Float64Array): number {
  const dx = y[0] - y[6];
  const dy = y[1] - y[7];
  const dz = y[2] - y[8];
  const rvx = y[3] - y[9];
  const rvy = y[4] - y[10];
  const rvz = y[5] - y[11];
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz + SOFTENING * SOFTENING);
  // 约化质量 m₁m₂/(m₁+m₂)=0.5；E = ½·μᵣ·v² − G m₁m₂/r_soft
  return 0.25 * (rvx * rvx + rvy * rvy + rvz * rvz) - 1 / r;
}

/**
 * 抛物线相对轨道初值（近心点沿 +x，轨道面 = xy 平面）：
 * r = r_p(1+ξ²)，x = r_p(1−ξ²)，y = 2 r_p ξ，t = ξ + ξ³/3（Barker，
 * 时间单位 √(2r_p³/μ)，取 r_p=1、μ=2 → 系数 1）。入轨取 ξ<0（近心点前）。
 */
function parabolicInit(): {
  rel: { x: number; y: number; vx: number; vy: number };
  tStart: number;
} {
  const xi = -Math.sqrt(START_RADIUS - 1);
  const x = 1 - xi * xi;
  const y = 2 * xi;
  const r = 1 + xi * xi;
  const v = Math.sqrt((2 * MU) / r);
  // 切向单位矢量（ξ 增大方向 = 朝近心点运动）：(−ξ, 1)/√(1+ξ²)
  const norm = Math.sqrt(1 + xi * xi);
  return {
    rel: { x, y, vx: (v * -xi) / norm, vy: v / norm },
    tStart: xi + (xi * xi * xi) / 3,
  };
}

interface DiskSpec {
  /** 盘法向节点角（绕 z 轴；两盘相差 π） */
  node: number;
  /** 自旋方向：+1 顺行（相对轨道角动量 +z） */
  spin: number;
}

/**
 * 生成单盘测试粒子（宿主静止系；随后叠加宿主位置/速度）。
 * 环内均匀方位角 + 确定性抖动（径向 ±0.01、竖向 ±0.02、方位微扰）。
 */
function buildDisk(
  spec: DiskSpec,
  rand: () => number,
): Array<{ x: number; y: number; z: number; vx: number; vy: number; vz: number }> {
  const out: Array<{ x: number; y: number; z: number; vx: number; vy: number; vz: number }> = [];
  const ci = Math.cos(DISK_INCLINATION);
  const si = Math.sin(DISK_INCLINATION);
  const cn = Math.cos(spec.node);
  const sn = Math.sin(spec.node);
  for (let k = 0; k < RING_COUNT; k += 1) {
    const rk = RING_R_MIN + ((RING_R_MAX - RING_R_MIN) * k) / (RING_COUNT - 1);
    const count = Math.round(RING_DENSITY * rk);
    for (let j = 0; j < count; j += 1) {
      const phi = (Math.PI * 2 * j) / count + rand() * 0.05;
      const r = rk + (rand() - 0.5) * 0.02;
      const zJit = (rand() - 0.5) * 0.04;
      // 盘面内位置/圆速度（Plummer 软化圆速度）
      const vc = Math.sqrt((r * r) / Math.pow(r * r + SOFTENING * SOFTENING, 1.5));
      const px = Math.cos(phi) * r;
      const py = Math.sin(phi) * r;
      const vx = -Math.sin(phi) * vc * spec.spin;
      const vy = Math.cos(phi) * vc * spec.spin;
      // 姿态旋转：先绕 x 轴倾角 i，再绕 z 轴节点角 Ω
      const y1 = py * ci - zJit * si;
      const z1 = py * si + zJit * ci;
      const vy1 = vy * ci;
      const vz1 = vy * si;
      out.push({
        x: px * cn - y1 * sn,
        y: px * sn + y1 * cn,
        z: z1,
        vx: vx * cn - vy1 * sn,
        vy: vx * sn + vy1 * cn,
        vz: vz1,
      });
    }
  }
  return out;
}

export interface AntennaeBakeResult {
  buffer: Buffer;
  snapshotCount: number;
  particleCount: number;
  diskACount: number;
}

/** 运行模拟并编码产物（确定性纯计算；两次调用逐字节一致） */
export function bakeAntennae(): AntennaeBakeResult {
  const rand = createSeededRandom(SEED);
  const { rel, tStart } = parabolicInit();

  // 两核对称放置（质心系；等质量 → 各取 ±rel/2）
  const coreA = { x: -rel.x / 2, y: -rel.y / 2, z: 0, vx: -rel.vx / 2, vy: -rel.vy / 2, vz: 0 };
  const coreB = { x: rel.x / 2, y: rel.y / 2, z: 0, vx: rel.vx / 2, vy: rel.vy / 2, vz: 0 };

  // 双盘（顺行；节点角相差 π → 两条尾反对称展开）
  const diskA = buildDisk({ node: 0.35, spin: 1 }, rand);
  const diskB = buildDisk({ node: 0.35 + Math.PI, spin: 1 }, rand);
  const nA = diskA.length;
  const n = nA + diskB.length;
  assertBake(nA <= 3000 && diskB.length <= 3000, `单盘粒子数超限（${nA}/${diskB.length} > 3000）`);

  const y = new Float64Array(12 + n * 6);
  const writeBody = (
    o: number,
    b: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  ): void => {
    y[o] = b.x;
    y[o + 1] = b.y;
    y[o + 2] = b.z;
    y[o + 3] = b.vx;
    y[o + 4] = b.vy;
    y[o + 5] = b.vz;
  };
  writeBody(0, coreA);
  writeBody(6, coreB);
  diskA.forEach((p, i) =>
    writeBody(12 + i * 6, {
      x: p.x + coreA.x,
      y: p.y + coreA.y,
      z: p.z + coreA.z,
      vx: p.vx + coreA.vx,
      vy: p.vy + coreA.vy,
      vz: p.vz + coreA.vz,
    }),
  );
  diskB.forEach((p, i) =>
    writeBody(12 + (nA + i) * 6, {
      x: p.x + coreB.x,
      y: p.y + coreB.y,
      z: p.z + coreB.z,
      vx: p.vx + coreB.vx,
      vy: p.vy + coreB.vy,
      vz: p.vz + coreB.vz,
    }),
  );

  const sim: SimState = { y, n };
  const len = y.length;
  const k1 = new Float64Array(len);
  const k2 = new Float64Array(len);
  const k3 = new Float64Array(len);
  const k4 = new Float64Array(len);
  const tmp = new Float64Array(len);

  const e0 = coreOrbitalEnergy(y);
  const snapTimes = Array.from(
    { length: SNAPSHOT_COUNT },
    (_, s) => SNAP_T_START + ((SNAP_T_END - SNAP_T_START) * s) / (SNAPSHOT_COUNT - 1),
  );

  const floatsPerSnap = 6 + n * 3;
  const data = new Float32Array(5 + SNAPSHOT_COUNT * floatsPerSnap);
  data[0] = Math.fround(ANTENNAE_MAGIC);
  data[1] = ANTENNAE_VERSION;
  data[2] = SNAPSHOT_COUNT;
  data[3] = n;
  data[4] = nA;

  let t = tStart;
  let snapIndex = 0;
  let prevSep = Number.POSITIVE_INFINITY;
  let minSep = Number.POSITIVE_INFINITY;
  let sepDecreasing = true;
  const steps = Math.ceil((SNAP_T_END - tStart) / DT);
  for (let step = 0; step <= steps && snapIndex < SNAPSHOT_COUNT; step += 1) {
    // 快照采样（步进对齐：|t − t_snap| < DT/2）
    if (snapIndex < SNAPSHOT_COUNT && t >= snapTimes[snapIndex] - DT / 2) {
      const base = 5 + snapIndex * floatsPerSnap;
      for (let i = 0; i < 6; i += 1) data[base + i] = y[i < 3 ? i : 3 + i]; // 核 A xyz + 核 B xyz
      for (let i = 0; i < n; i += 1) {
        const o = 12 + i * 6;
        data[base + 6 + i * 3] = y[o];
        data[base + 6 + i * 3 + 1] = y[o + 1];
        data[base + 6 + i * 3 + 2] = y[o + 2];
      }
      snapIndex += 1;
    }
    // 两核间距单调性跟踪（近心点前减、后增；数值近心点 ≈ t=0）
    const dx = y[0] - y[6];
    const dy = y[1] - y[7];
    const dz = y[2] - y[8];
    const sep = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (sepDecreasing && sep > prevSep + 1e-9) sepDecreasing = false;
    else if (!sepDecreasing) {
      assertBake(sep >= prevSep - 1e-6, `两核间距在近心点后回落（t=${t.toFixed(2)}）`);
    }
    minSep = Math.min(minSep, sep);
    prevSep = sep;
    rk4Step(sim, DT, k1, k2, k3, k4, tmp);
    t += DT;
  }
  assertBake(snapIndex === SNAPSHOT_COUNT, `快照仅采得 ${snapIndex}/${SNAPSHOT_COUNT} 帧`);
  assertBake(Math.abs(minSep - 1) < 0.1, `数值近心距 ${minSep.toFixed(3)} 偏离 r_p=1 超 10%`);

  // 能量宽松守恒（§R4-22"能量单调性宽松断言"：两核两体能量 RK4 漂移 <2%·μ/r_p）
  const e1 = coreOrbitalEnergy(y);
  assertBake(Math.abs(e1 - e0) < 0.02 * MU, `两核轨道能量漂移 ${Math.abs(e1 - e0).toFixed(4)} 超限`);

  // 产物数值域自校验
  let maxAbs = 0;
  for (let i = 5; i < data.length; i += 1) {
    assertBake(Number.isFinite(data[i]), `产物含 NaN/Inf（索引 ${i}）`);
    maxAbs = Math.max(maxAbs, Math.abs(data[i]));
  }
  assertBake(maxAbs < 48, `粒子坐标 |r|=${maxAbs.toFixed(1)} 超出 48 r_p 界`);

  return {
    buffer: Buffer.from(data.buffer),
    snapshotCount: SNAPSHOT_COUNT,
    particleCount: n,
    diskACount: nA,
  };
}
