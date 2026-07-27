'use client';

/**
 * 标签近距钳制共用组件（R3-4，IMPROVEMENT_REQUIREMENTS_3 §4.1-B）
 *
 * drei `<Html distanceFactor>` 的"世界空间固定大小"语义在相机贴近时会把
 * 标签放大数十倍铺屏（跟随小天体放大时说明文字遮挡画面，用户反馈）。
 * 本组件包装 Html：锚点 group 每帧取 matrixWorld 世界坐标计算相机距离，
 * 按 `labelCounterScale` 对内层 div 做反向 CSS 缩放——距离小于最小生效
 * 距离（默认 distanceFactor × 0.5）后屏幕尺寸恒定，远距（≥ 最小生效
 * 距离）反向系数恒 1、观感零回退。
 *
 * 性能：直改 DOM 样式不经 React 重渲染（项目 labelElRef 同款模式）；
 * 缩放值量化（3 位小数）缓存比对，未变化不写样式（防每帧字符串分配）；
 * 世界坐标用模块级临时向量（useFrame 同步执行，实例间复用安全）。
 * 内层反向缩放与子元素既有 ref/opacity 直改逻辑互不干扰。
 */

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, type CSSProperties, type ReactNode } from 'react';
import * as THREE from 'three';
import { labelCounterScale, labelMinDistance, quantizeScale } from '@/utils/labelScale';

const TMP_ANCHOR_POS = new THREE.Vector3();

export interface ClampedHtmlLabelProps {
  /** 锚点相对父级位置（等价原 Html position） */
  position?: [number, number, number];
  /** drei Html 世界固定尺寸因子（沿用各标签既有取值） */
  distanceFactor: number;
  /** 最小生效距离比例（默认 LABEL_MIN_DISTANCE_RATIO=0.5，逐标签可调） */
  minDistanceRatio?: number;
  /** 透传 Html center（标签均为居中锚定） */
  center?: boolean;
  /** 透传 Html zIndexRange */
  zIndexRange?: [number, number];
  /** 透传 Html style（标签均为 pointerEvents: 'none'） */
  style?: CSSProperties;
  children: ReactNode;
}

export function ClampedHtmlLabel({
  position,
  distanceFactor,
  minDistanceRatio,
  center = true,
  zIndexRange,
  style,
  children,
}: ClampedHtmlLabelProps): JSX.Element {
  const anchorRef = useRef<THREE.Group>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const lastScaleRef = useRef(1);
  const minDistance = labelMinDistance(distanceFactor, minDistanceRatio);

  useFrame(({ camera }) => {
    const anchor = anchorRef.current;
    const el = innerRef.current;
    if (!anchor || !el) return;
    const dist = TMP_ANCHOR_POS.setFromMatrixPosition(anchor.matrixWorld).distanceTo(
      camera.position,
    );
    const scale = quantizeScale(labelCounterScale(dist, minDistance));
    if (scale !== lastScaleRef.current) {
      lastScaleRef.current = scale;
      el.style.transform = scale < 1 ? `scale(${scale})` : '';
    }
  });

  return (
    <group ref={anchorRef} position={position}>
      <Html center={center} distanceFactor={distanceFactor} zIndexRange={zIndexRange} style={style}>
        <div ref={innerRef} style={{ transformOrigin: 'center' }}>
          {children}
        </div>
      </Html>
    </group>
  );
}
