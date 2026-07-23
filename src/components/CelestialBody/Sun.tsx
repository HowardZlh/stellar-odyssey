'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SUN } from '@/data/planets';
import { textureUrl } from '@/data/textures';
import { useSimulationStore } from '@/store';
import { useBitmapTexture } from '@/hooks/useBitmapTexture';
import { bodyDisplayRadius } from '@/utils/scale';

/**
 * 太阳：发光球体 + 点光源 + 多层光晕（需求 4.1：太阳含光晕和大气发光效果）
 *
 * P3-1：表面使用真实太阳观测纹理（Solar System Scope，CC BY 4.0，
 * 登记见 data/textures.ts），启动即请求（优先级 1）；加载失败/未就绪时
 * 降级为纯色发光球。发光材质亮度高于 Bloom 亮度阈值，经泛光呈现自然辉光（P3-3）。
 */
export function Sun(): JSX.Element {
  // 真实比例模式（需求 4.1）：太阳半径按真实线性比例映射（约 0.047 场景单位）
  const realScaleMode = useSimulationStore((s) => s.realScaleMode);
  const radius = bodyDisplayRadius(SUN.radiusKm, realScaleMode);
  const selectBody = useSimulationStore((s) => s.selectBody);
  // 太阳为 L2 主发光体：启动即加载（P3-2 优先级 1，仅次于聚焦天体）
  const sunTexture = useBitmapTexture(textureUrl('sun', 'surface'), 1, true);

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

  useEffect(() => {
    return () => {
      // 三层 sprite 共用同一贴图，释放一次即可（AGENTS.md 内存管理）
      glowSprites[0]?.texture.dispose();
    };
  }, [glowSprites]);

  return (
    <group name="sun">
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          selectBody(SUN.id);
        }}
      >
        <sphereGeometry args={[radius, 64, 64]} />
        {sunTexture ? (
          <meshBasicMaterial map={sunTexture} color="#fff2d0" />
        ) : (
          <meshBasicMaterial color={SUN.color} />
        )}
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
