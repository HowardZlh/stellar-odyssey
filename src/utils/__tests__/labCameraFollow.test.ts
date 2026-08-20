/**
 * 地面视角天体跟随纯函数单测（LE-M6 补丁 P5）
 *
 * 两层断言：
 * 1. 数学层：Rodrigues 最小旋转的恒等/90°/模长守恒/退化守卫、方向插值、
 *    复位收敛比例的帧率无关性；
 * 2. **真实星历性质层**（本补丁的价值证明）：用 l2029 烘焙星历全窗 60s
 *    采样跑一遍跟随仿真——
 *    - 关跟随（对照）：相机视线与月亮的夹角漂移 **> 40°**（证明补丁必要，
 *      也防未来有人把默认值改回不跟随）；
 *    - 开跟随 + 零初始偏移：全程夹角 **< 0.1°**（望远档 3° FOV 可用性的
 *      机器保证）；
 *    - 开跟随 + 5° 初始偏移：全程夹角**守恒**在 5°（差量语义 ≠ 硬居中）。
 */

import { readFileSync } from "fs";
import { join } from "path";
import { validateLunarEclipses } from "../bakedData";
import {
  LAB_FOLLOW_MAX_ROLL_RATE_RAD_PER_SEC,
  LAB_FOLLOW_RECENTER_TAU_SEC,
  angleBetweenDirs,
  cameraBasisFromView,
  followRecenterFraction,
  rollFromCameraBasis,
  rollTowardTarget,
  rotateVectorBetweenDirs,
  slerpDirections,
  wrapAngleRad,
} from "../labCameraFollow";
import {
  LAB_POLAR_MAX_TELESCOPIC_RAD,
  clampLabPolar,
} from "../labGestures";
import { sceneDirFromAltAz } from "../meteorShower";
import type { MutableVec3 } from "../solarEclipseSpace";
import { emptyLunarFrameState, lunarFrameState } from "../lunarEclipseLab";

const DEG = Math.PI / 180;

function out3(): MutableVec3 {
  return [0, 0, 0];
}

describe("rotateVectorBetweenDirs（最小旋转 Rodrigues）", () => {
  it("同向 → 恒等（逐帧常态快路）", () => {
    const v: MutableVec3 = [1, 2, 3];
    const r = rotateVectorBetweenDirs([0, 1, 0], [0, 1, 0], v, out3());
    expect(r[0]).toBeCloseTo(1, 12);
    expect(r[1]).toBeCloseTo(2, 12);
    expect(r[2]).toBeCloseTo(3, 12);
  });

  it("+X → +Y 的最小旋转（绕 +Z 转 90°）作用于任意向量", () => {
    const r = rotateVectorBetweenDirs([1, 0, 0], [0, 1, 0], [1, 0, 0], out3());
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(1, 12);
    expect(r[2]).toBeCloseTo(0, 12);
    const r2 = rotateVectorBetweenDirs([1, 0, 0], [0, 1, 0], [0, 0, 1], out3());
    // 转轴 +Z 上的分量不动
    expect(r2[0]).toBeCloseTo(0, 12);
    expect(r2[1]).toBeCloseTo(0, 12);
    expect(r2[2]).toBeCloseTo(1, 12);
  });

  it("刚体性：模长守恒 + 与旋转前后天体方向的夹角守恒（跟随语义的核心）", () => {
    const from: MutableVec3 = [0.3, 0.9, -0.31];
    const to: MutableVec3 = [0.35, 0.88, -0.32];
    const cam: MutableVec3 = [-0.4, -1.05, 0.5];
    const before = angleBetweenDirs(from, [-cam[0], -cam[1], -cam[2]]);
    const r = rotateVectorBetweenDirs(from, to, cam, out3());
    expect(Math.hypot(r[0], r[1], r[2])).toBeCloseTo(
      Math.hypot(cam[0], cam[1], cam[2]),
      12,
    );
    const after = angleBetweenDirs(to, [-r[0], -r[1], -r[2]]);
    expect(after).toBeCloseTo(before, 12);
  });

  it("入参无需预先归一（内部归一）", () => {
    const a = rotateVectorBetweenDirs([5, 0, 0], [0, 7, 0], [1, 0, 0], out3());
    const b = rotateVectorBetweenDirs([1, 0, 0], [0, 1, 0], [1, 0, 0], out3());
    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
    expect(a[2]).toBeCloseTo(b[2], 12);
  });

  it("退化守卫：近反向（旋转不唯一）/零向量/非有限 → 保持恒等，不写坏相机", () => {
    const v: MutableVec3 = [1, 2, 3];
    for (const [from, to] of [
      [[0, 1, 0], [0, -1, 0]],
      [[0, 0, 0], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 0]],
      [[Number.NaN, 1, 0], [0, 1, 0]],
      [[0, 1, 0], [0, Number.POSITIVE_INFINITY, 0]],
    ] as Array<[number[], number[]]>) {
      const r = rotateVectorBetweenDirs(from, to, v, out3());
      expect([r[0], r[1], r[2]]).toEqual([1, 2, 3]);
    }
    expect(
      rotateVectorBetweenDirs([0, 1, 0], [0, 1, 0], [Number.NaN, 0, 0], out3())[0],
    ).toBeNaN();
  });

  it("out 复用（零 GC）：返回同一引用，且可原地自更新（v === out）", () => {
    const o = out3();
    expect(rotateVectorBetweenDirs([1, 0, 0], [0, 1, 0], [1, 0, 0], o)).toBe(o);
    const inPlace: MutableVec3 = [1, 0, 0];
    rotateVectorBetweenDirs([1, 0, 0], [0, 1, 0], inPlace, inPlace);
    expect(inPlace[1]).toBeCloseTo(1, 12);
  });
});

