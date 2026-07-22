'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { SUN } from '@/data/planets';
import { useSimulationStore } from '@/store';
import { visualBodyRadius } from '@/utils/scale';

/**
 * 太阳：发光球体 + 点光源 + 多层光晕（需求 4.1：太阳含光晕和大气发光效果）
 */
export function Sun(): JSX.Element {
  const radius = visualBodyRadius(SUN.radiusKm);
  const selectBody = useSimulationStore((s) => s.selectBody);

  const glowSprites = useMemo(() => {
    // 简单多层光晕：径向渐变贴图 sprite
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255, 220, 130, 0.55)');
      gradient.addColorStop(0.4, 'rgba(255, 180, 80, 0.18)');
      gradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
    const texture = new THREE.CanvasTexture(canvas);
    return [2.5, 4, 6].map((scale) => ({ texture, scale: radius * scale }));
  }, [radius]);

  return (
    <group name="sun">
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          selectBody(SUN.id);
        }}
      >
        <sphereGeometry args={[radius, 64, 64]} />
        <meshBasicMaterial color={SUN.color} />
      </mesh>
      {glowSprites.map((glow, idx) => (
        <sprite key={idx} scale={[glow.scale, glow.scale, 1]}>
          <spriteMaterial
            map={glow.texture}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
      {/* 附录A：太阳点光源强度 8 */}
      <pointLight intensity={8} distance={0} decay={0.4} color="#fff5e0" />
    </group>
  );
}
