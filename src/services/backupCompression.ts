/**
 * 备份数据压缩服务
 * 使用 fflate 进行流式压缩，减小备份文件体积
 */

import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";

export type CompressionResult = {
  compressed: Uint8Array;
  originalSize: number;
  compressedSize: number;
  ratio: number;
};

export type DecompressionResult = {
  decompressed: string;
  originalSize: number;
  decompressedSize: number;
};

/**
 * 压缩字符串数据
 */
export function compressString(data: string): CompressionResult {
  const originalBytes = strToU8(data);
  const compressed = gzipSync(originalBytes, { level: 9 });

  return {
    compressed,
    originalSize: originalBytes.byteLength,
    compressedSize: compressed.byteLength,
    ratio: compressed.byteLength / originalBytes.byteLength,
  };
}

/**
 * 解压字符串数据
 */
export function decompressString(compressed: Uint8Array): DecompressionResult {
  const decompressedBytes = gunzipSync(compressed);
  const decompressed = strFromU8(decompressedBytes);

  return {
    decompressed,
    originalSize: compressed.byteLength,
    decompressedSize: decompressedBytes.byteLength,
  };
}

/**
 * 将 Uint8Array 转换为 Base64 字符串
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * 将 Base64 字符串转换为 Uint8Array
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 压缩备份 JSON 并返回 Base64 字符串
 */
export function compressBackupJson(json: string): {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
} {
  const result = compressString(json);
  return {
    compressed: bytesToBase64(result.compressed),
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    ratio: result.ratio,
  };
}

/**
 * 解压备份 JSON
 */
export function decompressBackupJson(compressedBase64: string): string {
  const compressed = base64ToBytes(compressedBase64);
  const result = decompressString(compressed);
  return result.decompressed;
}

/**
 * 检测数据是否已压缩（通过 gzip 魔术字节）
 */
export function isGzipCompressed(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 格式化压缩率
 */
export function formatCompressionRatio(ratio: number): string {
  return `${((1 - ratio) * 100).toFixed(1)}%`;
}