describe("slerpDirections（复位收敛用方向插值）", () => {
  it("t=0 取 a、t=1 取 b、中点为单位向量且夹角减半量级", () => {
    const a: MutableVec3 = [1, 0, 0];
    const b: MutableVec3 = [0, 1, 0];
    expect(slerpDirections(a, b, 0, out3())[0]).toBeCloseTo(1, 12);
    expect(slerpDirections(a, b, 1, out3())[1]).toBeCloseTo(1, 12);
    const mid = slerpDirections(a, b, 0.5, out3());
    expect(Math.hypot(mid[0], mid[1], mid[2])).toBeCloseTo(1, 12);
    expect(angleBetweenDirs(a, mid)).toBeCloseTo(45 * DEG, 10);
  });

  it("t 钳制 [0,1]，非有限 t 保持 a", () => {
    const a: MutableVec3 = [1, 0, 0];
    const b: MutableVec3 = [0, 1, 0];
    expect(slerpDirections(a, b, -5, out3())[0]).toBeCloseTo(1, 12);
    expect(slerpDirections(a, b, 5, out3())[1]).toBeCloseTo(1, 12);
    expect(slerpDirections(a, b, Number.NaN, out3())[0]).toBeCloseTo(1, 12);
  });

  it("退化守卫：零/非有限入参与近反向中点均安全降级为单位向量", () => {
    expect(slerpDirections([0, 0, 0], [0, 0, 1], 0.5, out3())[2]).toBe(1);
    expect(slerpDirections([0, 0, 1], [0, 0, 0], 0.5, out3())[2]).toBe(1);
    const zero = slerpDirections([0, 0, 0], [0, 0, 0], 0.5, out3());
    expect(Math.hypot(zero[0], zero[1], zero[2])).toBeCloseTo(1, 12);
    const anti = slerpDirections([1, 0, 0], [-1, 0, 0], 0.5, out3());
    expect(Math.hypot(anti[0], anti[1], anti[2])).toBeCloseTo(1, 12);
    expect(slerpDirections([Number.NaN, 0, 0], [0, 0, 1], 0.5, out3())[2]).toBe(1);
  });
});

describe("followRecenterFraction（复位收敛比例）", () => {
  it("τ 语义：0.5s 后残余 <5%（观感上的「0.5 秒平滑归中」）", () => {
    // 60 FPS 连乘 0.5s
    let residual = 1;
    for (let i = 0; i < 30; i += 1) {
      residual *= 1 - followRecenterFraction(1 / 60);
    }
    expect(residual).toBeLessThan(0.05);
    expect(LAB_FOLLOW_RECENTER_TAU_SEC).toBeGreaterThan(0);
  });

  it("帧率无关：30 FPS 与 120 FPS 在同一时长后残余一致", () => {
    const residualAt = (fps: number): number => {
      let r = 1;
      for (let i = 0; i < fps * 0.5; i += 1) r *= 1 - followRecenterFraction(1 / fps);
      return r;
    };
    expect(residualAt(30)).toBeCloseTo(residualAt(120), 3);
  });

  it("域与守卫：[0,1]、dt≤0/非有限 → 0、τ 非法回退默认", () => {
    expect(followRecenterFraction(0)).toBe(0);
    expect(followRecenterFraction(-1)).toBe(0);
    expect(followRecenterFraction(Number.NaN)).toBe(0);
    expect(followRecenterFraction(1000)).toBe(1);
    expect(followRecenterFraction(0.016, 0)).toBeCloseTo(
      followRecenterFraction(0.016),
      12,
    );
    expect(followRecenterFraction(0.016, Number.NaN)).toBeCloseTo(
      followRecenterFraction(0.016),
      12,
    );
  });
});

