export const BACKUP_ARCHIVE_KIND = "kidindin-full-backup-archive" as const;
export const BACKUP_ARCHIVE_VERSION = 1 as const;

export const BACKUP_ARCHIVE_CHUNK_BYTES = 1024 * 1024;
export const DEFAULT_MAX_NDJSON_LINE_BYTES = 4 * 1024 * 1024;

const SHA256_BLOCK_BYTES = 64;
const SHA256_DIGEST_WORDS = 8;
const MAX_HASH_INPUT_BYTES = Math.floor(Number.MAX_SAFE_INTEGER / 8);

const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
]);

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const UTF8_ENCODER = new TextEncoder();

function rotateRight(value: number, places: number) {
  return (value >>> places) | (value << (32 - places));
}

/**
 * Browser-compatible incremental SHA-256. Digest methods clone the current
 * state, so reading a digest never finalizes or otherwise mutates this object.
 */
export class IncrementalSha256 {
  private state: Uint32Array;
  private readonly buffer: Uint8Array;
  private bufferLength: number;
  private totalBytes: number;
  private readonly schedule: Uint32Array;

  constructor(source?: IncrementalSha256) {
    this.state = source ? source.state.slice() : SHA256_INITIAL_STATE.slice();
    this.buffer = source ? source.buffer.slice() : new Uint8Array(SHA256_BLOCK_BYTES);
    this.bufferLength = source?.bufferLength ?? 0;
    this.totalBytes = source?.totalBytes ?? 0;
    this.schedule = new Uint32Array(64);
  }

  clone() {
    return new IncrementalSha256(this);
  }

  update(value: Uint8Array | string) {
    const bytes = typeof value === "string" ? UTF8_ENCODER.encode(value) : value;
    if (bytes.byteLength === 0) return this;
    if (this.totalBytes > MAX_HASH_INPUT_BYTES - bytes.byteLength) {
      throw new Error("SHA-256 输入过大，无法安全计算长度");
    }
    this.totalBytes += bytes.byteLength;

    let offset = 0;
    if (this.bufferLength > 0) {
      const copied = Math.min(SHA256_BLOCK_BYTES - this.bufferLength, bytes.byteLength);
      this.buffer.set(bytes.subarray(0, copied), this.bufferLength);
      this.bufferLength += copied;
      offset += copied;
      if (this.bufferLength === SHA256_BLOCK_BYTES) {
        this.processBlock(this.buffer, 0);
        this.bufferLength = 0;
      }
    }

    while (offset + SHA256_BLOCK_BYTES <= bytes.byteLength) {
      this.processBlock(bytes, offset);
      offset += SHA256_BLOCK_BYTES;
    }

    if (offset < bytes.byteLength) {
      this.buffer.set(bytes.subarray(offset), 0);
      this.bufferLength = bytes.byteLength - offset;
    }
    return this;
  }

  digestBytes() {
    const finalized = this.clone();
    finalized.finish();
    const digest = new Uint8Array(SHA256_DIGEST_WORDS * 4);
    const view = new DataView(digest.buffer);
    for (let index = 0; index < SHA256_DIGEST_WORDS; index += 1) {
      view.setUint32(index * 4, finalized.state[index]!, false);
    }
    return digest;
  }

  digestHex() {
    let result = "";
    for (const byte of this.digestBytes()) result += byte.toString(16).padStart(2, "0");
    return result;
  }

  private finish() {
    const originalTotalBytes = this.totalBytes;
    this.buffer[this.bufferLength] = 0x80;
    this.bufferLength += 1;

    if (this.bufferLength > 56) {
      this.buffer.fill(0, this.bufferLength);
      this.processBlock(this.buffer, 0);
      this.bufferLength = 0;
    }

    this.buffer.fill(0, this.bufferLength, 56);
    const bitLength = originalTotalBytes * 8;
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    view.setUint32(56, Math.floor(bitLength / 0x1_0000_0000), false);
    view.setUint32(60, bitLength >>> 0, false);
    this.processBlock(this.buffer, 0);
    this.bufferLength = 0;
  }

