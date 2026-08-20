'use client';

/**
 * 实验室触控板/触屏手势接线（方案 A，流星雨 M2 落地；E-M2 抽取为共享叶组件，
 * 流星雨与日全食实验室共用——FOV 捏合链单一事实源，§2.1「全部直接复用」）：
 * 双指滚动 → 环顾、捏合（Chrome/Firefox：wheel+ctrlKey；Safari：gesture*）→
 * FOV 缩放、触屏双指捏合 → FOV（M4-2）。
 *
 * 换算/钳制全部走 utils/labGestures 纯函数（组件内零可测业务逻辑）；
 * 监听挂画布元素、非被动（preventDefault 阻止页面缩放/回弹）。
 * 消费前提：反转轨道相机（target 原点、polar 钳制与 OrbitControls props
 * 同一事实源 labGestures 常量）。
 *
 * LE-M6 补丁 P1（望远档）：`minFovDeg` 入参（缺省 `LAB_FOV_MIN_DEG` = 30
 * ——流星雨/观察站逐像素零变化），日月食条目传 `LAB_FOV_TELESCOPIC_MIN_DEG`
 * （3°，日月盘 0.5° 可放大到视口高 ~18%）。配套**旋转速度随 FOV 自适应**：
 * 逐帧把 `labRotateSpeedForFov(基准, 当前FOV)` 写回默认轨道控制器
 * （`makeDefault` 的 OrbitControls 实例），保证望远档下拖拽的**屏幕像素
 * 手感恒定**——否则 3° 视场下一次拖拽会扫过数十个屏宽。基准速度取控制器
 * 实例首见时的 `rotateSpeed`（组件侧 props 即事实源，本组件只做缩放）。
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  LAB_FOV_MIN_DEG,
  clampLabPolar,
  labRotateSpeedForFov,
  pinchFovDeg,
  safariGestureFovDeg,
  touchPinchScale,
  wheelLookDelta,
} from '@/utils/labGestures';

/** Safari 专有捏合手势事件（lib.dom 无类型声明，最小结构接口） */
interface SafariGestureEvent extends Event {
  readonly scale?: number;
}

export interface TrackpadLookControlsProps {
  /**
   * FOV 缩放下限（度）：缺省 30（`LAB_FOV_MIN_DEG`，流星雨/观察站原口径）；
   * 日月食条目传 `LAB_FOV_TELESCOPIC_MIN_DEG`（3°）开望远档。
   */
  minFovDeg?: number;
}

export function TrackpadLookControls({
  minFovDeg = LAB_FOV_MIN_DEG,
}: TrackpadLookControlsProps = {}): null {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as {
    rotateSpeed?: number;
  } | null;

  /** 基准 rotateSpeed（按控制器实例记忆一次，防被自适应写入值污染） */
  const baseSpeedRef = useRef<{ obj: unknown; base: number } | null>(null);

  // 旋转速度自适应（逐帧读 FOV → 写控制器；运镜 rig 直改 FOV 的路径同样覆盖）
  useFrame(() => {
    if (!controls || typeof controls.rotateSpeed !== 'number') return;
    if (baseSpeedRef.current?.obj !== controls) {
      baseSpeedRef.current = { obj: controls, base: controls.rotateSpeed };
    }
    controls.rotateSpeed = labRotateSpeedForFov(
      baseSpeedRef.current.base,
      (camera as THREE.PerspectiveCamera).fov
    );
  });

  useEffect(() => {
    const el = gl.domElement;
    const cam = camera as THREE.PerspectiveCamera;
    const spherical = new THREE.Spherical();
    // Safari 捏合走 gesture*（激活期间忽略 ctrl+wheel 分支防双重缩放）
    let gestureActive = false;
    let gestureStartFovDeg = cam.fov;

    const applyFov = (fovDeg: number): void => {
      cam.fov = fovDeg;
      cam.updateProjectionMatrix();
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // 触控板捏合（Chrome/Firefox/Edge 映射为 wheel+ctrlKey）→ FOV
        if (!gestureActive) applyFov(pinchFovDeg(cam.fov, e.deltaY, minFovDeg));
        return;
      }
      // 双指滚动 → 环顾（deltaMode 换行/换页按近似像素预乘）
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const { dThetaRad, dPhiRad } = wheelLookDelta(
        e.deltaX * unit,
        e.deltaY * unit,
        el.clientHeight,
        cam.fov,
        minFovDeg
      );
      if (dThetaRad === 0 && dPhiRad === 0) return;
      // 相机球坐标绕 target（原点）旋转，半径不变；polar 钳制与
      // OrbitControls props 同一事实源（labGestures 常量）
      spherical.setFromVector3(cam.position);
      spherical.theta += dThetaRad;
      spherical.phi = clampLabPolar(spherical.phi + dPhiRad);
      cam.position.setFromSpherical(spherical);
      cam.lookAt(0, 0, 0);
    };

    // 触屏双指捏合（M4-2 触控）：起始双指距为基准 → touchPinchScale →
    // safariGestureFovDeg（M2 登记的同一 FOV 钳制函数复用）。单指环顾由
    // OrbitControls 原生触控 rotate 承担；仅双指时 preventDefault（防页面缩放）。
    let touchStartDistPx = 0;
    let touchStartFovDeg = cam.fov;
    const touchDistPx = (touches: TouchList): number =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 2) {
        touchStartDistPx = touchDistPx(e.touches);
        touchStartFovDeg = cam.fov;
      }
    };
    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || touchStartDistPx <= 0) return;
      e.preventDefault();
      applyFov(
        safariGestureFovDeg(
          touchStartFovDeg,
          touchPinchScale(touchStartDistPx, touchDistPx(e.touches)),
          minFovDeg
        )
      );
    };
    const onTouchEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2) touchStartDistPx = 0;
    };

    const onGestureStart = (e: Event): void => {
      e.preventDefault();
      gestureActive = true;
      gestureStartFovDeg = cam.fov;
    };
    const onGestureChange = (e: Event): void => {
      e.preventDefault();
      const scale = (e as SafariGestureEvent).scale;
      if (typeof scale === 'number') {
        applyFov(safariGestureFovDeg(gestureStartFovDeg, scale, minFovDeg));
      }
    };
    const onGestureEnd = (e: Event): void => {
      e.preventDefault();
      gestureActive = false;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [camera, gl, minFovDeg]);

  return null;
}
