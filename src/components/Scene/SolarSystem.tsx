'use client';

import { PLANETS } from '@/data/planets';
import { useSimulationStore } from '@/store';
import { OrbitLine } from '@/components/Scene/OrbitLine';
import { Planet } from '@/components/CelestialBody/Planet';
import { Sun } from '@/components/CelestialBody/Sun';

/**
 * 太阳系场景：太阳 + 八大行星 + 轨道线
 *
 * 轨道线与天体渲染分离（需求 4.3）：轨道线静态预计算，天体沿轨道运动。
 */
export function SolarSystem(): JSX.Element {
  const showOrbits = useSimulationStore((s) => s.showOrbits);

  return (
    <group>
      <Sun />
      {PLANETS.map((planet) => (
        <group key={planet.id}>
          {showOrbits && <OrbitLine elements={planet.orbit} />}
          <Planet data={planet} />
        </group>
      ))}
    </group>
  );
}