  private processBlock(bytes: Uint8Array, offset: number) {
    const words = this.schedule;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, SHA256_BLOCK_BYTES);
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const prior15 = words[index - 15]!;
      const prior2 = words[index - 2]!;
      const smallSigma0 = rotateRight(prior15, 7) ^ rotateRight(prior15, 18) ^ (prior15 >>> 3);
      const smallSigma1 = rotateRight(prior2, 17) ^ rotateRight(prior2, 19) ^ (prior2 >>> 10);
      words[index] = (words[index - 16]! + smallSigma0 + words[index - 7]! + smallSigma1) >>> 0;
    }

    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;

    for (let index = 0; index < 64; index += 1) {
      const largeSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + largeSigma1 + choose + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const largeSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (largeSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}

export function utf8ByteLength(value: string) {
  return UTF8_ENCODER.encode(value).byteLength;
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkBytes = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkBytes));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("不是严格的标准 Base64 数据");
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Base64 数据无法解码");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytesToBase64(bytes) !== value) throw new Error("Base64 数据包含非规范填充位");
  return bytes;
}

export interface Utf8LineReadOptions {
  maxLineBytes?: number;
  onBytesRead?: (totalBytesRead: number) => void;
}

export interface Utf8Line {
  line: string;
  /** UTF-8 byte length excluding the terminating LF byte. */
  lineBytes: number;
  /** Bytes pulled from the stream so far; it can extend beyond this line. */
  totalBytesRead: number;
}

function decodeUtf8Line(bytes: Uint8Array) {
  try {
    // Preserve an actual U+FEFF at the beginning so re-encoding remains byte exact.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("备份文件包含无效的 UTF-8 数据");
  }
}

function joinByteSegments(segments: Uint8Array[], byteLength: number) {
  if (segments.length === 1 && segments[0]!.byteLength === byteLength) return segments[0]!;
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const segment of segments) {
    joined.set(segment, offset);
    offset += segment.byteLength;
  }
  return joined;
}

/** Streams a UTF-8 LF-delimited NDJSON file without loading it into memory. */
export async function* readUtf8Lines(
  file: Blob,
  options: Utf8LineReadOptions = {},
): AsyncGenerator<Utf8Line> {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_NDJSON_LINE_BYTES;
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
    throw new Error("maxLineBytes 必须是正的安全整数");
  }

  const reader = file.stream().getReader();
  let segments: Uint8Array[] = [];
  let currentLineBytes = 0;
  let totalBytesRead = 0;
  let sawAnyByte = false;
  let endedWithLf = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      sawAnyByte = true;
      totalBytesRead += value.byteLength;
      options.onBytesRead?.(totalBytesRead);

      let segmentStart = 0;
      for (let index = 0; index < value.byteLength; index += 1) {
        if (value[index] !== 0x0a) continue;
        const segment = value.subarray(segmentStart, index);
        currentLineBytes += segment.byteLength;
        if (currentLineBytes > maxLineBytes) {
          throw new Error(`备份文件单行超过 ${maxLineBytes} 字节上限`);
        }
        if (segment.byteLength > 0) segments.push(segment);
        const lineBytes = joinByteSegments(segments, currentLineBytes);
        yield {
          line: decodeUtf8Line(lineBytes),
          lineBytes: currentLineBytes,
          totalBytesRead,
        };
        segments = [];
        currentLineBytes = 0;
        segmentStart = index + 1;
      }

      const remainder = value.subarray(segmentStart);
      currentLineBytes += remainder.byteLength;
      if (currentLineBytes > maxLineBytes) {
        throw new Error(`备份文件单行超过 ${maxLineBytes} 字节上限`);
      }
      if (remainder.byteLength > 0) segments.push(remainder);
      endedWithLf = value[value.byteLength - 1] === 0x0a;
    }
  } finally {
    reader.releaseLock();
  }

  if (!sawAnyByte) throw new Error("备份文件为空");
  if (!endedWithLf || currentLineBytes > 0) {
    throw new Error("备份文件必须以换行符结束");
  }
}
