import { encodeStorefrontPhoto } from "./storefrontCompressionStrategy";

// A narrow worker type avoids mixing the project's DOM and WebWorker lib types.
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<File>) => void) | null;
  postMessage: (message: { blob: Blob } | { error: string }) => void;
};

workerScope.onmessage = async ({ data: file }) => {
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const source = bitmap;
    canvas = new OffscreenCanvas(1, 1);
    const surface = canvas;
    const context = surface.getContext("2d");
    if (!context) throw new Error("后台图片压缩不可用");
    let drawn = false;
    const blob = await encodeStorefrontPhoto(source.width, source.height,
      async (width, height, quality) => {
        if (!drawn) {
          surface.width = width;
          surface.height = height;
          context.drawImage(source, 0, 0);
          drawn = true;
        }
        return surface.convertToBlob({ type: "image/jpeg", quality });
      });
    workerScope.postMessage({ blob });
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : "后台图片压缩失败",
    });
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
};
