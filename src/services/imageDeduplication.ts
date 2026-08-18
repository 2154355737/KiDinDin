export type ImageDeduplicationEntry = {
  file: File;
  key: string;
  label: string;
};

const fingerprintCache = new WeakMap<Blob, Promise<string>>();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function fingerprintImage(file: File) {
  const cached = fingerprintCache.get(file);
  if (cached) return cached;

  const fingerprint = (async () => {
    if (!globalThis.crypto?.subtle) {
      throw new Error("当前运行环境不支持图片内容去重，请更新 App 后重试");
    }
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    return bytesToHex(new Uint8Array(digest));
  })();
  fingerprintCache.set(file, fingerprint);
  void fingerprint.catch(() => fingerprintCache.delete(file));
  return fingerprint;
}

export async function findDuplicateImage(
  candidate: File,
  entries: readonly ImageDeduplicationEntry[],
) {
  const sameSizeEntries = entries.filter(
    (entry) => entry.file.size === candidate.size,
  );
  if (!sameSizeEntries.length) return null;

  const candidateFingerprint = await fingerprintImage(candidate);
  for (const entry of sameSizeEntries) {
    if ((await fingerprintImage(entry.file)) === candidateFingerprint) {
      return entry;
    }
  }
  return null;
}

export async function findFirstDuplicateImage(
  entries: readonly ImageDeduplicationEntry[],
) {
  const seen = new Map<string, ImageDeduplicationEntry>();
  for (const entry of entries) {
    const fingerprint = `${entry.file.size}:${await fingerprintImage(entry.file)}`;
    const original = seen.get(fingerprint);
    if (original) return { duplicate: entry, original };
    seen.set(fingerprint, entry);
  }
  return null;
}
