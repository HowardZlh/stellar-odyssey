/**
 * 银心参考系观察模式位姿计算单元测试（P6 §3.1.1 / §6 测试验收）
 */

import {
  GALACTIC_FRAME_TRANSITION_SECONDS,
  advanceFrameTransition,
  computeGalacticFramePose,
  frameModeTargetWeight,
  galacticFrameHudLabel,
  sunWorldScenePos,
  tiltAroundX,
} from '@/utils/galacticFrame';
import { galacticPointToSceneUnits } from '@/utils/cameraFocus';
import { sunGalacticPositionLy, DAYS_PER_MYR } from '@/utils/galaxy';
import { SCENE_UNITS_PER_LY } from '@/utils/scale';

const myrToDays = (myr: number): number => myr * DAYS_PER_MYR;

describe('tiltAroundX（与 cameraFocus 组变换一致）', () => {
  it('x 分量不变，y/z 绕 X 轴旋转', () => {
    const p = tiltAroundX({ x: 5, y: 10, z: 0 });
    expect(p.x).toBe(5);
    // 60.2° 倾斜后 y、z 均改变
    expect(p.y).not.toBeCloseTo(10, 3);
    expect(p.z).not.toBeCloseTo(0, 3);
    // 模长守恒（纯旋转）
    expect(Math.hypot(p.y, p.z)).toBeCloseTo(10, 6);
  });
});

describe('sunWorldScenePos', () => {
  it('等于 galacticPointToSceneUnits(sun, simDays) 之负？——不，等于组内太阳倾斜位置', () => {
    // sunWorldScenePos = tilt(sunLy·units)；
    // galacticPointToSceneUnits(sunLy) = tilt((sunLy−sunLy)·units) = 0
    const days = myrToDays(37);
    const sun = sunGalacticPositionLy(days);
    const w = sunWorldScenePos(days);
    const expected = tiltAroundX({
      x: sun.x * SCENE_UNITS_PER_LY,
      y: sun.y * SCENE_UNITS_PER_LY,
      z: sun.z * SCENE_UNITS_PER_LY,
    });
    expect(w.x).toBeCloseTo(expected.x, 6);
    expect(w.y).toBeCloseTo(expected.y, 6);
    expect(w.z).toBeCloseTo(expected.z, 6);
    // 校验：太阳自身经 galacticPointToSceneUnits 落在原点（跟随模式基准）
    const atOrigin = galacticPointToSceneUnits(sun, days);
    expect(Math.hypot(atOrigin.x, atOrigin.y, atOrigin.z)).toBeCloseTo(0, 6);
  });

  it('t=0 时太阳在 (R,0,0)·units，倾斜后 x 不变、y/z 为 0', () => {
    const w = sunWorldScenePos(0);
    expect(w.y).toBeCloseTo(0, 6);
    expect(w.z).toBeCloseTo(0, 6);
    expect(w.x).toBeGreaterThan(0);
  });

  it('注入 unitsPerLy 线性缩放', () => {
    const a = sunWorldScenePos(myrToDays(20), 1);
    const b = sunWorldScenePos(myrToDays(20), 2);
    expect(b.x).toBeCloseTo(a.x * 2, 6);
    expect(b.y).toBeCloseTo(a.y * 2, 6);
    expect(b.z).toBeCloseTo(a.z * 2, 6);
  });
});

