"use client";

/**
 * 地面视角「天体跟随」相机 rig（LE-M6 补丁 P5 立、P6 扩；日食/月食/
 * selenelion 共用）
 *
 * P5（跟随）：差量刚体旋转 = 等效赤道仪跟踪，保留用户手动偏移（**非硬锁定
 * 居中**）——算法见 `utils/labCameraFollow.ts` 文件头。
 *
 * P6（天顶 roll 限幅）：`lookAt(up=+Y)` 在天顶盲区会把方位甩尾直接变成画面
 * 翻滚（l2029 月亮 89.8° 过天顶，×243 加速下 ≈1 秒翻 167°）。本 rig 因此
 * **接管挂载期间的相机朝向**（不再依赖 lookAt）：
 * 1. 视线变化经最小旋转对齐（画面连续，不产生自旋）；
 * 2. 与「地平线水平」基准的 roll 偏差按墙钟限幅 ≤25°/s 逐帧回正
 *    （`rollTowardTarget`）——远离天顶时每帧偏差 ≪ 限幅、瞬时追平，与
 *    lookAt 逐像素等价；天顶甩尾段画面平缓转过、随后自动回到水平。
 *
 * 与 OrbitControls 的协作：three 的 OrbitControls 每次 update 从
 * `position − target` 重算球坐标（读 position，不读 quaternion），外部改写
 * position 被支持；其内部的 lookAt 会先写一次朝向，本 rig 以缺省 priority 0
 * 晚于 drei 控制器（priority −1）运行、随即以限幅朝向覆写——远离天顶时两者
 * 逐像素一致。`camera.up` 保持世界 +Y 不动（它是控制器极角钳制的参考轴）。
 * 同场景 TrackpadLookControls 须传 `orientationManaged`（其滚轮环顾不再
 * lookAt，朝向统一归本 rig——否则两者会在天顶附近互相打架）。
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
  cameraBasisFromView,
  followRecenterFraction,
  rollFromCameraBasis,
  rollTowardTarget,
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
    /** P6 朝向管线状态：上帧视线/右轴（roll 连续性的事实源） */
    orientView: MutableVec3;
    orientRight: MutableVec3;
    hasOrient: boolean;
    basis: number[];
    matrix: THREE.Matrix4;
    scratchV: THREE.Vector3;
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
    orientView: [0, 0, -1],
    orientRight: [1, 0, 0],
    hasOrient: false,
    basis: new Array(9).fill(0),
    matrix: new THREE.Matrix4(),
    scratchV: new THREE.Vector3(),
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

    // ---- 位置更新（P5：复位收敛 / 差量跟随）----
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
      }
    } else if (enabled && s.hasPrev) {
      // 差量跟随：把 prevDir→dir 的最小旋转施加到相机位置（刚体，半径不变）
      s.rotated[0] = pos.x;
      s.rotated[1] = pos.y;
      s.rotated[2] = pos.z;
      rotateVectorBetweenDirs(s.prevDir, dir, s.rotated, s.rotated);
      pos.set(s.rotated[0], s.rotated[1], s.rotated[2]);
    }

    // 方向历史始终更新（跟随关闭期间也记，重新开启不产生累计跳变）
    s.prevDir[0] = dir[0];
    s.prevDir[1] = dir[1];
    s.prevDir[2] = dir[2];
    s.hasPrev = true;

    // 仰角钳制（与 OrbitControls props 同一事实源）：天体逼近天顶/地平线
    // 下时相机停在域边界，天体略微偏心属边界真实行为
    if (radius > 0) {
      s.spherical.setFromVector3(pos);
      const clamped = clampLabPolar(s.spherical.phi, maxPolarRad);
      if (clamped !== s.spherical.phi) {
        s.spherical.phi = clamped;
        pos.setFromSpherical(s.spherical);
      }
    }

    // ---- 朝向管线（P6：挂载期间每帧接管，不再 lookAt）----
    const r2 = pos.length();
    if (!(r2 > 0)) return;
    s.nextView[0] = -pos.x / r2;
    s.nextView[1] = -pos.y / r2;
    s.nextView[2] = -pos.z / r2;
    if (!s.hasOrient) {
      // 首帧：从相机现有朝向播种（接受运镜/lookAt 留下的任何 roll）
      const v = s.scratchV;
      v.set(0, 0, -1).applyQuaternion(camera.quaternion);
      s.orientView[0] = v.x;
      s.orientView[1] = v.y;
      s.orientView[2] = v.z;
      v.set(1, 0, 0).applyQuaternion(camera.quaternion);
      s.orientRight[0] = v.x;
      s.orientRight[1] = v.y;
      s.orientRight[2] = v.z;
      s.hasOrient = true;
    }
    // 1. 视线变化经最小旋转对齐上帧右轴（画面连续、零自旋）
    rotateVectorBetweenDirs(
      s.orientView,
      s.nextView,
      s.orientRight,
      s.orientRight,
    );
    // 2. 相对「地平线水平」基准的 roll 偏差，按墙钟限幅回正
    const roll = rollFromCameraBasis(s.nextView, s.orientRight);
    const newRoll = rollTowardTarget(roll, 0, delta);
    // 3. 组装基并写入相机（camera.up 不动——控制器极角钳制的参考轴）
    if (cameraBasisFromView(s.nextView, newRoll, s.basis)) {
      const b = s.basis;
      s.matrix.set(
        b[0], b[3], b[6], 0,
        b[1], b[4], b[7], 0,
        b[2], b[5], b[8], 0,
        0, 0, 0, 1,
      );
      camera.quaternion.setFromRotationMatrix(s.matrix);
      // 记录本帧终态（roll 连续性事实源）
      s.orientView[0] = s.nextView[0];
      s.orientView[1] = s.nextView[1];
      s.orientView[2] = s.nextView[2];
      s.orientRight[0] = b[0];
      s.orientRight[1] = b[1];
      s.orientRight[2] = b[2];
    }
  });

  return null;
}

/** 便于消费侧类型标注（组件返回 null，不产生场景节点） */
export type BodyFollowRigElement = JSX.Element;
