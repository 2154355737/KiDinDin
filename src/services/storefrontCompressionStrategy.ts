export const STOREFRONT_TARGET_BYTES = 500 * 1024;

/** Shared by worker and DOM fallback. Pixel dimensions must never change. */
export async function encodeStorefrontPhoto(
  sourceWidth: number,
  sourceHeight: number,
  encode: (width: number, height: number, quality: number) => Promise<Blob>,
): Promise<Blob> {
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) ||
      sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("门头照片尺寸无效，请重新选择图片");
  }
  // Keep the existing 0.5 quality floor instead of sacrificing legibility to
  // meet a best-effort byte target. Oversized results are valid saved photos.
  const minimumQuality = 0.5;
  let quality = 0.82;
  let smallest: Blob | undefined;

  // Bound encoding work, including pathological images that do not shrink well.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const blob = await encode(
      sourceWidth,
      sourceHeight,
      quality,
    );
    if (blob.type !== "image/jpeg" || blob.size === 0) {
      throw new Error("门头照片 JPEG 压缩失败，请重新选择图片");
    }
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= STOREFRONT_TARGET_BYTES) return blob;

    if (quality === minimumQuality) break;
    // JPEG size is not linear in quality: estimate the next quality from actual
    // output, validate every result, and never fall back to resizing or cropping.
    quality = Math.max(minimumQuality, Math.min(
      quality - 0.12,
      quality * (STOREFRONT_TARGET_BYTES / blob.size) * 0.95,
    ));
  }
  return smallest!;
}
