/**
 * 动画工具单元测试（需求 3.2.1 平滑过渡）
 */

import {
  advanceTransitionProgress,
  easeInOutCubic,
  interpolateCameraState,
  lerp,
  lerpVec3,
} from '@/utils/animation';
import type { CameraState } from '@/types';

describe('lerp / lerpVec3', () => {
  it('线性插值端点与中点', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('向量插值逐分量进行', () => {
    const v = lerpVec3({ x: 0, y: 2, z: -4 }, { x: 10, y: 4, z: 4 }, 0.5);
    expect(v).toEqual({ x: 5, y: 3, z: 0 });
  });
});

describe('easeInOutCubic', () => {
  it('端点固定：f(0)=0, f(1)=1, f(0.5)=0.5', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
  });

  it('缓入缓出：前段慢于线性、后段快于线性', () => {
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
  });

  it('越界输入被钳制', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it('关于中心对称：f(t) + f(1−t) = 1', () => {
    for (const t of [0.1, 0.3, 0.42]) {
      expect(easeInOutCubic(t) + easeInOutCubic(1 - t)).toBeCloseTo(1, 10);
    }
  });
});

describe('interpolateCameraState', () => {
  const from: CameraState = {
    position: { x: 0, y: 0, z: 100 },
    target: { x: 0, y: 0, z: 0 },
    fov: 50,
  };
  const to: CameraState = {
    position: { x: 0, y: 60, z: 80 },
    target: { x: 10, y: 0, z: 0 },
    fov: 45,
  };

  it('t=0 返回起点，t=1 返回终点', () => {
    expect(interpolateCameraState(from, to, 0)).toEqual(from);
    expect(interpolateCameraState(from, to, 1)).toEqual(to);
  });

  it('中间态位置、目标、FOV 同步插值', () => {
    const mid = interpolateCameraState(from, to, 0.5);
    expect(mid.position.y).toBeCloseTo(30, 10);
    expect(mid.target.x).toBeCloseTo(5, 10);
    expect(mid.fov).toBeCloseTo(47.5, 10);
  });
});

describe('advanceTransitionProgress', () => {
  it('按帧间隔推进', () => {
    expect(advanceTransitionProgress(0, 0.5, 2)).toBeCloseTo(0.25, 10);
  });

  it('钳制到 1', () => {
    expect(advanceTransitionProgress(0.9, 1, 2)).toBe(1);
  });

  it('时长非正时直接完成', () => {
    expect(advanceTransitionProgress(0, 0.1, 0)).toBe(1);
    expect(advanceTransitionProgress(0, 0.1, -5)).toBe(1);
  });
});
