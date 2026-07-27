'use client';


import type { JSX } from 'react';
import { PLANETS } from '@/data/planets';
import { ASTEROID_BELT, COMETS, DWARF_PLANETS, KUIPER_BELT } from '@/data/smallBodies';
import { useSimulationStore } from '@/store';
import { planetFrozen } from '@/utils/freezeGate';
import { OrbitLine } from '@/components/Scene/OrbitLine';
import { Belt } from '@/components/Scene/Belt';
import { OortCloud } from '@/components/Scene/OortCloud';
import { Heliopause } from '@/components/Scene/Heliopause';
import { Comet } from '@/components/CelestialBody/Comet';
import { Planet } from '@/components/CelestialBody/Planet';
import { Sun } from '@/components/CelestialBody/Sun';

/**
 * 太阳系场景：太阳 + 八大行星（含卫星/环）+ 彗星 + 小行星带 + 柯伊伯带（含冥王星）
 *
 * 轨道线与天体渲染分离（需求 4.3）：轨道线静态预计算，天体沿轨道运动。
 * 彗星轨道线体现高离心率椭圆特征；冥王星轨道倾角 17°、高离心率可见。
 */
export function SolarSystem(): JSX.Element {
  const showOrbitsSetting = useSimulationStore((s) => s.showOrbits);
  // R2-3 外层视角下太阳系内容退化（需求 3.3）：冻结判定收敛至 utils/freezeGate
  // （淡出完毕即卸载轨道线）；淡出区间内轨道线透明度随行星权重同步渐隐
  // （fadeWithPlanets，OrbitLine.tsx）。太阳本体保持可见（L3 标记热区依赖）
  const frozen = useSimulationStore((s) => planetFrozen(s.continuousLevel));
  const showOrbits = showOrbitsSetting && !frozen;

  return (
    <group>
      <Sun />
      {PLANETS.map((planet) => (
        <group key={planet.id}>
          {showOrbits && <OrbitLine elements={planet.orbit} fadeWithPlanets />}
          <Planet data={planet} />
        </group>
      ))}

      {/* 矮行星：冥王星（与海王星 2:3 共振）+ 阋神星/鸟神星/妊神星（可选需求） */}
      {DWARF_PLANETS.map((dwarf) => (
        <group key={dwarf.id}>
          {showOrbits && (
            <OrbitLine elements={dwarf.orbit} color="#aa99cc" opacity={0.45} fadeWithPlanets />
          )}
          <Planet data={dwarf} />
        </group>
      ))}

      {/* 彗星（哈雷为逆行轨道，彗尾始终背向太阳） */}
      {COMETS.map((comet) => (
        <group key={comet.id}>
          {showOrbits && (
            <OrbitLine elements={comet.orbit} color="#7fc4dd" opacity={0.4} fadeWithPlanets />
          )}
          <Comet data={comet} />
        </group>
      ))}

      {/* 小行星带（2.2–3.2 AU）与柯伊伯带（30–50 AU），开普勒剪切公转 */}
      <Belt config={ASTEROID_BELT} />
      <Belt config={KUIPER_BELT} />

      {/* 日球层顶示意（S3 §4.3-4：太阳风与星际介质边界，L2 外缘半透明球壳） */}
      <Heliopause />

      {/* 奥尔特云外边界示意（可选需求：L2 ↔ L3 过渡参照物） */}
      <OortCloud />
    </group>
  );
}