describe('computeGalacticFramePose', () => {
  const days = myrToDays(50);

  it('跟随模式（w=0）：groupOffset=−sunWorld，标记落在场景原点', () => {
    const pose = computeGalacticFramePose({ simDays: days, galacticCenterWeight: 0 });
    expect(pose.groupOffset.x).toBeCloseTo(-pose.sunWorld.x, 9);
    expect(pose.groupOffset.y).toBeCloseTo(-pose.sunWorld.y, 9);
    expect(pose.groupOffset.z).toBeCloseTo(-pose.sunWorld.z, 9);
    // markerScenePos = groupOffset + sunWorld = 0（太阳系居原点）
    expect(pose.markerScenePos.x).toBeCloseTo(0, 9);
    expect(pose.markerScenePos.y).toBeCloseTo(0, 9);
    expect(pose.markerScenePos.z).toBeCloseTo(0, 9);
  });

  it('银心模式（w=1）：groupOffset=0，标记落在轨道实际位置 sunWorld', () => {
    const pose = computeGalacticFramePose({ simDays: days, galacticCenterWeight: 1 });
    expect(pose.groupOffset.x).toBeCloseTo(0, 9);
    expect(pose.groupOffset.y).toBeCloseTo(0, 9);
    expect(pose.groupOffset.z).toBeCloseTo(0, 9);
    expect(pose.markerScenePos.x).toBeCloseTo(pose.sunWorld.x, 9);
    expect(pose.markerScenePos.y).toBeCloseTo(pose.sunWorld.y, 9);
    expect(pose.markerScenePos.z).toBeCloseTo(pose.sunWorld.z, 9);
  });

  it('过渡中（w=0.5）：标记 = 0.5·sunWorld，组内标记场景位 = groupOffset+sunWorld 连续', () => {
    const pose = computeGalacticFramePose({ simDays: days, galacticCenterWeight: 0.5 });
    expect(pose.markerScenePos.x).toBeCloseTo(0.5 * pose.sunWorld.x, 9);
    // 一致性：markerScenePos 恒等于 groupOffset + sunWorld（无跳变）
    expect(pose.markerScenePos.x).toBeCloseTo(pose.groupOffset.x + pose.sunWorld.x, 9);
    expect(pose.markerScenePos.y).toBeCloseTo(pose.groupOffset.y + pose.sunWorld.y, 9);
    expect(pose.markerScenePos.z).toBeCloseTo(pose.groupOffset.z + pose.sunWorld.z, 9);
  });

  it('银心模式下标记随时间实际移动（轨道内可见运动，非静止）', () => {
    const p0 = computeGalacticFramePose({ simDays: 0, galacticCenterWeight: 1 }).markerScenePos;
    const p1 = computeGalacticFramePose({
      simDays: myrToDays(30),
      galacticCenterWeight: 1,
    }).markerScenePos;
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    expect(moved).toBeGreaterThan(0);
  });

  it('跟随模式下标记恒在原点（时间推进不移动，现状行为保持）', () => {
    const p0 = computeGalacticFramePose({ simDays: 0, galacticCenterWeight: 0 }).markerScenePos;
    const p1 = computeGalacticFramePose({
      simDays: myrToDays(30),
      galacticCenterWeight: 0,
    }).markerScenePos;
    expect(Math.hypot(p0.x, p0.y, p0.z)).toBeCloseTo(0, 9);
    expect(Math.hypot(p1.x, p1.y, p1.z)).toBeCloseTo(0, 9);
  });

  it('权重越界 / 非有限 / unitsPerLy≤0 抛 RangeError', () => {
    expect(() => computeGalacticFramePose({ simDays: 0, galacticCenterWeight: -0.1 })).toThrow(
      RangeError,
    );
    expect(() => computeGalacticFramePose({ simDays: 0, galacticCenterWeight: 1.1 })).toThrow(
      RangeError,
    );
    expect(() =>
      computeGalacticFramePose({ simDays: 0, galacticCenterWeight: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      computeGalacticFramePose({ simDays: 0, galacticCenterWeight: 0.5, unitsPerLy: 0 }),
    ).toThrow(RangeError);
  });
});

describe('frameModeTargetWeight / galacticFrameHudLabel', () => {
  it('follow→0，galactic-center→1', () => {
    expect(frameModeTargetWeight('follow')).toBe(0);
    expect(frameModeTargetWeight('galactic-center')).toBe(1);
  });

  it('HUD 文案随模式区分', () => {
    expect(galacticFrameHudLabel('follow')).toContain('跟随太阳系');
    expect(galacticFrameHudLabel('galactic-center')).toContain('银心固定');
    expect(galacticFrameHudLabel('follow')).not.toBe(galacticFrameHudLabel('galactic-center'));
  });
});

describe('advanceFrameTransition（2 秒平滑过渡）', () => {
  it('向目标 1 推进：约 2 秒线性走完', () => {
    let p = 0;
    // 60 FPS，2 秒 = 120 帧
    for (let i = 0; i < 120; i += 1) {
      p = advanceFrameTransition(p, 1, 1 / 60);
    }
    expect(p).toBeCloseTo(1, 5);
  });

  it('向目标 0 回退：从 1 约 2 秒走回 0', () => {
    let p = 1;
    for (let i = 0; i < 120; i += 1) {
      p = advanceFrameTransition(p, 0, 1 / 60);
    }
    expect(p).toBeCloseTo(0, 5);
  });

  it('钳制在 [0,1]，超步长不越界', () => {
    expect(advanceFrameTransition(0.9, 1, 10)).toBe(1);
    expect(advanceFrameTransition(0.1, 0, 10)).toBe(0);
  });

  it('默认过渡时长为 2 秒', () => {
    expect(GALACTIC_FRAME_TRANSITION_SECONDS).toBe(2);
    // 单帧（1/60s）推进量 = delta/seconds
    expect(advanceFrameTransition(0, 1, 1 / 60)).toBeCloseTo(1 / 60 / 2, 9);
  });

  it('seconds≤0 抛 RangeError', () => {
    expect(() => advanceFrameTransition(0, 1, 0.016, 0)).toThrow(RangeError);
    expect(() => advanceFrameTransition(0, 1, 0.016, -1)).toThrow(RangeError);
  });
});
