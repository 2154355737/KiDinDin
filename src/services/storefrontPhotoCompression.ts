const TARGET_BYTES = 500 * 1024;
const MIN_QUALITY = 0.5;
const MAX_DIMENSION = 2560;
const MIN_LONGEST_SIDE = 480;

function fileBaseName(fileName: string) {
  const trimmed = fileName.trim();
  const extensionIndex = trimmed.lastIndexOf(".");
  return extensionIndex > 0 ? trimmed.slice(0, extensionIndex) : trimmed || "storefront";
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("门头照片无法读取，请重新拍照或选择图片"));
    };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("门头照片压缩失败，请重新选择图片"));
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Re-encodes only newly selected storefront photos. Existing IndexedDB records
 * are deliberately never read or migrated here.
 */
export async function compressStorefrontPhoto(file: File) {
  if (file.size <= TARGET_BYTES) return file;

  const image = await loadImage(file);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const initialScale = Math.min(1, MAX_DIMENSION / longestSide);
  let width = Math.max(1, Math.round(image.naturalWidth * initialScale));
  let height = Math.max(1, Math.round(image.naturalHeight * initialScale));

  while (true) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前设备不支持门头照片压缩");
    context.drawImage(image, 0, 0, width, height);

    for (const quality of [0.88, 0.78, 0.68, 0.58, MIN_QUALITY]) {
      const blob = await canvasBlob(canvas, quality);
      if (blob.size <= TARGET_BYTES) {
        return new File([blob], `${fileBaseName(file.name)}.jpg`, {
          lastModified: file.lastModified,
          type: "image/jpeg",
        });
      }
    }

    const longest = Math.max(width, height);
    if (longest <= MIN_LONGEST_SIDE) break;
    const nextLongest = Math.max(
      MIN_LONGEST_SIDE,
      Math.round(longest * 0.8),
    );
    const nextScale = nextLongest / longest;
    width = Math.max(1, Math.round(width * nextScale));
    height = Math.max(1, Math.round(height * nextScale));
  }

  throw new Error(
    "门头照片无法压缩到 500 KB 以内，请裁剪图片后重新选择",
  );
}
