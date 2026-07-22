'use client';

import { PLANETS } from '@/data/planets';
import { ASTEROID_BELT, COMETS, KUIPER_BELT, PLUTO } from '@/data/smallBodies';
import { useSimulationStore } from '@/store';
import { OrbitLine } from '@/components/Scene/OrbitLine';
import { Belt } from '@/components/Scene/Belt';
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
  // 外层视角下太阳系内容退化（与行星冻结阈值一致，需求 3.3）
  const frozen = useSimulationStore((s) => s.continuousLevel > 3.2);
  const showOrbits = showOrbitsSetting && !frozen;

  return (
    <group>
      <Sun />
      {PLANETS.map((planet) => (
        <group key={planet.id}>
          {showOrbits && <OrbitLine elements={planet.orbit} />}
          <Planet data={planet} />
        </group>
      ))}

      {/* 矮行星冥王星（柯伊伯带成员，与海王星 2:3 共振） */}
      <group>
        {showOrbits && <OrbitLine elements={PLUTO.orbit} color="#aa99cc" opacity={0.45} />}
        <Planet data={PLUTO} />
      </group>

      {/* 彗星（哈雷为逆行轨道，彗尾始终背向太阳） */}
      {COMETS.map((comet) => (
        <group key={comet.id}>
          {showOrbits && <OrbitLine elements={comet.orbit} color="#7fc4dd" opacity={0.4} />}
          <Comet data={comet} />
        </group>
      ))}

      {/* 小行星带（2.2–3.2 AU）与柯伊伯带（30–50 AU），开普勒剪切公转 */}
      <Belt config={ASTEROID_BELT} />
      <Belt config={KUIPER_BELT} />
    </group>
  );
}
