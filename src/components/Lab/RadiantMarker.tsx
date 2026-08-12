'use client';

/**
 * 辐射点标注（M3-4，需求 §3 辅助 UI）：圆圈 + 十字刻度 + 星座名标签，
 * 置于辐射点方向 × 2940（星穹半径内侧），每帧随天穹同步旋转（CPU 经 M1
 * 坐标函数求辐射点地平方向，组件零内联球面公式）。
 *
 * locale 纪律：本组件不订阅 locale——星座名经叶组件 LabelText（内部订阅），
 * 语言切换不重建场景图（Scene/LocalizedLabelText 惯例）。
 * 显隐由父级 DOM 层控制（showRadiant 开关 + 辐射点在地平线上），本组件
 * 挂载即渲染。
 */

import type { JSX } from 'react';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { MessageKey } from '@/i18n';
import { LabelText } from '@/components/Scene/LocalizedLabelText';
import {
  horizontalFromEquatorial,
  localSiderealTime,
  sceneDirFromAltAz,
} from '@/utils/meteorShower';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

/** 标注距离（场景单位，星穹半径 3000 内侧防深度冲突） */
const MARKER_DISTANCE_UNITS = 2940;

/** 圆圈内/外半径（场景单位；2940 距离下 ≈1.5° 视径） */
const RING_INNER_UNITS = 70;
const RING_OUTER_UNITS = 78;

/** 十字刻度：距中心偏移与长宽（留中心空窗，不遮流星） */
const TICK_OFFSET_UNITS = 108;
const TICK_LENGTH_UNITS = 44;
const TICK_WIDTH_UNITS = 6;

const MARKER_COLOR = '#7dd3fc';

/** 十字刻度角度（N/E/S/W 四向） */
const TICK_ANGLES = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

interface RadiantMarkerProps {
  refs: LabFrameRefs;
  /** 星座名字典键（父级 DOM 层按页签传入；叶组件内订阅 locale） */
  labelKey: MessageKey;
}

/** 辐射点标注（随天穹同步旋转；材质均 depthWrite:false 防遮星点） */
export function RadiantMarker({ refs, labelKey }: RadiantMarkerProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    const lst = localSiderealTime(shower.epochLst0Deg, s.hourOffset, refs.timeSecRef.current / 3600);
    const radiant = horizontalFromEquatorial(
      shower.radiantRaDeg,
      shower.radiantDecDeg,
      s.observerLat,
      lst
    );
    const dir = sceneDirFromAltAz(radiant);
    group.position.set(
      dir[0] * MARKER_DISTANCE_UNITS,
      dir[1] * MARKER_DISTANCE_UNITS,
      dir[2] * MARKER_DISTANCE_UNITS
    );
    // 标注面朝观测者（原点）
    group.lookAt(0, 0, 0);
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <ringGeometry args={[RING_INNER_UNITS, RING_OUTER_UNITS, 64]} />
        <meshBasicMaterial
          color={MARKER_COLOR}
          transparent
          opacity={0.65}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {TICK_ANGLES.map((angle) => (
        <mesh
          key={angle}
          position={[Math.cos(angle) * TICK_OFFSET_UNITS, Math.sin(angle) * TICK_OFFSET_UNITS, 0]}
          rotation-z={angle}
        >
          <planeGeometry args={[TICK_LENGTH_UNITS, TICK_WIDTH_UNITS]} />
          <meshBasicMaterial
            color={MARKER_COLOR}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
      <Html position={[0, -RING_OUTER_UNITS * 2.2, 0]} center style={{ pointerEvents: 'none' }}>
        <span className="whitespace-nowrap rounded bg-black/50 px-1.5 py-0.5 text-xs text-sky-300 backdrop-blur">
          <LabelText k={labelKey} />
        </span>
      </Html>
    </group>
  );
}
