"use client";

/**
 * 地面视角「天体跟随」相机 rig（LE-M6 补丁 P5；日食/月食/selenelion 共用）
 *
 * 语义与算法见 `utils/labCameraFollow.ts` 文件头（差量刚体旋转 = 等效赤道仪
 * 跟踪，保留用户手动偏移；**非硬锁定居中**）。本组件只做三件事：
 * 1. 逐帧取天体方向（调用方注入 `getBodyDir`，读自各条目的 frameRef）；
 * 2. `recenterToken` 变化 → 进入 0.5s 量级的平滑复位（τ 收敛，帧率无关）；
 * 3. 跟随开启时把 `d(t−1)→d(t)` 的最小旋转施加到相机位置，再过 polar 钳制
 *    （与 OrbitControls props 同一事实源 `clampLabPolar`）后 lookAt 原点。
 *
 * 与 OrbitControls 的协作：three 的 OrbitControls 每次 update 都从
 * `camera.position − target` 重算球坐标，因此外部直接改写 position 是被
 * 支持的（TrackpadLookControls 的滚轮环顾已是同一手法）。drei 的
 * OrbitControls 以 priority −1 更新，本 rig 走缺省 0 → 每帧在其之后生效。
 *
 * 挂载纪律：仅地面档（含 selenelion 场景）挂载；运镜 rig 工作期间与太空/
 * 月球档不挂（相机归运镜/其它控制器所有）。月球视角**无需跟随**——地球在
 * 月面天空因潮汐锁定而固定不动。
 */

import type { JSX } from "react";
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  LAB_POLAR_MAX_TELESCOPIC_RAD,
  clampLabPolar,
} from "@/utils/labGestures";
import {
  LAB_FOLLOW_RECENTER_DONE_RAD,
  angleBetweenDirs,
  followRecenterFraction,
  rotateVectorBetweenDirs,
  slerpDirections,
} from "@/utils/labCameraFollow";
import type { MutableVec3 } from "@/utils/solarEclipseSpace";

export interface BodyFollowRigProps {
  /** 跟随开关（面板控件，默认开；关闭时仍持续记录方向，重开不跳变） */
  enabled: boolean;
  /**
   * 复位令牌：数值变化即触发一次平滑复位（「回到月亮/太阳」按钮点击、
   * 跟随由关转开时递增）。
   */
  recenterToken: number;
  /** 天体方向（场景单位向量，+Y 天顶）；写入 out 并返回，逐帧零 GC */
  getBodyDir: (out: MutableVec3) => MutableVec3;
  /**
   * polar 上限（弧度）：须与同场景 OrbitControls 的 `maxPolarAngle` 同值，
   * 否则控制器会在下一帧把跟随写入的位姿拉回去（互相打架）。
   * 缺省望远档上限——近天顶天体（l2029 圣保罗几乎正穿天顶）跟随可用的前提。
   */
  maxPolarRad?: number;
}

/** 地面视角天体跟随 rig（无渲染输出） */
export function BodyFollowRig({
  enabled,
  recenterToken,
  getBodyDir,
  maxPolarRad = LAB_POLAR_MAX_TELESCOPIC_RAD,
}: BodyFollowRigProps): null {
  const camera = useThree((s) => s.camera);

  const stateRef = useRef<{
    dir: MutableVec3;
    prevDir: MutableVec3;
    hasPrev: boolean;
    rotated: MutableVec3;
    viewDir: MutableVec3;
    nextView: MutableVec3;
    token: number;
    recentering: boolean;
    spherical: THREE.Spherical;
  }>({
    dir: [0, 1, 0],
    prevDir: [0, 1, 0],
    hasPrev: false,
    rotated: [0, 0, 0],
    viewDir: [0, 1, 0],
    nextView: [0, 1, 0],
    token: recenterToken,
    recentering: false,
    spherical: new THREE.Spherical(),
  });

  useFrame((_, delta) => {
    const s = stateRef.current;
    const dir = getBodyDir(s.dir);
    if (
      !Number.isFinite(dir[0]) ||
      !Number.isFinite(dir[1]) ||
      !Number.isFinite(dir[2])
    ) {
      return;
    }

    // 复位令牌变化 → 进入平滑收敛（跟随关时同样允许复位：先看到再决定跟不跟）
    if (s.token !== recenterToken) {
      s.token = recenterToken;
      s.recentering = true;
    }

    const pos = camera.position;
    const radius = pos.length();
    let changed = false;

    if (s.recentering && radius > 0) {
      // 当前视线方向 = −相机位置（反转轨道相机看向原点）
      s.viewDir[0] = -pos.x / radius;
      s.viewDir[1] = -pos.y / radius;
      s.viewDir[2] = -pos.z / radius;
      const residual = angleBetweenDirs(s.viewDir, dir);
      if (residual <= LAB_FOLLOW_RECENTER_DONE_RAD) {
        s.recentering = false;
      } else {
        const f = followRecenterFraction(delta);
        slerpDirections(s.viewDir, dir, f, s.nextView);
        pos.set(
          -s.nextView[0] * radius,
          -s.nextView[1] * radius,
          -s.nextView[2] * radius,
        );
        changed = true;
      }
    } else if (enabled && s.hasPrev) {
      // 差量跟随：把 prevDir→dir 的最小旋转施加到相机位置（刚体，半径不变）
      s.rotated[0] = pos.x;
      s.rotated[1] = pos.y;
      s.rotated[2] = pos.z;
      rotateVectorBetweenDirs(s.prevDir, dir, s.rotated, s.rotated);
      if (
        s.rotated[0] !== pos.x ||
        s.rotated[1] !== pos.y ||
        s.rotated[2] !== pos.z
      ) {
        pos.set(s.rotated[0], s.rotated[1], s.rotated[2]);
        changed = true;
      }
    }

    // 方向历史始终更新（跟随关闭期间也记，重新开启不产生累计跳变）
    s.prevDir[0] = dir[0];
    s.prevDir[1] = dir[1];
    s.prevDir[2] = dir[2];
    s.hasPrev = true;

    if (!changed) return;
    // 仰角钳制（与 OrbitControls props 同一事实源）：天体逼近天顶/地平线
    // 下时相机停在域边界，天体略微偏心属边界真实行为
    s.spherical.setFromVector3(pos);
    const clamped = clampLabPolar(s.spherical.phi, maxPolarRad);
    if (clamped !== s.spherical.phi) {
      s.spherical.phi = clamped;
      pos.setFromSpherical(s.spherical);
    }
    camera.lookAt(0, 0, 0);
  });

  return null;
}

/** 便于消费侧类型标注（组件返回 null，不产生场景节点） */
export type BodyFollowRigElement = JSX.Element;
