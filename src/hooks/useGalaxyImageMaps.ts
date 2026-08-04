'use client';

/**
 * R5-1 星系影像权重图 Hook：`public/data/galaxy-maps/<id>-{meta,density,color,dust}`
 * （R5-1 烘焙产物，DSS2 彩色合成公版影像 → 256² 权重图）。
 *
 * meta 经 `bakedData.loadGalaxyMapMeta`（fetch + 校验 + URL 缓存），
 * 像素图经浏览器 Image → canvas 解码为原始字节（密度/尘埃取 R 通道，
 * 颜色取 RGB）——纯逻辑采样（utils/galaxyNearView.sampleParticlesFromMap）
 * 仅消费字节数组，本 Hook 是唯一 DOM 依赖点。
 *
 * 加载完成前与任何环节失败（产物缺失/解码失败/尺寸与 meta 不符）时
 * 返回 null——消费方降级 R4-9 参数化生成（§R5-1 B 降级登记）。
 * 成功结果模块级缓存（多消费方共享一次解码）。
 */

import { useEffect, useState } from 'react';
import { loadGalaxyMapMeta } from '@/utils/bakedData';
import {
  galaxyMapUrls,
  isImageDrivenGalaxy,
  type GalaxyImageMaps,
} from '@/utils/galaxyNearView';

/** 模块级缓存（成功缓存；失败不缓存，可重试——bakedData 同语义） */
const resolvedById = new Map<string, GalaxyImageMaps>();
const inflightById = new Map<string, Promise<GalaxyImageMaps | null>>();

/** 浏览器解码 PNG → ImageData（SSR/测试环境或失败返回 null） */
async function decodeImageData(url: string): Promise<ImageData | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

/** ImageData（RGBA）→ 单通道（R）字节数组 */
function extractChannel(image: ImageData): Uint8Array {
  const n = image.width * image.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = image.data[i * 4];
  }
  return out;
}

/** ImageData（RGBA）→ RGB 三通道字节数组 */
function extractRgb(image: ImageData): Uint8Array {
  const n = image.width * image.height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    out[i * 3] = image.data[i * 4];
    out[i * 3 + 1] = image.data[i * 4 + 1];
    out[i * 3 + 2] = image.data[i * 4 + 2];
  }
  return out;
}

async function loadGalaxyImageMaps(galaxyId: string): Promise<GalaxyImageMaps | null> {
  const urls = galaxyMapUrls(galaxyId);
  if (!urls) return null;
  const meta = await loadGalaxyMapMeta(galaxyId);
  if (!meta) return null;
  const [density, color, dust] = await Promise.all([
    decodeImageData(urls.density),
    decodeImageData(urls.color),
    decodeImageData(urls.dust),
  ]);
  if (!density || !color || !dust) return null;
  const size = meta.mapSizePx;
  const sizeOk = (img: ImageData): boolean => img.width === size && img.height === size;
  if (!sizeOk(density) || !sizeOk(color) || !sizeOk(dust)) return null;
  return {
    mapRadiusLy: meta.mapRadiusLy,
    density: { size, data: extractChannel(density) },
    color: { size, data: extractRgb(color) },
    dust: { size, data: extractChannel(dust) },
  };
}

/**
 * @param galaxyId 覆盖星系 id（null / 非覆盖星系恒返回 null——懒加载
 *   门控：消费方在近观激活时才传入 id）
 */
export function useGalaxyImageMaps(galaxyId: string | null): GalaxyImageMaps | null {
  const [maps, setMaps] = useState<GalaxyImageMaps | null>(() =>
    galaxyId ? (resolvedById.get(galaxyId) ?? null) : null,
  );
  useEffect(() => {
    if (!galaxyId || !isImageDrivenGalaxy(galaxyId)) {
      setMaps(null);
      return undefined;
    }
    const cached = resolvedById.get(galaxyId);
    if (cached) {
      setMaps(cached);
      return undefined;
    }
    setMaps(null);
    let alive = true;
    let promise = inflightById.get(galaxyId);
    if (!promise) {
      promise = loadGalaxyImageMaps(galaxyId).then((loaded) => {
        inflightById.delete(galaxyId);
        if (loaded) resolvedById.set(galaxyId, loaded);
        return loaded;
      });
      inflightById.set(galaxyId, promise);
    }
    void promise.then((loaded) => {
      if (alive && loaded) setMaps(loaded);
    });
    return () => {
      alive = false;
    };
  }, [galaxyId]);
  return maps;
}

/** 测试用：清空模块级缓存 */
export function resetGalaxyImageMapsForTest(): void {
  resolvedById.clear();
  inflightById.clear();
}
