/**
 * 最小 PNG 编解码器（R5-1 烘焙管线专用；零外部依赖，压缩经 node:zlib）
 *
 * 省 token 约定落实：不引入 sharp/pngjs 等重依赖，纯 JS 实现子集：
 * - 解码：8-bit、colorType 0（灰度）/2（RGB）/6（RGBA），非隔行，
 *   全部 5 种扫描线滤波（None/Sub/Up/Average/Paeth）；
 * - 编码：8-bit、channels 1/3/4，逐行 Paeth（type 4）滤波 +
 *   deflateSync level 9（确定性输出——幂等性依赖）。
 *
 * 仅烘焙脚本与其单测消费，不进运行时 bundle。
 */

import { deflateSync, inflateSync } from 'node:zlib';

export interface RasterImage {
  width: number;
  height: number;
  /** 每像素通道数：1（灰度）/ 3（RGB）/ 4（RGBA） */
  channels: 1 | 3 | 4;
  /** 行主序像素数据，长度 = width×height×channels */
  data: Uint8Array;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ---------------------------------------------------------------------------
// CRC-32（PNG 块校验）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// 解码
// ---------------------------------------------------------------------------

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** 解码 PNG（支持子集见文件头；不支持的格式抛 Error） */
export function decodePng(bytes: Uint8Array): RasterImage {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('非 PNG 文件（签名不符）');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idatParts: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const interlace = bytes[dataStart + 12];
      if (bitDepth !== 8) throw new Error(`仅支持 8-bit PNG，收到 bitDepth=${bitDepth}`);
      if (colorType !== 0 && colorType !== 2 && colorType !== 6) {
        throw new Error(`仅支持灰度/RGB/RGBA PNG，收到 colorType=${colorType}`);
      }
      if (interlace !== 0) throw new Error('不支持隔行扫描 PNG');
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4; // + CRC
  }
  if (width <= 0 || height <= 0 || colorType < 0) throw new Error('PNG 缺少 IHDR');
  const channels = (colorType === 0 ? 1 : colorType === 2 ? 3 : 4) as 1 | 3 | 4;
  const raw = inflateSync(Buffer.concat(idatParts.map((p) => Buffer.from(p))));
  const stride = width * channels;
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[rowStart + x];
      const left = x >= channels ? data[outStart + x - channels] : 0;
      const up = y > 0 ? data[outStart - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? data[outStart - stride + x - channels] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4:
          value = rawByte + paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`未知 PNG 滤波类型 ${filter}`);
      }
      data[outStart + x] = value & 0xff;
    }
  }
  return { width, height, channels, data };
}

// ---------------------------------------------------------------------------
// 编码
// ---------------------------------------------------------------------------

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)));
  return out;
}

/** 编码 PNG（逐行 Paeth 滤波 + deflate level 9，确定性输出） */
export function encodePng(image: RasterImage): Uint8Array {
  const { width, height, channels, data } = image;
  if (data.length !== width * height * channels) {
    throw new Error(`像素数据长度 ${data.length} 与 ${width}×${height}×${channels} 不符`);
  }
  const stride = width * channels;
  const filtered = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    filtered[y * (stride + 1)] = 4; // Paeth
    const rowStart = y * stride;
    const outStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? data[rowStart + x - channels] : 0;
      const up = y > 0 ? data[rowStart - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? data[rowStart - stride + x - channels] : 0;
      filtered[outStart + x] = (data[rowStart + x] - paethPredictor(left, up, upLeft)) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(filtered, { level: 9 });
  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(idat.buffer, idat.byteOffset, idat.byteLength)),
    chunk('IEND', new Uint8Array(0)),
  ];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}
