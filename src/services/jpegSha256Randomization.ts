const JPEG_SOI = new Uint8Array([0xff, 0xd8]);
const JPEG_COMMENT_MARKER = new Uint8Array([0xff, 0xfe]);
const COMMENT_PREFIX = new TextEncoder().encode("KiDinDin-SHA256-Random:");

let randomizationSequence = 0;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256Bytes(value: BufferSource) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前运行环境不支持 SHA-256 图片随机化，请更新 App 后重试");
  }
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", value));
}

async function createRandomDigest(source: File) {
  randomizationSequence += 1;
  const secureRandom = new Uint8Array(32);
  globalThis.crypto.getRandomValues(secureRandom);
  const runtimeEntropy = new TextEncoder().encode(
    [
      Date.now(),
      typeof performance === "undefined" ? 0 : performance.now(),
      randomizationSequence,
      source.name,
      source.size,
      source.lastModified,
      typeof globalThis.crypto.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : "",
    ].join("|"),
  );
  const mixed = new Uint8Array(secureRandom.length + runtimeEntropy.length);
  mixed.set(secureRandom);
  mixed.set(runtimeEntropy, secureRandom.length);
  return sha256Bytes(mixed);
}

function createJpegCommentSegment(randomDigest: Uint8Array) {
  const digestText = new TextEncoder().encode(bytesToHex(randomDigest));
  const payload = new Uint8Array(COMMENT_PREFIX.length + digestText.length);
  payload.set(COMMENT_PREFIX);
  payload.set(digestText, COMMENT_PREFIX.length);

  const segmentLength = payload.length + 2;
  const segment = new Uint8Array(JPEG_COMMENT_MARKER.length + 2 + payload.length);
  segment.set(JPEG_COMMENT_MARKER);
  segment[2] = (segmentLength >>> 8) & 0xff;
  segment[3] = segmentLength & 0xff;
  segment.set(payload, 4);
  return segment;
}

export async function randomizeJpegSha256(jpeg: Blob, source: File) {
  const header = new Uint8Array(await jpeg.slice(0, 2).arrayBuffer());
  if (
    header.length !== JPEG_SOI.length ||
    header[0] !== JPEG_SOI[0] ||
    header[1] !== JPEG_SOI[1]
  ) {
    throw new Error(`图片 ${source.name} 不是有效的 JPEG，无法添加 SHA-256 随机信息`);
  }

  const randomDigest = await createRandomDigest(source);
  const commentSegment = createJpegCommentSegment(randomDigest);
  const randomizedBlob = new Blob(
    [jpeg.slice(0, 2), commentSegment, jpeg.slice(2)],
    { type: "image/jpeg" },
  );
  const contentSha256 = bytesToHex(
    await sha256Bytes(await randomizedBlob.arrayBuffer()),
  );
  return {
    blob: randomizedBlob,
    contentSha256,
    randomDigest: bytesToHex(randomDigest),
  };
}
