import { encodeStorefrontPhoto } from "./storefrontCompressionStrategy";

const TARGET_BYTES = 500 * 1024;
const MIN_QUALITY = 0.5;
const MAX_DIMENSION = 2560;
const MIN_LONGEST_SIDE = 480;

function fileBaseName(fileName: string) {
  const trimmed = fileName.trim();
  const extensionIndex = trimmed.lastIndexOf(".");
  return extensionIndex > 0 ? trimmed.slice(0, extensionIndex) : trimmed || "storefront";
}

function loadImage(file: File, imageLabel = "门头照片") {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const timeout = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      image.src = "";
      URL.revokeObjectURL(url);
      reject(new Error(`${imageLabel}读取超时，请重试`));
    }, 15_000);
    image.onload = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      reject(new Error(`${imageLabel}无法读取，请重新拍照或选择图片`));
    };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number, imageLabel = "门头照片") {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`${imageLabel}压缩失败，请重新选择图片`));
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Compresses an image to the shared upload target. Existing IndexedDB records
 * are deliberately never read or migrated here.
 */
export async function compressImageToTarget(file: File, imageLabel = "图片") {
  if (file.size <= TARGET_BYTES && file.type.toLowerCase() === "image/jpeg") {
    return file;
  }

  const image = await loadImage(file, imageLabel);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const initialScale = Math.min(1, MAX_DIMENSION / longestSide);
  let width = Math.max(1, Math.round(image.naturalWidth * initialScale));
  let height = Math.max(1, Math.round(image.naturalHeight * initialScale));

  while (true) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前设备不支持图片压缩");
    context.drawImage(image, 0, 0, width, height);

    for (const quality of [0.88, 0.78, 0.68, 0.58, MIN_QUALITY]) {
      const blob = await canvasBlob(canvas, quality, imageLabel);
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
    `${imageLabel}无法压缩到 500 KB 以内，请裁剪图片后重新选择`,
  );
}

function compressInWorker(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./storefrontPhotoCompression.worker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    const fail = () => {
      cleanup();
      reject(new Error("后台图片压缩不可用"));
    };
    const timeout = setTimeout(fail, 15_000);
    worker.onerror = (event) => {
      event.preventDefault();
      fail();
    };
    worker.onmessageerror = fail;
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
      const blob = event.data?.blob;
      if (!(blob instanceof Blob) || blob.type !== "image/jpeg" ||
          blob.size === 0) {
        fail();
        return;
      }
      cleanup();
      resolve(blob);
    };
    try {
      worker.postMessage(file);
    } catch {
      fail();
    }
  });
}

async function compressStorefrontOnMainThread(file: File) {
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前设备不支持图片压缩");
    let drawn = false;
    return await encodeStorefrontPhoto(image.naturalWidth, image.naturalHeight,
      async (width, height, quality) => {
        // Give the page a chance to respond between fallback encoding attempts.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!drawn) {
          canvas.width = width;
          canvas.height = height;
          context.drawImage(image, 0, 0);
          drawn = true;
        }
        return canvasBlob(canvas, quality);
      });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    image.src = "";
  }
}

export async function compressStorefrontPhoto(file: File) {
  if (file.size <= TARGET_BYTES && file.type.toLowerCase() === "image/jpeg") {
    // A MIME label and JPEG header alone do not prove a camera file is decodable.
    const image = await loadImage(file);
    image.src = "";
    return file;
  }
  let blob: Blob | undefined;
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" &&
      typeof createImageBitmap === "function" &&
      typeof OffscreenCanvas.prototype.convertToBlob === "function") {
    try {
      blob = await compressInWorker(file);
    } catch {
      // Older WebViews may expose APIs but fail to decode or start a worker.
    }
  }
  blob ??= await compressStorefrontOnMainThread(file);
  return new File([blob], `${fileBaseName(file.name)}.jpg`, {
    lastModified: file.lastModified,
    type: "image/jpeg",
  });
}