describe("angleBetweenDirs", () => {
  it("正交 90°、同向 0°、反向 180°；非法入参 0", () => {
    expect(angleBetweenDirs([1, 0, 0], [0, 1, 0])).toBeCloseTo(90 * DEG, 12);
    expect(angleBetweenDirs([1, 0, 0], [2, 0, 0])).toBeCloseTo(0, 12);
    expect(angleBetweenDirs([1, 0, 0], [-1, 0, 0])).toBeCloseTo(180 * DEG, 12);
    expect(angleBetweenDirs([0, 0, 0], [1, 0, 0])).toBe(0);
    expect(angleBetweenDirs([Number.NaN, 0, 0], [1, 0, 0])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 真实星历性质测试：l2029 全窗跟随仿真（本补丁的价值证明）
// ---------------------------------------------------------------------------

/** 相机初始半径（组件侧 INITIAL_CAMERA_RADIUS 同值口径） */
const CAM_RADIUS = 1.2;

/** 用烘焙星历跑跟随仿真，返回全程「视线 ↔ 月亮」夹角序列（度） */
function simulateFollow(options: {
  enabled: boolean;
  initialOffsetDeg: number;
}): number[] {
  const raw: unknown = JSON.parse(
    readFileSync(
      join(process.cwd(), "public/data/lunar_eclipses.json"),
      "utf8",
    ),
  );
  const data = validateLunarEclipses(raw);
  if (!data) throw new Error("lunar_eclipses.json 校验失败");
  const event = data.events.find((e) => e.id === "l2029");
  if (!event) throw new Error("l2029 事件缺失");
  const group = { topo: event.topo, geo: event.geo };
  const frame = emptyLunarFrameState();

  const dirAt = (tSec: number): MutableVec3 => {
    lunarFrameState(group, event.observer, tSec, frame);
    const d = sceneDirFromAltAz({
      altRad: frame.moonAltDeg * DEG,
      azRad: frame.moonAzDeg * DEG,
    });
    return [d[0], d[1], d[2]];
  };

  const start = event.contacts.p1;
  const end = event.contacts.p4;
  let dir = dirAt(start);
  // 初始相机：对准月亮后按初始偏移**向地平方向**压低（绕水平轴旋转——
  // 真正的角距偏移；绕天顶轴的方位偏移在高仰角处角距 = off×cos(alt)，
  // 近天顶时几乎为 0，不能用来验证偏移守恒）
  const off = options.initialOffsetDeg * DEG;
  const axis: MutableVec3 = [dir[2], 0, -dir[0]]; // dir × ŷ 方向的水平轴
  const al = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  axis[0] /= al;
  axis[2] /= al;
  const c = Math.cos(-off);
  const sn = Math.sin(-off);
  const kdv = axis[0] * dir[0] + axis[1] * dir[1] + axis[2] * dir[2];
  const view: MutableVec3 = [
    dir[0] * c + (axis[1] * dir[2] - axis[2] * dir[1]) * sn + axis[0] * kdv * (1 - c),
    dir[1] * c + (axis[2] * dir[0] - axis[0] * dir[2]) * sn + axis[1] * kdv * (1 - c),
    dir[2] * c + (axis[0] * dir[1] - axis[1] * dir[0]) * sn + axis[2] * kdv * (1 - c),
  ];
  const vl = Math.hypot(view[0], view[1], view[2]);
  const cam: MutableVec3 = [
    (-view[0] / vl) * CAM_RADIUS,
    (-view[1] / vl) * CAM_RADIUS,
    (-view[2] / vl) * CAM_RADIUS,
  ];

  const angles: number[] = [];
  for (let t = start; t <= end; t += 60) {
    const next = dirAt(t);
    if (options.enabled) {
      rotateVectorBetweenDirs(dir, next, cam, cam);
      // 组件侧的仰角钳制同步纳入仿真（边界行为如实体现）
      const r = Math.hypot(cam[0], cam[1], cam[2]);
      const phi = Math.acos(Math.min(1, Math.max(-1, cam[1] / r)));
      const clamped = clampLabPolar(phi, LAB_POLAR_MAX_TELESCOPIC_RAD);
      if (clamped !== phi) {
        const theta = Math.atan2(cam[0], cam[2]);
        const sp = Math.sin(clamped);
        cam[0] = r * sp * Math.sin(theta);
        cam[1] = r * Math.cos(clamped);
        cam[2] = r * sp * Math.cos(theta);
      }
    }
    dir = next;
    angles.push(
      angleBetweenDirs([-cam[0], -cam[1], -cam[2]], dir) / DEG,
    );
  }
  return angles;
}

describe("l2029 全窗跟随仿真（真实星历性质测试）", () => {
  it("关跟随（对照）：月亮漂出画面 —— 全程最大偏离 > 40°（补丁必要性的机器证据）", () => {
    const angles = simulateFollow({ enabled: false, initialOffsetDeg: 0 });
    expect(Math.max(...angles)).toBeGreaterThan(40);
  });

  it("开跟随 + 零初始偏移：全程偏离 < 0.15°（望远档 3° FOV 的可用性保证）", () => {
    const angles = simulateFollow({ enabled: true, initialOffsetDeg: 0 });
    // 残余仅来自天顶禁区钳制（l2029 圣保罗月亮几乎正穿天顶，望远档上限
    // 0.002 rad = 0.115°）——占 3° 画面高的 3.8%，肉眼在中心区
    expect(Math.max(...angles)).toBeLessThan(0.15);
    // 缺省档天顶余量（0.02 rad = 1.15°）会把月亮推到 3° 画面的边缘——
    // 望远档上限存在的必要性（防未来有人把它调回去）
    expect(Math.max(...angles)).toBeLessThan((0.02 / DEG) * 0.2);
  });

  it("开跟随 + 5° 手动偏移：偏移守恒（差量语义，不是硬居中）", () => {
    const angles = simulateFollow({ enabled: true, initialOffsetDeg: 5 });
    for (const a of angles) {
      expect(a).toBeGreaterThan(4.8);
      expect(a).toBeLessThan(5.2);
    }
  });
});

// ---------------------------------------------------------------------------
// LE-M6 补丁 P6：天顶通过的画面 roll 限幅
// ---------------------------------------------------------------------------

describe("wrapAngleRad / rollTowardTarget（P6 roll 限幅）", () => {
  it("wrapAngleRad 归一到 (−π, π]，非有限返回 0", () => {
    expect(wrapAngleRad(0)).toBe(0);
    expect(wrapAngleRad(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngleRad(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngleRad(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngleRad(-2.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 12);
    expect(wrapAngleRad(Number.NaN)).toBe(0);
  });

  it("限幅生效：单帧步长 ≤ 速率 × dt；差值在步长内直接到达", () => {
    const rate = LAB_FOLLOW_MAX_ROLL_RATE_RAD_PER_SEC;
    const dt = 1 / 60;
    const big = rollTowardTarget(100 * DEG, 0, dt);
    expect(Math.abs(big - 100 * DEG)).toBeCloseTo(rate * dt, 12);
    const small = rollTowardTarget(0.1 * DEG, 0, dt);
    expect(small).toBe(0);
  });

  it("最短路径：359° → 1° 走 2°（跨 ±180° 绕行），不走 358°", () => {
    const next = rollTowardTarget(359 * DEG, 1 * DEG, 10, Math.PI);
    // 差值 +2°（最短），10s × π/s 足够一步到达 → 359°+2° = 361°
    expect(wrapAngleRad(next)).toBeCloseTo(wrapAngleRad(361 * DEG), 10);
  });

  it("帧率无关：同一时长内 30 FPS 与 120 FPS 走过的总角度一致（限幅段）", () => {
    const run = (fps: number): number => {
      let roll = 170 * DEG;
      for (let i = 0; i < fps; i += 1) roll = rollTowardTarget(roll, 0, 1 / fps);
      return roll;
    };
    expect(run(30)).toBeCloseTo(run(120), 10);
  });

  it("守卫：dt≤0/目标非有限不动；当前非有限取目标；速率非法回退默认", () => {
    expect(rollTowardTarget(1, 0, 0)).toBe(1);
    expect(rollTowardTarget(1, Number.NaN, 0.016)).toBe(1);
    expect(rollTowardTarget(Number.NaN, 0.5, 0.016)).toBe(0.5);
    expect(rollTowardTarget(Number.NaN, Number.NaN, 0.016)).toBe(0);
    const d = rollTowardTarget(1, 0, 1 / 60, Number.NaN);
    expect(Math.abs(d - 1)).toBeCloseTo(
      LAB_FOLLOW_MAX_ROLL_RATE_RAD_PER_SEC / 60,
      12,
    );
  });
});

describe("cameraBasisFromView / rollFromCameraBasis（P6 朝向组装）", () => {
  it("roll=0 时与 lookAt(up=+Y) 基一致（水平视线锚点）", () => {
    const b: number[] = new Array(9).fill(0);
    // 视线 −Z（正北）：right=+... view×(0,1,0) = (−fz,0,fx) = (1,0,0)
    expect(cameraBasisFromView([0, 0, -1], 0, b)).toBe(true);
    const expected = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let i = 0; i < 9; i += 1) expect(b[i]).toBeCloseTo(expected[i], 12);
  });

  it("基是右手正交系（任意视线 + 任意 roll）", () => {
    const b: number[] = new Array(9).fill(0);
    expect(cameraBasisFromView([0.3, 0.8, -0.5], 0.7, b)).toBe(true);
    const r = b.slice(0, 3);
    const u = b.slice(3, 6);
    const k = b.slice(6, 9);
    const dot = (a: number[], c: number[]): number =>
      a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    expect(dot(r, u)).toBeCloseTo(0, 12);
    expect(dot(r, k)).toBeCloseTo(0, 12);
    expect(dot(u, k)).toBeCloseTo(0, 12);
    expect(dot(r, r)).toBeCloseTo(1, 12);
    // 右手系：r × u = k
    expect(r[1] * u[2] - r[2] * u[1]).toBeCloseTo(k[0], 12);
  });

  it("组装 ↔ 反解往返自洽（含近天顶视线的 +X 参考轴回退）", () => {
    const b: number[] = new Array(9).fill(0);
    for (const view of [
      [0.2, 0.4, -0.6],
      [0.001, 0.9999995, 0.0002], // 近天顶（up 投影退化 → +X 回退）
      [0, 1, 0], // 正天顶
    ]) {
      for (const roll of [-2.5, -0.4, 0, 0.9, 3]) {
        expect(cameraBasisFromView(view, roll, b)).toBe(true);
        const got = rollFromCameraBasis(view, b.slice(0, 3));
        expect(wrapAngleRad(got - roll)).toBeCloseTo(0, 9);
      }
    }
  });

  it("守卫：零向量/非有限入参返回 false / 0", () => {
    const b: number[] = new Array(9).fill(0);
    expect(cameraBasisFromView([0, 0, 0], 0, b)).toBe(false);
    expect(cameraBasisFromView([1, 0, 0], Number.NaN, b)).toBe(false);
    expect(cameraBasisFromView([Number.NaN, 0, 0], 0, b)).toBe(false);
    expect(rollFromCameraBasis([0, 0, 0], [1, 0, 0])).toBe(0);
    expect(rollFromCameraBasis([0, 0, -1], [Number.NaN, 0, 0])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P6 真实星历性质测试：l2029 天顶通过段的画面旋转限幅
// ---------------------------------------------------------------------------

describe("l2029 天顶通过段 roll 限幅仿真（×243 加速、60 FPS 墙钟）", () => {
  /** topo 星历 → 场景方向（60s 行线性插值足够——测的是旋转率量级） */
  function makeDirAt(): (tSec: number) => MutableVec3 {
    const raw: unknown = JSON.parse(
      readFileSync(
        join(process.cwd(), "public/data/lunar_eclipses.json"),
        "utf8",
      ),
    );
    const data = validateLunarEclipses(raw);
    if (!data) throw new Error("lunar_eclipses.json 校验失败");
    const event = data.events.find((e) => e.id === "l2029");
    if (!event) throw new Error("l2029 事件缺失");
    const group = { topo: event.topo, geo: event.geo };
    const frame = emptyLunarFrameState();
    return (tSec: number): MutableVec3 => {
      lunarFrameState(group, event.observer, tSec, frame);
      const d = sceneDirFromAltAz({
        altRad: frame.moonAltDeg * DEG,
        azRad: frame.moonAzDeg * DEG,
      });
      return [d[0], d[1], d[2]];
    };
  }

  /** 仿真：跟随开启跨天顶（03:00–03:20 UT），返回逐帧画面自旋率（°/s 墙钟） */
  function simulate(pipeline: "lookAt" | "limited"): number[] {
    const dirAt = makeDirAt();
    const RATE = 243; // 加速档倍率（l2029 量级）
    const FPS = 60;
    const t0 = Date.UTC(2029, 5, 26, 3, 0, 0) / 1000;
    const t1 = Date.UTC(2029, 5, 26, 3, 20, 0) / 1000;
    let dir = dirAt(t0);
    // 相机对准月亮；朝向初始为 roll=0 基准
    const basis: number[] = new Array(9).fill(0);
    cameraBasisFromView(dir, 0, basis);
    let right: MutableVec3 = [basis[0], basis[1], basis[2]];
    let view: MutableVec3 = [dir[0], dir[1], dir[2]];
    const rates: number[] = [];
    for (let t = t0; t <= t1; t += (RATE * 1) / FPS) {
      const next = dirAt(t);
      // 跟随：视线 = 月亮方向（零偏移）
      const newView: MutableVec3 = [next[0], next[1], next[2]];
      let newRight: MutableVec3;
      if (pipeline === "lookAt") {
        cameraBasisFromView(newView, 0, basis); // lookAt ≡ roll=0 快照
        newRight = [basis[0], basis[1], basis[2]];
      } else {
        // P6 管线：对齐上帧右轴 → roll 限幅回正 → 组装
        const aligned: MutableVec3 = [0, 0, 0];
        rotateVectorBetweenDirs(view, newView, right, aligned);
        const roll = rollFromCameraBasis(newView, aligned);
        const newRoll = rollTowardTarget(roll, 0, 1 / FPS);
        cameraBasisFromView(newView, newRoll, basis);
        newRight = [basis[0], basis[1], basis[2]];
      }
      // 画面自旋率 = 上帧右轴（对齐视线变化后）与本帧右轴的夹角 / dt
      const alignedPrev: MutableVec3 = [0, 0, 0];
      rotateVectorBetweenDirs(view, newView, right, alignedPrev);
      rates.push((angleBetweenDirs(alignedPrev, newRight) / DEG) * FPS);
      view = newView;
      right = newRight;
      dir = next;
    }
    return rates;
  }

  it("lookAt 基线（病灶）：天顶甩尾段画面自旋率峰值 > 100°/s", () => {
    const rates = simulate("lookAt");
    expect(Math.max(...rates)).toBeGreaterThan(100);
  });

  it("P6 管线：画面自旋率处处 ≤ 25°/s 限幅（+1% 数值容差）", () => {
    const rates = simulate("limited");
    const limit = (LAB_FOLLOW_MAX_ROLL_RATE_RAD_PER_SEC / DEG) * 1.01;
    for (const r of rates) expect(r).toBeLessThanOrEqual(limit);
  });

  it("P6 管线：甩尾产生的 roll 债在段末已还清（回到地平线水平 <2°）", () => {
    const dirAt = makeDirAt();
    const RATE = 243;
    const FPS = 60;
    const t0 = Date.UTC(2029, 5, 26, 3, 0, 0) / 1000;
    // 04:00 止：甩尾段（03:05–03:13 事件时间 ≈2s 墙钟）+ 追平余量
    // （×243 下 60 事件分 = 14.8 墙钟秒 ≫ 167°/25°/s ≈ 6.7s）
    const t1 = Date.UTC(2029, 5, 26, 4, 0, 0) / 1000;
    const basis: number[] = new Array(9).fill(0);
    let view = dirAt(t0);
    cameraBasisFromView(view, 0, basis);
    let right: MutableVec3 = [basis[0], basis[1], basis[2]];
    let maxAbsRoll = 0;
    let lastRoll = 0;
    for (let t = t0; t <= t1; t += (RATE * 1) / FPS) {
      const newView = dirAt(t);
      const aligned: MutableVec3 = [0, 0, 0];
      rotateVectorBetweenDirs(view, newView, right, aligned);
      const roll = rollFromCameraBasis(newView, aligned);
      const newRoll = rollTowardTarget(roll, 0, 1 / FPS);
      cameraBasisFromView(newView, newRoll, basis);
      right = [basis[0], basis[1], basis[2]];
      view = newView;
      maxAbsRoll = Math.max(maxAbsRoll, Math.abs(newRoll));
      lastRoll = newRoll;
    }
    // 甩尾段确实积累了大额 roll 债（>60°，证明不是瞬间快照）……
    expect(maxAbsRoll / DEG).toBeGreaterThan(60);
    // ……且 20 分钟（事件时间 ≈ 4.9 墙钟秒的甩尾 + 其余时间追平）后已还清
    expect(Math.abs(lastRoll) / DEG).toBeLessThan(2);
  });
});
